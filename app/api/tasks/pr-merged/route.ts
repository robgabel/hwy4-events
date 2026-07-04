import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { parseBuiltRefs } from "@/lib/tasks";

// Auto-Done webhook (PRD-roadmap-board.md Phase 3). Closes the Roadmap-board loop:
// when a PR that "Builds HWY-N" merges, the .github/workflows/task-done.yml Action
// POSTs the merged PR's body + number here, and this flips those tickets to `done`.
// So a merged ticket needs no manual status change — the board self-updates.
//
// CRON_SECRET-gated (fail-closed), same as every internal route. POST only.

export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }

  let payload: { body?: string; pr_number?: number; pr_url?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const refs = parseBuiltRefs(payload.body);
  if (refs.length === 0) {
    // A merged PR that doesn't reference a ticket is normal — no-op, not an error.
    return NextResponse.json({ ok: true, closed: [], note: "No 'Builds HWY-N' ref in PR body." });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const closed: string[] = [];
  const now = new Date().toISOString();

  for (const ref of refs) {
    // Only close a ticket that isn't already done/wont_do, and record the PR that
    // did it. `.select` tells us whether a row actually flipped.
    const { data, error } = await supabase
      .from("hwy4_tasks")
      .update({
        status: "done",
        done_at: now,
        updated_at: now,
        pr_number: payload.pr_number ?? null,
        pr_url: payload.pr_url ?? null,
      })
      .eq("ref", ref)
      .not("status", "in", "(done,wont_do)")
      .select("ref");
    if (error) {
      console.error(`[pr-merged] failed to close ${ref}:`, error.message);
      continue;
    }
    if (data && data.length > 0) closed.push(ref);
  }

  return NextResponse.json({ ok: true, refs, closed });
}
