/**
 * Venues whose listings are curated manually (e.g. once-a-year batch insert
 * from a printed flyer). Scrapers must skip events that match these so they
 * don't overwrite the hand-cleaned rows with messier auto-scraped versions.
 *
 * Match logic: case-insensitive substring against the event's name and
 * venue_name. Keep patterns broad enough to catch source-name variants
 * ("Cameo Plaza Merchants", "Cameo Plaza, Arnold", etc.) but narrow enough
 * to avoid false positives.
 */
const MANUAL_VENUE_PATTERNS: readonly string[] = [
  "cameo plaza",
];

export interface MatchableEvent {
  name?: string | null;
  venue_name?: string | null;
}

export function isManuallyManagedEvent(e: MatchableEvent): boolean {
  const haystack = `${e.name ?? ""} ${e.venue_name ?? ""}`.toLowerCase();
  return MANUAL_VENUE_PATTERNS.some((p) => haystack.includes(p));
}
