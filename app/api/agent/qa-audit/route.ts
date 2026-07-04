import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { SITE_URL } from "@/lib/constants";
import { runQaAudit } from "@/lib/agent/qa-audit";

// QA agent cron (PRD-roadmap-board.md Phase 3). HTTP-checks the live site's key
// pages + sitemaps for CODE/regression bugs and files `type='bug'` `proposed`
// Roadmap tickets (advisory — a human promotes each). Weekly; low-noise by design
// (one ticket per check-class, deduped). See lib/agent/qa-audit.ts.

export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const result = await runQaAudit(supabase, SITE_URL);

    if (result.filed > 0) {
      const webhook = process.env.SLACK_WEBHOOK_URL;
      if (webhook) {
        const lines = [
          `*Hwy4 QA agent — ${result.filed} bug ticket(s) filed*`,
          ...result.filed_titles.map((t) => `• ${t}`),
          `→ ${SITE_URL}/admin/roadmap`,
        ];
        try {
          await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: lines.join("\n") }),
          });
        } catch (err) {
          console.error("[qa-audit] Slack post failed:", err);
        }
      }
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[qa-audit] failed:", err);
    return NextResponse.json({ error: "QA audit failed" }, { status: 500 });
  }
}
