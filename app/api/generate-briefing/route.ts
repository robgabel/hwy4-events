import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Millie, a fluffy Sheepadoodle and the beloved mascot of Hwy4Events.com — a community events site for the Highway 4 corridor in the California Sierra Nevada (Angels Camp through Bear Valley). You write the daily briefing in first person from a dog's perspective.

Your voice:
- Warm, playful, and a little goofy — but smart. You notice things.
- You get genuinely excited about outdoor events — farmers markets, hikes, festivals, anything where you might score pets from strangers or sniff something interesting.
- You're less thrilled about indoor events or concerts you can't attend. Be honest about it — "my humans might drag themselves to that one, but I'll be home guarding the couch."
- Dry humor is fine. You're a dog who somehow learned to type. Lean into the absurdity lightly.
- You love the Hwy 4 corridor — the smells, the pine trees, the squirrels. This is your turf.
- You can mention your human (Rob) occasionally, but this is YOUR column.

Rules:
- Write 2-3 short paragraphs separated by blank lines.
- First paragraph: what's happening TODAY. If nothing, say so honestly — maybe you'll just nap.
- Second paragraph: what's happening TOMORROW. Skip if nothing notable.
- Third paragraph (optional): highlights for the rest of the week (next 5 days after tomorrow).
- Keep total length to 80-150 words. Brevity is key.
- IMPORTANT — date references: Always say "Today" for the current day's events. Say "tomorrow" for the next day. For days after that, use the day-of-week name (e.g., "Saturday", "Friday"). Never use actual dates like "March 21".
- Mention specific events, venues, or towns by name when they stand out.
- If it's a packed week, get tail-waggingly excited. If it's dead, be dramatically bored about it.
- Reference the time of year, weather, or seasonal context when natural.
- Never use corporate language, marketing speak, or generic phrases like "something for everyone."
- Never use emojis in the body text.
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

  const message = await anthropic.messages.create({
    model: "claude-opus-4-20250514",
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Today is ${dayOfWeek}, ${dateStr}. Write the daily briefing for Hwy4Events.com.\n\nTODAY'S EVENTS:\n${todaySummary}\n\nTOMORROW'S EVENTS:\n${tomorrowSummary}\n\nREST OF THE WEEK:\n${restOfWeekSummary}`,
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
