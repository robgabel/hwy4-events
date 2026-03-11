export type EventCategory =
  | "live_music"
  | "festival"
  | "civic"
  | "resort"
  | "lodge"
  | "other";

export type EventStatus = "confirmed" | "tentative" | "cancelled";

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
}

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  live_music: "Live Music",
  festival: "Festival",
  civic: "Community",
  resort: "Resort",
  lodge: "Lodge",
  other: "Other",
};

export const CATEGORY_ICONS: Record<EventCategory, string> = {
  live_music: "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z",
  festival: "M21 15.546c-.523 0-1.046.151-1.5.454a2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0A1.75 1.75 0 003 15.546V12a9 9 0 0118 0v3.546z",
  civic: "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3",
  resort: "M3 21l3.75-9L12 3l5.25 9L21 21H3z",
  lodge: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  other: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
};

export const TOWNS = [
  "Angels Camp",
  "Murphys",
  "Arnold",
  "Avery",
  "Bear Valley",
  "Dorrington",
  "White Pines",
] as const;
