import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { triageSubmissionById, triagePendingBatch } from "@/lib/agent/submission-triage";

// Agent Cockpit Stage 1 (submissions) — the triage worker.
//
// Default (cron backstop): triages every pending, un-analyzed submission so an
// opinion is always waiting at /admin/submissions even if the on-submit hook
// missed one. Pass ?id=<uuid> to (re)analyze a single submission, ?force=1 to
// re-run one that was already analyzed.
//
// Read-only toward hwy4_events: this only writes the agent's opinion onto the
// submission row. Publishing/merging is always a human click in the admin UI.

export const maxDuration = 60;

export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const force = url.searchParams.get("force") === "1";

  try {
    if (id) {
      const result = await triageSubmissionById(id, { force });
      return NextResponse.json(result);
    }
    const limit = Number(url.searchParams.get("limit") ?? "10") || 10;
    const result = await triagePendingBatch(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[triage-submissions] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
