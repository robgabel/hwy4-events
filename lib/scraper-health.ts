// Pure shaping over `scrape_runs` (written by scripts/lib/scrape-run-log.ts
// on every scripts/scrape.ts run) for the /admin/scrapers operational-health
// tab and the weekly scraper-health memo. No DB access here — callers pass
// in rows already read from Supabase. Locked by scripts/test/scraper-health.test.ts.

export interface SourceResult {
  inserted: number;
  updated: number;
  unchanged: number;
  skippedFuzzy: number;
  error: string | null;
}

export interface ScrapeRunRow {
  id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  sources_attempted: number;
  sources_errored: number;
  total_inserted: number;
  total_updated: number;
  source_results: Record<string, SourceResult>;
}

export interface SourceRollup {
  key: string;
  runsSeen: number;
  errorRuns: number;
  totalInserted: number;
  totalUpdated: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastOkAt: string | null;
}

/** Aggregates per-source totals across a window of runs (caller decides the
 *  window — e.g. last 7 or 30 days of rows). Newest-first input is assumed
 *  only for lastOkAt/lastErrorAt "first seen" tracking. */
export function rollupBySource(runs: ScrapeRunRow[]): SourceRollup[] {
  const bySource = new Map<string, SourceRollup>();

  for (const run of runs) {
    for (const [key, result] of Object.entries(run.source_results)) {
      const existing = bySource.get(key) ?? {
        key,
        runsSeen: 0,
        errorRuns: 0,
        totalInserted: 0,
        totalUpdated: 0,
        lastError: null,
        lastErrorAt: null,
        lastOkAt: null,
      };
      existing.runsSeen++;
      existing.totalInserted += result.inserted;
      existing.totalUpdated += result.updated;
      if (result.error) {
        existing.errorRuns++;
        if (!existing.lastErrorAt) {
          existing.lastError = result.error;
          existing.lastErrorAt = run.started_at;
        }
      } else if (!existing.lastOkAt) {
        existing.lastOkAt = run.started_at;
      }
      bySource.set(key, existing);
    }
  }

  return [...bySource.values()].sort((a, b) => b.errorRuns - a.errorRuns || a.key.localeCompare(b.key));
}

export type RunStatus = "clean" | "errors" | "no-data";

export function runStatus(run: ScrapeRunRow): RunStatus {
  if (run.sources_attempted === 0) return "no-data";
  return run.sources_errored > 0 ? "errors" : "clean";
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/** Sources with an error on the most recent run they appeared in (i.e. still
 *  broken as of "now", not just historically flaky). */
export function currentlyErroring(rollups: SourceRollup[]): SourceRollup[] {
  return rollups.filter((r) => {
    if (!r.lastErrorAt) return false;
    if (!r.lastOkAt) return true;
    return new Date(r.lastErrorAt).getTime() > new Date(r.lastOkAt).getTime();
  });
}

/**
 * Sustained per-run insert rate worth a human's eyes, independent of whether
 * the source is erroring. Named for the case that motivated it: Murphys
 * Irish Pub, a real venue booking roughly 5 events a week, had its
 * homepage-widget scraper INSERTING around 10 *new* rows on every run,
 * repeatedly, because the page carried no absolute dates and the extractor
 * invented a fresh date for the same acts every few days — 36 of the venue's
 * 50 upcoming rows were phantoms by the time it was caught (2026-08-09, see
 * LESSONS.md). Nothing flagged it: the scraper never errored, so
 * `currentlyErroring` never lit up and this was the blind spot.
 *
 * Steady-state healthy sources insert roughly 0-3 rows per run (real new
 * events trickling in). A MEDIAN at or above this bar, sustained across at
 * least MIN_RUNS_FOR_INSERT_RATE_ANOMALY runs, means either a genuinely
 * booming venue or a hallucinating extractor — this check doesn't say which,
 * only that it is worth a look.
 */
export const INSERT_RATE_ANOMALY_MEDIAN_THRESHOLD = 5;

/** Minimum runs a source must appear in before its median is trusted, so one
 *  spike (a legitimate backfill, a big festival announced at once) can't by
 *  itself read as a sustained anomaly. */
export const MIN_RUNS_FOR_INSERT_RATE_ANOMALY = 3;

export interface InsertRateAnomaly {
  source: string;
  runCount: number;
  medianInserted: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Flags sources whose per-run `inserted` count has a sustained high MEDIAN
 *  across the runs provided (caller decides the window, same as
 *  `rollupBySource`). A single spike does not flag: it takes
 *  MIN_RUNS_FOR_INSERT_RATE_ANOMALY-or-more runs for that source before its
 *  median counts, and the median itself (not a peak) is what's compared
 *  against the threshold, so one big-but-real batch can't trip it. */
export function findInsertRateAnomalies(runs: ScrapeRunRow[]): InsertRateAnomaly[] {
  const insertsBySource = new Map<string, number[]>();
  for (const run of runs) {
    for (const [key, result] of Object.entries(run.source_results)) {
      const list = insertsBySource.get(key);
      if (list) list.push(result.inserted);
      else insertsBySource.set(key, [result.inserted]);
    }
  }

  const anomalies: InsertRateAnomaly[] = [];
  for (const [source, inserted] of insertsBySource) {
    if (inserted.length < MIN_RUNS_FOR_INSERT_RATE_ANOMALY) continue;
    const medianInserted = median(inserted);
    if (medianInserted >= INSERT_RATE_ANOMALY_MEDIAN_THRESHOLD) {
      anomalies.push({ source, runCount: inserted.length, medianInserted });
    }
  }

  return anomalies.sort(
    (a, b) => b.medianInserted - a.medianInserted || a.source.localeCompare(b.source)
  );
}
