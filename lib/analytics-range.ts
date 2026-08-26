// Date-range selection for the /admin/analytics Growth tab.
//
// The page used to hardcode a 30-day window and a 14-bar trend chart, so the
// months of history sitting in analytics_daily / site_events / seo_snapshots
// were fetched and thrown away. These are the pure pieces: which ranges exist,
// how a ?range= param maps to one, and how a long daily series collapses into
// a readable number of bars. Locked by scripts/test/analytics-range.test.ts.

export type RangeKey = "7d" | "30d" | "90d" | "6mo" | "12mo";

export type RangeOption = {
  key: RangeKey;
  /** Segmented-control label. */
  label: string;
  /** Days of history the range asks for. */
  days: number;
};

export const RANGE_OPTIONS: RangeOption[] = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "6mo", label: "6mo", days: 182 },
  { key: "12mo", label: "12mo", days: 365 },
];

export const DEFAULT_RANGE: RangeKey = "30d";

/** Resolve a ?range= value to a known option. Unknown/absent -> the default. */
export function parseRange(raw: string | string[] | undefined): RangeOption {
  const want = Array.isArray(raw) ? raw[0] : raw;
  return (
    RANGE_OPTIONS.find((o) => o.key === want) ??
    RANGE_OPTIONS.find((o) => o.key === DEFAULT_RANGE)!
  );
}

/**
 * Bucket size (in days) that keeps a `days`-long daily series under `maxBars`
 * columns. 1 = per-day, 7 = weekly, 14 = fortnightly. Snapped to whole weeks
 * above 1 so a bucket is always a comparable unit ("a week"), never an
 * arbitrary 5-day lump whose bars can't be read against each other.
 */
export function bucketSizeFor(days: number, maxBars = 30): number {
  if (days <= maxBars) return 1;
  return Math.ceil(days / maxBars / 7) * 7;
}

export type Bucketable = { date: string };

export type Bucket<T> = {
  /** First day in the bucket (chronological). */
  start: string;
  /** Last day in the bucket. */
  end: string;
  /** How many daily rows landed in it (may be < size at the series edges). */
  count: number;
  rows: T[];
};

/**
 * Group a CHRONOLOGICAL (oldest -> newest) daily series into fixed-size
 * buckets. Bucketing runs from the NEWEST end backwards, so the most recent
 * bucket is always a whole period and any short bucket is the oldest one — a
 * partial week at the right edge would otherwise read as a traffic collapse.
 */
export function bucketSeries<T extends Bucketable>(rows: T[], size: number): Bucket<T>[] {
  if (size <= 1 || rows.length === 0) {
    return rows.map((r) => ({ start: r.date, end: r.date, count: 1, rows: [r] }));
  }
  const out: Bucket<T>[] = [];
  for (let end = rows.length; end > 0; end -= size) {
    const slice = rows.slice(Math.max(0, end - size), end);
    out.unshift({
      start: slice[0].date,
      end: slice[slice.length - 1].date,
      count: slice.length,
      rows: slice,
    });
  }
  return out;
}

/** Label for one bucket on a chart axis: "6/11" for a day, "6/11–6/17" for a span. */
export function bucketLabel(b: Bucket<Bucketable>, short: (iso: string) => string): string {
  return b.start === b.end ? short(b.start) : `${short(b.start)}–${short(b.end)}`;
}
