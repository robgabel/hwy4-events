import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin.js";
import type { ExtractedEvent } from "./extract.js";

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
  skippedFuzzy: number;
}

/**
 * Normalize an event name for dedup comparison.
 * Collapses dash variants, extra whitespace, and minor punctuation differences.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Replace all dash/hyphen variants (en-dash, em-dash, minus, etc.) with plain hyphen
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    // Collapse multiple spaces/whitespace to single space
    .replace(/\s+/g, " ")
    // Remove leading "the " (sometimes appears/disappears)
    .replace(/^the\s+/, "")
    // Normalize common punctuation
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"');
}

/**
 * Towns that should be treated as equivalent for dedup purposes.
 * Maps variant → canonical name.
 */
const TOWN_ALIASES: Record<string, string> = {
  "white pines": "arnold",
  "hathaway pines": "arnold",
};

function normalizeTown(town: string): string {
  const lower = town.toLowerCase().trim();
  return TOWN_ALIASES[lower] ?? lower;
}

/**
 * Generate a deterministic dedup key from event name + date + town.
 */
export function generateDedupKey(
  name: string,
  date: string,
  town: string
): string {
  const input = `${normalizeName(name)}|${date}|${normalizeTown(town)}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

/**
 * Upsert extracted events into hwy4_events.
 * Uses dedup_key to avoid duplicates and update changed fields.
 */
/**
 * Simple similarity score between two normalized strings (0-1).
 * Uses longest common substring ratio.
 */
function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  if (shorter.length === 0) return 0;
  // Check if one contains the other
  if (longer.includes(shorter)) return shorter.length / longer.length;
  // Levenshtein-based similarity
  const maxLen = Math.max(na.length, nb.length);
  const dist = levenshtein(na, nb);
  return 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

export async function upsertEvents(
  events: ExtractedEvent[],
  sourceName: string,
  orgSlug: string,
  sourceUrl: string
): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0 };

  for (const event of events) {
    const dedupKey = generateDedupKey(event.name, event.date, event.town);

    // Check for existing event with this dedup key
    const { data: existing } = await supabaseAdmin
      .from("hwy4_events")
      .select(
        "id, name, venue_name, description, start_time, end_time, price, event_url, address, town, image_url"
      )
      .eq("dedup_key", dedupKey)
      .maybeSingle();

    const now = new Date().toISOString();

    if (existing) {
      // Check if any mutable fields changed
      const changed =
        existing.name !== event.name ||
        existing.venue_name !== event.venue_name ||
        existing.description !== event.description ||
        existing.start_time !== event.start_time ||
        existing.end_time !== event.end_time ||
        existing.price !== event.price ||
        existing.event_url !== event.event_url ||
        existing.address !== event.address ||
        existing.town !== event.town ||
        existing.image_url !== (event.image_url ?? null);

      if (changed) {
        await supabaseAdmin
          .from("hwy4_events")
          .update({
            name: event.name,
            venue_name: event.venue_name,
            description: event.description,
            start_time: event.start_time,
            end_time: event.end_time,
            price: event.price,
            event_url: event.event_url,
            address: event.address,
            town: event.town,
            image_url: event.image_url ?? null,
            last_scraped_at: now,
          })
          .eq("id", existing.id);
        result.updated++;
      } else {
        // Just touch last_scraped_at
        await supabaseAdmin
          .from("hwy4_events")
          .update({ last_scraped_at: now })
          .eq("id", existing.id);
        result.unchanged++;
      }
    } else {
      // Fuzzy match: check for near-duplicate on same date in same/nearby town
      const canonicalTown = normalizeTown(event.town);
      const { data: candidates } = await supabaseAdmin
        .from("hwy4_events")
        .select("id, name, town")
        .eq("date", event.date);

      const fuzzyMatch = candidates?.find((c) => {
        const sameTown = normalizeTown(c.town) === canonicalTown;
        return sameTown && similarity(c.name, event.name) >= 0.85;
      });

      if (fuzzyMatch) {
        // Update existing event with better data, re-key it
        await supabaseAdmin
          .from("hwy4_events")
          .update({
            dedup_key: dedupKey,
            last_scraped_at: now,
          })
          .eq("id", fuzzyMatch.id);
        result.skippedFuzzy++;
        console.log(`  Fuzzy dedup: "${event.name}" matched existing "${fuzzyMatch.name}"`);
        continue;
      }

      // Insert new event
      const { error } = await supabaseAdmin.from("hwy4_events").insert({
        name: event.name,
        description: event.description,
        date: event.date,
        start_time: event.start_time,
        end_time: event.end_time,
        venue_name: event.venue_name,
        town: event.town,
        address: event.address,
        category: event.category,
        artists: event.artists,
        status: "confirmed",
        is_past: false,
        price: event.price,
        event_url: event.event_url,
        image_url: event.image_url ?? null,
        source_url: sourceUrl,
        source_name: sourceName,
        visibility: "public",
        org_slug: orgSlug,
        dedup_key: dedupKey,
        last_scraped_at: now,
      });

      if (error) {
        console.error(`Failed to insert event "${event.name}":`, error.message);
      } else {
        result.inserted++;
      }
    }
  }

  return result;
}
