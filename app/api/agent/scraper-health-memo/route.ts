import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { SITE_URL } from "@/lib/constants";
import { gatherScraperHealthContext } from "@/lib/agent/scraper-health-context";
import { coerceDigest, emptyDigest, type Digest, type ScraperHealthContext } from "@/lib/agent/types";
import { parseModelJson } from "@/lib/agent/model-json";

// Weekly scraper-health memo: the operational-health counterpart to the daily
// chief-of-staff digest and the weekly growth memo. Reads scrape_runs (written
// by scripts/lib/scrape-run-log.ts on every scripts/scrape.ts run) and writes
// a short read on scraper reliability. Same agent_runs table, tagged
// run_type='scraper_health'. Read-only: it reports, it fixes nothing.

export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are the person who keeps the lights on for Hwy4Events.com's data pipeline, a one-person community events site for the Highway 4 corridor (Angels Camp to Bear Valley, California). Once a week you write a short operational-health memo for Rob, the owner, about the scrapers that keep the site's event catalog current.

You are given a structured signal pack: real counts from the last 14 days of scrape runs, which sources are currently erroring, and which sources ran clean but added nothing. Summarize ONLY what you are given. Never invent a source name, an error, or a number. If a section is empty, say the pipeline is healthy there.

A "source" key is an org_slug or source_name string (e.g. "visit-murphys", "fb-discover-arnold", "gocalaveras") — write it in your prose roughly as a reader would say it out loud (Visit Murphys, Facebook Discover Arnold, GoCalaveras), you don't need to preserve the exact slug punctuation.

Triage into three buckets:
- needs_you: sources broken RIGHT NOW (their most recent run errored and hasn't recovered since). Each gets a one-line "why": what's likely wrong (site changed shape, added bot protection, API auth failed) based on the error text given, and that new events from that source have stopped flowing until it's fixed.
- fyi: the pipeline's overall shape this week — total events inserted/updated, how many of the last runs were clean, anything worth a passing mention (a source that came back online, a particularly productive source).
- watching: sources that ran clean all week but added zero events. Not broken, but worth an eyeball: either the source is genuinely quiet (fine) or its page changed shape in a way the scraper doesn't error on but silently extracts nothing (not fine). Say which you suspect if the pattern is clear (a long-quiet source vs. one that just went quiet this week), otherwise just flag it.

If sources_attempted is 0 for every run in the window, say plainly that no scrape data has been recorded yet rather than inventing anything.

Do not manufacture urgency. A clean week with real inserts is a good outcome: say so plainly and keep needs_you empty.

Voice: plain, direct, a little dry. Like a sharp operator briefing a peer, not a chatbot. Short sentences. No corporate filler, no hype, no emojis, and NO EM DASHES (use commas, periods, or parentheses).

Output STRICT JSON only. No markdown fences, no preamble. Match this shape exactly:
{"summary": string, "needs_you": [{"title": string, "detail": string, "why": string}], "fyi": [{"title": string, "detail": string}], "watching": [{"title": string, "detail": string}]}

Never set "link" on any item (there is no per-source admin page to send Rob to yet).`;

async function generateMemo(
  context: ScraperHealthContext
): Promise<{ digest: Digest; status: string; usage: { input: number; output: number } }> {
  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Today is ${context.date}. Here is this week's scraper-health signal pack as JSON. Write the memo.\n\n${JSON.stringify(
          context,
          null,
          2
        )}`,
      },
    ],
  });

  const usage = { input: message.usage.input_tokens, output: message.usage.output_tokens };
  const block = message.content[0];
  const text = block && block.type === "text" ? block.text : "";
  const parsed = coerceDigest(parseModelJson(text));
  if (parsed) return { digest: parsed, status: "ok", usage };

  return {
    digest: emptyDigest(text || "The scraper-health memo could not be produced this run."),
    status: "degraded",
    usage,
  };
}

async function postSlack(digest: Digest): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const n = digest.needs_you.length;
  const header = n > 0 ? `${n} scraper(s) need you` : "scrapers all clean";
  const lines = [`*Hwy4 scraper health — ${header}*`, digest.summary, `→ ${SITE_URL}/admin/scrapers`];
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
  } catch (err) {
    console.error("[scraper-health-memo] Slack post failed:", err);
  }
}

export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const context = await gatherScraperHealthContext(supabase);
    const { digest, status, usage } = await generateMemo(context);

    const { error } = await supabase.from("agent_runs").insert({
      run_type: "scraper_health",
      status,
      model: MODEL,
      input_tokens: usage.input,
      output_tokens: usage.output,
      context_in: context,
      digest,
    });
    if (error) throw error;

    await postSlack(digest);

    return NextResponse.json({
      ok: true,
      status,
      needs_you: digest.needs_you.length,
      summary: digest.summary,
    });
  } catch (err) {
    console.error("[scraper-health-memo] failed:", err);
    try {
      await supabase.from("agent_runs").insert({
        run_type: "scraper_health",
        status: "error",
        model: MODEL,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      /* best effort */
    }
    return NextResponse.json({ error: "Memo generation failed" }, { status: 500 });
  }
}
