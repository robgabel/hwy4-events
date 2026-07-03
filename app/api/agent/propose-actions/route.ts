import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createClient } from "@supabase/supabase-js";
import { proposeLinkGapActions, researchPendingProposals } from "@/lib/agent/propose-link-gaps";
import { proposeVenueRowActions, researchPendingVenueProposals } from "@/lib/agent/propose-venue-rows";
import { runAutoExecutor } from "@/lib/agent/auto-runner";
import { SITE_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // each new proposal does one web-research call

// Agent Cockpit Stage 1 proposer (PRD-agent-cockpit.md). Drains the actionable
// link-gap worklist into `proposed` agent_actions rows for a human to approve at
// /admin/actions. Writes proposals only — never executes (publish/insert is a
// human click in the cockpit). Idempotent. CRON_SECRET-gated; also triggered
// manually by the "Scan now" button on /admin/actions.
export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }
  const supabase = createClient(url, key);

  try {
    const result = await proposeLinkGapActions(supabase);
    // Same propose→research split for the venue-gap worklist (Phase 1A): stage
    // unregistered venues, then research a small batch of their addresses.
    const venues = await proposeVenueRowActions(supabase);
    // Research bounded batches of blank proposals (each ~15-25s; capped so the
    // cron can't time out). The rest get researched next run or on-demand in the UI.
    const research = await researchPendingProposals(supabase, 3);
    const venueResearch = await researchPendingVenueProposals(supabase, 2);
    // Stage 2: auto-execute any proposals whose type has graduated (no-op while
    // every agent_policy.auto_execute is false). Covers proposals from prior runs too.
    const auto = await runAutoExecutor(supabase);

    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (webhook && (result.proposed > 0 || venues.proposed > 0 || auto.executed > 0)) {
      const bits: string[] = [];
      if (result.proposed > 0) bits.push(`${result.proposed} new link-gap action(s) proposed`);
      if (venues.proposed > 0) bits.push(`${venues.proposed} new venue(s) to register proposed`);
      if (auto.executed > 0) bits.push(`${auto.executed} auto-executed`);
      try {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `*Cockpit:* ${bits.join(", ")} → ${SITE_URL}/admin/actions` }),
        });
      } catch (err) {
        console.error("[propose-actions] Slack post failed:", err);
      }
    }

    return NextResponse.json({ ok: true, ...result, venues, research, venueResearch, auto });
  } catch (err) {
    console.error("[propose-actions] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
