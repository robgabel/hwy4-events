// Expired seasonal event URLs -> evergreen guide pages (PRD-july4-evergreen.md).
//
// Event slugs embed the date, so a big annual event's search equity is parked
// on a URL that goes stale every year. This registry 301s those expired URLs
// into the year-less guide page that inherits them. Consulted by the event
// detail page BEFORE the slug lookup (the underlying rows still exist and
// would otherwise keep rendering a stale page).
//
// Hand-maintained: after each year's holiday passes, append the year's
// high-traffic detail-page slugs here (GSC by-page shows which earned rank).
// Entries only activate once the slug's embedded date is past, so listing a
// future slug can never black-hole a live event page. Locked by
// scripts/test/seasonal-redirects.test.ts.
//
// Relative (not "@/") imports so the scripts/ test runner can import this.

export type SeasonalRedirect = {
  /** The exact expired event slug (as in /events/<slug>). */
  fromSlug: string;
  /** Internal path of the evergreen guide that inherits the URL. */
  to: string;
};

export const SEASONAL_REDIRECTS: SeasonalRedirect[] = [
  // July 4, 2026 — the five pages that earned real rank (GSC 28d as of
  // 2026-07-11: 321 / 306 / 192 / 57 / 22 clicks). The two Arnold parade
  // slugs and the two Murphys Hotel slugs are duplicate rows that split
  // equity; this consolidates each pair into one target.
  {
    fromSlug: "arnold-independence-day-parade-2026-07-04-arnold",
    to: "/arnold-4th-of-july",
  },
  {
    fromSlug: "arnolds-independence-day-parade-2026-07-04-arnold",
    to: "/arnold-4th-of-july",
  },
  {
    fromSlug: "murphys-4th-of-july-parade-2026-07-04-murphys",
    to: "/murphys-4th-of-july",
  },
  {
    fromSlug:
      "4th-of-july-celebration-at-the-murphys-historic-hotel-2026-07-04-murphys",
    to: "/murphys-4th-of-july",
  },
  {
    fromSlug: "4th-of-july-celebration-2026-07-04-murphys",
    to: "/murphys-4th-of-july",
  },
];

/**
 * Pure: the guide path a stale slug should 301 to, or null. Only fires once
 * the slug's embedded event date is strictly past (Pacific civil date), so a
 * mistakenly-listed future or same-day slug keeps rendering its live page.
 */
export function seasonalRedirectFor(
  slug: string,
  todayIso: string
): string | null {
  const hit = SEASONAL_REDIRECTS.find((r) => r.fromSlug === slug);
  if (!hit) return null;
  const date = slug.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!date || date >= todayIso) return null;
  return hit.to;
}
