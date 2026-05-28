import { TOWN_INFO } from "@/lib/towns";

/**
 * Three-tier address cascade used to drive the map pin, directions URL,
 * structured data, and the Location dd on the event detail page:
 *
 *   1. The event's own address, if present.
 *   2. (Future: venue-registry address — added in PR #3 when the registry
 *      is wired into the Next.js bundle.)
 *   3. The town's defaultAddress (e.g. Arnold → "961 Highway 4, Arnold CA").
 *
 * Returns null when no tier resolves. The Location display falls back to
 * "<town>, California" in that case, which is still safe.
 */
export function resolveDisplayAddress(
  address: string | null,
  town: string
): string | null {
  if (address && address.trim()) return address.trim();
  const townDefault = TOWN_INFO[town]?.defaultAddress;
  if (townDefault) return townDefault;
  return null;
}

/**
 * Best destination string for a directions URL. Prefers a real street string
 * (via resolveDisplayAddress) so the user lands at the right place rather than
 * a town centroid; falls back to the venue name.
 */
export function resolveDestination(
  address: string | null,
  town: string,
  venueName: string
): string {
  const resolved = resolveDisplayAddress(address, town);
  return resolved ? `${resolved}, ${town}, CA` : `${venueName}, ${town}, CA`;
}

/** Google Maps directions URL (universal — works on Android, desktop, and iOS). */
export function buildDirectionsUrl(
  address: string | null,
  town: string,
  venueName: string
): string {
  const destination = resolveDestination(address, town, venueName);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/**
 * Build a clean freeform query for geocoding (Nominatim). Event addresses are
 * messy — suite numbers and an embedded "<town> CA <zip>" tail confuse the
 * geocoder. We keep only the street portion (everything before the town name),
 * drop suite/unit segments, then re-append a normalized ", <town>, CA".
 * Returns null when there's no street address to geocode (caller falls back to
 * the town centroid). Directions URLs do NOT use this — Google/Apple tolerate
 * the raw string and prefer the richer original.
 */
export function buildGeocodeQuery(address: string | null, town: string): string | null {
  const resolved = resolveDisplayAddress(address, town);
  if (!resolved) return null;

  let street = resolved;
  const townIdx = street.toLowerCase().indexOf(town.toLowerCase());
  if (townIdx > 0) street = street.slice(0, townIdx);
  street = street
    .replace(/,?\s*(suite|ste\.?|unit|apt\.?|#)\s*[\w-]+/gi, "")
    .replace(/[,\s]+$/, "")
    .trim();

  if (!street) return null;
  return `${street}, ${town}, CA`;
}

/** Apple Maps directions URL — preferred on iOS, opens the Maps app. */
export function buildAppleDirectionsUrl(
  address: string | null,
  town: string,
  venueName: string
): string {
  const destination = resolveDestination(address, town, venueName);
  return `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}`;
}
