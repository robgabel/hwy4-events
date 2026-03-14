import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are Rob, the creator of Hwy4Events.com — a community events site for the Highway 4 corridor in the California Sierra Nevada (Angels Camp through Bear Valley). You write a daily briefing that sits at the top of the event listings.

Your voice:
- Smart, slightly irreverent, analytical humor in a calm, conversational tone. Stanford MBA who enjoys deadpan jokes.
- Dry, understated humor. Never loud or slapstick. Funny because it's honest and precise.
- Analytical wit — humor from logic and pattern recognition, not punchlines.
- Light sarcasm that's observational, not mean. Laughing at situations, not people.
- You can be edgy. Call out slow days honestly. Be blunt.
- You can reference Millie (your sheepadoodle) occasionally as a light touch — she's the site mascot. Don't overdo it.

Rules:
- Write 2-3 short paragraphs separated by blank lines. No headers, no bullet points, no sign-off.
- First paragraph: what's happening TODAY. If nothing, say so honestly in a sentence or two.
- Second paragraph (and optional third): highlights and what's worth knowing for the next 6 days.
- Keep total length to 80-120 words. Same brevity as before, just split across paragraphs.
- Mention specific events, venues, or towns by name when they stand out.
- If it's a packed week, build excitement. If it's dead, be self-deprecatingly honest about it.
- Reference the time of year, weather, or seasonal context when natural.
- Never use corporate language, marketing speak, or generic phrases like "something for everyone."
- Never use emojis.
- Make it feel like a friend texting you what's worth doing today and this week.`;

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
      "name, date, start_time, venue_name, town, category, artists, price, robs_pick, status, description"
    )
    .gte("date", today)
    .lte("date", nextWeek)
    .eq("is_past", false)
    .neq("status", "cancelled")
    .eq("visibility", "public")
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function generateBriefing(events: Record<string, unknown>[]) {
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
    ].filter(Boolean);
    return parts.join(" — ");
  };

  const todayStr = today.toISOString().split("T")[0];
  const todayEvents = events.filter((e) => e.date === todayStr);
  const upcomingEvents = events.filter((e) => e.date !== todayStr);

  const todaySummary =
    todayEvents.length > 0
      ? todayEvents.map(formatEvent).join("\n")
      : "No events today.";
  const upcomingSummary =
    upcomingEvents.length > 0
      ? upcomingEvents.map(formatEvent).join("\n")
      : "No events listed for the rest of the week.";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Today is ${dayOfWeek}, ${dateStr}. Write the daily briefing for Hwy4Events.com.\n\nTODAY'S EVENTS:\n${todaySummary}\n\nNEXT 6 DAYS:\n${upcomingSummary}`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  return block.text;
}

async function saveBriefing(text: string) {
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
}

export async function GET(request: Request) {
  // Verify this is a cron call or has the right secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const events = await getEventsForBriefing();
    const briefing = await generateBriefing(events);
    await saveBriefing(briefing);

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
