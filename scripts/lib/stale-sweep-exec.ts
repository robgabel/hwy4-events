import { supabaseAdmin } from "./supabase-admin.js";
import {
  selectStaleRows,
  effectiveSweepCap,
  sweepExecuteEnabled,
  type SweepPlan,
  type SweepRow,
} from "./stale-sweep.js";

/** PostgREST caps an unbounded SELECT at its configured max rows and says
 *  nothing about it. A silently truncated resident set would make the
 *  considered population arbitrary — rows past the cut can't be selected, and
 *  the abort cap would be computed against a short count. Ask for an explicit,
 *  ordered page instead, and shout if we ever fill it. */
const RESIDENT_ROW_LIMIT = 1000;

/**
 * DB half of the window-scoped stale sweep (see stale-sweep.ts for the
 * rationale and every guardrail). Archive-then-delete, in that order, so a
 * failed archive means nothing is deleted. Best-effort: any error logs and
 * returns 0 — a sweep failure must never fail the scrape.
 */
export async function sweepStaleSourceRows(
  opts: SweepPlan & { orgSlug: string }
): Promise<number> {
  try {
    return await runSweep(opts);
  } catch (err) {
    // The docstring's promise, actually kept: a thrown client/network error
    // must not take the scrape down with it.
    console.error(
      `  Sweep: unexpected failure for ${opts.orgSlug}, nothing deleted:`,
      err instanceof Error ? err.message : err
    );
    return 0;
  }
}

async function runSweep(
  opts: SweepPlan & { orgSlug: string }
): Promise<number> {
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
    .lte("date", to)
    .order("date")
    .limit(RESIDENT_ROW_LIMIT);
  if (error) {
    console.error("  Sweep: resident-row query failed, skipping:", error.message);
    return 0;
  }
  const residents = (data ?? []) as SweepRow[];
  if (residents.length >= RESIDENT_ROW_LIMIT) {
    console.error(
      `  Sweep: resident query hit the ${RESIDENT_ROW_LIMIT}-row limit — the considered set is partial, skipping.`
    );
    return 0;
  }

  const { stale, protectedRows } = selectStaleRows(residents, opts);
  for (const p of protectedRows) {
    console.log(
      `  Sweep: "${p.row.name}" (${p.row.date}) is gone from the source but ${p.reason} — left in place for a human.`
    );
  }
  if (stale.length === 0) {
    console.log("  Sweep: nothing stale in the covered window.");
    return 0;
  }
  // Annotate each selected row with its key situation: a "0 keys (legacy)"
  // row can never match a batch, so it reads differently from a keyed row the
  // source genuinely stopped asserting — the distinction the execute flip
  // depends on.
  const describeKeys = (r: SweepRow): string => {
    const keys = opts.keysOf(r).filter(Boolean);
    return keys.length === 0 ? "0 keys (legacy row)" : `${keys.length} key(s), absent from batch`;
  };
  const cap = effectiveSweepCap(residents.length, opts.maxPerRun);
  // Dry-run unless SWEEP_EXECUTE names this source (the RECONCILE_EXECUTE
  // precedent, per-source since HWY-21 — there is no "all sources" value, see
  // sweepExecuteEnabled). In GitHub Actions the flag is a repository VARIABLE
  // wired through .github/workflows/scrape.yml — NOT a Vercel env.
  const executing = sweepExecuteEnabled(process.env.SWEEP_EXECUTE, opts.orgSlug);

  // Dry-run reporting comes BEFORE the cap gate: graduation is a human reading
  // several days of would-remove lists, and an over-cap selection is exactly
  // the report that needs reading in full — it explains what an execute run
  // would refuse and why. Execute mode keeps the hard abort below.
  if (!executing) {
    for (const r of stale) {
      console.log(
        `  Sweep DRY-RUN would remove: ${r.date} "${r.name}" (${r.id}) — ${describeKeys(r)}`
      );
    }
    if (stale.length > cap) {
      console.log(
        `  Sweep DRY-RUN: ${stale.length} row(s) selected — OVER the cap (${cap} for ${residents.length} resident); an execute run would ABORT. Nothing deleted.`
      );
    } else {
      console.log(
        `  Sweep DRY-RUN: ${stale.length} row(s) selected. Add "${opts.orgSlug}" to SWEEP_EXECUTE to enable deletion.`
      );
    }
    return 0;
  }

  if (stale.length > cap) {
    console.error(
      `  Sweep ABORTED: ${stale.length} rows selected (cap ${cap} for ${residents.length} resident). ` +
        "No legitimate calendar edit strands this many — assuming a bad fetch. Nothing deleted."
    );
    for (const r of stale.slice(0, 5)) {
      console.error(`    would have selected: ${r.date} "${r.name}" — ${describeKeys(r)}`);
    }
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
