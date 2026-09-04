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
  "551f2b7b-6ae3-4d2a-89bb-5ebfa77098bd", // 4th of July Celebration at the Murphys Historic Hotel — Sat Jul 4 2026
  "5270c640-aec6-4144-b005-fcaa8767654d", // Murphys 4th of July Parade — Sat Jul 4 2026 (noon, down Main St)
]);

// 2.5. AMERICA'S 250TH FEATURE — a patriotic feature that is NOT on the Fourth of
//    July. The Hot Copper Car Show (Sat Jun 20 2026, Copperopolis Town Square)
//    kicks off the summer of America's 250th, so it wears the Old Glory skin but
//    with a "America's 250th" tag (not "July 4th") and its own "Red, White &
//    Chrome" banner on its detail page. Same shape as a Fourth Feature: patriotic
//    list card + a banner atop its OWN detail page (keeps the real poster/desc/
//    map). Keyed by event id.
const TWO_FIFTY_EVENT_IDS = new Set<string>([
  "a658adc7-9311-4d25-99da-a59800e437a7", // Hot Copper Car Show — Sat Jun 20 2026
]);

// 3. ADOPT-A-PET DAY — a warm, dogs-and-cats skin: a pet-celebrating list card
//    plus a banner atop its OWN detail page (it keeps its real shelter poster,
//    description, and map). Keyed by event id so only this specific Saturday
//    lights up; future shelter events stay standard until added here.
const ADOPT_A_PET_EVENT_IDS = new Set<string>([
  "a1721b10-cfbb-4ef1-8ed0-567a152de04c", // California Adopt-a-Pet Day — Sat Jun 6 2026, Calaveras Humane Society
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
 * An America's-250th feature that is NOT on the Fourth of July (the Hot Copper
 * Car Show, Jun 20). Gets the Old Glory banner on its OWN detail page with the
 * bespoke "Red, White & Chrome" treatment, keeping its real poster/desc/map.
 */
export function isTwoFiftyEvent(event: Pick<Hwy4Event, "id">): boolean {
  return TWO_FIFTY_EVENT_IDS.has(event.id);
}

/**
 * Events that render the red/white/blue list card: the parade, any Fourth-of-July
 * feature, and the America's-250th feature (which tags as "America's 250th"
 * rather than "July 4th" — see patrioticCardTag).
 */
export function isPatrioticCard(
  event: Pick<Hwy4Event, "org_slug" | "id">
): boolean {
  return (
    isParadeEvent(event) || isFourthFeatureEvent(event) || isTwoFiftyEvent(event)
  );
}

/**
 * The pill label on a patriotic list card. Fourth-of-July events read "July 4th";
 * the America's-250th feature (June, not the 4th) reads "America's 250th" so the
 * card doesn't claim a date it isn't on.
 */
export function patrioticCardTag(event: Pick<Hwy4Event, "id">): string {
  return isTwoFiftyEvent(event) ? "America's 250th" : "July 4th";
}

/**
 * Adopt-a-Pet Day: the warm dogs-and-cats list card + a banner on its own detail
 * page. Keyed by event id.
 */
export function isAdoptAPetEvent(event: Pick<Hwy4Event, "id">): boolean {
  return ADOPT_A_PET_EVENT_IDS.has(event.id);
}

// 4. CLASSIC ROCK NIGHT — Flashback at the Ebbetts Pass Moose Lodge gets a
//    vinyl-and-amp skin: a bespoke list card + a banner atop its OWN detail page
//    (it keeps its real poster/description/map). Keyed by a name + venue
//    PREDICATE rather than an event id on purpose: this concert is written by
//    several scrapers (the lodge calendar, GoCalaveras) that churn the row, so
//    the surviving id is not stable. Matching on "flashback" + "moose lodge"
//    lands on whichever row wins the read-time dedupe collapse.
export function isClassicRockEvent(
  event: Pick<Hwy4Event, "name" | "venue_name">
): boolean {
  const name = (event.name ?? "").toLowerCase();
  const venue = (event.venue_name ?? "").toLowerCase();
  return name.includes("flashback") && venue.includes("moose");
}
