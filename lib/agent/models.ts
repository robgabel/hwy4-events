// One place for Anthropic model ids. Callsites import these instead of
// inlining a string, so a bump cannot leave a stale id behind.
//
// Opus 5.5 adaptive thinking cannot be turned off. The first content block is
// often `thinking` (empty when display is omitted). Read replies with
// messageText() in ./message-text.ts, never content[0].
//
// Sonnet 5 also thinks by default, and it does accept thinking: { type: "disabled" }.
// Scrape and dedup paths that must return a bare JSON array pass THINKING_DISABLED.
// Reasoners leave thinking on and set MEDIUM_EFFORT so the API default (`high`)
// does not spend the whole max_tokens budget on thinking.

/** Voice copy: briefings, newsletter, venue blurbs, town-page drafts. */
export const PREMIUM_COPY_MODEL = "claude-opus-5-5";

/** Reasoners, research, and structured extraction. */
export const REASONER_MODEL = "claude-sonnet-5";

/** Alias for the default non-Haiku model. */
export const DEFAULT_MODEL = REASONER_MODEL;

/** Cheap classifiers. Do not bump this id without a separate decision. */
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/** Alias for the Haiku classifier. */
export const EXTRACT_MODEL = HAIKU_MODEL;

/**
 * Depth lever for Opus 5.5 voice drafts and for Sonnet 5 reasoners.
 * Medium keeps adaptive thinking shallow enough that a short reply still
 * finishes inside a raised max_tokens cap. Thinking tokens count against
 * that cap.
 */
export const MEDIUM_EFFORT = { effort: "medium" } as const;

/**
 * Sonnet 5 only. A false "yes" on dedup drops a real event, and the Firecrawl
 * / vision / email extractors parse a bare JSON array. Thinking off preserves
 * the pre-bump shape: the reply is the JSON, and max_tokens is not shared
 * with a thinking block. Opus 5.5 rejects this.
 */
export const THINKING_DISABLED = { type: "disabled" } as const;
