// Single source of truth for reading upcoming events.
//
// THE EGRESS FIX: every public page (homepage, /this-week, /this-weekend,
// /this-month, /towns/[slug], sitemap) used to run its OWN full-table scan of
// `hwy4_events` on every ISR revalidation. With ~30 pages each revalidating
// hourly and crawlers sweeping them, that was dozens of full-table reads per
// hour — the source of the Supabase free-tier egress overage.
//
// Now there is ONE cached fetch of the upcoming-events superset
// (`getUpcomingEvents`), and every page filters that in memory. One DB scan
// feeds the whole site per cache window instead of one scan per page.
//
// Cache invalidation: tagged `events`. The daily scraper / data backfills can
// bust it instantly by calling `/api/revalidate?secret=…&tag=events`. Absent an
// explicit bust, it self-refreshes every `REVALIDATE_SECONDS`.

import { unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { Hwy4Event } from "@/lib/types";
import { dedupeEvents } from "@/lib/dedupe-events";
import { gateEventDescription } from "@/lib/description-quality";
import { pacificToday } from "@/lib/date-windows";
import type { SitemapEventRow } from "@/lib/sitemap";

export const EVENTS_CACHE_TAG = "events";
const REVALIDATE_SECONDS = 1800; // 30 min upper bound on staleness
const PAGE_SIZE = 1000;

// Columns needed by the card renderer (EventCard), the read-time deduper
// (dedupe-events.ts), and the JSON-LD builders (schema.tsx). Trimmed vs. the
// old per-page selects: dropped `source_url`, `source_name`, and `importance`,
// which no list view or schema reads — smaller rows, less egress per scan.
const EVENT_COLUMNS =
  "id, name, description, date, start_time, end_time, venue_name, town, " +
  "address, category, artists, status, price, cost_tier, event_url, " +
  "source_event_id, image_url, visibility, org_slug, robs_pick, is_weekly, " +
  "verification_status, community_sourced, last_scraped_at, updated_at";

async function fetchUpcomingEvents(): Promise<Hwy4Event[]> {
  // "Today" in the corridor's Pacific civil date, NOT UTC. Computing it in UTC
  // rolls over to tomorrow at 5pm Pacific (4pm during PST), which dropped the
  // whole evening's events from every list. pacificToday() is the same helper
  // the /this-week|weekend|month pages already use.
  const today = pacificToday().iso;
  let all: Hwy4Event[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await getSupabase()
      .from("hwy4_events")
      .select(EVENT_COLUMNS) // no `count: exact` — it fired a second full scan
      .gte("date", today)
      .neq("status", "cancelled")
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("[events-data] fetchUpcomingEvents failed:", error);
      break;
    }
    all = all.concat((data ?? []) as unknown as Hwy4Event[]);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const deduped = dedupeEvents(all);
  console.log(
    `[events-data] fetched ${all.length} upcoming rows, ${deduped.length} after dedupe`
  );
  // Gate descriptions ONCE here, after dedupe: strip calendar-widget junk and
  // suppress meaningless stubs so no list card renders them. Done post-dedupe so
  // read-time clustering still sees raw text. See lib/description-quality.ts.
  return deduped.map(gateEventDescription);
}

/**
 * All upcoming, non-cancelled events (today onward), deduped. Cached across the
 * whole site so every page shares ONE database scan per cache window.
 */
export const getUpcomingEvents = unstable_cache(
  fetchUpcomingEvents,
  ["hwy4-upcoming-events"],
  { revalidate: REVALIDATE_SECONDS, tags: [EVENTS_CACHE_TAG] }
);

/** Events whose date falls within [start, end] inclusive (ISO YYYY-MM-DD). */
export async function getEventsInRange(
  start: string,
  end: string
): Promise<Hwy4Event[]> {
  const all = await getUpcomingEvents();
  return all.filter((e) => e.date >= start && e.date <= end);
}

/** Upcoming events in a single town, capped (already deduped upstream). */
export async function getEventsInTown(
  townName: string,
  limit = 20
): Promise<Hwy4Event[]> {
  const all = await getUpcomingEvents();
  return all.filter((e) => e.town === townName).slice(0, limit);
}

/** Minimal rows for sitemap URL generation: identity + the recency/curation
 *  signals the sitemap selector needs (honest lastmod, keep-curated-picks). */
export async function getUpcomingEventSlugRows(): Promise<SitemapEventRow[]> {
  const all = await getUpcomingEvents();
  return all.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    town: e.town,
    updated_at: e.updated_at ?? null,
    robs_pick: e.robs_pick,
  }));
}

/** Most recent scrape timestamp across upcoming events (for the "Last checked"
 *  badge). Derived from the cached set — no extra query. */
export async function getLastScrapedAt(): Promise<string | null> {
  const all = await getUpcomingEvents();
  let latest: string | null = null;
  for (const e of all) {
    if (e.last_scraped_at && (!latest || e.last_scraped_at > latest)) {
      latest = e.last_scraped_at;
    }
  }
  return latest;
}
