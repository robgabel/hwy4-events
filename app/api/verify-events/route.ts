import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { matchOrgForEvent } from "@/lib/event-link";

export const maxDuration = 120;

const VERIFICATION_PROMPT = `You are verifying whether a scraped event actually exists on the organizing org's official events page.

Event we're checking:
- Name: {NAME}
- Date: {DATE}
- Start time: {START_TIME}
- Venue: {VENUE}
- Town: {TOWN}
- Description: {DESC}

Source aggregator (where we scraped from, may be different from organizer): {SOURCE_NAME}

Canonical organizer events page (text below, may include unrelated content):
"""
{CANONICAL_TEXT}
"""

Decide one of:
- "verified" — the same event appears on the canonical page on the same date (allow for minor name differences).
- "needs_verification" — the event is NOT on the canonical page on that date. Either it's missing entirely, OR it appears on a different date.

Be conservative: if you can't clearly find a matching entry on the canonical page, return needs_verification. If the canonical page seems to be a generic landing page with no event list, also return needs_verification with reason "Canonical page has no parseable event list".

Return ONLY a JSON object, no markdown fences:
{
  "match": "verified" | "needs_verification",
  "reason": "1-2 sentences. If date conflict, state BOTH dates explicitly. If absent, say so."
}`;

interface OrgRow {
  slug: string;
  canonical_url: string | null;
  match_patterns: string[] | null;
}

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  date: string;
  start_time: string | null;
  venue_name: string;
  town: string;
  source_name: string | null;
  org_slug: string | null;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function plusDaysISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

async function fetchCanonicalText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Hwy4Events-Verifier/1.0 (+https://hwy4events.com)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[verify-events] ${url} returned ${res.status}`);
      return null;
    }
    const html = await res.text();
    const text = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
    // Cap to keep Haiku prompts cheap; organizer events pages are normally well under this.
    return text.length > 12_000 ? text.slice(0, 12_000) + "…" : text;
  } catch (err) {
    console.error(`[verify-events] fetch failed for ${url}:`, err);
    return null;
  }
}

// The public site shows NO "Date unconfirmed" badge (removed 2026-07-05 — it
// undermined reader trust). This alert + the /admin/verification queue are the
// only surfaces for a flag, so the Slack ping is what puts a fresh flag in
// front of a human the same day.
async function postToSlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[verify-events] Slack post failed:", err);
  }
}

// Org matching lives in lib/event-link.ts (matchOrgForEvent) — the single
// definition shared with the link resolver, so date-verification and link
// resolution always agree on which org owns an event.

export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    return NextResponse.json({ error: "Missing env" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const { data: orgsRaw, error: orgsErr } = await supabase
    .from("hwy4_orgs")
    .select("slug, canonical_url, match_patterns")
    .eq("canonical_check_enabled", true)
    .not("canonical_url", "is", null);
  if (orgsErr) return NextResponse.json({ error: orgsErr.message }, { status: 500 });

  const orgs = (orgsRaw ?? []) as OrgRow[];
  if (orgs.length === 0) {
    return NextResponse.json({ checked: 0, message: "No orgs have canonical_check_enabled=true" });
  }

  const today = todayISO();
  const horizon = plusDaysISO(14);
  const { data: eventsRaw, error: evErr } = await supabase
    .from("hwy4_events")
    .select("id, name, description, date, start_time, venue_name, town, source_name, org_slug")
    .eq("verification_status", "unchecked")
    .gte("date", today)
    .lte("date", horizon)
    .limit(50);
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

  const events = (eventsRaw ?? []) as EventRow[];
  const pairs = events
    .map((ev) => ({ ev, org: matchOrgForEvent(ev, orgs) }))
    .filter((p): p is { ev: EventRow; org: OrgRow } => p.org !== null);

  if (pairs.length === 0) {
    return NextResponse.json({ checked: 0, message: "No unchecked events matched any enabled org", events_scanned: events.length });
  }

  // Fetch each canonical URL once per run.
  const cache = new Map<string, string | null>();
  for (const o of orgs) {
    if (!o.canonical_url) continue;
    if (!cache.has(o.slug)) cache.set(o.slug, await fetchCanonicalText(o.canonical_url));
  }

  const results: Array<{ id: string; status: string; reason: string }> = [];
  for (const { ev, org } of pairs) {
    const canonicalText = cache.get(org.slug) ?? null;
    const checkedAt = new Date().toISOString();

    if (!canonicalText) {
      const reason = "Could not fetch canonical events page; flag for manual review.";
      await supabase
        .from("hwy4_events")
        .update({
          verification_status: "needs_verification",
          verification_reason: reason,
          verification_checked_at: checkedAt,
          verification_snapshot: null,
        })
        .eq("id", ev.id);
      results.push({ id: ev.id, status: "needs_verification", reason });
      continue;
    }

    const prompt = VERIFICATION_PROMPT
      .replace("{NAME}", ev.name)
      .replace("{DATE}", ev.date)
      .replace("{START_TIME}", ev.start_time ?? "(unknown)")
      .replace("{VENUE}", ev.venue_name)
      .replace("{TOWN}", ev.town)
      .replace("{DESC}", ev.description ?? "(none)")
      .replace("{SOURCE_NAME}", ev.source_name ?? "(unknown)")
      .replace("{CANONICAL_TEXT}", canonicalText);

    try {
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 250,
        messages: [{ role: "user", content: prompt }],
      });
      const block = msg.content[0];
      if (block.type !== "text") throw new Error("non-text response");

      let json = block.text.trim();
      if (json.startsWith("```")) {
        json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      const parsed = JSON.parse(json) as { match: "verified" | "needs_verification"; reason: string };
      const newStatus = parsed.match === "verified" ? "verified" : "needs_verification";

      await supabase
        .from("hwy4_events")
        .update({
          verification_status: newStatus,
          verification_reason: parsed.reason ?? null,
          verification_checked_at: checkedAt,
          verification_snapshot: canonicalText.slice(0, 4000),
        })
        .eq("id", ev.id);

      results.push({ id: ev.id, status: newStatus, reason: parsed.reason ?? "" });
    } catch (err) {
      console.error(`[verify-events] LLM/parse error for event ${ev.id}:`, err);
      // Leave row as unchecked so the next run retries.
    }
  }

  const flagged = results.filter((r) => r.status === "needs_verification");
  if (flagged.length > 0) {
    const byId = new Map(pairs.map((p) => [p.ev.id, p.ev]));
    const lines = flagged.slice(0, 10).map((r) => {
      const ev = byId.get(r.id);
      return ev
        ? `• *${ev.name}* — ${ev.date}, ${ev.town}: ${r.reason}`
        : `• ${r.id}: ${r.reason}`;
    });
    const more = flagged.length > 10 ? `\n…and ${flagged.length - 10} more.` : "";
    await postToSlack(
      `🔎 Date verification flagged ${flagged.length} event(s) against the organizer's page (not shown publicly):\n${lines.join("\n")}${more}\nReview: https://hwy4events.com/admin/verification`
    );
  }

  return NextResponse.json({
    checked: results.length,
    verified: results.filter((r) => r.status === "verified").length,
    flagged: flagged.length,
    orgs_enabled: orgs.length,
    events_scanned: events.length,
    results,
  });
}
