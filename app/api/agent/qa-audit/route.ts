import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { SITE_URL } from "@/lib/constants";
import { runQaAudit } from "@/lib/agent/qa-audit";
import { fileIssueFilingAlert } from "@/lib/agent/issue-filing-alert";

// QA agent cron. HTTP-checks the live site's key pages + sitemaps for
// CODE/regression bugs and files `proposed` GitHub issues (advisory; Rob accepts
// or closes each, issue #325). Weekly; low-noise by design (one issue per
// check-class, deduped by check_key). See lib/agent/qa-audit.ts.

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

    // Findings that didn't reach GitHub go to the Inbox (agent_actions), not
    // only Slack, so an expired token can't hide them.
    const filing_alert = await fileIssueFilingAlert(supabase, {
      source: "qa_audit",
      error: result.filing_error,
      unfiled: result.unfiled_titles,
      ungated: result.filed_issues.filter((i) => !i.gated).map((i) => i.html_url),
    });

    // A finding that could not be filed is still news: say so, or the sensor
    // fails silently (token unset, GitHub down).
    if (result.filed > 0 || result.filing_error) {
      const webhook = process.env.SLACK_WEBHOOK_URL;
      if (webhook) {
        const lines = [
          `*Hwy4 QA agent: ${result.filed} GitHub issue(s) filed*`,
          ...result.filed_issues.map((i) => `• <${i.html_url}|#${i.number}> ${i.title}`),
          ...(result.unfiled_titles.length
            ? [`⚠️ ${result.unfiled_titles.length} finding(s) not filed: ${result.filing_error}.`]
            : []),
          ...(result.filed_issues.some((i) => !i.gated)
            ? ["⚠️ GitHub dropped the labels on some issues, so they are missing `proposed`."]
            : []),
          ...(result.filing_error || result.filed_issues.some((i) => !i.gated)
            ? [
                filing_alert === "inserted" || filing_alert === "duplicate"
                  ? "Inbox has the alert."
                  : "⚠️ The Inbox alert could not be written either; check the Vercel logs.",
              ]
            : []),
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

    return NextResponse.json({ ok: true, ...result, filing_alert });
  } catch (err) {
    console.error("[qa-audit] failed:", err);
    return NextResponse.json({ error: "QA audit failed" }, { status: 500 });
  }
}
