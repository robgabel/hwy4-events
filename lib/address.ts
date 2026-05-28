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
 * Build a Google Maps directions URL for an event. Prefers a real street
 * string (via resolveDisplayAddress) so the user lands at the right place
 * rather than a town centroid; falls back to the venue name.
 */
export function buildDirectionsUrl(
  address: string | null,
  town: string,
  venueName: string
): string {
  const resolved = resolveDisplayAddress(address, town);
  const destination = resolved
    ? `${resolved}, ${town}, CA`
    : `${venueName}, ${town}, CA`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
