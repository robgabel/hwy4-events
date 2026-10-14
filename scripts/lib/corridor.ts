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
 * Core cities are matched as a bare substring. They are specific enough that
 * a street named after them has not shown up in corridor addresses. Do not
 * add a common street word ("linden", "oakdale") here — those go in
 * VALLEY_NON_CORRIDOR_CITIES and match as a city token. Longer names stay
 * ahead of shorter ones so "san andreas" cannot be confused with a shorter
 * token.
 */
const CORE_NON_CORRIDOR_CITIES = [
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
  // Alpine County, over Ebbetts Pass — BVAC's events page lists the Death
  // Ride (Turtle Rock Park, Markleeville), which is outside the corridor.
  "markleeville",
];

/**
 * Towns inside the Copperopolis Facebook Discover radius that are not on the
 * Hwy 4 corridor: the Central Valley and Stanislaus side west of Copperopolis.
 * Matched as a city token (see addressHasCityToken), not a bare substring, so
 * "Linden St" or "Oakdale Road" in Murphys still passes.
 *
 * Milton is deliberately absent. It is in Calaveras County, next to
 * Copperopolis (ZIP 95684). A Milton address must not be dropped.
 */
const VALLEY_NON_CORRIDOR_CITIES = [
  "jenny lind",
  "knights ferry",
  "farmington",
  "riverbank",
  "waterford",
  "oakdale",
  "escalon",
  "linden",
];

export const NON_CORRIDOR_CITIES = [
  ...CORE_NON_CORRIDOR_CITIES,
  ...VALLEY_NON_CORRIDOR_CITIES,
];

/**
 * Postal codes for the valley cities above. Facebook addresses always carry
 * a ZIP, and a 5-digit token cannot collide with a corridor town name.
 * 95230 is Farmington only — Milton's ZIP is 95684, which is not listed.
 * 95252 is both Jenny Lind and Valley Springs (already a core city).
 * A city-shaped Milton address is exempt from 95230 anyway, because some
 * geocoders stamp Milton with the neighboring Farmington ZIP.
 */
const NON_CORRIDOR_ZIPS = [
  "95230",
  "95361",
  "95320",
  "95236",
  "95252",
  "95367",
  "95386",
];

const STREET_SUFFIX =
  "(?!\\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|cir|circle|pl|place)\\b)";

/**
 * Known out-of-corridor venues that scrapers keep tagging with a corridor
 * town. Matched against venue_name (substring, normalized lowercase). Use this
 * when the event's address is null/missing so the city-based check can't fire.
 */
export const NON_CORRIDOR_VENUES = [
  "laughton ranch", // Jackson, Amador County — off Hwy 49/88, not Hwy 4
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Apostrophes folded so "Knight's Ferry" matches the city "knights ferry". */
function foldPlace(s: string): string {
  return s.toLowerCase().replace(/['’]/g, "");
}

/**
 * City token, not a street name. "Linden, CA" and ", Farmington," match;
 * "Linden St" and "Oakdale Road" do not. A bare "Farmington" matches too,
 * which is what a town field looks like.
 */
function addressHasCityToken(folded: string, city: string): boolean {
  const esc = escapeRegExp(city);
  const re = new RegExp(
    `(?:^|,)\\s*${esc}\\b(?:\\s*,|\\s+ca\\b|\\s+california\\b|$)`
  );
  return re.test(folded);
}

function hasZip(folded: string, zip: string): boolean {
  return new RegExp(`(?:^|\\D)${zip}(?:-\\d{4})?(?:\\D|$)`).test(folded);
}

/**
 * Milton the town, not "Milton Road". Official ZIP is 95684. Some geocoders
 * still write Farmington's 95230 on a Milton address, so that ZIP is ignored
 * when the city token is Milton.
 */
function namesMilton(folded: string): boolean {
  return addressHasCityToken(folded, "milton");
}

/** Returns true if the address text mentions a known non-corridor city. */
export function isNonCorridorAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const folded = foldPlace(addr);
  if (CORE_NON_CORRIDOR_CITIES.some((c) => folded.includes(c))) return true;
  if (VALLEY_NON_CORRIDOR_CITIES.some((c) => addressHasCityToken(folded, c))) {
    return true;
  }
  // 95230 beside a Milton city token is a geocoder conflation, not Farmington.
  return NON_CORRIDOR_ZIPS.some((zip) => {
    if (zip === "95230" && namesMilton(folded)) return false;
    return hasZip(folded, zip);
  });
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
function descriptionHasCity(
  folded: string,
  city: string,
  streetGuard: boolean
): boolean {
  const esc = escapeRegExp(city);
  const guard = streetGuard ? STREET_SUFFIX : "";
  // "in <city>" or "<city>, CA/California", but never "<city> Fault".
  // Valley cities also refuse a street suffix ("in Linden Street").
  const re = new RegExp(
    `(?:\\bin\\s+${esc}${guard}|\\b${esc}\\s*,\\s*(?:ca\\b|california\\b))(?!\\s*fault)`
  );
  return re.test(folded);
}

export function isNonCorridorDescription(
  text: string | null | undefined
): boolean {
  if (!text) return false;
  const folded = foldPlace(text);
  if (CORE_NON_CORRIDOR_CITIES.some((city) => descriptionHasCity(folded, city, false))) {
    return true;
  }
  return VALLEY_NON_CORRIDOR_CITIES.some((city) =>
    descriptionHasCity(folded, city, true)
  );
}

/**
 * Drop test for the upsert path: an event is out-of-corridor if its address
 * or town names a non-corridor city, its venue is a known out-of-corridor
 * venue, or its description carries a strong locative out-of-corridor signal
 * (the last covers rows whose structured location was mislabeled to a corridor
 * town). A blank address with town "Farmington" still drops. A corridor town
 * in that slot does not.
 */
export function isOutOfCorridor(
  address: string | null | undefined,
  venueName: string | null | undefined,
  description?: string | null | undefined,
  town?: string | null | undefined
): boolean {
  return (
    isNonCorridorAddress(address) ||
    isNonCorridorAddress(town) ||
    isNonCorridorVenue(venueName) ||
    isNonCorridorDescription(description)
  );
}

/**
 * Join the pieces of a Facebook location (street, full address, city — not
 * the feed's contextual "near Copperopolis" label) and run the corridor
 * check. A split city field never reaches `address`, and the mapper would
 * otherwise stamp the feed town. Returns true when the event must be dropped
 * before that stamp.
 */
export function isOutOfCorridorLocation(
  parts: Array<string | null | undefined>,
  venueName?: string | null,
  description?: string | null
): boolean {
  const text = parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
  return isOutOfCorridor(text || null, venueName, description);
}
