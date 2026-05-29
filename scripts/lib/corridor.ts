/**
 * Hwy 4 corridor membership helpers.
 *
 * Shared by the GoCalaveras scraper (which drops non-corridor events at fetch
 * time) and the upsert path (a belt-and-suspenders drop that covers EVERY
 * source — some aggregators, e.g. visit-calaveras, tag an out-of-area venue
 * with a corridor town and slip past per-scraper filters).
 */

/**
 * Known nearby cities that are NOT in the Hwy 4 corridor. Events located in
 * these cities should be dropped, even when a scraper/LLM tagged them with a
 * corridor town.
 *
 * Order matters: longer/more specific names first so e.g. "san andreas" is
 * matched before any "andreas" substring confusion.
 */
export const NON_CORRIDOR_CITIES = [
  "mokelumne hill",
  "san andreas",
  "valley springs",
  "wallace",
  "rail road flat",
  "railroad flat",
  "west point",
  "mountain ranch",
  "burson",
  "campo seco",
  "glencoe",
  "jackson",
  "sutter creek",
  "pioneer",
  "stockton",
  "lodi",
  "sonora",
  "columbia",
  "jamestown",
];

/**
 * Known out-of-corridor venues that scrapers keep tagging with a corridor
 * town. Matched against venue_name (substring, normalized lowercase). Use this
 * when the event's address is null/missing so the city-based check can't fire.
 */
export const NON_CORRIDOR_VENUES = [
  "laughton ranch", // Jackson, Amador County — off Hwy 49/88, not Hwy 4
];

/** Returns true if the address text mentions a known non-corridor city. */
export function isNonCorridorAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const lower = addr.toLowerCase();
  return NON_CORRIDOR_CITIES.some((c) => lower.includes(c));
}

/** Returns true if the venue name matches a known out-of-corridor venue. */
export function isNonCorridorVenue(venue: string | null | undefined): boolean {
  if (!venue) return false;
  const lower = venue.toLowerCase();
  return NON_CORRIDOR_VENUES.some((v) => lower.includes(v));
}

/**
 * Drop test for the upsert path: an event is out-of-corridor if either its
 * address names a non-corridor city or its venue is a known out-of-corridor
 * venue.
 */
export function isOutOfCorridor(
  address: string | null | undefined,
  venueName: string | null | undefined
): boolean {
  return isNonCorridorAddress(address) || isNonCorridorVenue(venueName);
}
