/**
 * Window-scoped stale sweep — the retraction primitive organizer-owned
 * scrapers were missing (2026-08-09).
 *
 * Two venues proved the same lesson from opposite directions: an append-only
 * ingest plus an organizer who EDITS their calendar equals permanent ghosts.
 * Sequoia Woods renamed "Patio Party #4 (TBD)" to "... - The Hit Men" and the
 * TBD row lived on beside it (reconcile happened to catch that one because
 * the titles overlapped; a same-night act swap like Jamie Byous vs The Hit
 * Men is deliberately un-mergeable — different named acts are different
 * events). The Murphys Irish Pub's old LLM source went further and invented
 * whole rows. Deduplication cannot fix either class, because the rows are not
 * duplicates: they are listings the source no longer asserts. The only honest
 * fix is retraction: after a successful scrape, a resident row this source
 * owns, inside the WINDOW the scrape actually covered, that the scrape no
 * longer contains, gets archived and deleted.
 *
 * Guardrails (all here, all pure, locked by scripts/test/stale-sweep.test.ts):
 *  - Window-scoped: only dates the run provably looked at are sweepable —
 *    a month view that failed to parse (or parsed suspiciously few events)
 *    contributes no window, so a bad fetch can never mass-delete.
 *  - Own-rows only: callers pass an ownRow predicate so rows merged from
 *    other sources (an aggregator's URL or source_event_id) are untouchable.
 *  - Human work is untouchable: robs_pick, community_sourced,
 *    series_umbrella, and any *_locked row is skipped and logged, never swept.
 *  - MAX_SWEEP_PER_RUN aborts the whole sweep when a run wants to delete more
 *    rows than any legitimate calendar edit would produce.
 *  - Reversible: the executor (stale-sweep-exec.ts) archives every row to
 *    hwy4_events_removed_archive before deleting. Restore with
 *    INSERT INTO hwy4_events SELECT (jsonb_populate_record(null::hwy4_events,
 *    snapshot)).* FROM hwy4_events_removed_archive WHERE event_id = '…'.
 *  - Dry-run by default: the executor only deletes when SWEEP_EXECUTE names
 *    the calling source (the RECONCILE_EXECUTE precedent, per-source since
 *    HWY-21 — see sweepExecuteEnabled): report-only logs first, then flip.
 *
 * Deliberate non-goal: a swept event's detail URL 404s. That is honest — the
 * event is no longer asserted by anyone, so there is no better destination
 * (contrast merged-away URLs, which 301 to their survivor via event_merge_log).
 *
 * This module is pure (no Supabase import) so tests run without env; the
 * DB-touching half lives in stale-sweep-exec.ts.
 */

export interface SweepWindow {
  /** Inclusive YYYY-MM-DD bounds. */
  from: string;
  to: string;
}

export interface SweepRow {
  id: string;
  name: string;
  date: string;
  source_event_id: string | null;
  event_url: string | null;
  /** The executor selects `*`, so an ownRow predicate may read the venue — the
   *  aggregator sweep needs it to honor the manual-sources blocklist. */
  venue_name?: string | null;
  robs_pick?: boolean | null;
  community_sourced?: boolean | null;
  series_umbrella?: boolean | null;
  price_locked?: boolean | null;
  description_locked?: boolean | null;
  poster_locked?: boolean | null;
  times_locked?: boolean | null;
  notability_locked?: boolean | null;
}

/** Hard ceiling on per-run deletions regardless of venue size. */
export const MAX_SWEEP_PER_RUN = 20;

/**
 * Is deletion enabled for THIS caller? `SWEEP_EXECUTE` is an ALLOWLIST OF ORG
 * SLUGS and nothing else:
 *
 *   unset / "" / "true" / any other text → every sweep is report-only
 *   "murphys-irish-pub,sequoia-woods"    → those two delete, everyone else reports
 *
 * There is deliberately **no "true" = all alias** (HWY-21). It started as one
 * global switch, which was fine while both callers were organizer scrapers
 * graduating together, and became a trap the moment a corridor-wide aggregator
 * joined them: the natural way to graduate the pub sweep is to type "true",
 * which would have armed the GoCalaveras sweep on the same run, over hundreds
 * of rows, before anyone had read one line of its dry-run log. Arming a sweep
 * now costs exactly one deliberate act — naming that sweep. A flag left at
 * "true" from the old semantics fails safe (nothing deletes) rather than
 * silently arming everything.
 *
 * Each caller passes its own org slug, so a source graduates on its own clock.
 * Pure + exported so scripts/test/stale-sweep.test.ts can lock the parsing
 * without the Supabase env the executor needs.
 */
export function sweepExecuteEnabled(
  flag: string | null | undefined,
  orgSlug: string
): boolean {
  const raw = (flag ?? "").trim().toLowerCase();
  if (!raw) return false;
  const wanted = orgSlug.trim().toLowerCase();
  if (!wanted) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .some((s) => s !== "" && s === wanted);
}

/**
 * Per-run abort cap, RELATIVE to the venue's resident rows in the queried
 * window (2026-08-09 review finding: a flat 20 was inert for a venue whose
 * whole future catalog is ~29 rows — a partially-rendered month view could
 * have stranded 12 real rows without tripping it). A sweep may remove at most
 * ~a third of what is resident, floor 3 (tiny venues can still retract a real
 * cancellation), ceiling MAX_SWEEP_PER_RUN.
 */
export function maxSweepAllowed(residentCount: number): number {
  return Math.min(MAX_SWEEP_PER_RUN, Math.max(3, Math.ceil(residentCount * 0.34)));
}

/**
 * The cap actually applied to a run: the relative cap, further lower-bounded by
 * a per-source budget when the caller sets one (HWY-21).
 *
 * The relative cap alone degenerates on a large catalog — at 169 resident rows
 * `maxSweepAllowed` is already pinned to the flat ceiling of 20, i.e. ~12% of a
 * corridor-wide aggregator's future catalog deletable every single night. A
 * source that knows its own blast radius passes a tighter number; a genuine
 * mass retraction then takes several nights and stays visible in the logs,
 * which for a deletion path is the right speed.
 */
export function effectiveSweepCap(
  residentCount: number,
  maxPerRun?: number
): number {
  const relative = maxSweepAllowed(residentCount);
  if (maxPerRun === undefined || !Number.isFinite(maxPerRun)) return relative;
  return Math.min(relative, Math.max(0, Math.floor(maxPerRun)));
}

const MONTH_INDEX: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "August 2026" → { from: 2026-08-01, to: 2026-08-31 }; anything else → null. */
export function monthWindowFromLabel(label: string): SweepWindow | null {
  const m = /^([a-z]+)\s+(\d{4})$/i.exec(label.trim());
  if (!m) return null;
  const mo = MONTH_INDEX[m[1].toLowerCase()];
  if (!mo) return null;
  const y = Number(m[2]);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${y}-${pad2(mo)}-01`, to: `${y}-${pad2(mo)}-${pad2(lastDay)}` };
}

/**
 * Sweepable windows from a run's parsed month views. A month qualifies only
 * when its label resolved AND it parsed at least minEventsPerMonth entries
 * (a thin parse means the fetch, not the calendar, is suspect). Windows are
 * clamped to today — the sweep never touches the past.
 */
export function sweepWindowsFromMonths(
  months: { label: string | null; eventCount: number }[],
  today: string,
  minEventsPerMonth = 3
): SweepWindow[] {
  const out: SweepWindow[] = [];
  for (const m of months) {
    if (!m.label || m.eventCount < minEventsPerMonth) continue;
    const w = monthWindowFromLabel(m.label);
    if (!w || w.to < today) continue;
    out.push({ from: w.from < today ? today : w.from, to: w.to });
  }
  return out;
}

export function inAnyWindow(date: string, windows: SweepWindow[]): boolean {
  return windows.some((w) => date >= w.from && date <= w.to);
}

/** Reason a row must never be auto-deleted, or null when it is sweepable. */
export function isProtectedRow(row: SweepRow): string | null {
  if (row.robs_pick) return "robs_pick";
  if (row.community_sourced) return "community_sourced";
  if (row.series_umbrella) return "series_umbrella";
  if (
    row.price_locked ||
    row.description_locked ||
    row.poster_locked ||
    row.times_locked ||
    row.notability_locked
  )
    return "locked";
  return null;
}

export interface SweepSelection {
  stale: SweepRow[];
  protectedRows: { row: SweepRow; reason: string }[];
}

/**
 * The pure selection: rows inside a covered window, owned by this source,
 * whose identity keys all failed to appear in the current batch.
 */
export function selectStaleRows(
  rows: SweepRow[],
  opts: {
    windows: SweepWindow[];
    /** Identity keys present in the current scrape batch. */
    presentKeys: Set<string>;
    /** Keys that would mark this resident row present (sid, url slug, …). */
    keysOf: (row: SweepRow) => (string | null | undefined)[];
    /** False = not this source's row (merged from elsewhere) — untouchable. */
    ownRow?: (row: SweepRow) => boolean;
  }
): SweepSelection {
  const stale: SweepRow[] = [];
  const protectedRows: { row: SweepRow; reason: string }[] = [];
  for (const row of rows) {
    if (!inAnyWindow(row.date, opts.windows)) continue;
    if (opts.ownRow && !opts.ownRow(row)) continue;
    const keys = opts.keysOf(row).filter((k): k is string => !!k);
    if (keys.some((k) => opts.presentKeys.has(k))) continue;
    const reason = isProtectedRow(row);
    if (reason) protectedRows.push({ row, reason });
    else stale.push(row);
  }
  return { stale, protectedRows };
}
