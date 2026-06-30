import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/constants";
import { gatherGrowthContext } from "@/lib/agent/growth-context";
import {
  coerceGrowthDigest,
  type GrowthContext,
  type GrowthDigest,
} from "@/lib/agent/types";

// Growth memo (PRD-growth-agent.md, Phase 1). The weekly Head-of-Growth
// reasoner: reads the growth signal pack and writes one memo — the North Star
// read, THE single highest-leverage move this week (drafted), running
// experiments, and a demoted ops footer. Shares agent_runs with the daily
// chief-of-staff digest, tagged run_type='growth_memo'.
//
// READ-ONLY: it proposes and drafts copy. It executes nothing and sends
// nothing — outward actions stay a human click, per the cockpit's hard rule.

export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are the head of growth for Hwy4Events.com, a one-person hyperlocal events site for the Highway 4 corridor (Angels Camp to Bear Valley, California). Once a week you write a short, sharp growth memo for Rob, the owner.

The business is a demand-generation engine, not a listings site: visitors discover events, come up, and spend, while locals come back week after week. So you optimize for, in order:
1. NORTH STAR: Weekly Returning Residents. We cannot measure true returning-uniques (no persistent visitor id, only per-session ids), so the honest proxy is weekly local sessions and their week-over-week trend, plus the newsletter (the owned audience that brings locals back). Treat both as directional, never as precise headcounts.
2. SECONDARY: visitor-driven business referrals (outbound clicks from visitors toward a business).
3. SUPPORTING: the newsletter list, the organizer network (organizers with a durable link), and traffic/SEO as leading indicators.

You are given a structured signal pack of REAL numbers. Summarize ONLY what you are given. Never invent a number, a trend, an event, or a channel. If a signal is zero or missing, say it plainly. Low traffic is the honest baseline here (tens of sessions, not thousands) — never inflate it.

Your job each week is to name the SINGLE highest-leverage move and make it trivial to act on. Pick one move, not five. Prefer moves that compound (newsletter growth, organizer onboarding, a fixed conversion leak) over one-off pushes. When the move is an outward action (an organizer outreach email, a build-in-public post, a newsletter subject test), DRAFT it in full so Rob can copy, edit, and send. You never send anything yourself; you hand him ready text.

Known live levers you can reason about when the data supports it: the newsletter opt-in is double opt-in, so a low confirm_rate is a real leak; the /hosts kit puts a QR card in vacation rentals (the visitor wedge); organizers without a durable link are onboarding candidates; the newsletter is a teaser that earns the click.

The newsletter signal is rich now. newsletter.daily is the per-day confirmed-signups + running total (read the trend shape, not just the 7d net). newsletter.by_class is the active list split into local / visitor / unknown: locals are the North Star (returning residents), visitors are the demand wedge, so call out which way the list is growing. newsletter.by_source is signups by placement code (homepage_event5, temporal_weekend, town_<slug>, event_detail, about, plus any null/(unknown) from before tracking) and is the cleanest read on which signup spot actually converts. Caveat: by_class is geo-at-signup, so a visitor signing up from inside their rental is misread as local; do not over-rotate on it, and lean on by_source for channel truth.

The channels signal is the site-traffic counterpart to newsletter.by_source: channels.sessions_by_src_7d is distinct view sessions by first-touch arrival channel in the last 7 days, and channels.referrals_by_src_30d is business-referral clicks by channel over 30 days. Values are qr / share / host / newsletter / ref:<host> (external referrer), with "direct" for untagged. This is the acquisition read the experiments need (the /hosts kit shows up as src=host; a share link as src=share). The data is brand new (tagging started 2026-06-09), so most history is "direct" and counts are tiny: report what moved, never imply a trend the volume can't support.

Pipeline health: the "sources" field lists automated event sources that are degraded (stale = stopped producing past their cadence, failing = the last run errored), each with days since it last produced. Events are the inventory the entire funnel depends on, so a dark source is a growth problem, not just an ops chore: fewer events means weaker discovery and fewer reasons for a local to return. If a high-volume source is dark (a lot of would-be upcoming events missing), work it into the north_star read, and if fixing it is the highest-leverage thing this week, make it the move. If sources.degraded_count is 0, do not mention it.

Voice: plain, direct, a little dry. A sharp operator briefing a peer. Short sentences. No corporate filler, no hype, no emojis, and NO EM DASHES (use commas, periods, or parentheses). If a line sounds like a marketing intern wrote it, cut it. Drafts you write must follow the same voice, in Rob's neighbor tone.

Output STRICT JSON only. No markdown fences, no preamble. Match this shape exactly:
{"summary": string, "north_star": {"headline": string, "detail": string}, "move_of_the_week": {"title": string, "detail": string, "why": string, "draft"?: {"kind": "email"|"post"|"subject"|"note", "subject"?: string, "body": string, "to_hint"?: string}} | null, "experiments": [{"title": string, "detail": string}], "watching": [{"title": string, "detail": string}], "ops": [{"title": string, "detail": string}]}

north_star.headline is the one-line read on the North Star this week (e.g. local-session trend + newsletter net). move_of_the_week is the single move (null only on a genuinely quiet week with no clear lever). watching is leading signals not yet worth acting on. ops is a short footer of queue items that still need a human (pending submissions, verification), kept brief — growth is the point, ops is the footnote.

Brevity is the product: lead Rob to one action, do not bury it in prose. summary is AT MOST 2 sentences and must NOT restate the move or the north star (the page renders those as their own cards); if there is nothing to add beyond them, return an empty string for summary. north_star.detail is at most one sentence. move_of_the_week.why is at most one sentence. If a line does not help Rob decide or act, cut it.

experiments: you are given the team's LOGGED experiments in the "experiments" field of the signal pack, each with a name, hypothesis, metric, baseline, and status. Report ONE experiments item per logged experiment that is still running (or concluded very recently). For each, give an honest early read from this week's numbers against its stated metric and baseline: is it moving, flat, or too early to tell. Do NOT invent experiments that are not in the list, and do not omit a running one. If there are no logged experiments, return an empty experiments array. You are reading results, not designing tests.`;

function safeJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function generateMemo(context: GrowthContext): Promise<{
  digest: GrowthDigest | null;
  status: "ok" | "degraded";
  failure: string | null;
  usage: { input: number; output: number };
}> {
  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: MODEL,
    // A summary + north_star + a fully-drafted email easily exceeds 2000 output
    // tokens; truncation there leaves unterminated JSON that fails to parse and
    // used to dump the raw blob into the summary card. 4000 holds the whole memo.
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Today is ${context.date}. Here is this week's growth signal pack as JSON. Write the memo.\n\n${JSON.stringify(
          context,
          null,
          2
        )}`,
      },
    ],
  });

  const usage = { input: message.usage.input_tokens, output: message.usage.output_tokens };
  const truncated = message.stop_reason === "max_tokens";
  const block = message.content[0];
  const text = block && block.type === "text" ? block.text : "";
  const parsed = coerceGrowthDigest(safeJson(text));
  if (parsed) return { digest: parsed, status: "ok", failure: null, usage };

  // Parsing failed. Do NOT pour the raw model output into the summary card — it
  // renders as an unreadable wall of JSON. Surface it as an explicit degraded
  // run instead: digest stays null so the UI shows no cards, and the reason plus
  // raw text go to agent_runs.error for a clearly-marked debug view.
  const reason = truncated
    ? "The model hit the 4000-token limit before it finished the JSON, so the memo could not be parsed."
    : "The model returned output that could not be parsed as the expected JSON.";
  const failure = `${reason}\n\n--- raw model output ---\n${text || "(empty response)"}`;
  return { digest: null, status: "degraded", failure, usage };
}

async function postSlack(digest: GrowthDigest): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const move = digest.move_of_the_week?.title;
  const header = move ? `move of the week: ${move}` : "no clear move this week";
  const lines = [
    `*Hwy4 growth memo — ${header}*`,
    digest.north_star.headline || digest.summary,
    `→ ${SITE_URL}/admin/briefings?view=growth`,
  ];
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
  } catch (err) {
    console.error("[growth-memo] Slack post failed:", err);
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }
  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey);

  try {
    const context = await gatherGrowthContext(supabase);
    const { digest, status, failure, usage } = await generateMemo(context);

    const { error } = await supabase.from("agent_runs").insert({
      run_type: "growth_memo",
      status,
      model: MODEL,
      input_tokens: usage.input,
      output_tokens: usage.output,
      context_in: context,
      digest,
      error: failure,
    });
    if (error) throw error;

    if (digest) await postSlack(digest);

    return NextResponse.json({
      ok: true,
      status,
      move: digest?.move_of_the_week?.title ?? null,
      summary: digest?.summary ?? null,
    });
  } catch (err) {
    console.error("[growth-memo] failed:", err);
    try {
      await supabase.from("agent_runs").insert({
        run_type: "growth_memo",
        status: "error",
        model: MODEL,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      /* best effort */
    }
    return NextResponse.json({ error: "Growth memo generation failed" }, { status: 500 });
  }
}
