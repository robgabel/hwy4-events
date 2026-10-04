/**
 * Honest WebPage dateModified (HWY-60).
 *
 * Nine page types used to stamp `dateModified: new Date()` on every render, so
 * a fixed editorial guide that is empty off-season claimed to change daily.
 * That is a guess presented as fact, which the never-guess rule forbids.
 *
 * The page was last modified when the newest thing it renders was: the latest
 * `updated_at` among the events on the page, or the hand-maintained
 * `editorialUpdated` date of the page's own copy, whichever is later. When the
 * page has neither (a list page on an empty day), the field is omitted. Town
 * pages already follow this shape with `content.lastVerified`.
 *
 * Pure, so scripts/ tests import it directly.
 */

export type ModifiedRow = { updated_at?: string | null };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function instant(value: string): number | null {
  const ms = ISO_DAY.test(value)
    ? Date.parse(`${value}T00:00:00Z`)
    : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Latest of the rendered rows' `updated_at` and the editorial date, returned as
 * the original string (an ISO timestamp or a YYYY-MM-DD day, both valid
 * schema.org dates), or null when nothing on the page is datable.
 */
export function pageDateModified(
  rows: readonly ModifiedRow[],
  editorialUpdated?: string | null
): string | null {
  let best: { value: string; ms: number } | null = null;
  const consider = (value: string | null | undefined) => {
    if (!value) return;
    const ms = instant(value);
    if (ms === null) return;
    if (!best || ms > best.ms) best = { value, ms };
  };
  for (const r of rows) consider(r.updated_at);
  consider(editorialUpdated);
  return (best as { value: string; ms: number } | null)?.value ?? null;
}
