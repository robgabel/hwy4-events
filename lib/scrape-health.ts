import type { SupabaseClient } from "@supabase/supabase-js";

// Scrape-source health: is every automated event source still running and
// producing? Combines two independent signals (defense in depth), so a dead or
// lapsing source is caught in ~1 day instead of the 30-40 it took for Facebook
// and Visit Murphys to go dark unnoticed:
//
//   1. LIVENESS  — max(last_scraped_at) per org_slug, via the cap-immune
//      scrape_source_liveness() RPC. Derived from DB state, so it survives a
//      timeout-cancelled job and is blind to which writer touched the row.
//      (upsertEvents bumps last_scraped_at on every touched row, even unchanged
//      ones, so a quiet-but-live source with >=1 future row still reads fresh.)
//   2. TELEMETRY — the latest scrape_runs row per source (status/error), written
//      incrementally by the orchestrator. Adds the "ran but hard-errored" signal
//      that liveness alone can't see (and surfaces it immediately, before the
//      liveness clock even ticks over).
//
// EXPECTED_SOURCES below is the source of truth for what SHOULD be fresh and how
// often. It lists only AUTOMATED sources; manually-curated seed venues (the Lube
// Room, Big Trees, Camp Connell, etc.) and community rows are intentionally
// static or human-owned, so alarming on their staleness would be a false
// positive. (Mirrors the GENERIC_VENUE_NAMES duplication in /api/check-events:
// the Next app and the scripts/ package have separate module roots, so this
// cannot import scripts/scrapers/*.)

const DAY = 86_400_000;

export type SourceCadence = "daily" | "weekly";
export type ScrapeRunStatus = "ok" | "failed" | "empty" | "skipped";
export type SourceState = "ok" | "stale" | "failing" | "empty" | "never_ran";

export interface ExpectedSource {
  /** org_slug as written into hwy4_events by the scraper. */
  org_slug: string;
  label: string;
  cadence: SourceCadence;
  /** Which system runs it — informational, shown in the panel. */
  writer: "github-scrape" | "vercel-cron";
  /**
   * How freshness is judged:
   *  - "liveness" (default): the last time the source produced an event row.
   *    Reliable for upsert scrapers, which re-touch (bump last_scraped_at on)
   *    existing rows every run. This is also what catches a scraper that swallows
   *    an upstream error and returns "ok" while producing nothing (the Facebook
   *    scrapers): its liveness clock keeps aging, so it goes stale honestly.
   *  - "run": the last successful run (scrape_runs telemetry). For INSERT-ONLY
   *    sources (BLS) that never re-touch existing rows, so their last_scraped_at
   *    would falsely age even while the cron runs fine each week.
   */
  freshness?: "liveness" | "run";
  note?: string;
}

// How many days a source can go without producing before it counts as lapsed.
// daily = 1-day run + 1-day buffer; weekly = a missed Monday + 2-day buffer.
export const GRACE_DAYS: Record<SourceCadence, number> = { daily: 2, weekly: 9 };

export const EXPECTED_SOURCES: ExpectedSource[] = [
  // ── daily GitHub scrape (scripts/scrape.ts) ──────────────────────────────
  { org_slug: "gocalaveras", label: "GoCalaveras", cadence: "daily", writer: "github-scrape" },
  { org_slug: "visit-murphys", label: "Visit Murphys", cadence: "daily", writer: "github-scrape" },
  { org_slug: "bistro-espresso", label: "Bistro Espresso", cadence: "daily", writer: "github-scrape" },
  {
    org_slug: "mystic-saloon",
    label: "Mystic Saloon (Facebook)",
    cadence: "daily",
    writer: "github-scrape",
    note: "Facebook-primary; its events also arrive via GoCalaveras, so a quiet run is not always a problem.",
  },
  { org_slug: "fb-discover-arnold", label: "Facebook Discover (Arnold)", cadence: "daily", writer: "github-scrape" },
  // Corridor community Facebook groups (scripts/scrapers/hwy4-fb-groups.ts). New
  // sources start at never_ran/empty (informational) until they produce, so a
  // genuinely quiet group never false-alarms; a token-scope 403 records as failing.
  { org_slug: "fb-group-uh4ccc", label: "FB Group: uh4ccc", cadence: "daily", writer: "github-scrape", note: "Community group; corridor-wide, town inferred per post." },
  { org_slug: "fb-group-upperhwy4", label: "FB Group: Upper Hwy 4", cadence: "daily", writer: "github-scrape", note: "Community group; corridor-wide, town inferred per post." },
  { org_slug: "fb-group-388511408445423", label: "FB Group: Hwy 4 (388511408445423)", cadence: "daily", writer: "github-scrape", note: "Community group; corridor-wide, town inferred per post." },
  { org_slug: "red-cross", label: "Red Cross blood drives", cadence: "daily", writer: "github-scrape" },
  { org_slug: "bear-valley", label: "Bear Valley Resort", cadence: "daily", writer: "github-scrape" },
  { org_slug: "branding-iron", label: "Branding Iron Saloon", cadence: "daily", writer: "github-scrape" },
  { org_slug: "brice-station", label: "Brice Station", cadence: "daily", writer: "github-scrape" },
  { org_slug: "murphys-irish-pub", label: "Murphys Irish Pub", cadence: "daily", writer: "github-scrape" },
  { org_slug: "watering-hole", label: "The Watering Hole", cadence: "daily", writer: "github-scrape" },
  // ── Vercel cron writers ──────────────────────────────────────────────────
  {
    org_slug: "moose-lodge",
    label: "Ebbetts Pass Moose Lodge",
    cadence: "weekly",
    writer: "vercel-cron",
    note: "PDF calendar cron (Mondays) + the public-events Firecrawl source.",
  },
  {
    org_slug: "blue-lake-springs",
    label: "Blue Lake Springs",
    cadence: "weekly",
    writer: "vercel-cron",
    // Insert-only (new flyers only; never re-touches existing rows), so liveness
    // would age even on a healthy week. Judge it by the last successful run.
    freshness: "run",
    note: "Flyer-image Vision cron (Mondays). Health is judged by the run, not the last event, since it only inserts new flyers.",
  },
];

// Display-only: org_slugs whose rows are owned by hand (seed scripts / community
// submissions) and deliberately NOT health-checked. Surfaced in the panel as
// context so a curator isn't confused about why they're absent from the alarms.
export const MANUAL_SOURCES: Record<string, string> = {
  "lube-room": "Image-only schedule, seeded by hand",
  "calaveras-big-trees-state-park": "Prose recurrence rules, seeded by hand",
  "camp-connell-general-store": "Season poster, seeded by hand",
  "arnold-library": "Weekly storytime, seeded by hand",
  "lake-alpine-lodge": "Seasonal music schedule, seeded by hand",
  "sequoia-woods": "Manually curated",
  "murphys-library": "Community / manual",
  "arnold-parade": "Community / one-off",
};

export interface SourceHealth extends ExpectedSource {
  state: SourceState;
  is_degraded: boolean; // state in {stale, failing} — the set that should alarm
  last_success_at: string | null; // max last_scraped_at (liveness)
  days_since_success: number | null;
  future_events: number;
  total_events: number;
  last_run_at: string | null; // latest scrape_runs row (telemetry)
  last_run_status: ScrapeRunStatus | null;
  last_error: string | null;
  consecutive_failures: number;
}

export interface ScrapeHealthReport {
  generated_at: string;
  sources: SourceHealth[];
  degraded: SourceHealth[]; // is_degraded, worst (most stale) first
  ok_count: number;
  degraded_count: number;
}

/**
 * Pure state machine, isolated so it can be locked by a test without a DB.
 * A hard run error trumps everything; otherwise the freshness basis (liveness for
 * upsert sources, last-good-run for insert-only sources) drives ok/stale against
 * the cadence grace; a source with no freshness signal at all is empty (if it at
 * least ran) or never_ran — both informational, so a genuinely quiet venue does
 * not day-one false-alarm.
 */
export function deriveSourceState(input: {
  cadence: SourceCadence;
  freshness: "liveness" | "run";
  daysSinceSuccess: number | null; // liveness: days since the source last produced an event
  daysSinceGoodRun: number | null; // telemetry: days since the last run that didn't error
  lastRunStatus: ScrapeRunStatus | null; // null = no telemetry yet
}): SourceState {
  const { cadence, freshness, daysSinceSuccess, daysSinceGoodRun, lastRunStatus } = input;
  if (lastRunStatus === "failed") return "failing";
  // "run" sources fall back to liveness only until their telemetry exists.
  // "liveness" sources must NOT fall back to run telemetry, or an error-swallowing
  // scraper that returns "ok" would read fresh forever while producing nothing.
  const days = freshness === "run" ? (daysSinceGoodRun ?? daysSinceSuccess) : daysSinceSuccess;
  if (days === null) return lastRunStatus ? "empty" : "never_ran";
  return days > GRACE_DAYS[cadence] ? "stale" : "ok";
}

export function isDegradedState(state: SourceState): boolean {
  return state === "stale" || state === "failing";
}

interface Liveness {
  total: number;
  future: number;
  last: string | null;
}
interface RunRow {
  status: ScrapeRunStatus;
  error: string | null;
  finished_at: string;
}

function buildHealth(
  src: ExpectedSource,
  liveness: Liveness | undefined,
  runs: RunRow[], // newest first
  nowMs: number
): SourceHealth {
  const last_success_at = liveness?.last ?? null;
  const days_since_success =
    last_success_at !== null
      ? Math.round(((nowMs - Date.parse(last_success_at)) / DAY) * 10) / 10
      : null;

  const latest = runs[0] ?? null;
  let consecutive_failures = 0;
  for (const r of runs) {
    if (r.status === "failed") consecutive_failures++;
    else break;
  }

  // Most recent run that did not error (ok or empty both mean "ran cleanly").
  // Drives freshness for insert-only sources whose liveness clock is unreliable.
  const goodRun = runs.find((r) => r.status === "ok" || r.status === "empty");
  const days_since_good_run = goodRun
    ? Math.round(((nowMs - Date.parse(goodRun.finished_at)) / DAY) * 10) / 10
    : null;

  const state = deriveSourceState({
    cadence: src.cadence,
    freshness: src.freshness ?? "liveness",
    daysSinceSuccess: days_since_success,
    daysSinceGoodRun: days_since_good_run,
    lastRunStatus: latest?.status ?? null,
  });

  return {
    ...src,
    state,
    is_degraded: isDegradedState(state),
    last_success_at,
    days_since_success,
    future_events: liveness?.future ?? 0,
    total_events: liveness?.total ?? 0,
    last_run_at: latest?.finished_at ?? null,
    last_run_status: latest?.status ?? null,
    last_error: latest?.error ?? null,
    consecutive_failures,
  };
}

/**
 * Compute health for every expected automated source. Never throws — degrades to
 * a best-effort report (empty liveness / telemetry) so a badge or a Slack alarm
 * caller can't be taken down by a transient query failure.
 */
export async function computeScrapeHealth(
  supabase: SupabaseClient
): Promise<ScrapeHealthReport> {
  const generated_at = new Date().toISOString();
  const nowMs = Date.now();

  // 1. Liveness via the cap-immune RPC.
  const livenessByOrg = new Map<string, Liveness>();
  try {
    const { data } = await supabase.rpc("scrape_source_liveness");
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      livenessByOrg.set(String(r.org_slug), {
        total: Number(r.total_events ?? 0),
        future: Number(r.future_events ?? 0),
        last: (r.last_success_at as string | null) ?? null,
      });
    }
  } catch {
    /* fall through with empty liveness — states become never_ran, never crash */
  }

  // 2. Recent telemetry (30d). Small rowset; the table may not exist on an
  //    un-migrated DB, so this is fully guarded.
  const runsBySource = new Map<string, RunRow[]>();
  try {
    const since = new Date(nowMs - 30 * DAY).toISOString();
    const { data } = await supabase
      .from("scrape_runs")
      .select("source, status, error, finished_at")
      .gte("finished_at", since)
      .order("finished_at", { ascending: false })
      .limit(1000);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const source = String(r.source ?? "");
      const list = runsBySource.get(source) ?? [];
      list.push({
        status: (r.status as ScrapeRunStatus) ?? "ok",
        error: (r.error as string | null) ?? null,
        finished_at: String(r.finished_at ?? ""),
      });
      runsBySource.set(source, list);
    }
  } catch {
    /* no telemetry yet — liveness alone still drives the report */
  }

  const sources = EXPECTED_SOURCES.map((src) =>
    buildHealth(src, livenessByOrg.get(src.org_slug), runsBySource.get(src.org_slug) ?? [], nowMs)
  );

  const degraded = sources
    .filter((s) => s.is_degraded)
    .sort((a, b) => (b.days_since_success ?? Infinity) - (a.days_since_success ?? Infinity));

  return {
    generated_at,
    sources,
    degraded,
    ok_count: sources.filter((s) => s.state === "ok").length,
    degraded_count: degraded.length,
  };
}

/** Never-throw badge count for the admin layout (degraded automated sources). */
export async function countDegradedSources(supabase: SupabaseClient | null): Promise<number> {
  if (!supabase) return 0;
  try {
    const report = await computeScrapeHealth(supabase);
    return report.degraded_count;
  } catch {
    return 0;
  }
}

/** Compact projection handed to the agent reasoners (chief-of-staff, growth). */
export interface ScrapeHealthForAgent {
  degraded_count: number;
  ok_count: number;
  degraded: {
    source: string;
    state: SourceState;
    days_since_success: number | null;
    future_events: number;
    last_error: string | null;
  }[];
}

export function summarizeForAgent(report: ScrapeHealthReport): ScrapeHealthForAgent {
  return {
    degraded_count: report.degraded_count,
    ok_count: report.ok_count,
    degraded: report.degraded.map((s) => ({
      source: s.label,
      state: s.state,
      days_since_success: s.days_since_success,
      future_events: s.future_events,
      // Trim a noisy stack/blob to a one-liner for the prompt.
      last_error: s.last_error ? s.last_error.slice(0, 200) : null,
    })),
  };
}

/** Record one source's run outcome. Best-effort; never throws to the caller. */
export async function recordScrapeRun(
  supabase: SupabaseClient,
  row: {
    source: string;
    status: ScrapeRunStatus;
    trigger?: "github" | "vercel-cron" | "manual";
    run_id?: string | null;
    started_at?: string | null;
    inserted?: number | null;
    updated?: number | null;
    unchanged?: number | null;
    error?: string | null;
  }
): Promise<void> {
  try {
    await supabase.from("scrape_runs").insert({
      source: row.source,
      status: row.status,
      trigger: row.trigger ?? "vercel-cron",
      run_id: row.run_id ?? null,
      started_at: row.started_at ?? null,
      inserted: row.inserted ?? null,
      updated: row.updated ?? null,
      unchanged: row.unchanged ?? null,
      error: row.error ?? null,
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[scrape-health] recordScrapeRun failed:", err);
  }
}
