import type { EventCategory } from "@/lib/types";

type OutdoorSignalEvent = {
  name?: string | null;
  venue_name?: string | null;
  category?: EventCategory | null;
};

const OUTDOOR_PATTERN =
  /\b(park|amphitheater|amphitheatre|market|garden|riverfront|plaza|field|fairgrounds|outdoor|trail|waterfront|stadium|patio|pavilion|farmers market)\b/i;

const INDOOR_VENUE_PATTERN =
  /\b(theater|theatre|hall|gallery|library|museum|lodge|arena|auditorium|ballroom|club|cafe|exhibit hall|convention center|center for the performing arts)\b/i;

export function isOutdoorEvent(event: OutdoorSignalEvent): boolean {
  const venue = event.venue_name ?? "";
  const name = event.name ?? "";
  const text = `${name} ${venue}`;

  if (event.category === "hike_walk") return true;
  if (event.category === "festival") {
    return !INDOOR_VENUE_PATTERN.test(text) && OUTDOOR_PATTERN.test(text);
  }

  if (OUTDOOR_PATTERN.test(venue)) return !INDOOR_VENUE_PATTERN.test(venue);

  if (OUTDOOR_PATTERN.test(name)) {
    return !INDOOR_VENUE_PATTERN.test(text);
  }

  return false;
}
