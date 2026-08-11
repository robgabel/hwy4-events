// Pure shaping over `scrape_runs` (written by scripts/lib/scrape-run-log.ts
// on every scripts/scrape.ts run) for the /admin/scrapers operational-health
// tab and the weekly scraper-health memo. No DB access here — callers pass
// in rows already read from Supabase. Locked by scripts/test/scraper-health.test.ts.

export interface SourceResult {
  inserted: number;
  updated: number;
  unchanged: number;
  skippedFuzzy: number;
  /** Rows written with neither source_event_id nor event_url (HWY-17). Optional
   *  because every `scrape_runs` row captured before the guard shipped lacks it,
   *  and because sources whose policy is "allow" report nothing. */
  unpinned?: number;
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
