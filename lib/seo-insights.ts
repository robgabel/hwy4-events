// Pure Search Console analytics — the shared brain behind the /admin/analytics
// Search panel and the Growth Agent's SEO signals. No I/O here: callers hand in
// rows read from seo_snapshots (see lib/seo-data.ts) and get back shaped insight.
// Pure + deterministic so scripts/test/seo-insights.test.ts can lock it.

export type QueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type DayPoint = {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  position: number; // GSC daily average position
};

export type PeriodTotals = {
  clicks: number;
  impressions: number;
  ctr: number; // 0..1, derived
  avgPosition: number; // impression-weighted
  days: number;
};

export type MonthOverMonth = {
  current: PeriodTotals;
  prior: PeriodTotals;
  clicksDeltaPct: number | null; // null when prior is 0 (no baseline)
  impressionsDeltaPct: number | null;
  positionDelta: number | null; // negative = improved (rank got smaller)
};

export type StrikingQuery = QueryRow & {
  /** Rough upside: impressions currently not converting to clicks. */
  potential: number;
};

const round = (n: number, dp = 1): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Impression-weighted rollup of a set of daily points. */
export function summarizePeriod(points: DayPoint[]): PeriodTotals {
  const clicks = points.reduce((s, p) => s + p.clicks, 0);
  const impressions = points.reduce((s, p) => s + p.impressions, 0);
  const weightedPos = points.reduce((s, p) => s + p.position * p.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? round((clicks / impressions) * 100, 2) / 100 : 0,
    avgPosition: impressions > 0 ? round(weightedPos / impressions, 1) : 0,
    days: points.length,
  };
}

const pctDelta = (cur: number, prior: number): number | null =>
  prior > 0 ? round(((cur - prior) / prior) * 100, 1) : null;

/**
 * Compare the most recent `periodDays` of daily history against the `periodDays`
 * immediately before it. Points need not be contiguous — they are sorted by date
 * and split by count from the tail, so gaps in GSC data don't skew the windows.
 */
export function monthOverMonth(points: DayPoint[], periodDays = 28): MonthOverMonth {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const current = sorted.slice(-periodDays);
  const prior = sorted.slice(-2 * periodDays, -periodDays);
  const c = summarizePeriod(current);
  const p = summarizePeriod(prior);
  return {
    current: c,
    prior: p,
    clicksDeltaPct: pctDelta(c.clicks, p.clicks),
    impressionsDeltaPct: pctDelta(c.impressions, p.impressions),
    positionDelta:
      c.avgPosition > 0 && p.avgPosition > 0 ? round(c.avgPosition - p.avgPosition, 1) : null,
  };
}

export type StrikeOpts = {
  minPosition?: number; // exclude already-winning top ranks
  maxPosition?: number; // exclude hopeless deep ranks
  minImpressions?: number; // ignore noise
  limit?: number;
};

/**
 * "Striking distance" queries — the highest-leverage SEO work. A query ranking
 * on the back half of page 1 or top of page 2 (default position 4–20) with real
 * impressions (default ≥ 20) needs only a small rank nudge to convert far more
 * clicks. Ranked by un-captured impressions (impressions the low CTR leaves on
 * the table), so the top of the list is where a content tweak pays the most.
 */
export function selectStrikingDistance(
  queries: QueryRow[],
  opts: StrikeOpts = {}
): StrikingQuery[] {
  const minPosition = opts.minPosition ?? 4;
  const maxPosition = opts.maxPosition ?? 20;
  const minImpressions = opts.minImpressions ?? 20;
  const limit = opts.limit ?? 10;

  return queries
    .filter(
      (q) =>
        q.position > minPosition &&
        q.position <= maxPosition &&
        q.impressions >= minImpressions
    )
    .map((q) => ({ ...q, potential: Math.round(q.impressions * (1 - q.ctr)) }))
    .sort((a, b) => b.potential - a.potential)
    .slice(0, limit);
}

/** Totals across a query snapshot (for the panel header + digest one-liner). */
export function snapshotTotals(queries: QueryRow[]): {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
} {
  const clicks = queries.reduce((s, q) => s + q.clicks, 0);
  const impressions = queries.reduce((s, q) => s + q.impressions, 0);
  const weightedPos = queries.reduce((s, q) => s + q.position * q.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? round((clicks / impressions) * 100, 2) / 100 : 0,
    avgPosition: impressions > 0 ? round(weightedPos / impressions, 1) : 0,
  };
}
