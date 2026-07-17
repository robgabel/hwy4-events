import { classifyEventCategory } from "./categorize";

/**
 * Event NOTABILITY judgment — the single source of truth for deciding whether a
 * scraped row is a real EVENT or just a venue's mundane recurring OPERATIONS.
 *
 * The rule (Rob's): being open to serve a meal is not an event; a special
 * occasion with a hook (live music, a guest, a theme, a one-off) is. So a
 * "Thursday Night Dinner" / "Sunday Brunch" / "Wednesday Deli Special" /
 * "Restaurant Open for Father's Day" is routine (hidden); a concert, a car show,
 * or a "Special Monthly Dinner with Live Music" is a real event (kept).
 *
 * Structured exactly like lib/categorize.ts (keyword floor + `reconcile*`) so the
 * two behave consistently:
 *  - A Tier-0 NOTABLE HOOK (live-music category, or an explicit hook token) or a
 *    Tier-1 ROUTINE meal pattern is AUTHORITATIVE — an LLM guess cannot flip it.
 *    This encodes "a hook beats being open to serve a meal": "Special Monthly
 *    Dinner with Live Music" is notable even though "Dinner" would otherwise read
 *    as routine, because the hook is checked first.
 *  - A Tier-2 SOFT routine signal is weak; an LLM may confirm or clear it.
 *
 * ONLY the two operational-venue write paths (sequoia-woods, moose-lodge) run
 * this and persist `is_routine`. No other source sets the flag — see the
 * OPERATIONAL_ORG_SLUGS gate in scripts/lib/dedup.ts.
 */

export interface NotabilitySignals {
  /** Weekly recurrence — a strong "operational" tell when paired with a meal. */
  is_weekly?: boolean;
  /** The row's category, if already known (live_music => a notable hook). */
  category?: string | null;
}

export interface DetailedNotability {
  /** True => hide it (a routine venue operation, not an event). */
  isRoutine: boolean;
  /** Which rule fired (for audit / bounded backfills); null on no match. */
  rule: string | null;
  /** True when the floor is a hard call the LLM must not override. */
  authoritative: boolean;
}

// Tier-0 NOTABLE hooks (besides live-music, which is caught via category). Any of
// these => a real event, no matter what meal words also appear. Scoped to the two
// operational venues (meals-or-concerts), so broad tokens are safe here.
const NOTABLE_HOOK =
  /\b(car show|car cruise|festival|fest|fundraiser|benefit|tournament|scramble|gala|casino night|murder mystery|themed|theme night|trivia|comedy|open mic|karaoke|dance party|dj\b|live band|live music|guest (?:chef|speaker|artist|dj|bartender)|featuring|anniversary|grand opening|new year'?s eve|nye|oktoberfest|cinco de mayo|st\.? patrick|halloween party|christmas party|holiday party|crab feed|chili cook)\b/;

// Tier-1 AUTHORITATIVE routine: mundane, standing meal/bar service. Checked only
// after the hooks above, so a meal WITH a hook has already been cleared.
const ROUTINE_STRONG: RegExp[] = [
  // "<Weekday> [Night] <meal>": Thursday Night Dinner, Sunday Brunch, Wednesday Deli Special
  /\b(?:sun|mon|tues|wednes|thurs|fri|satur)day(?: night)?\s+(?:dinner|brunch|breakfast|lunch|supper|buffet|deli special|special|bbq)\b/,
  // Named recurring nights / menu specials
  /\b(?:taco tuesday|prime rib night|fish fry|pasta night|wing night|burger night|steak night|spaghetti (?:night|dinner)|deli special|daily special|dinner special|lunch special|breakfast special)\b/,
  // Meal service as the whole subject of the title
  /^(?:breakfast|brunch|lunch|dinner|supper|happy hour|weekly dinner|member dinner)\b/,
  // "Open/Serving for <holiday>" — the restaurant is just open with a menu
  /\b(?:open|now open|serving|dining|dinner|brunch|breakfast|buffet)\s+(?:for|on)\s+(?:father'?s|mother'?s|easter|thanksgiving|christmas|new year|valentine'?s?|memorial day|labor day|independence day|4th of july)\b/,
  // "<Holiday> <meal>" with no hook — a holiday menu, not an event
  /\b(?:father'?s day|mother'?s day|easter|thanksgiving|christmas|valentine'?s day|memorial day|labor day)\s+(?:brunch|breakfast|dinner|buffet|lunch|meal|service|special)\b/,
  // A rented-out hall is not a public event: the Moose calendar lists
  // "Private Dinner Party" / "Private Event" blocks for hall rentals.
  /^private\s+(?:\w+\s+)?(?:party|event|rental|dinner|luncheon|reception)\b/,
];

// Tier-2 SOFT routine: a weak meal-service signal an LLM may confirm or clear.
// Deliberately does NOT include a bare "dinner"/"lunch" — those appear in real
// events ("Summer Scramble / Dinner"), so only the strong day/holiday-anchored
// forms above treat them as routine.
const ROUTINE_SOFT =
  /\b(brunch|buffet|breakfast|happy hour|dinner service|meal service|kitchen open|bar open|now serving)\b/;

// Any meal noun — used only when is_weekly is already true (weekly + a meal is an
// operational tell).
const MEAL_NOUN = /\b(dinner|brunch|breakfast|lunch|supper|buffet|deli|meal)\b/;

/**
 * Full notability judgment: routine-or-not, which rule fired, and whether that
 * call is authoritative (an LLM must not override it). Most callers want the
 * `classifyRoutine` convenience wrapper.
 */
export function classifyNotabilityDetailed(
  text: string,
  signals?: NotabilitySignals,
): DetailedNotability {
  const hay = text.toLowerCase();

  // Tier 0 — notable hooks beat everything.
  const category = signals?.category ?? classifyEventCategory(text);
  if (category === "live_music") {
    return { isRoutine: false, rule: "hook_live_music", authoritative: true };
  }
  if (NOTABLE_HOOK.test(hay)) {
    return { isRoutine: false, rule: "hook", authoritative: true };
  }

  // Tier 1 — authoritative routine meal service.
  for (const re of ROUTINE_STRONG) {
    if (re.test(hay)) {
      return { isRoutine: true, rule: "routine_meal", authoritative: true };
    }
  }

  // Tier 2 — soft routine (LLM may confirm or clear).
  if (ROUTINE_SOFT.test(hay)) {
    return { isRoutine: true, rule: "routine_soft", authoritative: false };
  }
  if (signals?.is_weekly && MEAL_NOUN.test(hay)) {
    return { isRoutine: true, rule: "weekly_meal", authoritative: false };
  }

  return { isRoutine: false, rule: null, authoritative: false };
}

/** Convenience: just the boolean. */
export function classifyRoutine(text: string, signals?: NotabilitySignals): boolean {
  return classifyNotabilityDetailed(text, signals).isRoutine;
}

/**
 * Reconcile the keyword floor with an LLM's routine verdict. One place, shared by
 * every operational writer that runs an LLM (the Moose PDF route today), so the
 * precedence can't drift:
 *  - An AUTHORITATIVE floor (either direction) WINS over the LLM.
 *  - Otherwise the LLM boolean decides (it may confirm or clear a soft match).
 *  - Otherwise the soft floor stands (LLM absent / non-boolean).
 */
export function reconcileNotability(
  keyword: DetailedNotability,
  llm: boolean | null | undefined,
): boolean {
  if (keyword.authoritative) return keyword.isRoutine;
  if (typeof llm === "boolean") return llm;
  return keyword.isRoutine;
}
