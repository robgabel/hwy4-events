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
  clusterEvents,
  pickSurvivor,
  normalizeVenue,
  type DedupableEvent,
} from "./dedupe-events";
import { textSimilarity, GENERIC_VENUES } from "./event-identity";

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

/** Fields the survivor lacks but a loser has, plus the union of artists. */
function buildFill(survivor: ReconcileRow, losers: ReconcileRow[]): Partial<ReconcileRow> {
  const fill: Partial<ReconcileRow> = {};
  const artistSet = new Set<string>(
    (survivor.artists ?? []).map((a) => a?.trim()).filter((a): a is string => !!a)
  );
  for (const l of losers) {
    for (const a of l.artists ?? []) {
      const t = a?.trim();
      if (t) artistSet.add(t);
    }
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
  const mergedArtists = [...artistSet];
  if (
    mergedArtists.length > 0 &&
    JSON.stringify(mergedArtists) !== JSON.stringify(survivor.artists ?? [])
  ) {
    fill.artists = mergedArtists;
  }
  return fill;
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
  const clusters = clusterEvents(rows).filter((c) => c.length > 1);

  log(
    `${dryRun ? "DRY RUN" : "EXECUTE"} — ${clusters.length} duplicate cluster(s) among ${rows.length} future events.\n`
  );

  const merged: MergeRecord[] = [];
  let deleted = 0;

  for (const cluster of clusters) {
    const survivor = pickSurvivor(cluster);
    const losers = cluster.filter((r) => r !== survivor);
    const fill = buildFill(survivor, losers);

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
    log("");

    if (dryRun) {
      merged.push(...records);
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

    if (Object.keys(fill).length > 0) {
      const { error: ue } = await supabase
        .from("hwy4_events")
        .update(fill)
        .eq("id", survivor.id);
      if (ue) log(`    update failed (survivor kept as-is): ${ue.message}`);
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

  return { clusters: clusters.length, scanned: rows.length, merged, deleted };
}
