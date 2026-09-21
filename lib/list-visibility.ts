// One gate between the shared upcoming feed and a rendered event card.
//
// Two rules, applied together so a new list cannot reopen either hole (HWY-45):
//
// 1. `is_routine` rows never become cards. The detail lookup
//    (lib/events.ts) 404s them with no private exemption. A list that showed
//    one, including inside an opted-in club, would be a dead link. The shared
//    fetch drops them too; this is the second check.
//
// 2. `visibility === "private"` rows render only when their `org_slug` is in
//    `enabledOrgs`. An empty set is the public feed. The homepage Clubs
//    toggle fills the set. Every other list passes nothing and stays public.
//
// Relative-import free and dependency free so scripts/test can load it.

export type ListVisibilityEvent = {
  visibility?: string | null;
  org_slug?: string | null;
  is_routine?: boolean | null;
};

/** No club opted in. The default for every list that is not the homepage. */
const NO_CLUBS: ReadonlySet<string> = new Set();

/**
 * Whether this row may render as a card for the given club opt-in.
 * Public non-routine rows always pass. Routine rows never pass.
 */
export function isListableEvent(
  event: ListVisibilityEvent,
  enabledOrgs: ReadonlySet<string> = NO_CLUBS
): boolean {
  if (event.is_routine === true) return false;
  if (event.visibility === "private") {
    return !!event.org_slug && enabledOrgs.has(event.org_slug);
  }
  return true;
}

/** The list filter. Omit `enabledOrgs` (or pass an empty set) for the public feed. */
export function filterListableEvents<T extends ListVisibilityEvent>(
  events: readonly T[],
  enabledOrgs: ReadonlySet<string> = NO_CLUBS
): T[] {
  return events.filter((event) => isListableEvent(event, enabledOrgs));
}
