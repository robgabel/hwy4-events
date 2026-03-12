import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin.js";
import type { ExtractedEvent } from "./extract.js";

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Generate a deterministic dedup key from event name + date + town.
 */
export function generateDedupKey(
  name: string,
  date: string,
  town: string
): string {
  const input = `${name.toLowerCase().trim()}|${date}|${town.toLowerCase().trim()}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

/**
 * Upsert extracted events into hwy4_events.
 * Uses dedup_key to avoid duplicates and update changed fields.
 */
export async function upsertEvents(
  events: ExtractedEvent[],
  sourceName: string,
  orgSlug: string,
  sourceUrl: string
): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };

  for (const event of events) {
    const dedupKey = generateDedupKey(event.name, event.date, event.town);

    // Check for existing event with this dedup key
    const { data: existing } = await supabaseAdmin
      .from("hwy4_events")
      .select("id, description, start_time, end_time, price, event_url")
      .eq("dedup_key", dedupKey)
      .maybeSingle();

    const now = new Date().toISOString();

    if (existing) {
      // Check if any mutable fields changed
      const changed =
        existing.description !== event.description ||
        existing.start_time !== event.start_time ||
        existing.end_time !== event.end_time ||
        existing.price !== event.price ||
        existing.event_url !== event.event_url;

      if (changed) {
        await supabaseAdmin
          .from("hwy4_events")
          .update({
            description: event.description,
            start_time: event.start_time,
            end_time: event.end_time,
            price: event.price,
            event_url: event.event_url,
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
        price: event.price,
        event_url: event.event_url,
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
