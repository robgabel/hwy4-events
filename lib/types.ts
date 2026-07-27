// Event types describe WHAT an event is, not WHERE it happens. Venue-based
// buckets (lodge, club, resort) were removed in favor of activity types.
export type EventCategory =
  | "live_music"
  | "festival"
  | "civic"
  | "hike_walk"
  | "kids"
  | "wine"
  | "games"
  | "fine_arts"
  | "other";

export type EventStatus = "confirmed" | "tentative" | "cancelled";
export type EventVisibility = "public" | "private";
export type EventImportance = "major" | "minor";
export type EventVerificationStatus =
  | "unchecked"
  | "verified"
  | "needs_verification"
  | "dismissed";

// Typed cost signal. The human-readable amount stays in `price`; cost_tier is
// the handle the UI badges and the "Free only" filter key off.
export type EventCostTier =
  | "free"
  | "paid"
  | "donation"
  | "varies"
  | "unknown";

export interface Hwy4Event {
  id: string;
  name: string;
  description: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  venue_name: string;
  town: string;
  address: string | null;
  category: EventCategory;
  artists: string[] | null;
  status: EventStatus;
  price: string | null;
  cost_tier: EventCostTier;
  // When true, price + cost_tier are human-set; the scraper and
  // /api/extract-prices must not overwrite them. See dedup.ts + extract-prices.
  price_locked?: boolean;
  // When true, description is human-set; the scraper must not overwrite it.
  description_locked?: boolean;
  // When true, image_url is human-pinned; no scraper may overwrite it.
  poster_locked?: boolean;
  // True => a mundane recurring venue operation (Thursday dinner, Sunday brunch),
  // hidden from every public list. Only the sequoia-woods/moose-lodge write paths
  // set it. See lib/notability.ts + the read-time filters in lib/events-data.ts.
  is_routine?: boolean;
  // When true, is_routine is human-set; no scraper may overwrite it.
  notability_locked?: boolean;
  // Which notability rule (or "llm") fired — audit only, never rendered.
  routine_reason?: string | null;
  event_url: string | null;
  source_url: string;
  source_name: string | null;
  visibility: EventVisibility;
  org_slug: string | null;
  importance: EventImportance | null;
  dedup_key: string | null;
  last_scraped_at: string | null;
  /** DB-maintained row last-modified. Drives honest sitemap <lastmod>. */
  updated_at?: string | null;
  /** Row creation timestamp. The "added on" date in the community-submitted
   *  confidence note (lib/confidence.ts, WS-8). */
  created_at?: string | null;
  image_url: string | null;
  robs_pick: boolean;
  is_weekly: boolean;
  verification_status?: EventVerificationStatus;
  community_sourced?: boolean;
  venue_key?: string | null;
  /** Curated festival umbrella card — see CLAUDE.md "Festival umbrella rows"
   *  and `series_umbrella` in lib/event-identity.ts. Seed-script owned. */
  series_umbrella?: boolean;
}

/**
 * Per-venue display info shown on event detail pages. Keyed by the registry
 * key in scripts/lib/venues.ts. `blurb` is a local-voice paragraph; the rest of
 * the optional fields are live facts synced from the Google Places API. Any
 * field may be absent — the UI renders only what's present.
 */
export interface Hwy4Venue {
  venue_key: string;
  canonical: string;
  town: string;
  address: string | null;
  blurb: string | null;
  place_id: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  phone: string | null;
  website: string | null;
  maps_url: string | null;
  hours: string[] | null;
  // Factual Google Places attributes (dogs / kids / patio / groups / parking …),
  // synced weekly by /api/sync-venue-facts. Rendered as practical badges on the
  // event detail page (Tier A — verified, attributed to Google).
  places_attributes: Record<string, unknown> | null;
  places_synced_at: string | null;
}

export interface Hwy4Org {
  id: string;
  slug: string;
  display_name: string;
}

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  live_music: "Live Music",
  festival: "Festival",
  civic: "Community",
  hike_walk: "Hike & Walk",
  kids: "Kids",
  wine: "Wine",
  games: "Games",
  fine_arts: "Fine Arts",
  other: "Other",
};

export const CATEGORY_ICONS: Record<EventCategory, string> = {
  live_music: "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z",
  festival: "M21 15.546c-.523 0-1.046.151-1.5.454a2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0A1.75 1.75 0 003 15.546V12a9 9 0 0118 0v3.546z",
  civic: "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3",
  hike_walk: "M3 21l3.75-9L12 3l5.25 9L21 21H3z",
  kids: "M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  wine: "M8 3h8l-1 8a3 3 0 01-6 0L8 3zM12 14v5M9 21h6",
  games: "M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z",
  fine_arts: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01",
  other: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
};

/**
 * The subset of event fields the homepage/list render path actually reads
 * (EventList filtering + collapse, EventCard, and the bespoke card variants).
 * The full `Hwy4Event` also carries scrape-provenance and audit columns
 * (address, event_url, source_event_id, last_scraped_at, updated_at, …) that no
 * card renders. The homepage ships the entire upcoming set (~1,000 rows) into
 * the document for client-side filtering, so projecting to this shape (see
 * `toListEvents` in lib/events-data.ts) keeps the per-row payload to only what's
 * displayed. `CollapsedEvent` extends this, so the type checker proves no card
 * consumer reaches for a dropped field. Full rows still feed JSON-LD and the
 * detail page.
 */
export type EventListItem = Pick<
  Hwy4Event,
  | "id"
  | "name"
  | "description"
  | "date"
  | "start_time"
  | "end_time"
  | "venue_name"
  | "town"
  | "category"
  | "artists"
  | "status"
  | "price"
  | "cost_tier"
  | "image_url"
  | "visibility"
  | "org_slug"
  | "robs_pick"
  | "is_weekly"
  | "verification_status"
  | "community_sourced"
>;

export interface CollapsedEvent extends EventListItem {
  // Multi-day run collapsed to a date-range card (lib/collapse-events.ts).
  endDate?: string;
  dayCount?: number;
  isCollapsed?: boolean;
  // Range card whose remaining days run at different hours (kickoff evening +
  // all-day main day): times are nulled and the card says "Times vary".
  timesVary?: boolean;
  // Spaced recurring series collapsed to its next occurrence: how many
  // upcoming instances this card stands for, and the data-derived cadence
  // behind the card's "Weekly"/"Repeats" chip.
  seriesCount?: number;
  seriesCadence?: "weekly" | "recurring";
}

export { TOWNS } from "./towns";
