import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "./supabase-admin.js";

const client = new Anthropic();

interface EventRow {
  name: string;
  description: string | null;
  date: string;
  start_time: string | null;
  venue_name: string;
  town: string;
  category: string;
  artists: string[] | null;
  price: string | null;
}

/**
 * Returns the relative label for a date: "Today", "Tomorrow", or the day name.
 * This is the core fix — ensures narratives never say "Sunday" when they mean "Today".
 */
function getRelativeDayLabel(
  dateStr: string,
  today: Date
): { label: string; dayName: string; isRelative: boolean } {
  const date = new Date(dateStr + "T12:00:00"); // noon to avoid timezone issues
  const todayNoon = new Date(today);
  todayNoon.setHours(12, 0, 0, 0);

  const diffMs = date.getTime() - todayNoon.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const dayName = date.toLocaleDateString("en-US", { weekday: "long" });

  if (diffDays === 0) return { label: "Today", dayName, isRelative: true };
  if (diffDays === 1) return { label: "Tomorrow", dayName, isRelative: true };
  return { label: dayName, dayName, isRelative: false };
}

/**
 * Format a date for display in the datelog header (e.g., "Sunday, Mar 15")
 */
function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  const day = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const dayNum = date.getDate();
  return `${day}, ${month} ${dayNum}`;
}

/**
 * Generate the "Week on the 4" narrative from upcoming events.
 * Uses relative day references (Today, Tomorrow) instead of bare day names
 * for the current and next day.
 */
export async function generateWeekNarrative(): Promise<void> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // Get events for the next 7 days
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 7);
  const endStr = endDate.toISOString().split("T")[0];

  const { data: events, error } = await supabaseAdmin
    .from("hwy4_events")
    .select(
      "name, description, date, start_time, venue_name, town, category, artists, price"
    )
    .gte("date", todayStr)
    .lte("date", endStr)
    .eq("is_past", false)
    .neq("status", "cancelled")
    .eq("visibility", "public")
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    console.error("Failed to fetch events for narrative:", error);
    return;
  }

  const typedEvents = events as EventRow[];

  // Build day-by-day context with relative labels
  const dayGroups = new Map<string, { label: string; dayName: string; header: string; events: EventRow[] }>();

  for (const event of typedEvents) {
    if (!dayGroups.has(event.date)) {
      const { label, dayName } = getRelativeDayLabel(event.date, today);
      dayGroups.set(event.date, {
        label,
        dayName,
        header: formatDateHeader(event.date),
        events: [],
      });
    }
    dayGroups.get(event.date)!.events.push(event);
  }

  // Build the event context for the LLM, using relative day labels
  const dayContextLines: string[] = [];
  const dateLog: { date: string; label: string; dayName: string; header: string }[] = [];

  for (const [date, group] of dayGroups) {
    dateLog.push({ date, label: group.label, dayName: group.dayName, header: group.header });

    const eventLines = group.events.map((e) => {
      const parts = [`  - ${e.name}`];
      if (e.venue_name) parts.push(`at ${e.venue_name}`);
      if (e.town) parts.push(`in ${e.town}`);
      if (e.start_time) parts.push(`at ${e.start_time}`);
      if (e.artists?.length) parts.push(`(${e.artists.join(", ")})`);
      if (e.price) parts.push(`[${e.price}]`);
      if (e.description) parts.push(`— ${e.description}`);
      return parts.join(" ");
    });

    dayContextLines.push(`${group.label} (${group.header}):\n${eventLines.join("\n")}`);
  }

  // Also note days with NO events
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dStr = d.toISOString().split("T")[0];
    if (!dayGroups.has(dStr)) {
      const { label, dayName } = getRelativeDayLabel(dStr, today);
      const header = formatDateHeader(dStr);
      dateLog.push({ date: dStr, label, dayName, header });
      dayContextLines.push(`${label} (${header}): No events`);
    }
  }

  // Sort dateLog by date
  dateLog.sort((a, b) => a.date.localeCompare(b.date));

  const eventContext = dayContextLines.join("\n\n");

  const prompt = `You are the voice of "The Week on the 4" — a short, warm editorial summary of the week's events along the Highway 4 corridor in the Sierra Nevada foothills of Calaveras County, California. Towns include Angels Camp, Murphys, Arnold, Avery, Dorrington, White Pines, and Bear Valley.

CRITICAL RULE — Relative day references:
- When referring to the current day, ALWAYS use "Today" (never the day name like "Sunday" or "Monday")
- When referring to the next day, ALWAYS use "Tomorrow" (never the day name)
- For all other days, use the day name (e.g., "Wednesday", "Saturday")
- In date headers/labels, the full date is fine (e.g., "Sunday, Mar 15") but in the narrative prose, use "Today"/"Tomorrow" for the first two days

The event listing below already uses these relative labels — follow them exactly.

Write 2-4 paragraphs (no headers, no bullet points, no bold text). Keep it conversational, witty, and rooted in the mountain-town vibe. If a day has no events, you can mention the quiet day with personality. Highlight standout events. Keep the total under 200 words.

Events this week:

${eventContext}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const narrative =
    message.content[0].type === "text" ? message.content[0].text : "";

  if (!narrative) {
    console.warn("Empty narrative generated");
    return;
  }

  // Upsert into Supabase
  const { error: upsertError } = await supabaseAdmin
    .from("hwy4_weekly_narratives")
    .upsert(
      {
        week_of: todayStr,
        narrative,
        date_log: dateLog,
        generated_at: new Date().toISOString(),
        event_count: typedEvents.length,
      },
      { onConflict: "week_of" }
    );

  if (upsertError) {
    console.error("Failed to save narrative:", upsertError);
    return;
  }

  console.log(
    `Narrative generated: ${narrative.length} chars, ${typedEvents.length} events, ${dateLog.length} days`
  );
}
