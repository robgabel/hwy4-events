import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { proposeLinkGapActions } from "@/lib/agent/propose-link-gaps";
import { SITE_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Agent Cockpit Stage 1 proposer (PRD-agent-cockpit.md). Drains the actionable
// link-gap worklist into `proposed` agent_actions rows for a human to approve at
// /admin/actions. Writes proposals only — never executes (publish/insert is a
// human click in the cockpit). Idempotent. CRON_SECRET-gated; also triggered
// manually by the "Scan now" button on /admin/actions.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }
  const supabase = createClient(url, key);

  try {
    const result = await proposeLinkGapActions(supabase);

    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (webhook && result.proposed > 0) {
      try {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `*Cockpit:* ${result.proposed} new link-gap action(s) proposed → ${SITE_URL}/admin/actions`,
          }),
        });
      } catch (err) {
        console.error("[propose-actions] Slack post failed:", err);
      }
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[propose-actions] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
