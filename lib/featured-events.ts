import type { Hwy4Event } from "@/lib/types";

// Marquee community events that get a bespoke, fully-themed treatment (special
// card on the list + a custom detail-page layout) instead of the standard
// category styling. The "special event" set is defined here, once, so the card
// and the detail page can't disagree about which events are special.
//
// Keyed off org_slug because it's a stable handle that survives title/date
// edits. Add a slug here when an event earns the full red-carpet treatment.
const PATRIOTIC_ORG_SLUGS = new Set<string>(["arnold-parade"]);

export function isPatrioticEvent(
  event: Pick<Hwy4Event, "org_slug">
): boolean {
  return !!event.org_slug && PATRIOTIC_ORG_SLUGS.has(event.org_slug);
}
