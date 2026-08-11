import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { generateEventSlug } from "@/lib/slugs";
import { SITE_URL } from "@/lib/constants";
import { assertNoResidentDuplicates } from "@/lib/dedupe-events";
import { withVoice } from "@/lib/voice";
import {
  dayOfYear,
  selectBriefingShape,
  recentOpeners,
  buildBriefingShapeGuidance,
  openerKey,
} from "@/lib/briefing-shapes";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You write the daily briefing for Hwy4Events.com — a community events site for the Highway 4 corridor (Angels Camp to Bear Valley) in the California Sierra. Bylined "Millie" (a Sheepadoodle), but you write as a knowledgeable local, not a dog.

Voice: Warm, opinionated, dry humor. Like a friend who lives up here. Not a tourism board. One subtle dog reference max per briefing — most days skip it.

Rules:
- 2-3 short paragraphs. Total length: 60-100 words. Be tight.
- P1: TODAY's highlights. If nothing, say so.
- P2: TOMORROW. Skip if nothing notable.
- P3 (optional): brief midweek highlights only. Do NOT mention next weekend — there's a separate weekend briefing for that.
- Say "Today" and "tomorrow" — for later days use day names, never dates like "March 21".
- Name-drop specific events and venues. Be honest if it's dead.
- No corporate language, no emojis in body text.
- FRESHNESS: Never reuse jokes, openers, closers, or structures from recent briefings below.
- End with: — Millie 🐾
- LINKS: Link event mentions as [event text](url). Keep natural — don't link every event or venue names.
- Events marked [MEMBERS ONLY] are for private clubs (like Blue Lake Springs). Mention them naturally but note they're for members/guests. Example: "Over at Blue Lake Springs, members can catch..."
- Do NOT link members-only events — they don't have public event pages.
- ROB'S PICKS: an event tagged [ROB'S PICK: reason] should lead with that reason, in your own words. A plain [ROB'S PICK] with no reason gets a plain mention, no invented enthusiasm.`;

async function getEventsForBriefing() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const today = new Date().toISOString().split("T")[0];
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const { data, error } = await supabase
    .from("hwy4_events")
    .select(
      "name, date, start_time, venue_name, town, category, artists, price, robs_pick, pick_reason, status, description, event_url, visibility"
    )
    .gte("date", today)
    .lte("date", nextWeek)
    .neq("status", "cancelled")
    .neq("is_routine", true)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;
  // HWY-16 (2026-08-11): loud assertion, not a collapse — the write-time merge
  // + nightly /api/reconcile-dupes own dedup at rest. See CLAUDE.md
  // "Deduplication (defense in depth)".
  return assertNoResidentDuplicates(data || []);
}

async function getRecentBriefings() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  const supabase = createClient(supabaseUrl, serviceKey);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  const { data } = await supabase
    .from("briefing_history")
    .select("briefing_date, text")
    .gte("briefing_date", sevenDaysAgo)
    .lt("briefing_date", today)
    .order("briefing_date", { ascending: false });

  return data || [];
}

async function generateBriefing(
  events: Record<string, unknown>[],
  recentBriefings: { briefing_date: string; text: string }[]
) {
  const anthropic = new Anthropic();

  const today = new Date();
  const dayOfWeek = today.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = today.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const formatEvent = (e: Record<string, unknown>) => {
    const slug = generateEventSlug(e.name as string, e.date as string, e.town as string);
    const internalUrl = `${SITE_URL}/events/${slug}`;
    const parts = [
      `${e.name} at ${e.venue_name} (${e.town})`,
      `on ${e.date}`,
      e.start_time ? `at ${e.start_time}` : "",
      e.category ? `[${e.category}]` : "",
      e.price ? `${e.price}` : "",
      e.robs_pick
        ? e.pick_reason
          ? `[ROB'S PICK: ${e.pick_reason}]`
          : "[ROB'S PICK]"
        : "",
      e.visibility === "private" ? "[MEMBERS ONLY]" : "",
      e.artists ? `Artists: ${(e.artists as string[]).join(", ")}` : "",
      e.visibility !== "private" ? `URL: ${internalUrl}` : "",
    ].filter(Boolean);
    return parts.join(" — ");
  };

  const todayStr = today.toISOString().split("T")[0];
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  const todayEvents = events.filter((e) => e.date === todayStr);
  const tomorrowEvents = events.filter((e) => e.date === tomorrowStr);
  const restOfWeekEvents = events.filter(
    (e) => e.date !== todayStr && e.date !== tomorrowStr
  );

  const todaySummary =
    todayEvents.length > 0
      ? todayEvents.map(formatEvent).join("\n")
      : "No events today.";
  const tomorrowSummary =
    tomorrowEvents.length > 0
      ? tomorrowEvents.map(formatEvent).join("\n")
      : "No events tomorrow.";
  const restOfWeekSummary =
    restOfWeekEvents.length > 0
      ? restOfWeekEvents.map(formatEvent).join("\n")
      : "No events listed for the rest of the week.";

  let historySection = "";
  if (recentBriefings.length > 0) {
    const entries = recentBriefings
      .map((b) => {
        const d = new Date(b.briefing_date + "T00:00:00");
        const label = d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
        return `--- ${label} ---\n${b.text}`;
      })
      .join("\n\n");
    historySection = `\n\nRECENT BRIEFINGS (for freshness — do NOT repeat jokes, phrases, structural patterns, or comedic bits from these. Events may repeat since they span multiple days, but your creative angle must be different each day):\n\n${entries}`;
  }

  // WS-6: rotate the briefing's structural shape by day-of-year and tell the
  // model which recent openers to avoid, so a daily reader can't pattern-match it.
  const shape = selectBriefingShape(dayOfYear(today));
  const openers = recentOpeners(recentBriefings.map((b) => b.text));
  const shapeGuidance = buildBriefingShapeGuidance(shape, openers);

  const message = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    system: withVoice(SYSTEM_PROMPT),
    messages: [
      {
        role: "user",
        content: `Today is ${dayOfWeek}, ${dateStr}. Write the daily briefing for Hwy4Events.com.\n\nTODAY'S EVENTS:\n${todaySummary}\n\nTOMORROW'S EVENTS:\n${tomorrowSummary}\n\nREST OF THE WEEK:\n${restOfWeekSummary}${historySection}${shapeGuidance}`,
      },
    ],
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error(
      `Daily briefing truncated: hit max_tokens (${message.usage.output_tokens} output tokens)`
    );
  }

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");

  // WS-6 opener guard: flag (don't block) a first-3-words repeat vs recent days.
  const newOpener = openerKey(block.text);
  if (newOpener && openers.some((o) => openerKey(o) === newOpener)) {
    console.warn(
      `[briefing] opener "${newOpener}" repeats a recent briefing (shape=${shape.id})`,
    );
  }
  return block.text;
}

async function saveBriefing(text: string, eventCount: number) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Upsert the briefing text
  const { error: textError } = await supabase.from("site_config").upsert(
    {
      key: "weekly_briefing",
      value: text,
    },
    { onConflict: "key" }
  );
  if (textError) throw textError;

  // Upsert the generation timestamp
  const { error: dateError } = await supabase.from("site_config").upsert(
    {
      key: "weekly_briefing_date",
      value: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
  if (dateError) throw dateError;

  // Archive to briefing_history for freshness lookback
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

export async function GET(request: Request) {
  // Verify this is a cron call or has the right secret

  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  try {
    const [events, recentBriefings] = await Promise.all([
      getEventsForBriefing(),
      getRecentBriefings(),
    ]);
    const briefing = await generateBriefing(events, recentBriefings);
    await saveBriefing(briefing, events.length);

    // Invalidate the home page cache so the new briefing appears immediately
    revalidatePath("/");

    return NextResponse.json({
      ok: true,
      briefing,
      eventCount: events.length,
    });
  } catch (err) {
    console.error("Briefing generation failed:", err);
    return NextResponse.json(
      { error: "Failed to generate briefing" },
      { status: 500 }
    );
  }
}
