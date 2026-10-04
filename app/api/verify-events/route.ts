import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { SITE_URL } from "@/lib/constants";
import { REGION } from "@/lib/region";
import { REGION_OPS } from "@/lib/region-ops";
import { matchOrgForEvent } from "@/lib/event-link";
import {
  compareEventTime,
  describeTimeMismatch,
  parseStatedTime,
} from "@/lib/verify-times";
import { HAIKU_MODEL } from "@/lib/agent/models";
import { messageText } from "@/lib/agent/message-text";
import {
  CANONICAL_FETCH_FAILURE_REASON,
  canonicalFetchAlert,
  canonicalUnreachableLog,
  fetchCanonicalPage,
  type CanonicalFetchResult,
} from "@/lib/verify-fetch";

export const maxDuration = 120;

const VERIFICATION_PROMPT = `You are verifying whether a scraped event actually exists on the organizing org's official events page, and whether we are showing the right time for it.

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

SEPARATELY, report the times the page states for THIS event.
- Copy them VERBATIM from the page ("6:15 PM", "11:00 am - 5:00 pm", "6-8pm").
- Use null when the page does not state a time for this event. NEVER infer,
  estimate, or carry a time over from a different event. A missing time is
  normal and reporting null is always the correct answer when unsure — we
  would rather show no correction than a wrong one.
- These are independent of "match": report the page's times even when the date
  matches, and use null for both when you returned needs_verification because
  the event is absent.

Return ONLY a JSON object, no markdown fences:
{
  "match": "verified" | "needs_verification",
  "reason": "1-2 sentences. If date conflict, state BOTH dates explicitly. If absent, say so.",
  "page_start_time": "verbatim start time from the page, or null",
  "page_end_time": "verbatim end time from the page, or null"
}`;

interface OrgRow {
  slug: string;
  display_name?: string | null;
  canonical_url: string | null;
  match_patterns: string[] | null;
}

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  venue_name: string;
  town: string;
  source_name: string | null;
  org_slug: string | null;
  times_locked?: boolean | null;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function plusDaysISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
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
    .select("slug, display_name, canonical_url, match_patterns")
    .eq("canonical_check_enabled", true)
    .not("canonical_url", "is", null);
  if (orgsErr) return NextResponse.json({ error: orgsErr.message }, { status: 500 });

  const orgs = (orgsRaw ?? []) as OrgRow[];
  if (orgs.length === 0) {
    return NextResponse.json({ checked: 0, message: "No orgs have canonical_check_enabled=true" });
  }

  const today = todayISO();
  const horizon = plusDaysISO(14);

  // Two cohorts, because a one-shot check cannot catch time drift.
  //
  //  (a) never-checked events in the next 14 days — the original behavior.
  //  (b) already-`verified` events inside RECHECK_WINDOW_DAYS whose last check
  //      has gone stale. This is the cohort that would have caught the Arnold
  //      Rim Trail hike: it verified fine in April, then the organizer moved the
  //      start five days before the event and nothing ever looked again.
  //
  // `needs_verification` and `dismissed` rows are deliberately excluded — those
  // are awaiting a human, and re-checking them would just re-flag them.
  // Exception: the pre-HWY-52 fetch-failure reason. That stamp was an outage,
  // not a verdict, and it used to sit in the queue forever. Those rows are
  // pulled back in so a recovered page can clear them.
  const RECHECK_WINDOW_DAYS = 10;
  const RECHECK_STALE_DAYS = 3;
  const recheckHorizon = plusDaysISO(RECHECK_WINDOW_DAYS);
  const staleBefore = new Date(
    Date.now() - RECHECK_STALE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const SELECT_COLS =
    "id, name, description, date, start_time, end_time, venue_name, town, source_name, org_slug, times_locked";

  // Fetch WIDE, then match, then cap — not the other way round.
  //
  // Only a small minority of upcoming events belong to an org with
  // canonical_check_enabled, and org ownership is decided in JS by
  // matchOrgForEvent (match_patterns can't be expressed in PostgREST). Capping
  // the QUERY meant the rows we pulled were mostly events no enabled org owns,
  // so almost nothing got checked: on 2026-07-27 the run examined exactly ONE
  // event out of ~55 eligible. Pull the whole candidate window ordered
  // soonest-first, match in memory, and bound the LLM calls afterwards.
  const FETCH_LIMIT = 1000;
  const MAX_CHECKS_PER_RUN = 40;

  const [uncheckedRes, recheckRes, fetchFailureRes] = await Promise.all([
    supabase
      .from("hwy4_events")
      .select(SELECT_COLS)
      .eq("verification_status", "unchecked")
      .gte("date", today)
      .lte("date", horizon)
      .order("date", { ascending: true })
      .limit(FETCH_LIMIT),
    supabase
      .from("hwy4_events")
      .select(SELECT_COLS)
      .eq("verification_status", "verified")
      .gte("date", today)
      .lte("date", recheckHorizon)
      .or(`verification_checked_at.is.null,verification_checked_at.lt.${staleBefore}`)
      .order("date", { ascending: true })
      .limit(FETCH_LIMIT),
    supabase
      .from("hwy4_events")
      .select(SELECT_COLS)
      .eq("verification_status", "needs_verification")
      .eq("verification_reason", CANONICAL_FETCH_FAILURE_REASON)
      .gte("date", today)
      .lte("date", horizon)
      .order("date", { ascending: true })
      .limit(FETCH_LIMIT),
  ]);
  const evErr = uncheckedRes.error ?? recheckRes.error ?? fetchFailureRes.error;
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

  // Fetch-failure retries first (they are false flags sitting in the human
  // queue), then re-checks: an event whose time may have moved under a reader
  // is more urgent than one we've never looked at. Cohorts are date-ordered,
  // so the soonest events win the budget.
  const eventsRaw = [
    ...(fetchFailureRes.data ?? []),
    ...(recheckRes.data ?? []),
    ...(uncheckedRes.data ?? []),
  ];

  const events = (eventsRaw ?? []) as EventRow[];
  const eligible = events
    .map((ev) => ({ ev, org: matchOrgForEvent(ev, orgs) }))
    .filter((p): p is { ev: EventRow; org: OrgRow } => p.org !== null);

  // Bound the Haiku spend per run. Logged rather than silently truncated — a
  // hidden cap reads as "we checked everything" when we deliberately didn't.
  const pairs = eligible.slice(0, MAX_CHECKS_PER_RUN);
  if (eligible.length > pairs.length) {
    console.log(
      `[verify-events] ${eligible.length} eligible, checking the ${pairs.length} soonest this run`
    );
  }

  if (pairs.length === 0) {
    return NextResponse.json({ checked: 0, message: "No unchecked events matched any enabled org", events_scanned: events.length });
  }

  // Fetch each canonical URL once per run. A failure is remembered so every
  // event for that org is skipped, not stamped needs_verification.
  const cache = new Map<string, CanonicalFetchResult>();
  const failures: Array<{
    slug: string;
    displayName: string;
    url: string;
    failure: Extract<CanonicalFetchResult, { ok: false }>;
  }> = [];
  for (const o of orgs) {
    if (!o.canonical_url) continue;
    if (cache.has(o.slug)) continue;
    const result = await fetchCanonicalPage(o.canonical_url, {
      userAgent: `${REGION_OPS.userAgents.verifierName}/1.0 (+${REGION.defaultSiteUrl})`,
    });
    cache.set(o.slug, result);
    if (!result.ok) {
      const displayName = o.display_name?.trim() || o.slug;
      console.error(
        canonicalUnreachableLog({ slug: o.slug, url: o.canonical_url, failure: result })
      );
      failures.push({ slug: o.slug, displayName, url: o.canonical_url, failure: result });
    }
  }

  const results: Array<{
    id: string;
    status: string;
    reason: string;
    time_verdict?: string;
  }> = [];
  for (const { ev, org } of pairs) {
    const fetched = cache.get(org.slug);
    const checkedAt = new Date().toISOString();

    // Unreachable or date-less page: already logged and queued for the Slack
    // alert below. Leave the row as it is. Writing needs_verification here is
    // what stuck the Wine & Beer Garden events in the queue after one blip.
    if (!fetched?.ok) continue;
    const canonicalText = fetched.text;

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
        model: HAIKU_MODEL,
        max_tokens: 250,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = messageText(msg.content).trim();
      if (!raw) throw new Error("non-text response");

      let json = raw;
      if (json.startsWith("```")) {
        json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      const parsed = JSON.parse(json) as {
        match: "verified" | "needs_verification";
        reason: string;
        page_start_time?: string | null;
        page_end_time?: string | null;
      };
      let newStatus = parsed.match === "verified" ? "verified" : "needs_verification";
      let reason = parsed.reason ?? "";

      // Time drift. Only a STATED, differing time is evidence — `compareEventTime`
      // returns "unknown" when either side is absent or unparseable, and unknown
      // never flags (lib/verify-times.ts). A row whose times a human already
      // pinned is skipped outright: it's authoritative, so a page that disagrees
      // is the page being stale, not us.
      const pageStart = parseStatedTime(parsed.page_start_time);
      const pageEnd = parseStatedTime(parsed.page_end_time);
      const timeVerdict = ev.times_locked
        ? "unknown"
        : compareEventTime(ev.start_time, parsed.page_start_time);

      if (timeVerdict === "mismatch") {
        // Keep a date problem in the reason if there already was one; otherwise
        // the time IS the finding.
        reason =
          newStatus === "needs_verification"
            ? `${reason} ${describeTimeMismatch(ev.start_time, parsed.page_start_time)}`.trim()
            : describeTimeMismatch(ev.start_time, parsed.page_start_time);
        newStatus = "needs_verification";
      }

      await supabase
        .from("hwy4_events")
        .update({
          verification_status: newStatus,
          verification_reason: reason || null,
          verification_checked_at: checkedAt,
          verification_snapshot: canonicalText.slice(0, 4000),
          // Advisory only — a human applies it at /admin/verification. Stored
          // even on a match so the queue can show what the organizer states.
          verification_suggested_start: pageStart,
          verification_suggested_end: pageEnd,
        })
        .eq("id", ev.id);

      results.push({
        id: ev.id,
        status: newStatus,
        reason,
        time_verdict: timeVerdict,
      });
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
    const timeDrift = flagged.filter((r) => r.time_verdict === "mismatch").length;
    const headline =
      timeDrift > 0
        ? `🔎 Verification flagged ${flagged.length} event(s) against the organizer's page — ${timeDrift} with a WRONG TIME (not shown publicly):`
        : `🔎 Verification flagged ${flagged.length} event(s) against the organizer's page (not shown publicly):`;
    await postToSlack(
      `${headline}\n${lines.join("\n")}${more}\nReview: ${SITE_URL}/admin/verification`
    );
  }

  if (failures.length > 0) {
    await postToSlack(
      failures
        .map((f) =>
          canonicalFetchAlert({
            displayName: f.displayName,
            url: f.url,
            failure: f.failure,
          })
        )
        .join("\n")
    );
  }

  // A page that loaded again can retire the old outage stamps. Upcoming rows
  // already re-judged this run stay as the model left them; everything else
  // (including past events still sitting in /admin/verification) goes back to
  // unchecked so a one-day blip does not wait on a human.
  const recovered = new Set(
    [...cache.entries()].filter(([, result]) => result.ok).map(([slug]) => slug)
  );
  let releasedFetchFailures = 0;
  if (recovered.size > 0) {
    const { data: stuck, error: stuckErr } = await supabase
      .from("hwy4_events")
      .select("id, name, description, venue_name, org_slug")
      .eq("verification_status", "needs_verification")
      .eq("verification_reason", CANONICAL_FETCH_FAILURE_REASON);
    if (stuckErr) {
      console.error("[verify-events] could not read fetch-failure flags:", stuckErr.message);
    } else {
      const judged = new Set(results.map((r) => r.id));
      const releaseIds = (
        (stuck ?? []) as Array<{
          id: string;
          name: string;
          description: string | null;
          venue_name: string;
          org_slug: string | null;
        }>
      )
        .filter((row) => {
          if (judged.has(row.id)) return false;
          const owner = matchOrgForEvent(row, orgs);
          return owner ? recovered.has(owner.slug) : false;
        })
        .map((row) => row.id);
      if (releaseIds.length > 0) {
        const { error: releaseErr } = await supabase
          .from("hwy4_events")
          .update({
            verification_status: "unchecked",
            verification_reason: null,
          })
          .in("id", releaseIds);
        if (releaseErr) {
          console.error(
            "[verify-events] failed to release fetch-failure flags:",
            releaseErr.message
          );
        } else {
          releasedFetchFailures = releaseIds.length;
          console.log(
            `[verify-events] released ${releasedFetchFailures} fetch-failure flag(s) after the canonical page loaded`
          );
        }
      }
    }
  }

  return NextResponse.json({
    checked: results.length,
    verified: results.filter((r) => r.status === "verified").length,
    flagged: flagged.length,
    time_mismatches: results.filter((r) => r.time_verdict === "mismatch").length,
    rechecked: recheckRes.data?.length ?? 0,
    orgs_enabled: orgs.length,
    events_scanned: events.length,
    eligible: eligible.length,
    deferred_to_next_run: eligible.length - pairs.length,
    canonical_unreachable: failures.map((f) => ({
      slug: f.slug,
      url: f.url,
      kind: f.failure.kind,
      error: f.failure.error,
      attempts: f.failure.attempts,
      status: f.failure.status ?? null,
    })),
    released_fetch_failures: releasedFetchFailures,
    results,
  });
}
