import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const WEEKEND_SYSTEM_PROMPT = `You write the weekend preview for Hwy4Events.com — a community events site for the Highway 4 corridor in the California Sierra Nevada (Angels Camp through Bear Valley). The briefing is bylined "Millie" (a Sheepadoodle), but you write as a knowledgeable local, not as a dog.

Your voice:
- Warm, opinionated, and genuinely helpful — like a friend who lives up here and actually goes to these things.
- Have real opinions. Recommend what's worth going to and why. If the weekend is quiet, say so.
- Reference what makes the corridor special — the pine air, the winding drive, the small-town feel, seasonal shifts.
- Dry humor welcome. You're not a tourism board.
- You may include ONE subtle, brief dog reference per briefing (maximum). It should feel like a wink, not a personality. Most weekends, skip it entirely.

Rules:
- Write 2-3 short paragraphs separated by blank lines.
- First paragraph: Friday highlights. Skip if nothing notable on Friday.
- Second paragraph: Saturday highlights — this is usually the big day.
- Third paragraph: Sunday events or a wrap-up.
- Keep total length to 80-150 words. Brevity is key.
- IMPORTANT — date references: Use day names ("Friday", "Saturday", "Sunday") — never actual dates like "March 21".
- Mention specific events, venues, or towns by name when they stand out.
- If it's a packed weekend, convey the energy. If it's dead, be honest about it.
- Reference the time of year, weather, or seasonal context when natural.
- Never use corporate language, marketing speak, or generic phrases like "something for everyone."
- Never use emojis in the body text.
- FRESHNESS: You'll see your recent briefings below. Never reuse the same jokes, phrases, openers, closers, or comedic structures. Find a new angle every weekend.
- Always end with a final line on its own: — Millie 🐾
- LINKS: Each event in the data includes a URL. When you mention a specific event by name, link it using markdown format: [event text](url). Keep links natural and conversational. Don't link every single event — just the ones you name-drop. Venue names and towns should NOT be linked, only event references.`;

function getUpcomingWeekend(): { friday: string; sunday: string; label: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 5=Fri, 6=Sat

  // Find next Friday (or today if it's Friday)
  let daysUntilFriday = (5 - day + 7) % 7;
  if (daysUntilFriday === 0 && day === 5) daysUntilFriday = 0; // Today is Friday
  if (day === 6) daysUntilFriday = 6; // Saturday → next Friday
  if (day === 0) daysUntilFriday = 5; // Sunday → next Friday

  const friday = new Date(now);
  friday.setDate(now.getDate() + daysUntilFriday);
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() + 2);

  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const labelFmt = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return {
    friday: fmt(friday),
    sunday: fmt(sunday),
    label: `${labelFmt(friday)} – ${labelFmt(sunday)}`,
  };
}

async function getWeekendEvents() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { friday, sunday } = getUpcomingWeekend();

  const { data, error } = await supabase
    .from("hwy4_events")
    .select(
      "name, date, start_time, venue_name, town, category, artists, price, robs_pick, status, description, event_url"
    )
    .gte("date", friday)
    .lte("date", sunday)
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
  events: Record<string, unknown>[],
  recentBriefings: { briefing_date: string; text: string }[]
) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  const { friday, sunday, label } = getUpcomingWeekend();

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

  // Group by day
  const fridayEvents = events.filter((e) => e.date === friday);
  const saturdayDate = new Date(friday);
  saturdayDate.setDate(saturdayDate.getDate() + 1);
  const saturdayStr = saturdayDate.toISOString().split("T")[0];
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

  const message = await anthropic.messages.create({
    model: "claude-opus-4-20250514",
    max_tokens: 400,
    system: WEEKEND_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Write the weekend preview for Hwy4Events.com. This covers ${label}.\n\nFRIDAY EVENTS:\n${fridaySummary}\n\nSATURDAY EVENTS:\n${saturdaySummary}\n\nSUNDAY EVENTS:\n${sundaySummary}${historySection}`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  return block.text;
}

async function saveWeekendBriefing(text: string, eventCount: number) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { label } = getUpcomingWeekend();

  // Save the briefing text
  const { error: textError } = await supabase.from("site_config").upsert(
    { key: "weekend_briefing", value: text },
    { onConflict: "key" }
  );
  if (textError) throw textError;

  // Save the generation timestamp
  const { error: dateError } = await supabase.from("site_config").upsert(
    { key: "weekend_briefing_date", value: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (dateError) throw dateError;

  // Save the weekend date range label
  const { error: labelError } = await supabase.from("site_config").upsert(
    { key: "weekend_briefing_label", value: label },
    { onConflict: "key" }
  );
  if (labelError) throw labelError;

  // Archive to briefing_history
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
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [events, recentBriefings] = await Promise.all([
      getWeekendEvents(),
      getRecentBriefings(),
    ]);
    const briefing = await generateWeekendBriefing(events, recentBriefings);
    await saveWeekendBriefing(briefing, events.length);

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
