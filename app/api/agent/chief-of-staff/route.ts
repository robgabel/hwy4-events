import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/constants";
import {
  coerceDigest,
  emptyDigest,
  type Digest,
  type DigestContext,
  type Vitals,
} from "@/lib/agent/types";

// Agent Cockpit Stage 0 reasoner. Reads the day's signals (verification queue,
// pending submissions, recent auto-merges, latest SEO capture), asks Sonnet to
// triage them into a short digest, and writes one agent_runs row. It executes
// NOTHING — read-only by design. See PRD-agent-cockpit.md.

export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are the chief of staff for Hwy4Events.com, a one-person community events site for the Highway 4 corridor (Angels Camp to Bear Valley, California). Each morning you write a short digest for Rob, the owner, summarizing the state of the site's automation and flagging what needs a human.

You are given structured signals: real counts and samples. Summarize ONLY what you are given. Never invent numbers, events, issues, or trends. If a section has nothing, return an empty array for it.

Community submissions: each pending submission may carry an agent triage verdict (in pending_submissions_sample): publish_new (a real new event to add), duplicate (already on the site), duplicate_needs_update (on the site but the submission adds info), or reject (spam / out of corridor / unverifiable), plus a one-line headline. Use these to tell Rob what is actually waiting: lead with the count that needs a real decision (publish_new and duplicate_needs_update), and note if any look like spam or duplicates he can clear fast. A submission with verdict still null has not been analyzed yet; say it is pending analysis, do not guess.

Triage into three buckets:
- needs_you: things that genuinely need Rob's decision today (events waiting in the verification queue, new community submissions to review, anything anomalous in the numbers). Each gets a one-line "why" stating what is at stake.
- fyi: ran-fine confirmations and minor notes that need no action.
- watching: search/SEO movement worth tracking, not acting on.

Do not manufacture urgency. A quiet day is a fine outcome: say so in the summary and keep needs_you short or empty.

Voice: plain, direct, a little dry. Like a sharp operator briefing a peer, not a chatbot. Short sentences. No corporate filler, no hype, no emojis, and NO EM DASHES (use commas, periods, or parentheses). If a line would sound like a marketing intern wrote it, cut it.

Output STRICT JSON only. No markdown fences, no preamble. Match this shape exactly:
{"summary": string, "needs_you": [{"title": string, "detail": string, "why": string, "link"?: string}], "fyi": [{"title": string, "detail": string}], "watching": [{"title": string, "detail": string}]}

Links: two admin pages exist. "/admin/verification" lists ONLY events flagged for date verification, so attach "link":"/admin/verification" only to a date-verification item. "/admin/submissions" is where community submissions are reviewed, so attach "link":"/admin/submissions" only to a community-submission item. SEO, merges, and everything else have NO admin page, so omit "link" for them entirely. A wrong link sends Rob to an empty page.`;

async function gatherContext(supabase: SupabaseClient): Promise<DigestContext> {
  const today = new Date().toISOString().split("T")[0];
  const in14 = new Date(Date.now() + 14 * 86_400_000).toISOString().split("T")[0];
  const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString();

  const [upcoming, needsVerif, pendingSubs, merges, seoLatest] = await Promise.all([
    supabase
      .from("hwy4_events")
      .select("id", { count: "exact", head: true })
      .gte("date", today)
      .lte("date", in14)
      .neq("status", "cancelled")
      .eq("visibility", "public"),
    supabase
      .from("hwy4_events")
      .select("name, date, venue_name, town, verification_reason", { count: "exact" })
      .eq("verification_status", "needs_verification")
      .order("date", { ascending: true })
      .limit(15),
    supabase
      .from("event_submissions")
      .select(
        "event_name, event_date, town, submitter_name, created_at, ai_verdict, ai_confidence, ai_headline",
        { count: "exact" }
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("event_merge_log")
      .select("id", { count: "exact", head: true })
      .gte("merged_at", since24h),
    supabase
      .from("seo_snapshots")
      .select("captured_at")
      .order("captured_at", { ascending: false })
      .limit(1),
  ]);

  let seoCaptured: string | null = null;
  let seoTop: DigestContext["seo"]["top"] = [];
  const latestCap = (seoLatest.data?.[0] as { captured_at?: string } | undefined)?.captured_at;
  if (latestCap) {
    seoCaptured = latestCap;
    const { data: seoRows } = await supabase
      .from("seo_snapshots")
      .select("query, clicks, impressions, position")
      .eq("captured_at", latestCap)
      .order("impressions", { ascending: false })
      .limit(10);
    seoTop = ((seoRows ?? []) as Record<string, unknown>[]).map((r) => ({
      query: String(r.query ?? ""),
      clicks: Number(r.clicks ?? 0),
      impressions: Number(r.impressions ?? 0),
      position: Number(r.position ?? 0),
    }));
  }

  const vitals: Vitals = {
    upcoming_events_14d: upcoming.count ?? 0,
    needs_verification: needsVerif.count ?? 0,
    pending_submissions: pendingSubs.count ?? 0,
    merges_24h: merges.count ?? 0,
    seo_rows: seoTop.length,
  };

  return {
    date: today,
    vitals,
    needs_verification_sample: ((needsVerif.data ?? []) as Record<string, unknown>[]).map((e) => ({
      name: String(e.name ?? ""),
      date: String(e.date ?? ""),
      venue: String(e.venue_name ?? ""),
      town: String(e.town ?? ""),
      reason: (e.verification_reason as string | null) ?? null,
    })),
    pending_submissions_sample: ((pendingSubs.data ?? []) as Record<string, unknown>[]).map((s) => ({
      name: String(s.event_name ?? ""),
      date: String(s.event_date ?? ""),
      town: String(s.town ?? ""),
      submitter: (s.submitter_name as string | null) ?? null,
      submitted: String(s.created_at ?? ""),
      verdict: (s.ai_verdict as string | null) ?? null,
      confidence: (s.ai_confidence as string | null) ?? null,
      headline: (s.ai_headline as string | null) ?? null,
    })),
    seo: { captured_at: seoCaptured, top: seoTop },
  };
}

function safeJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
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

async function generateDigest(
  context: DigestContext
): Promise<{ digest: Digest; status: string; usage: { input: number; output: number } }> {
  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Today is ${context.date}. Here are this morning's signals as JSON. Write the digest.\n\n${JSON.stringify(
          context,
          null,
          2
        )}`,
      },
    ],
  });

  const usage = {
    input: message.usage.input_tokens,
    output: message.usage.output_tokens,
  };
  const block = message.content[0];
  const text = block && block.type === "text" ? block.text : "";
  const parsed = coerceDigest(safeJson(text));
  if (parsed) return { digest: parsed, status: "ok", usage };

  // Fallback: keep the raw text as the summary so the cockpit still renders.
  return {
    digest: emptyDigest(text || "The chief of staff could not produce a digest this run."),
    status: "degraded",
    usage,
  };
}

async function postSlack(digest: Digest): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const n = digest.needs_you.length;
  const header = n > 0 ? `${n} thing(s) need you` : "all quiet";
  const lines = [`*Hwy4 chief of staff — ${header}*`, digest.summary, `→ ${SITE_URL}/admin/today`];
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
  } catch (err) {
    console.error("[chief-of-staff] Slack post failed:", err);
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
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const context = await gatherContext(supabase);
    const { digest, status, usage } = await generateDigest(context);

    // Guard: never link an item to /admin/verification when that queue is empty.
    // The reasoner can attach the only known admin link to non-verification items
    // (e.g. community submissions), which then dead-ends on an empty page.
    if (context.vitals.needs_verification === 0) {
      for (const bucket of [digest.needs_you, digest.fyi, digest.watching]) {
        for (const item of bucket) {
          if (item.link === "/admin/verification") delete item.link;
        }
      }
    }

    const { error } = await supabase.from("agent_runs").insert({
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
    console.error("[chief-of-staff] failed:", err);
    // Record the failure so /admin/today shows something honest instead of stale.
    try {
      await supabase.from("agent_runs").insert({
        status: "error",
        model: MODEL,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      /* best effort */
    }
    return NextResponse.json({ error: "Digest generation failed" }, { status: 500 });
  }
}
