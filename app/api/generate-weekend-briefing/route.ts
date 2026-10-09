import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { generateEventSlug } from "@/lib/slugs";
import { SITE_URL } from "@/lib/constants";
import {
  repairEventLinks,
  logLinkRepairs,
  type LinkableEvent,
} from "@/lib/briefing-links";
import { withVoice } from "@/lib/voice";
import {
  selectBriefingPicks,
  pickTag,
  formatPicksSection,
  missingPicks,
  logMissingPicks,
  ROB_PICKS_RULE,
  type BriefingPick,
  type BriefingPickRow,
} from "@/lib/briefing-picks";
import { getPickRowsBetween } from "@/lib/briefing-picks-data";
import { FESTIVAL_GUIDES } from "@/lib/event-guides";
import { addDaysIso } from "@/lib/picks";
import {
  addDays,
  pacificToday,
  shouldArchiveWeekendBriefing,
  upcomingWeekendPreview,
  type WeekendPreview,
} from "@/lib/date-windows";
import { nowPacificMinutes } from "@/lib/event-time";

import { MEDIUM_EFFORT, PREMIUM_COPY_MODEL } from "@/lib/agent/models";
import { messageText } from "@/lib/agent/message-text";

export const maxDuration = 60;

// How far past Sunday to look for a mark-your-calendar pick, and how many.
const PICK_LOOKAHEAD_DAYS = 14;
const PICK_LOOKAHEAD_MAX = 1;

const WEEKEND_SYSTEM_PROMPT = `You write the weekend preview for Hwy4Events.com — a community events site for the Highway 4 corridor (Angels Camp to Bear Valley) in the California Sierra. Bylined "Millie" (a Sheepadoodle), but you write as a knowledgeable local, not a dog.

Voice: Warm, opinionated, dry humor. Like a friend who lives up here. Not a tourism board. One subtle dog reference max — most weekends skip it.

Rules:
- 2-3 short paragraphs. Total length: 60-100 words. Be tight.
- P1: Friday highlights. Skip if nothing notable.
- P2: Saturday — usually the big day.
- P3: Sunday or wrap-up.
- IMPORTANT — date anchoring: The FIRST time you mention each day, include the date: "Friday, March 27" or "Saturday the 28th". After that first mention, just use the day name. This helps readers orient to which weekend you're covering.
- Name-drop specific events and venues. Be honest if it's dead.
- No corporate language, no emojis in body text.
- FRESHNESS: Never reuse jokes, openers, closers, or structures from recent briefings below.
- End with: — Millie 🐾
- LINKS: Link event mentions as [event text](url). Keep natural — don't link every event or venue names.
- URLS ARE NOT YOURS TO WRITE: when you link an event, copy its "URL:" value from the event lists above character for character. Never construct, guess, or edit a URL, and never reuse a URL from RECENT BRIEFINGS — those may be stale.
- Events marked [MEMBERS ONLY] are for private clubs (like Blue Lake Springs). Mention them naturally but note they're for members/guests. Example: "Over at Blue Lake Springs, members can catch..."
- Do NOT link members-only events — they don't have public event pages.
${ROB_PICKS_RULE}`;

async function getWeekendEvents(weekend: WeekendPreview) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase
    .from("hwy4_events")
    .select(
      "name, date, start_time, end_time, venue_name, venue_key, town, category, artists, price, robs_pick, pick_reason, sold_out, status, description, event_url, visibility"
    )
    .gte("date", weekend.friday)
    .lte("date", weekend.sunday)
    .neq("status", "cancelled")
    .neq("is_routine", true)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;
  // Rows arrive already deduped at rest (write-time merge + nightly
  // /api/reconcile-dupes; the read-time assertion was retired 2026-08-23
  // after a clean soak — dedup Move 3 complete). The daily audit is the
  // standing duplicate detector.
  return data || [];
}

async function getCancelledWeekendEvents(weekend: WeekendPreview) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data } = await supabase
    .from("hwy4_events")
    .select("name, date, venue_name, town")
    .gte("date", weekend.friday)
    .lte("date", weekend.sunday)
    .eq("status", "cancelled")
    .order("date", { ascending: true });

  return data || [];
}

async function getRecentBriefings() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  const supabase = createClient(supabaseUrl, serviceKey);

  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const { data } = await supabase
    .from("site_config")
    .select("key, value")
    .in("key", ["weekend_briefing"])
    .limit(1);

  // Also check briefing_history for recent weekend-like entries
  const { data: history } = await supabase
    .from("briefing_history")
    .select("briefing_date, text")
    .gte("briefing_date", fourWeeksAgo)
    .order("briefing_date", { ascending: false })
    .limit(3);

  return history || [];
}

async function generateWeekendBriefing(
  weekend: WeekendPreview,
  events: Record<string, unknown>[],
  recentBriefings: { briefing_date: string; text: string }[],
  cancelledEvents: { name: string; date: string; venue_name: string; town: string }[] = [],
  picks: { inWindow: BriefingPick[]; lookahead: BriefingPick[] } = {
    inWindow: [],
    lookahead: [],
  }
) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  const { friday, sunday, label } = weekend;

  const formatEvent = (e: Record<string, unknown>) => {
    const slug = generateEventSlug(e.name as string, e.date as string, e.town as string);
    const internalUrl = `${SITE_URL}/events/${slug}`;
    const parts = [
      `${e.name} at ${e.venue_name} (${e.town})`,
      `on ${e.date}`,
      e.start_time ? `at ${e.start_time}` : "",
      e.category ? `[${e.category}]` : "",
      e.price ? `${e.price}` : "",
      pickTag(e as Parameters<typeof pickTag>[0], picks.inWindow),
      e.visibility === "private" ? "[MEMBERS ONLY]" : "",
      e.artists ? `Artists: ${(e.artists as string[]).join(", ")}` : "",
      e.visibility !== "private" ? `URL: ${internalUrl}` : "",
    ].filter(Boolean);
    return parts.join(" — ");
  };

  // Group by day
  const fridayEvents = events.filter((e) => e.date === friday);
  const saturdayStr = addDays(friday, 1);
  const saturdayEvents = events.filter((e) => e.date === saturdayStr);
  const sundayEvents = events.filter((e) => e.date === sunday);

  const fridaySummary =
    fridayEvents.length > 0
      ? fridayEvents.map(formatEvent).join("\n")
      : "No events Friday.";
  const saturdaySummary =
    saturdayEvents.length > 0
      ? saturdayEvents.map(formatEvent).join("\n")
      : "No events Saturday.";
  const sundaySummary =
    sundayEvents.length > 0
      ? sundayEvents.map(formatEvent).join("\n")
      : "No events Sunday.";

  let historySection = "";
  if (recentBriefings.length > 0) {
    const entries = recentBriefings
      .map((b) => {
        const d = new Date(b.briefing_date + "T00:00:00");
        const dateLabel = d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
        return `--- ${dateLabel} ---\n${b.text}`;
      })
      .join("\n\n");
    historySection = `\n\nRECENT BRIEFINGS (for freshness — do NOT repeat jokes, phrases, or structural patterns):\n\n${entries}`;
  }

  let cancelledSection = "";
  if (cancelledEvents.length > 0) {
    const cancelledList = cancelledEvents
      .map((e) => `- ${e.name} at ${e.venue_name} (${e.town}) on ${e.date}`)
      .join("\n");
    cancelledSection = `\n\nCANCELLED EVENTS (mention briefly so locals know — one sentence max):\n${cancelledList}`;
  }

  const message = await anthropic.messages.create({
    model: PREMIUM_COPY_MODEL,
    // 4096, not 1024: Opus 5.5 thinking shares this cap.
    max_tokens: 4096,
    output_config: MEDIUM_EFFORT,
    system: withVoice(WEEKEND_SYSTEM_PROMPT),
    messages: [
      {
        role: "user",
        content: `Write the weekend preview for Hwy4Events.com. This covers ${label}.\n\nFRIDAY EVENTS:\n${fridaySummary}\n\nSATURDAY EVENTS:\n${saturdaySummary}\n\nSUNDAY EVENTS:\n${sundaySummary}${formatPicksSection(picks.inWindow, picks.lookahead)}${cancelledSection}${historySection}`,
      },
    ],
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error(
      `Weekend briefing truncated: hit max_tokens (${message.usage.output_tokens} output tokens)`
    );
  }

  const text = messageText(message.content);
  if (!text) throw new Error("Unexpected response type");
  return text;
}

async function saveWeekendBriefing(
  weekend: WeekendPreview,
  text: string,
  eventCount: number
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Read the label first. History is written before the label changes, so a
  // failed archive leaves the old label in place and a retry still archives.
  // A refresh (same label) never reaches that insert.
  const { data: existingLabel, error: labelReadError } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "weekend_briefing_label")
    .maybeSingle();
  if (labelReadError) throw labelReadError;
  const archive = shouldArchiveWeekendBriefing(existingLabel?.value, weekend.label);

  // Save the briefing text
  const { error: textError } = await supabase.from("site_config").upsert(
    { key: "weekend_briefing", value: text },
    { onConflict: "key" }
  );
  if (textError) throw textError;

  // Save the generation timestamp. A refresh updates this, so the weekend
  // tab's "Updated" line matches the text just written.
  const { error: dateError } = await supabase.from("site_config").upsert(
    { key: "weekend_briefing_date", value: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (dateError) throw dateError;

  if (archive) {
    // One history row per weekend (the Friday preview). Keyed by generation
    // date, same as before, so the daily lookback's shape is unchanged.
    const { error: historyError } = await supabase
      .from("briefing_history")
      .upsert(
        {
          briefing_date: new Date().toISOString().split("T")[0],
          text: text,
          event_count: eventCount,
        },
        { onConflict: "briefing_date" }
      );
    if (historyError) throw historyError;
  }

  // Label last: once it matches, a retry will not insert a second history row.
  const { error: labelError } = await supabase.from("site_config").upsert(
    { key: "weekend_briefing_label", value: weekend.label },
    { onConflict: "key" }
  );
  if (labelError) throw labelError;
}

export async function GET(request: Request) {

  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  try {
    // One window for the whole request. Friday cron: the following Fri–Sun.
    // Thursday cron: that same weekend, now one day out, reread from the DB.
    const weekend = upcomingWeekendPreview();
    const [events, recentBriefings, cancelledEvents] = await Promise.all([
      getWeekendEvents(weekend),
      getRecentBriefings(),
      getCancelledWeekendEvents(weekend),
    ]);
    // Rob's Picks under the homepage's own rule (issue #356), plus one
    // mark-your-calendar pick from the two weeks after this weekend.
    const { friday, sunday } = weekend;
    const lookaheadRows = await getPickRowsBetween(
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      ),
      addDaysIso(sunday, 1),
      addDaysIso(sunday, PICK_LOOKAHEAD_DAYS)
    );
    const picks = selectBriefingPicks(
      [...(events as unknown as BriefingPickRow[]), ...lookaheadRows],
      {
        todayIso: pacificToday().iso,
        nowMinutes: nowPacificMinutes(),
        windowStart: friday,
        windowEnd: sunday,
        guides: FESTIVAL_GUIDES,
        lookaheadDays: PICK_LOOKAHEAD_DAYS,
        maxLookahead: PICK_LOOKAHEAD_MAX,
      }
    );
    const raw = await generateWeekendBriefing(
      weekend,
      events,
      recentBriefings,
      cancelledEvents,
      picks
    );
    // Same deterministic link enforcement as the daily briefing: the model is
    // handed exact URLs but sometimes reconstructs them from its prose.
    // The lookahead pick rows were in the prompt too, so a correctly copied
    // mark-your-calendar link must resolve against them, not get unlinked.
    const repair = repairEventLinks(raw, [
      ...(events as unknown as LinkableEvent[]),
      ...lookaheadRows,
    ]);
    logLinkRepairs("weekend-briefing", repair);
    const briefing = repair.text;
    logMissingPicks("weekend-briefing", missingPicks(briefing, picks.inWindow));
    await saveWeekendBriefing(weekend, briefing, events.length);

    revalidatePath("/");

    return NextResponse.json({
      ok: true,
      briefing,
      eventCount: events.length,
    });
  } catch (err) {
    console.error("Weekend briefing generation failed:", err);
    return NextResponse.json(
      { error: "Failed to generate weekend briefing" },
      { status: 500 }
    );
  }
}
