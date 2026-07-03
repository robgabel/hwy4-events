import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";

/**
 * Monthly AEO prompt-audit reminder.
 *
 * Fires on the 1st of each month (vercel.json cron) and posts a reminder to
 * SLACK_WEBHOOK_URL nudging Rob to run the manual AEO prompt audit: ask the
 * AI answer engines (ChatGPT, Perplexity, Gemini AI Overview) the query bank
 * below and log whether Hwy4Events is cited, where it ranks, and whether the
 * info is accurate.
 *
 * This is a manual ritual — a human must judge citation accuracy. The route
 * only delivers the reminder + the query checklist. Full method and the
 * monthly log template live in AEO-SEO-MEASUREMENT.md (Part 3.2 + Part 4).
 *
 * No mutations; safe to re-run. Auth via CRON_SECRET bearer token.
 */

const QUERY_BANK = [
  "What's happening this weekend in Murphys, CA?",
  "Things to do in Arnold, California this weekend",
  "Events near Bear Valley, CA this month",
  "Family-friendly events in Calaveras County this weekend",
  "What is there to do on Highway 4 in the Sierra foothills?",
  "Live music in Murphys this weekend",
  "Wine events near Murphys, CA",
  "Festivals in Calaveras County this summer",
  "Farmers market or community events in Angels Camp",
  "I'm visiting Arnold CA for the weekend, what events are on?",
  "Day trip from Stockton to the Sierra foothills, what's happening?",
  "Where can I find a calendar of events for the Highway 4 corridor?",
  "What towns are between Angels Camp and Bear Valley and what happens there?",
];

const DOC_URL =
  "https://github.com/robgabel/hwy4-events/blob/main/AEO-SEO-MEASUREMENT.md";

export async function GET(request: Request) {

  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const month = new Date().toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });

  const lines: string[] = [
    `*AEO prompt audit — ${month}*`,
    "Run each query through ChatGPT (search on), Perplexity, and Google's AI Overview. For each, note: *cited?* / *rank among sources* / *accurate?* A wrong date quoted back is a content bug to fix.",
    "",
    ...QUERY_BANK.map((q, i) => `${i + 1}. ${q}`),
    "",
    `Also glance at AI-engine *referral traffic* in Cloudflare (chatgpt / perplexity / gemini / copilot).`,
    `Log results in the Part 4 template: ${DOC_URL}`,
  ];

  const webhook = process.env.SLACK_WEBHOOK_URL;
  let posted = false;
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: lines.join("\n") }),
      });
      posted = res.ok;
    } catch (err) {
      console.error("[aeo-audit-reminder] Slack post failed:", err);
    }
  } else {
    console.warn("[aeo-audit-reminder] SLACK_WEBHOOK_URL not set — skipping post");
  }

  return NextResponse.json({ ok: true, month, posted, queries: QUERY_BANK.length });
}
