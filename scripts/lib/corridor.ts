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
 * Detect a strong *locative* out-of-corridor signal in free-text (a
 * description/blurb). This exists because aggregators like gocalaveras.com are
 * county-wide, and a listing's structured venue/town/address can be flat wrong
 * while its own prose states the truth. The real-world case that motivated it:
 * the "Calaveras Community Band" July 4 concert whose description read "at
 * Turner Park in San Andreas" while the scraped town/venue/address were all
 * (wrongly) tagged Murphys, so the address-only corridor filter let it through.
 *
 * We deliberately require a locative phrase — "in <city>" or "<city>, CA" —
 * rather than a bare substring, and explicitly exclude "San Andreas Fault"
 * (a geological feature, not a location), so in-corridor trail/nature listings
 * that merely name the fault, or a Murphys event that mentions driving over
 * from a neighboring town, are never wrongly dropped. Low false-positive by
 * design. Mirrors the DB-layer backstop trigger so ingest and the database
 * agree on what "in San Andreas" means.
 */
export function isNonCorridorDescription(
  text: string | null | undefined
): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return NON_CORRIDOR_CITIES.some((city) => {
    const esc = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "in <city>" or "<city>, CA/California", but never "<city> Fault".
    const re = new RegExp(
      `(?:\\bin\\s+${esc}|\\b${esc}\\s*,\\s*(?:ca\\b|california\\b))(?!\\s*fault)`
    );
    return re.test(lower);
  });
}

/**
 * Drop test for the upsert path: an event is out-of-corridor if its address
 * names a non-corridor city, its venue is a known out-of-corridor venue, or its
 * description carries a strong locative out-of-corridor signal (the last covers
 * rows whose structured location was mislabeled to a corridor town).
 */
export function isOutOfCorridor(
  address: string | null | undefined,
  venueName: string | null | undefined,
  description?: string | null | undefined
): boolean {
  return (
    isNonCorridorAddress(address) ||
    isNonCorridorVenue(venueName) ||
    isNonCorridorDescription(description)
  );
}
