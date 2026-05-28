// Event types describe WHAT an event is, not WHERE it happens. Venue-based
// buckets (lodge, club, resort) were removed in favor of activity types.
export type EventCategory =
  | "live_music"
  | "festival"
  | "civic"
  | "hike_walk"
  | "kids"
  | "wine"
  | "other";

export type EventStatus = "confirmed" | "tentative" | "cancelled";
export type EventVisibility = "public" | "private";
export type EventImportance = "major" | "minor";
export type EventVerificationStatus =
  | "unchecked"
  | "verified"
  | "needs_verification"
  | "dismissed";

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
  event_url: string | null;
  source_url: string;
  source_name: string | null;
  visibility: EventVisibility;
  org_slug: string | null;
  importance: EventImportance | null;
  dedup_key: string | null;
  last_scraped_at: string | null;
  image_url: string | null;
  robs_pick: boolean;
  is_weekly: boolean;
  verification_status?: EventVerificationStatus;
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
  other: "Other",
};

export const CATEGORY_ICONS: Record<EventCategory, string> = {
  live_music: "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z",
  festival: "M21 15.546c-.523 0-1.046.151-1.5.454a2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0A1.75 1.75 0 003 15.546V12a9 9 0 0118 0v3.546z",
  civic: "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3",
  hike_walk: "M3 21l3.75-9L12 3l5.25 9L21 21H3z",
  kids: "M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  wine: "M8 3h8l-1 8a3 3 0 01-6 0L8 3zM12 14v5M9 21h6",
  other: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
};

export interface CollapsedEvent extends Hwy4Event {
  endDate?: string;
  dayCount?: number;
  isCollapsed?: boolean;
}

export { TOWNS } from "./towns";
