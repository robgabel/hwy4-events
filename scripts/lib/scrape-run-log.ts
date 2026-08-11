import { supabaseAdmin } from "./supabase-admin.js";
import type { UpsertResult } from "./dedup.js";

/**
 * Durable per-run scraper health, for the /admin operational-health tab.
 *
 * Every scraper funnels its writes through `upsertEvents` (dedup.ts), so that
 * single function is instrumented to accumulate results here keyed by
 * org_slug/source_name — no need to touch every individual scraper file, and
 * any future scraper is covered automatically. `scrape.ts` also records a
 * per-top-level-source error when a scraper throws.
 *
 * The summary row is written to `scrape_runs` by `finishScrapeRun`, called
 * right after the scraper loop and BEFORE the slower URL-validation pass —
 * so the health data survives even if the job gets killed by the runner
 * timeout during validation (the failure mode that made the last few weeks
 * of scraper health invisible: GitHub Actions reports a timeout kill as
 * "cancelled", not "failure", so nothing downstream ever ran).
 *
 * Best-effort throughout: a failure here must never break the scrape.
 */

interface SourceTotals {
  inserted: number;
  updated: number;
  unchanged: number;
  skippedFuzzy: number;
  /** Rows written with neither source_event_id nor event_url — unverifiable,
   *  uncorrectable, unretractable (see scripts/lib/unpinned-guard.ts). Always 0
   *  for sources whose policy is "allow" (seeds/vision, unpinned by design), so
   *  a nonzero here is a text-scrape source worth looking at. */
  unpinned: number;
  error: string | null;
}

const emptyTotals = (): SourceTotals => ({
  inserted: 0,
  updated: 0,
  unchanged: 0,
  skippedFuzzy: 0,
  unpinned: 0,
  error: null,
});

interface RunState {
  startedAt: string;
  sources: Map<string, SourceTotals>;
}

let current: RunState | null = null;

export function beginScrapeRun(): void {
  current = { startedAt: new Date().toISOString(), sources: new Map() };
}

/** Called from `upsertEvents` on every write, keyed by org_slug (falls back
 *  to sourceName) — the same key already shown in `hwy4_events.source_name`. */
export function recordSourceResult(key: string, result: UpsertResult): void {
  if (!current) return;
  const totals = current.sources.get(key) ?? emptyTotals();
  totals.inserted += result.inserted;
  totals.updated += result.updated;
  totals.unchanged += result.unchanged;
  totals.skippedFuzzy += result.skippedFuzzy;
  totals.unpinned += result.unpinned;
  current.sources.set(key, totals);
}

/** Called from scrape.ts's top-level catch when a scraper throws. */
export function recordSourceError(key: string, message: string): void {
  if (!current) return;
  const totals = current.sources.get(key) ?? emptyTotals();
  totals.error = message.slice(0, 500);
  current.sources.set(key, totals);
}

export async function finishScrapeRun(sourcesAttempted: string[]): Promise<void> {
  if (!current) return;
  const { startedAt, sources } = current;
  current = null;

  const completedAt = new Date().toISOString();
  const sourceResults = Object.fromEntries(sources);
  const erroredCount = [...sources.values()].filter((s) => s.error).length;
  const totals = [...sources.values()].reduce(
    (acc, s) => ({
      inserted: acc.inserted + s.inserted,
      updated: acc.updated + s.updated,
    }),
    { inserted: 0, updated: 0 }
  );

  try {
    await supabaseAdmin.from("scrape_runs").insert({
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      sources_attempted: sourcesAttempted.length,
      sources_errored: erroredCount,
      total_inserted: totals.inserted,
      total_updated: totals.updated,
      source_results: sourceResults,
    });
  } catch (err) {
    console.error("Failed to write scrape_runs summary:", err);
  }
}
