import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { reconcileDuplicates } from "@/lib/reconcile";

export const maxDuration = 60;

/**
 * Self-healing event identity (dedup Move 3).
 *
 * Runs the shared reconcile engine (lib/reconcile.ts) over future events on a
 * daily schedule, AFTER the scrape windows and BEFORE the /api/check-events
 * audit. Because it operates on DB state — blind to who wrote the rows — it
 * covers every write path: the upsertEvents scrapers AND the three raw-insert
 * writers (scrape-bls, scrape-moose-lodge, bistro-espresso) AND any future
 * writer. That coverage is the whole point: it's a property of running on the
 * data, not of each writer's code.
 *
 * ROLLOUT: ships in DRY-RUN mode (reports what it would merge, mutates nothing).
 * After a canary week of clean dry-runs, flip to execute by setting the Vercel
 * env var RECONCILE_EXECUTE=true (or hit ?execute=1 for a one-off manual run).
 * Every executed merge is logged to event_merge_log and is reversible.
 *
 * CRON_SECRET-gated. Read-only in dry-run; deletes losers (reversibly) when
 * executing.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Missing Supabase credentials" },
      { status: 500 }
    );
  }

  // Dry-run unless explicitly enabled. Env flip (RECONCILE_EXECUTE=true) drives
  // the daily cron; ?execute=1 forces a one-off execute for manual runs.
  const url = new URL(request.url);
  const execute =
    process.env.RECONCILE_EXECUTE === "true" || url.searchParams.get("execute") === "1";

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const result = await reconcileDuplicates(supabase, {
      dryRun: !execute,
      log: (line) => console.log(`[reconcile-dupes] ${line}`),
    });

    return NextResponse.json({
      ok: true,
      mode: execute ? "execute" : "dry-run",
      reconciled_at: new Date().toISOString(),
      clusters: result.clusters,
      scanned: result.scanned,
      deleted: result.deleted,
      // Trim the heavy merged_snapshot out of the response; the full snapshot
      // lives in event_merge_log. Keep just the identity of each merge.
      merges: result.merged.map((m) => ({
        survivor_id: m.survivor_id,
        merged_from_id: m.merged_from_id,
        signal: m.signal,
      })),
    });
  } catch (err) {
    console.error("[reconcile-dupes] Failed:", err);
    return NextResponse.json(
      { error: "Reconcile failed", details: (err as Error).message },
      { status: 500 }
    );
  }
}
