import { cache } from "react";
import { generateEventSlug } from "./slugs";
import type { Hwy4Event } from "./types";

// Shared by the event detail page and the generated-poster route so the slug →
// event resolution can't drift. `image_url` is included because the poster
// branching (supplied vs generated) keys off it.
export const EVENT_COLUMNS =
  "id, name, description, date, start_time, end_time, venue_name, town, address, category, artists, status, price, cost_tier, event_url, source_url, source_name, visibility, org_slug, importance, robs_pick, community_sourced, venue_key, image_url";

const PAGE_SIZE = 60;

const matchSlug = (events: Hwy4Event[] | null, slug: string): Hwy4Event | null =>
  events?.find((e) => generateEventSlug(e.name, e.date, e.town) === slug) ?? null;

/**
 * Resolve an event from its computed slug. Wrapped in React cache() so repeated
 * lookups in one request (page + metadata) share a single fetch. The slug embeds
 * the date (YYYY-MM-DD), so we query just that date; falls back to a paginated
 * scan only when the date can't be parsed.
 */
export const findEventBySlug = cache(
  async (slug: string): Promise<Hwy4Event | null> => {
    const { getSupabase } = await import("./supabase");
    const supabase = getSupabase();

    const dateMatch = slug.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      const { data } = await supabase
        .from("hwy4_events")
        .select(EVENT_COLUMNS)
        .eq("date", dateMatch[0])
        .neq("status", "cancelled");
      const hit = matchSlug(data as unknown as Hwy4Event[] | null, slug);
      if (hit) return hit;
    }

    const today = new Date().toISOString().split("T")[0];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("hwy4_events")
        .select(EVENT_COLUMNS)
        .gte("date", today)
        .neq("status", "cancelled")
        .order("date", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error || !data) break;
      const hit = matchSlug(data as unknown as Hwy4Event[], slug);
      if (hit) return hit;
      if (data.length < PAGE_SIZE) break;
    }
    return null;
  }
);
