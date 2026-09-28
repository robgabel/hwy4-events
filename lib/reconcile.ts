// Self-healing event identity — the existing-vs-existing reconcile engine.
//
// The title-based `dedup_key` only collides on byte-identical re-scrapes, and
// the write-time matcher in `scripts/lib/dedup.ts` only compares an *incoming*
// scrape against resident rows. Nothing reconciles two rows that are *both*
// already resident — which is exactly what happens when two sources describe
// the same show differently, or a raw-insert writer (scrape-bls, scrape-moose,
// bistro-espresso) bypasses the matcher entirely. Read-time `dedupeEvents`
// hides the duplicate on every render, but the rows persist in the DB forever.
//
// This engine fixes the *system*, not the writers: it operates on DB state,
// blind to who wrote the rows, so every present and future writer is covered by
// one job. It clusters resident rows with the SAME shared `clusterEvents` /
// `pickSurvivor` the read-time layer uses (so it merges precisely what the live
// site would have collapsed), back-fills the survivor from its losers, and
// deletes the losers — writing a full reversible snapshot to `event_merge_log`
// *before* each delete.
//
// The "same event" rule is NOT forked here: it lives in `lib/event-identity.ts`
// and is reached only through `clusterEvents`. This module owns only the
// reconcile mechanics (snapshot, back-fill, delete, audit log).

import {
  clusterEventsDetailed,
  pickSurvivor,
  normalizeVenue,
  type DedupableEvent,
  type RefusedMatch,
} from "./dedupe-events";
import {
  textSimilarity,
  GENERIC_VENUES,
  mergeArtistLists,
  isActlessPlaceholderTitle,
  sameEventMatch,
} from "./event-identity";
import { clockConflictPatch } from "./verify-times";

/** The minimal Supabase surface the reconcile uses. Typed structurally rather
 *  than as the concrete `SupabaseClient` on purpose: the Next app and the
 *  `scripts/` package each install their own `@supabase/supabase-js`, and a
 *  nominal `SupabaseClient` from one install is not assignable to the other.
 *  A service-role client from either satisfies this shape. */
export interface ReconcileDbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

/** The columns the reconcile reads for clustering + back-fill. Selected via
 *  `*` so `merged_snapshot` captures the complete row for restore; this typed
 *  view names the fields the fill logic touches. */
export interface ReconcileRow extends DedupableEvent {
  id: string;
  address?: string | null;
  price?: string | null;
  // Full row carries every other column too (for the snapshot).
  [key: string]: unknown;
}

/** One survivor←loser merge, captured before the loser is deleted. The first
 *  three fields map 1:1 to `event_merge_log`; `merged_snapshot` is the full
 *  deleted row so a false merge is one `INSERT … SELECT` away from restore. */
export interface MergeRecord {
  survivor_id: string;
  merged_from_id: string;
  signal: string;
  merged_snapshot: Record<string, unknown>;
}

export interface ReconcileResult {
  /** Duplicate clusters found (groups of 2+ rows). */
  clusters: number;
  /** Future rows scanned. */
  scanned: number;
  /** Merge records — one per loser. In dry-run these describe what *would*
   *  merge; with `dryRun: false` they're also the rows written to the log. */
  merged: MergeRecord[];
  /** Rows actually deleted (0 in dry-run). */
  deleted: number;
  /** Matches the clustering declined because the row resembles two events
   *  that must stay apart (dedup v2 1.5). Never merged; for a human. */
  refused: RefusedMatch<ReconcileRow>[];
  /** Survivors sent to /admin/verification because a merged-away listing
   *  stated a different start (see `survivorClockFlag`). In dry-run, the ones
   *  that would be. */
  clockFlags: { id: string; reason: string }[];
}

export interface ReconcileOptions {
  /** Only reconcile events on/after this ISO date (default: today). */
  fromDate?: string;
  /** When true, compute and return what would merge but mutate nothing. */
  dryRun: boolean;
  /** Optional per-line logger for CLI output (the cron leaves it unset). */
  log?: (line: string) => void;
}

const SELECT_COLUMNS = "*";

/** A best-effort label for which identity signal made the pair match, for the
 *  audit log. Descriptive only — cluster membership is already decided by the
 *  real `isSameEvent` via `clusterEvents`; this never influences a merge. It
 *  re-derives the cheap title/artist/description/venue signals from the
 *  *exported* helpers (it does not fork the predicate). */
function describeMatch(a: ReconcileRow, b: ReconcileRow): string {
  // Two feeds disagreeing on the start, matched on strong identity inside
  // overlapping windows (dedup v2 1.2). Named first: every signal below
  // assumes the clocks agreed.
  if (sameEventMatch(a, b) === "cross_source") return "cross-source-window";
  if (a.name && b.name && textSimilarity(a.name, b.name) >= 0.85) return "title";
  const setA = new Set(
    (a.artists ?? []).map((x) => x?.toLowerCase().trim()).filter(Boolean)
  );
  if ((b.artists ?? []).some((x) => setA.has(x?.toLowerCase().trim()))) {
    return "artists";
  }
  if (
    a.description &&
    b.description &&
    textSimilarity(a.description, b.description) >= 0.92
  ) {
    return "description";
  }
  // Same venue + an identical known start-AND-end window is its own identity
  // signal (isSameEvent's sameExactWindow). Label it as such so an audit read
  // isn't misled into thinking a title/act signal fired (HWY-29 fix #4).
  if (
    a.start_time &&
    a.end_time &&
    a.start_time === b.start_time &&
    a.end_time === b.end_time
  ) {
    return "venue+exact-window";
  }
  const va = normalizeVenue(a.venue_name);
  const vb = normalizeVenue(b.venue_name);
  if (va && vb && !GENERIC_VENUES.has(va) && !GENERIC_VENUES.has(vb)) {
    return "venue+placeholder-or-act";
  }
  return "matched";
}

/** Fields the survivor lacks but a loser has, plus the union of artists
 *  (placeholder-titled losers do not donate leftover acts). */
function buildFill(survivor: ReconcileRow, losers: ReconcileRow[]): Partial<ReconcileRow> {
  const fill: Partial<ReconcileRow> = {};
  const mergedArtists = mergeArtistLists(survivor, ...losers) ?? [];
  const survivorIsSpecific = !isActlessPlaceholderTitle(survivor.name ?? "");
  for (const l of losers) {
    const loserIsPlaceholder = isActlessPlaceholderTitle(l.name ?? "");
    // A series placeholder's description/end/sid are the aggregator's leftover
    // occurrence (stale act blurb, usual 7–10 window, EventON id). Don't donate
    // them onto a named-act survivor. Empty-field fills from a SPECIFIC loser
    // still happen.
    if (survivorIsSpecific && loserIsPlaceholder) continue;
    if (!survivor.description && l.description && !fill.description) fill.description = l.description;
    // A cluster's rows could not disagree on start until timeless rows became
    // mergeable (HWY-10), so a survivor that states no clock now inherits one
    // from the sibling that does. Never overwrites a known start.
    if (!survivor.start_time && l.start_time && !fill.start_time) fill.start_time = l.start_time;
    if (!survivor.end_time && l.end_time && !fill.end_time) fill.end_time = l.end_time;
    if (!survivor.image_url && l.image_url && !fill.image_url) fill.image_url = l.image_url;
    if (!survivor.event_url && l.event_url && !fill.event_url) fill.event_url = l.event_url;
    if (!survivor.address && l.address && !fill.address) fill.address = l.address;
    if (!survivor.price && l.price && !fill.price) fill.price = l.price;
    if (!survivor.source_event_id && l.source_event_id && !fill.source_event_id)
      fill.source_event_id = l.source_event_id;
  }
  if (
    mergedArtists.length > 0 &&
    JSON.stringify(mergedArtists) !== JSON.stringify(survivor.artists ?? [])
  ) {
    fill.artists = mergedArtists;
  }
  return fill;
}

/** When the cross-source rule merged a loser whose start differs from the
 *  survivor's, the loser's clock is staged on the survivor for a human rather
 *  than deleted with it (dedup v2 review #5; `clockConflictPatch` decides when
 *  a flag is warranted). Only a DIRECT cross-source match flags: a series
 *  placeholder's default clock (the standard path's start tolerance) is the
 *  aggregator's leftover, not a competing claim about this event. */
function survivorClockFlag(
  survivor: ReconcileRow,
  losers: ReconcileRow[],
  now: string
): Record<string, unknown> | null {
  for (const l of losers) {
    if (sameEventMatch(survivor, l) !== "cross_source") continue;
    const patch = clockConflictPatch(survivor, l, now);
    if (patch) return patch;
  }
  return null;
}

/**
 * Reconcile resident duplicate rows in `hwy4_events`.
 *
 * Pulls future, non-cancelled rows, clusters them with the shared
 * `clusterEvents`, keeps the richest (`pickSurvivor`), back-fills the survivor
 * from its losers, and deletes the losers — but only after writing a full
 * snapshot of each loser to `event_merge_log` (log-before-delete, so every
 * automated delete is reversible). `dryRun: true` mutates nothing.
 *
 * The Supabase client is injected so the same engine serves both the CLI
 * (`scripts/backfill-dedup.ts`, env `SUPABASE_URL`) and the Vercel cron
 * (`app/api/reconcile-dupes`, env `NEXT_PUBLIC_SUPABASE_URL`). Caller must pass
 * a service-role client.
 */
export async function reconcileDuplicates(
  supabase: ReconcileDbClient,
  opts: ReconcileOptions
): Promise<ReconcileResult> {
  const { dryRun } = opts;
  const log = opts.log ?? (() => {});
  const fromDate = opts.fromDate ?? new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("hwy4_events")
    .select(SELECT_COLUMNS)
    .gte("date", fromDate)
    .neq("status", "cancelled");
  if (error) throw error;

  const rows = (data ?? []) as unknown as ReconcileRow[];
  const detailed = clusterEventsDetailed(rows);
  const clusters = detailed.clusters.filter((c) => c.length > 1);

  log(
    `${dryRun ? "DRY RUN" : "EXECUTE"} — ${clusters.length} duplicate cluster(s) among ${rows.length} future events.\n`
  );
  for (const r of detailed.refused) {
    log(
      `  REFUSED ${r.row.date} "${r.row.name}" [${r.row.id}] matches rows kept apart: ` +
        r.matches.map((m) => `"${m.name}" [${m.id}]`).join(", ")
    );
  }

  const merged: MergeRecord[] = [];
  const clockFlags: { id: string; reason: string }[] = [];
  let deleted = 0;

  for (const cluster of clusters) {
    const survivor = pickSurvivor(cluster);
    const losers = cluster.filter((r) => r !== survivor);
    const fill = buildFill(survivor, losers);
    const now = new Date().toISOString();
    const flag = survivorClockFlag(survivor, losers, now);

    const records: MergeRecord[] = losers.map((l) => ({
      survivor_id: survivor.id,
      merged_from_id: l.id,
      signal: describeMatch(survivor, l),
      merged_snapshot: l as Record<string, unknown>,
    }));

    log(`• ${survivor.date} ${survivor.start_time ?? "?"} — ${survivor.town}`);
    log(`    KEEP  "${survivor.name}"  venue="${survivor.venue_name}"  [${survivor.id}]`);
    for (const l of losers) {
      log(`    DROP  "${l.name}"  venue="${l.venue_name}"  [${l.id}]  (${describeMatch(survivor, l)})`);
    }
    if (Object.keys(fill).length > 0) {
      log(`    fill survivor: ${Object.keys(fill).join(", ")}`);
    }
    if (flag) log(`    flag survivor: ${flag.verification_reason}`);
    log("");

    if (dryRun) {
      merged.push(...records);
      if (flag) clockFlags.push({ id: survivor.id, reason: String(flag.verification_reason) });
      continue;
    }

    // Log BEFORE delete: a deletion is only safe if it's reversible. If the
    // audit write fails, skip the delete for this cluster (leave the dupe; the
    // next run retries) rather than delete an unrecorded row.
    const { error: le } = await supabase.from("event_merge_log").insert(records);
    if (le) {
      log(`    SKIP cluster — merge log write failed: ${le.message}`);
      continue;
    }

    if (Object.keys(fill).length > 0 || flag) {
      // Back-filling the survivor is a content change, so stamp `updated_at`
      // (the sitemap's <lastmod>). Only then, on purpose: stamping
      // unconditionally would bump every survivor's lastmod on every nightly
      // run with nothing to fill, and a verification flag changes nothing a
      // reader sees.
      const patch: Record<string, unknown> = { ...fill, ...(flag ?? {}) };
      if (Object.keys(fill).length > 0) patch.updated_at = now;
      const { error: ue } = await supabase
        .from("hwy4_events")
        .update(patch)
        .eq("id", survivor.id);
      if (ue) log(`    update failed (survivor kept as-is): ${ue.message}`);
      else if (flag) clockFlags.push({ id: survivor.id, reason: String(flag.verification_reason) });
    }

    const { error: de } = await supabase
      .from("hwy4_events")
      .delete()
      .in("id", losers.map((l) => l.id));
    if (de) {
      log(`    delete failed: ${de.message}`);
      continue;
    }
    deleted += losers.length;
    merged.push(...records);
  }

  log(
    dryRun
      ? `Dry run complete. Would delete ${merged.length} row(s) across ${clusters.length} cluster(s).`
      : `Done. ${deleted} row(s) deleted across ${clusters.length} cluster(s); ${merged.length} merge(s) logged.`
  );

  return {
    clusters: clusters.length,
    scanned: rows.length,
    merged,
    deleted,
    refused: detailed.refused,
    clockFlags,
  };
}
