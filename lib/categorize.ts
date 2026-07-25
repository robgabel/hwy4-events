import type { EventCategory } from "./types";

/**
 * Keyword-based event categorizer — the single source of truth for deriving an
 * EventCategory from an event's free text (title, and optionally description /
 * source-provided category names).
 *
 * Categories describe WHAT the event is, not WHERE. Order matters: most specific
 * patterns first. Returns "other" when nothing matches.
 *
 * Two precedence tiers (see `classifyEventCategoryDetailed` + `reconcileCategory`):
 *  - AUTHORITATIVE rules fire on high-precision tokens (bingo, opera, karaoke,
 *    pottery, blood drive, …). When one matches, the category is near-certain, so
 *    an LLM guess does NOT get to override it. This closes the old hole where a
 *    confident-wrong LLM could flip a clearly-named event into the wrong bucket
 *    (the Eugene fork hit this hard: venue boilerplate dumped its whole classical
 *    season into Live Music).
 *  - SOFT rules are weaker signals; an LLM MAY upgrade them to a more specific
 *    category, but may never downgrade a specific keyword result to "other".
 *
 * Used by:
 *  - the GoCalaveras + Facebook scrapers (deterministic floor, reconciled with an
 *    LLM via `reconcileCategory`)
 *  - the Visit Murphys scraper + feed-ingest (title + source category names; no LLM)
 *  - the `/admin/submissions` publish form (submitted name + description)
 */

export const VALID_CATEGORIES: readonly EventCategory[] = [
  "live_music",
  "festival",
  "civic",
  "hike_walk",
  "kids",
  "wine",
  "games",
  "fine_arts",
  "other",
];

export interface DetailedCategory {
  /** The resolved category ("other" if nothing matched). */
  category: EventCategory;
  /** Which rule fired (for debugging / bounded backfills); null on no match. */
  rule: string | null;
  /** True when a high-precision keyword fired → should win over an LLM guess. */
  authoritative: boolean;
}

interface CategoryRule {
  category: EventCategory;
  rule: string;
  pattern: RegExp;
  authoritative: boolean;
}

// Ordered, most-specific first. Where a category has both unambiguous and weak
// tokens it's split into an authoritative rule immediately followed by a soft
// rule. This preserves the original single-regex behavior exactly — the UNION of
// tokens per category and the cross-category order are unchanged — while letting
// the unambiguous tokens carry override weight. Verified token-for-token against
// the pre-2026-06-23 single-regex classifier; the only deliberate category-output
// change is "blood drive" → civic (was "other"), matching the red-cross scraper.
const RULES: CategoryRule[] = [
  { category: "live_music", rule: "live_music_strong", authoritative: true,
    pattern: /\b(live music|open mic|karaoke)\b/ },
  { category: "live_music", rule: "live_music", authoritative: false,
    pattern: /\b(concert|dj|trio|band|acoustic|jazz|blues)\b/ },

  { category: "wine", rule: "wine_strong", authoritative: true,
    pattern: /\b(wine|winery|vineyard|wine tasting|mimosa)\b/ },
  { category: "wine", rule: "wine", authoritative: false,
    pattern: /\b(tasting|sip & |sip and )\b/ },

  // "trail workday" / "identification walk" sit alongside "trail stewardship":
  // trail-work and docent-led interpretive walks are the same outdoors-on-foot
  // bucket a reader browsing Hike & Walk is looking for. Added 2026-07-25 with
  // the Arnold Rim Trail source, whose whole calendar is guided hikes, tree-ID
  // walks, and volunteer trail workdays.
  { category: "hike_walk", rule: "hike_walk", authoritative: false,
    pattern: /\b(hike|(?:guided|nature|bird|wildflower|interpretive|identifier|identification|docent) walks?|trail run|fun run|5k|trail stewardship|trail work ?days?)\b/ },

  // Strong performing-arts signals run BEFORE "kids": a play's blurb often
  // mentions "family"/"children", which would otherwise misroute it into "kids".
  { category: "fine_arts", rule: "performing_arts_strong", authoritative: true,
    pattern: /\b(opera|ballet|shakespeare|playhouse)\b/ },
  { category: "fine_arts", rule: "performing_arts", authoritative: false,
    pattern: /\b(theater|theatre|broadway|matinee|one-act)\b/ },

  { category: "kids", rule: "kids", authoritative: false,
    pattern: /\b(kids|kid|children|family|youth|teens?|tweens?|day camp|summer camp|adventure camp|forest school|creek critters|easter egg|story ?time)\b/ },

  { category: "games", rule: "games_strong", authoritative: true,
    pattern: /\b(bingo|trivia|bocce|cribbage|poker)\b/ },
  { category: "games", rule: "games", authoritative: false,
    pattern: /\b(pool tournament|card tournament|game night)\b/ },

  // Remaining Fine Arts: comedy/improv + visual/craft arts. After "kids" so a
  // kids' art/pottery camp still lands in "kids".
  { category: "fine_arts", rule: "visual_arts_strong", authoritative: true,
    pattern: /\b(pottery|ceramics?|wheel throwing|paint (?:and|&) sip|sip (?:and|&) paint|open studio)\b/ },
  { category: "fine_arts", rule: "visual_arts", authoritative: false,
    pattern: /\b(improv|drama|comedy|stand-?up|art gallery|art exhibit|art show|paint|painting|drawing|sketching|sculpt)\b/ },

  { category: "festival", rule: "festival", authoritative: false,
    pattern: /\b(festival|fair|celebration|fest)\b/ },

  { category: "civic", rule: "civic_strong", authoritative: true,
    pattern: /\b(farmers market|flea market|car show|car cruise|blood drive)\b/ },
  { category: "civic", rule: "civic", authoritative: false,
    pattern: /\b(meeting|fundraiser|breakfast|luncheon|town hall|public hearing|council|board)\b/ },
];

// Venue self-description that injects a false category signal when a scraper drags
// the venue blurb into the event text — e.g. "the foothills' most beautiful concert
// venue" pushing a comedy night into live_music. Stripped before matching. Tight on
// purpose: only a (category-word + venue-noun) pair, so real event phrases like
// "Concert in the Park" or "Summer Concert Series" are untouched.
const VENUE_BOILERPLATE =
  /\b(?:premier |beautiful |historic |intimate |stunning |iconic )?(?:live[- ]music|concert|event|performance|performing[- ]arts)[- ](?:venue|hall|center|centre|space)\b/gi;

// Act-name noise: "family" as part of a band's NAME or lineup phrasing is not a
// kids signal — "Willie Nelson & Family" was classified kids off exactly this
// (2026-07-16 QA). Strip only the band-shaped usages ("& Family", "and Family",
// "Family Band", "Family lineup"); a genuine "family day" / "fun for the whole
// family" keeps its bare "family" token and still routes to kids.
// ("Family Band" drops only the "family" via lookahead — "band" itself is a
// legitimate live_music token and must survive the strip).
// NOTE: no leading \b before "&" — there is no word boundary between a space
// and "&", so "\b&" can never match and "Willie Nelson & Family" sailed
// straight through to kids (2026-07-17 QA, the regex's second miss).
const ACT_NAME_NOISE =
  /(?:(?:&|\band)\s+family\b|\bfamily(?=\s+(?:band|lineup)\b))/gi;

function stripVenueBoilerplate(text: string): string {
  return text.replace(VENUE_BOILERPLATE, " ").replace(ACT_NAME_NOISE, " ");
}

/**
 * Full classification result: the category, which rule fired, and whether that
 * rule is authoritative (high-precision → should beat an LLM). The scrapers use
 * this; everyone else can use the `classifyEventCategory` convenience wrapper.
 */
export function classifyEventCategoryDetailed(text: string): DetailedCategory {
  const haystack = stripVenueBoilerplate(text.toLowerCase());
  for (const r of RULES) {
    if (r.pattern.test(haystack)) {
      return { category: r.category, rule: r.rule, authoritative: r.authoritative };
    }
  }
  return { category: "other", rule: null, authoritative: false };
}

/** Convenience: just the category. Stable signature for the no-LLM callers. */
export function classifyEventCategory(text: string): EventCategory {
  return classifyEventCategoryDetailed(text).category;
}

/**
 * Reconcile the keyword classification with an LLM's category guess. One place,
 * shared by every scraper that runs an LLM classifier, so the precedence rule
 * can't drift between them:
 *  - An AUTHORITATIVE keyword match WINS over the LLM (the fix).
 *  - Otherwise the LLM may UPGRADE a soft/"other" keyword result to a specific
 *    category, but may never downgrade a specific keyword result to "other".
 */
export function reconcileCategory(
  keyword: DetailedCategory,
  llm: string | null | undefined,
): EventCategory {
  if (keyword.authoritative) return keyword.category;
  if (llm && llm !== "other" && (VALID_CATEGORIES as readonly string[]).includes(llm)) {
    return llm as EventCategory;
  }
  return keyword.category;
}
