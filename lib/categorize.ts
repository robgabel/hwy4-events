import type { EventCategory } from "./types";

/**
 * Keyword-based event categorizer — the single source of truth for deriving an
 * EventCategory from an event's free text (title, and optionally description /
 * source-provided category names).
 *
 * Categories describe WHAT the event is, not WHERE. Order matters: most specific
 * patterns first. Returns "other" when nothing matches.
 *
 * Used by:
 *  - the Visit Murphys scraper (`scripts/scrapers/visit-murphys.ts`), which feeds
 *    in the title + the source's own category names
 *  - the `/admin/submissions` publish form, which feeds in the submitted name +
 *    description so community submissions (the `/submit` form collects no
 *    category) default to the right type instead of always falling back to
 *    "other" (e.g. "Karaoke at Murphys Irish Pub" → live_music).
 */
export function classifyEventCategory(text: string): EventCategory {
  const haystack = text.toLowerCase();

  if (/\b(live music|concert|dj|open mic|trio|band|acoustic|jazz|blues|karaoke)\b/.test(haystack)) {
    return "live_music";
  }
  if (/\b(wine|vineyard|winery|tasting|mimosa|sip & |sip and )\b/.test(haystack)) return "wine";
  if (/\b(hike|guided walk|nature walk|bird walk|trail run|fun run|5k|trail stewardship)\b/.test(haystack)) {
    return "hike_walk";
  }
  // Strong performing-arts signals run BEFORE "kids": a play's blurb often
  // mentions "family"/"children" ("Henry V", "What the Constitution Means to
  // Me"), which would otherwise misroute the production into "kids".
  if (/\b(theater|theatre|playhouse|shakespeare|broadway|matinee|one-act|opera|ballet)\b/.test(haystack)) {
    return "fine_arts";
  }
  if (/\b(kids|kid|children|family|youth|day camp|summer camp|adventure camp|forest school|creek critters|easter egg|story time)\b/.test(haystack)) {
    return "kids";
  }
  if (/\b(bingo|trivia|bocce|pool tournament|cribbage|card tournament|game night|poker)\b/.test(haystack)) {
    return "games";
  }
  // Remaining Fine Arts: comedy/improv and visual/craft arts (pottery, painting,
  // drawing). After "kids" so a kids art/pottery camp still lands in "kids".
  if (/\b(improv|drama|comedy|stand-?up|art gallery|art exhibit|art show|painting|drawing|sketching|pottery|ceramic|ceramics|wheel throwing|sculpt|paint (?:and|&) sip|sip (?:and|&) paint|open studio)\b/.test(haystack)) {
    return "fine_arts";
  }
  if (/\b(festival|fair|celebration|fest)\b/.test(haystack)) return "festival";
  if (/\b(meeting|fundraiser|breakfast|luncheon|town hall|public hearing|council|board|farmers market|flea market|car show|car cruise)\b/.test(haystack)) {
    return "civic";
  }
  return "other";
}
