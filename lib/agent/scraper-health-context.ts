import type { SupabaseClient } from "@supabase/supabase-js";
import { rollupBySource, runStatus, currentlyErroring, type ScrapeRunRow } from "@/lib/scraper-health";
import type { ScraperHealthContext } from "./types";

const WINDOW_DAYS = 14;

/** Reads the last WINDOW_DAYS of scrape_runs and shapes the signal pack the
 *  weekly scraper-health memo reasons over. Read-only; never throws (a
 *  read failure degrades to an empty window rather than blocking the run). */
export async function gatherScraperHealthContext(
  supabase: SupabaseClient
): Promise<ScraperHealthContext> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const date = new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from("scrape_runs")
    .select(
      "id, started_at, completed_at, duration_ms, sources_attempted, sources_errored, total_inserted, total_updated, source_results"
    )
    .gte("started_at", since)
    .order("started_at", { ascending: false });

  const runs = (data ?? []) as ScrapeRunRow[];
  const rollups = rollupBySource(runs);
  const broken = currentlyErroring(rollups);
  const quiet = rollups.filter(
    (r) => !broken.some((b) => b.key === r.key) && r.totalInserted === 0 && r.totalUpdated === 0
  );

  const totals = runs.reduce(
    (acc, r) => ({
      inserted: acc.inserted + r.total_inserted,
      updated: acc.updated + r.total_updated,
    }),
    { inserted: 0, updated: 0 }
  );

  return {
    date,
    vitals: {
      windowDays: WINDOW_DAYS,
      runsInWindow: runs.length,
      cleanRuns: runs.filter((r) => runStatus(r) === "clean").length,
      runsWithErrors: runs.filter((r) => runStatus(r) === "errors").length,
      totalInserted: totals.inserted,
      totalUpdated: totals.updated,
      currentlyErroringSources: broken.length,
    },
    // Cap what's handed to the model — recent runs and the worst offenders,
    // not the full window (keeps the prompt small and the read focused).
    recentRuns: runs.slice(0, 10).map((r) => ({
      date: r.started_at,
      status: runStatus(r),
      durationMs: r.duration_ms,
      sourcesAttempted: r.sources_attempted,
      sourcesErrored: r.sources_errored,
      totalInserted: r.total_inserted,
      totalUpdated: r.total_updated,
    })),
    brokenSources: broken.slice(0, 15).map((r) => ({
      key: r.key,
      lastError: r.lastError,
      lastErrorAt: r.lastErrorAt,
      errorRunsInWindow: r.errorRuns,
    })),
    quietSources: quiet.slice(0, 15).map((r) => ({ key: r.key, runsSeen: r.runsSeen })),
  };
}
