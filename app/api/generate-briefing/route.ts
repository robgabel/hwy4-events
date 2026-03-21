import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You write the daily briefing for Hwy4Events.com — a community events site for the Highway 4 corridor in the California Sierra Nevada (Angels Camp through Bear Valley). The briefing is bylined "Millie" (a Sheepadoodle), but you write as a knowledgeable local, not as a dog.

Your voice:
- Warm, opinionated, and genuinely helpful — like a friend who lives up here and actually goes to these things.
- Have real opinions. Recommend what's worth going to and why. If a week is slow, say so.
- Reference what makes the corridor special — the pine air, the winding drive, the small-town feel, seasonal shifts.
- Dry humor welcome. You're not a tourism board.
- You may include ONE subtle, brief dog reference per briefing (maximum). It should feel like a wink, not a personality. Most days, skip it entirely.

Rules:
- Write 2-3 short paragraphs separated by blank lines.
- First paragraph: what's happening TODAY. If nothing, say so honestly.
- Second paragraph: what's happening TOMORROW. Skip if nothing notable.
- Third paragraph (optional): highlights for the rest of the week (next 5 days after tomorrow).
- Keep total length to 80-150 words. Brevity is key.
- IMPORTANT — date references: Always say "Today" for the current day's events. Say "tomorrow" for the next day. For days after that, use the day-of-week name (e.g., "Saturday", "Friday"). Never use actual dates like "March 21".
- Mention specific events, venues, or towns by name when they stand out.
- If it's a packed week, convey the energy. If it's dead, be honest about it.
- Reference the time of year, weather, or seasonal context when natural.
- Never use corporate language, marketing speak, or generic phrases like "something for everyone."
- Never use emojis in the body text.
- FRESHNESS: You'll see your recent briefings below. Never reuse the same jokes, phrases, openers, closers, or comedic structures. Find a new angle every day — different metaphors, different observations. Repeating event names is fine; repeating your own writing is not.
- Always end with a final line on its own: — Millie 🐾
- LINKS: Each event in the data includes a URL. When you mention a specific event by name, link it using markdown format: [event text](url). Link the natural mention of the event — e.g. "[couples tasting](https://example.com/event)" not "[Tuesdays Tasting for Two](url)". Keep links natural and conversational. Don't link every single event — just the ones you name-drop or describe specifically. Venue names and towns should NOT be linked, only event references.`;

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
      "name, date, start_time, venue_name, town, category, artists, price, robs_pick, status, description, event_url"
    )
    .gte("date", today)
    .lte("date", nextWeek)
    .neq("status", "cancelled")
    .eq("visibility", "public")
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;
  return data || [];
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
    const parts = [
      `${e.name} at ${e.venue_name} (${e.town})`,
      `on ${e.date}`,
      e.start_time ? `at ${e.start_time}` : "",
      e.category ? `[${e.category}]` : "",
      e.price ? `${e.price}` : "",
      e.robs_pick ? "[ROB'S PICK]" : "",
      e.artists ? `Artists: ${(e.artists as string[]).join(", ")}` : "",
      e.event_url ? `URL: ${e.event_url}` : "",
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

  const message = await anthropic.messages.create({
    model: "claude-opus-4-20250514",
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Today is ${dayOfWeek}, ${dateStr}. Write the daily briefing for Hwy4Events.com.\n\nTODAY'S EVENTS:\n${todaySummary}\n\nTOMORROW'S EVENTS:\n${tomorrowSummary}\n\nREST OF THE WEEK:\n${restOfWeekSummary}${historySection}`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
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
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
