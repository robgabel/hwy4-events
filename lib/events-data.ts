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
import { Hwy4Event, EventListItem } from "@/lib/types";
import { dedupeEvents } from "@/lib/dedupe-events";
import { pacificToday, addDays } from "@/lib/date-windows";
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
  return deduped;
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

// The homepage is a near-term "what's on" feed, not the full catalog. The whole
// upcoming set (~1,000 rows stretching to 2028, including ~300 weekly-recurrence
// instances) is shipped into the client for filtering, so bounding it to a
// horizon is the single biggest payload cut — and a horizon naturally trims both
// the far-future one-offs and the weekly-recurrence tail in one move. The deep
// catalog stays fully reachable on /this-week, /this-month, the town pages, and
// the sitemap, all of which read the uncapped getUpcomingEvents above. Curated
// robs_pick highlights bypass the cap so an event further out is never hidden
// from the homepage. Tune the window with this one constant.
const HOMEPAGE_HORIZON_DAYS = 60;

export async function getHomepageEvents(): Promise<Hwy4Event[]> {
  const all = await getUpcomingEvents();
  const cutoff = addDays(pacificToday().iso, HOMEPAGE_HORIZON_DAYS);
  return all.filter((e) => e.date <= cutoff || e.robs_pick);
}

// The homepage (and other list views) renders ~25 cards at a time but holds the
// whole upcoming set in the client for instant filtering. Shipping every row's
// full `description` (the card clamps it to 2-3 lines) plus scrape-only columns
// (address, event_url, source_event_id, last_scraped_at, updated_at) bloated the
// document to ~1.6MB for ~1,000 events. `toListEvents` projects each row to the
// display shape and trims the description, so only what a card shows crosses the
// wire. Full rows stay available for JSON-LD (buildItemList) and the detail page.
const LIST_DESCRIPTION_MAX = 280;

function truncateForList(text: string | null): string | null {
  if (!text || text.length <= LIST_DESCRIPTION_MAX) return text;
  const slice = text.slice(0, LIST_DESCRIPTION_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  // Prefer a word boundary, but don't backtrack so far we lose half the teaser.
  const cut =
    lastSpace > LIST_DESCRIPTION_MAX * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + "…";
}

/** Project full event rows to the lightweight shape the card/list render path
 *  reads, with the description trimmed. Use for any client list that receives
 *  the upcoming superset (homepage). */
export function toListEvents(events: Hwy4Event[]): EventListItem[] {
  return events.map((e) => ({
    id: e.id,
    name: e.name,
    description: truncateForList(e.description),
    date: e.date,
    start_time: e.start_time,
    end_time: e.end_time,
    venue_name: e.venue_name,
    town: e.town,
    category: e.category,
    artists: e.artists,
    status: e.status,
    price: e.price,
    cost_tier: e.cost_tier,
    image_url: e.image_url,
    visibility: e.visibility,
    org_slug: e.org_slug,
    robs_pick: e.robs_pick,
    is_weekly: e.is_weekly,
    verification_status: e.verification_status,
    community_sourced: e.community_sourced,
  }));
}

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
