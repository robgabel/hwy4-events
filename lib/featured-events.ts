import type { Hwy4Event } from "@/lib/types";

// Marquee events that step out of the standard category styling into a bespoke,
// fully-themed Old Glory treatment. Two distinct levels live here, once, so the
// card and the detail page can't disagree about which events are special.
//
// 1. PARADE — the Arnold Independence Day Parade. Earns the full red-carpet:
//    the patriotic list card AND a custom parade-only detail microsite (route,
//    "Marching in the parade?", organizer contact). Keyed off org_slug because
//    it's a stable handle that survives title/date edits.
//
// 2. FOURTH FEATURE — other events that should wear the patriotic skin on the
//    Fourth of July itself: the patriotic list card + a red/white/blue banner
//    atop their OWN detail page (NOT the parade microsite — they keep their real
//    flyer/description/map). Keyed by event id, because a multi-day festival
//    (e.g. Sierra Nevada Arts & Crafts, Jul 4-5) should light up ONLY its July-4
//    row, and the two days share a title, org_slug (null), and venue — id is the
//    only thing that tells the 4th apart from the 5th.
const PARADE_ORG_SLUGS = new Set<string>(["arnold-parade"]);

const FOURTH_FEATURE_EVENT_IDS = new Set<string>([
  "dddfef2b-df2d-43a8-89a6-2006bfcf20da", // Sierra Nevada Arts & Crafts Festival — Sat Jul 4 2026
]);

/** The Arnold parade: special card + the bespoke parade detail microsite. */
export function isParadeEvent(event: Pick<Hwy4Event, "org_slug">): boolean {
  return !!event.org_slug && PARADE_ORG_SLUGS.has(event.org_slug);
}

/**
 * An event that gets the Old Glory banner on its OWN detail page (keeping its
 * real content) rather than the parade microsite. Festival-style July-4 feature.
 */
export function isFourthFeatureEvent(event: Pick<Hwy4Event, "id">): boolean {
  return FOURTH_FEATURE_EVENT_IDS.has(event.id);
}

/**
 * Events that render the red/white/blue list card with the "July 4th" tag: the
 * parade plus any Fourth-of-July feature event.
 */
export function isPatrioticCard(
  event: Pick<Hwy4Event, "org_slug" | "id">
): boolean {
  return isParadeEvent(event) || isFourthFeatureEvent(event);
}
