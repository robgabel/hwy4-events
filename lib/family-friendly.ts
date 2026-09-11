// Read-time family-friendly tag, orthogonal to `hwy4_events.category`.
//
// Category describes WHAT the event is (live_music, festival, civic, …) and is
// single-valued, so a free outdoor concert that says "Dogs and kids welcome"
// correctly stays live_music. Jen's homepage Kids chip used to key off
// category==='kids' alone, which hid every family-signalled event that had
// already won a more specific type. This lens is the tag that category could
// not be: explicit hospitality/audience language promotes; age-gate language
// vetoes even a "kids welcome" mention. Never-guess: bare "family"/"kids" is
// not enough (Willie Nelson & Family, Children's Advocacy Center, "friends,
// family and supporters"). No column, no backfill, no recategorization.
//
// Consumer: EventList's Kids quick chip (`matchesKidsFilter`). Event Type
// checkboxes stay category-pure so Mia's Live Music filter is unchanged.
//
// Relative (not "@/") imports so the scripts/ test runner can import this.
// Locked by scripts/test/family-friendly.test.ts.

import type { EventCategory } from "./types";

export type FamilyFriendlyFields = {
  name: string;
  description?: string | null;
};

export type KidsFilterFields = FamilyFriendlyFields & {
  category: EventCategory;
};

// Admission-shaped age gates only. "For those 21 and over, bloody marys" at a
// pancake breakfast that also prices kids under 12 is NOT an age-gated event.
// `21+` / `18+` sit outside the trailing `\b`: `+` is a non-word char, so
// `\b` never fires between `+` and a space (`21+ event` would miss).
const AGE_GATE =
  /(?:(?:18|21)\s*\+|\b(?:(?:18|21)\s*(?:and|&)\s*(?:over|older)\s*(?:only|required|to\s+(?:enter|attend|come)|admitted|event)|must\s+be\s+(?:18|21)|no\s+minors|adults?\s*[- ]?only|(?:18|21)\s+to\s+(?:enter|attend)|no\s+(?:one|kids|children|minors|guests?)\s+under\s+(?:18|21)|ages?\s*(?:18|21)\s*\+|age(?:s)?[- ]restricted|strictly\s+(?:18|21)|not\s+(?:recommended\s+)?for\s+(?:kids|children|minors))\b)/;

// Explicit claims that kids/families are an intended audience. Phrase-level
// on purpose: a token match on "family" or "kids" is how categorize.ts used
// to steal concerts into the kids bucket, and it is the wrong tool here.
const FAMILY_SIGNAL =
  /\b(?:family[- ]friendly|kid[- ]friendly|kids[- ]friendly|child[- ]friendly|children[- ]friendly|(?:kids?|children)\s+welcome|dogs\s+and\s+kids\s+welcome|kids\s+and\s+dogs\s+welcome|all[- ]ages(?:\s+welcome)?|fun\s+for\s+(?:the\s+)?(?:whole\s+)?family|(?:the\s+)?whole\s+family|family\s+day|family\s+festival|family\s+activit(?:y|ies)|family\s+event|bring\s+(?:your\s+|the\s+)?(?:kids|children|family)|bring\s+(?:your\s+)?friends\s+and\s+family|for\s+families|for\s+the\s+whole\s+family|for\s+kids|for\s+children|kids?\s+under\s+\d+|children\s+under\s+\d+|kids?\s+\d+\s+and\s+under|child(?:ren)?(?:['’]s)?\s+tickets?|kids['’]?\s+tickets?|stroller[- ]friendly|strollers?\s+welcome)\b/;

function haystack(e: FamilyFriendlyFields): string {
  return `${e.name}\n${e.description ?? ""}`
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'");
}

/** True when name+description explicitly invite families/kids. */
export function isFamilyFriendly(e: FamilyFriendlyFields): boolean {
  const text = haystack(e);
  // `.search` always starts at index 0 (unlike `RegExp#test` with /g).
  if (text.search(AGE_GATE) >= 0) return false;
  return text.search(FAMILY_SIGNAL) >= 0;
}

/**
 * Homepage Kids chip: primary-kids rows always pass (their category already
 * won that slot); everything else must earn the derived tag. Age-gate exclude
 * applies only to the tag, never to a stored `kids` category.
 */
export function matchesKidsFilter(e: KidsFilterFields): boolean {
  if (e.category === "kids") return true;
  return isFamilyFriendly(e);
}
