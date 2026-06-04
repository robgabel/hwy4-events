// Sitemap selection + rendering. Pure helpers (no DB, no Next APIs) so the
// crawl-budget logic is unit-testable in isolation (scripts/test/sitemap.test.ts).
//
// WHY THIS EXISTS — the crawl-budget story:
// The site is a young domain. Google's "Discovered – currently not indexed"
// status is what you get when a low-authority site hands the crawler ~1,000+
// URLs at once, most of them near-identical recurring-event instances stretching
// two years out ("Live Music Upstairs" alone = 100+ weekly URLs). That both
// wastes the crawler's small budget and signals thin/templated content, which
// suppresses crawl of even the good pages.
//
// The fix is to advertise a small, high-signal set: drop the far-future tail
// (events re-enter as their date approaches) and collapse each recurring series
// to its soonest instances. Every event is still reachable on-site via the
// homepage / town / temporal pages — the sitemap is a crawl *hint*, not the only
// discovery path — so this is fully reversible and costs no real coverage.
//
// Imports are relative (./constants, ./slugs) to match the other unit-tested lib
// modules (see dedupe-events.ts) so the tsx test runner resolves them.

import { SITE_URL } from "./constants";
import { generateEventSlug } from "./slugs";

/** Days ahead to advertise event URLs. Past this, events are omitted until their
 *  date rolls inside the window (curated picks are kept regardless — see below). */
export const SITEMAP_EVENT_HORIZON_DAYS = 120;

/** Max instances of one recurring series to list. The rest are reachable on-site
 *  and roll into the sitemap as they approach. Keeps near-duplicates from burying
 *  the high-signal URLs and tripping thin-content heuristics. */
export const SITEMAP_MAX_INSTANCES_PER_SERIES = 2;

/** Minimal event shape the sitemap needs: identity + recency/curation signals. */
export type SitemapEventRow = {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  town: string;
  /** DB-maintained last-modified; drives honest <lastmod>. May be null. */
  updated_at: string | null;
  robs_pick: boolean;
};

export type ChangeFreq = "daily" | "weekly" | "monthly" | "yearly";

export type SitemapUrl = {
  loc: string;
  /** YYYY-MM-DD. Omit when there is no honest freshness signal. */
  lastmod?: string;
  changefreq?: ChangeFreq;
  priority?: number;
};

/** A recurring "series" = same title at the same town across many dates
 *  ("Live Music Upstairs" in Murphys). Two different titles never collapse, even
 *  at the same venue/time — mirrors the read/write dedup rule in event-identity. */
function seriesKey(row: { name: string; town: string }): string {
  return `${row.name.trim().toLowerCase()}|${row.town.trim().toLowerCase()}`;
}

function addDaysISO(todayISO: string, days: number): string {
  const d = new Date(`${todayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const byDateAsc = (a: SitemapEventRow, b: SitemapEventRow): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/**
 * From all upcoming event rows, pick the set worth advertising to search engines:
 *   1. keep events within `horizonDays` of today (always keep `robs_pick` — curated
 *      keystones are worth indexing early even if further out),
 *   2. collapse each recurring series to its soonest `maxPerSeries` instances.
 * Pure + deterministic given `todayISO`. Output is sorted soonest-first.
 * Locked by scripts/test/sitemap.test.ts.
 */
export function selectSitemapEvents(
  rows: SitemapEventRow[],
  opts: { todayISO: string; horizonDays?: number; maxPerSeries?: number }
): SitemapEventRow[] {
  const horizonDays = opts.horizonDays ?? SITEMAP_EVENT_HORIZON_DAYS;
  const maxPerSeries = opts.maxPerSeries ?? SITEMAP_MAX_INSTANCES_PER_SERIES;
  const horizonISO = addDaysISO(opts.todayISO, horizonDays);

  // 1. Horizon filter (never advertise past events; keep curated picks regardless).
  const candidates = rows.filter(
    (r) => r.date >= opts.todayISO && (r.date <= horizonISO || r.robs_pick)
  );

  // 2. Collapse recurring series to the soonest N instances.
  const byKey = new Map<string, SitemapEventRow[]>();
  for (const r of candidates) {
    const list = byKey.get(seriesKey(r));
    if (list) list.push(r);
    else byKey.set(seriesKey(r), [r]);
  }

  const kept: SitemapEventRow[] = [];
  for (const list of byKey.values()) {
    list.sort(byDateAsc);
    kept.push(...list.slice(0, maxPerSeries));
  }
  kept.sort(byDateAsc);
  return kept;
}

/** Event row → sitemap URL. <lastmod> is the DB `updated_at` (date-only, honest),
 *  omitted when unknown rather than faked to "now". */
export function eventToSitemapUrl(row: SitemapEventRow): SitemapUrl {
  return {
    loc: `${SITE_URL}/events/${generateEventSlug(row.name, row.date, row.town)}`,
    lastmod: row.updated_at ? row.updated_at.slice(0, 10) : undefined,
    changefreq: "weekly",
    priority: 0.7,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Render a <urlset> sitemap document from URL entries. */
export function renderUrlset(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => {
      const lines = [`    <loc>${escapeXml(u.loc)}</loc>`];
      if (u.lastmod) lines.push(`    <lastmod>${u.lastmod}</lastmod>`);
      if (u.changefreq) lines.push(`    <changefreq>${u.changefreq}</changefreq>`);
      if (u.priority !== undefined)
        lines.push(`    <priority>${u.priority.toFixed(1)}</priority>`);
      return `  <url>\n${lines.join("\n")}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** Render a <sitemapindex> document pointing at child sitemaps. */
export function renderSitemapIndex(
  children: { loc: string; lastmod?: string }[]
): string {
  const body = children
    .map((c) => {
      const lines = [`    <loc>${escapeXml(c.loc)}</loc>`];
      if (c.lastmod) lines.push(`    <lastmod>${c.lastmod}</lastmod>`);
      return `  <sitemap>\n${lines.join("\n")}\n  </sitemap>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}
