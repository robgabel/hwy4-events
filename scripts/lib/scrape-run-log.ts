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
 *
 * The insert itself is instrumented to fail LOUDLY (Slack, not just
 * console.error): a sensor that can fail silently is not a sensor. This
 * table's own insert was silently dead for a month (2026-07-09 -> 2026-08-09,
 * see LESSONS.md) because a migration no-opped over a prod table-name
 * collision and every write failed with nothing to show for it: an empty
 * admin panel and a weekly memo reasoning over nothing.
 *
 * IMPORTANT: those writes never reached a `catch` at all.
 * `@supabase/postgrest-js` resolves a DB/API failure (a 4xx/5xx from
 * PostgREST, a missing column, an RLS denial, even most transport errors) as
 * a normal `{ data: null, error }` result — it does not reject the promise
 * — unless `.throwOnError()` is chained, which this call doesn't. So the
 * actual July failure mode was a silently-ignored *resolved* error, not a
 * caught-and-swallowed exception. The `if (error)` check below is what
 * closes that gap; the surrounding try/catch is belt-and-braces for
 * something that genuinely throws (e.g. the fetch itself never completing).
 * Both paths post the same Slack alert, so this exact blind spot can't
 * recur invisibly either way.
 */

/** Posts a plain-text message to SLACK_WEBHOOK_URL if set; a no-op otherwise.
 *  Best-effort — a Slack outage (including a hang) must never block or
 *  throw out of the scrape run, which is why the fetch carries its own
 *  timeout: finishScrapeRun sits on the critical path of a timeout-capped
 *  GitHub Actions job, and without an explicit AbortSignal a hung webhook
 *  can run far longer than that on undici's own default before failing.
 *  This mirrors the fetch-a-webhook helper every `app/api/*` route defines
 *  for itself (grepped: none of them share one, and scripts/ has never
 *  posted to Slack before this), so there's nothing existing to import here. */
async function postSlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    // Also swallows a timeout/abort from the signal above — a slow or dead
    // webhook must not hold up (or fail) the scrape run.
    console.error("[scrape-run-log] Slack post failed:", err);
  }
}

interface SourceTotals {
  inserted: number;
  updated: number;
  unchanged: number;
  skippedFuzzy: number;
  error: string | null;
}

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
  const totals = current.sources.get(key) ?? {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skippedFuzzy: 0,
    error: null,
  };
  totals.inserted += result.inserted;
  totals.updated += result.updated;
  totals.unchanged += result.unchanged;
  totals.skippedFuzzy += result.skippedFuzzy;
  current.sources.set(key, totals);
}

/** Called from scrape.ts's top-level catch when a scraper throws. */
export function recordSourceError(key: string, message: string): void {
  if (!current) return;
  const totals = current.sources.get(key) ?? {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skippedFuzzy: 0,
    error: null,
  };
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

  const alert = (detail: string) =>
    postSlack(
      `:rotating_light: *scrape_runs telemetry write FAILED* — scraper health is blind until fixed: ${detail}`
    );

  try {
    // Destructure `{ error }` (the repo's own idiom — see scripts/lib/dedup.ts
    // and app/api/agent/scraper-health-memo/route.ts): supabase-js resolves a
    // DB/API failure here, it does not throw, so this `if (error)` is the
    // actual failure path (see the doc comment at the top of this file).
    const { error } = await supabaseAdmin.from("scrape_runs").insert({
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      sources_attempted: sourcesAttempted.length,
      sources_errored: erroredCount,
      total_inserted: totals.inserted,
      total_updated: totals.updated,
      source_results: sourceResults,
    });
    if (error) {
      console.error("Failed to write scrape_runs summary:", error.message, error.code);
      await alert(`${error.message} (${error.code})`);
    }
  } catch (err) {
    // Belt-and-braces for something that genuinely threw — e.g. the request
    // never completed at all — rather than resolving with an error above.
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to write scrape_runs summary (thrown):", err);
    await alert(message);
  }
}
