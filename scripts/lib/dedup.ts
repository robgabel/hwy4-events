import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin.js";
import type { ExtractedEvent } from "./extract.js";
import { KNOWN_VENUES } from "./venues.js";

/**
 * Heuristic: does a string look like a street address?
 * Matches "1276 S. Main St", "48B Copper Cove Dr", "3353 East Highway 4 …".
 * Used to recover from scrapers that wrote the address into the venue_name
 * field (e.g. GoCalaveras for the Arnold Spring Peddlers Faire row).
 */
function looksLikeStreetAddress(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  // Starts with house number (with optional letter suffix like "48B"),
  // followed by at least one word character.
  return /^\d+[A-Z]?\s+[A-Za-z]/.test(trimmed);
}

/**
 * Look up a venue's registered address by matching venue_name or any alias
 * against KNOWN_VENUES.
 */
function findRegisteredAddress(venueName: string | null | undefined): string | null {
  if (!venueName) return null;
  const target = venueName.toLowerCase().trim();
  for (const v of Object.values(KNOWN_VENUES)) {
    if (v.canonical.toLowerCase() === target) return v.address ?? null;
    for (const a of v.aliases) {
      if (a === target) return v.address ?? null;
    }
  }
  return null;
}

/**
 * Three-tier scrape-time address resolution:
 *
 *   1. Event's own address (if it looks real).
 *   2. Venue-registry address (when venue_name matches a registered venue).
 *   3. (Town defaults are render-time only — keep DB nullable so we can tell
 *      "we don't actually know" from "this is the town centroid".)
 *
 * Also: if venue_name *itself* is a street address and event.address is null,
 * swap them (recover from scrapers that crossed wires).
 */
export function normalizeEventLocation(event: ExtractedEvent): void {
  // Address-in-venue-name recovery
  if (!event.address && looksLikeStreetAddress(event.venue_name)) {
    event.address = event.venue_name;
    event.venue_name = "Unknown Venue";
  }
  // Registry fill-in
  if (!event.address) {
    const registered = findRegisteredAddress(event.venue_name);
    if (registered) event.address = registered;
  }
}

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
    // Normalize location fields before keying / writing — recovers from
    // scrapers that crossed venue_name with address, and back-fills address
    // from the venue registry where possible.
    normalizeEventLocation(event);

    const dedupKey = generateDedupKey(event.name, event.date, event.town);

    // Prefer the source-side stable id when the scraper provided one — this
    // survives town/venue/name changes so re-scrapes can update in place.
    // Falls back to dedup_key for sources that don't have a stable id.
    let existing: {
      id: string;
      name: string;
      venue_name: string;
      description: string | null;
      start_time: string | null;
      end_time: string | null;
      price: string | null;
      event_url: string | null;
      address: string | null;
      town: string;
      image_url: string | null;
    } | null = null;

    if (event.source_event_id) {
      const { data } = await supabaseAdmin
        .from("hwy4_events")
        .select(
          "id, name, venue_name, description, start_time, end_time, price, event_url, address, town, image_url"
        )
        .eq("source_name", sourceName)
        .eq("source_event_id", event.source_event_id)
        .maybeSingle();
      existing = data ?? null;
    }
    if (!existing) {
      const { data } = await supabaseAdmin
        .from("hwy4_events")
        .select(
          "id, name, venue_name, description, start_time, end_time, price, event_url, address, town, image_url"
        )
        .eq("dedup_key", dedupKey)
        .maybeSingle();
      existing = data ?? null;
    }

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
            // Keep dedup_key in sync with the (possibly-changed) town so
            // dedup_key lookups still find this row if source_event_id
            // ever disappears.
            dedup_key: dedupKey,
            ...(event.source_event_id && {
              source_event_id: event.source_event_id,
            }),
            last_scraped_at: now,
          })
          .eq("id", existing.id);
        result.updated++;
      } else {
        // Just touch last_scraped_at — but also opportunistically backfill
        // source_event_id on pre-existing rows that pre-date this column
        // being populated.
        await supabaseAdmin
          .from("hwy4_events")
          .update({
            last_scraped_at: now,
            ...(event.source_event_id && {
              source_event_id: event.source_event_id,
            }),
          })
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
        source_event_id: event.source_event_id ?? null,
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
