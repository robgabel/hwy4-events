import { supabaseAdmin } from "./supabase-admin.js";
import {
  selectStaleRows,
  maxSweepAllowed,
  type SweepRow,
  type SweepWindow,
} from "./stale-sweep.js";

/**
 * DB half of the window-scoped stale sweep (see stale-sweep.ts for the
 * rationale and every guardrail). Archive-then-delete, in that order, so a
 * failed archive means nothing is deleted. Best-effort: any error logs and
 * returns 0 — a sweep failure must never fail the scrape.
 */
export async function sweepStaleSourceRows(opts: {
  orgSlug: string;
  /** Stored on the archive rows — say which sweep and why. */
  reason: string;
  windows: SweepWindow[];
  presentKeys: Set<string>;
  keysOf: (row: SweepRow) => (string | null | undefined)[];
  ownRow?: (row: SweepRow) => boolean;
}): Promise<number> {
  if (opts.windows.length === 0) {
    console.log("  Sweep: no qualifying windows this run — nothing considered.");
    return 0;
  }
  const from = opts.windows.map((w) => w.from).sort()[0];
  const to = opts.windows.map((w) => w.to).sort().at(-1)!;

  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("*")
    .eq("org_slug", opts.orgSlug)
    .gte("date", from)
    .lte("date", to);
  if (error) {
    console.error("  Sweep: resident-row query failed, skipping:", error.message);
    return 0;
  }

  const { stale, protectedRows } = selectStaleRows((data ?? []) as SweepRow[], opts);
  for (const p of protectedRows) {
    console.log(
      `  Sweep: "${p.row.name}" (${p.row.date}) is gone from the source but ${p.reason} — left in place for a human.`
    );
  }
  if (stale.length === 0) {
    console.log("  Sweep: nothing stale in the covered window.");
    return 0;
  }
  const cap = maxSweepAllowed((data ?? []).length);
  if (stale.length > cap) {
    console.error(
      `  Sweep ABORTED: ${stale.length} rows selected (cap ${cap} for ${(data ?? []).length} resident). ` +
        "No legitimate calendar edit strands this many — assuming a bad fetch. Nothing deleted."
    );
    return 0;
  }
  // Dry-run by default (the RECONCILE_EXECUTE precedent): report what WOULD
  // be swept; delete only once SWEEP_EXECUTE=true is set after the report-only
  // logs have been reviewed.
  if (process.env.SWEEP_EXECUTE !== "true") {
    for (const r of stale) {
      console.log(`  Sweep DRY-RUN would remove: ${r.date} "${r.name}" (${r.id})`);
    }
    console.log(
      `  Sweep DRY-RUN: ${stale.length} row(s) selected. Set SWEEP_EXECUTE=true to enable deletion.`
    );
    return 0;
  }

  const { error: archiveErr } = await supabaseAdmin.from("hwy4_events_removed_archive").insert(
    stale.map((r) => ({ event_id: r.id, reason: opts.reason, snapshot: r }))
  );
  if (archiveErr) {
    console.error("  Sweep: archive insert failed — NOT deleting:", archiveErr.message);
    return 0;
  }
  const { error: delErr } = await supabaseAdmin
    .from("hwy4_events")
    .delete()
    .in(
      "id",
      stale.map((r) => r.id)
    );
  if (delErr) {
    console.error("  Sweep: delete failed (rows remain archived AND live):", delErr.message);
    return 0;
  }
  for (const r of stale) {
    console.log(`  Swept stale row: ${r.date} "${r.name}" (${r.id})`);
  }
  return stale.length;
}
