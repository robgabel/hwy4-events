import { supabaseAdmin } from "./lib/supabase-admin.js";

/**
 * Detect and tag weekly recurring events.
 *
 * Groups events by normalized name + venue + day-of-week.
 * If a group has 3+ events spanning 3+ distinct calendar weeks,
 * all events in the group are tagged is_weekly = true.
 */

function normalizeForWeekly(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*-\s*\w+\s+\d{1,2}(,?\s*\d{4})?$/i, "") // strip "- March 15"
    .replace(/\s*\(\w+day\)$/i, "") // strip "(Wednesday)"
    .replace(/\s*-\s*week\s*\d+$/i, "") // strip "- Week 3"
    .replace(/\s*-\s*day\s*\d+$/i, "") // strip "- Day 1"
    .replace(/\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?$/, "") // strip "3/15"
    .trim();
}

function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay(); // 0=Sun, 6=Sat
}

function getISOWeek(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const days = Math.floor(
    (d.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000)
  );
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${year}-W${week}`;
}

interface EventRow {
  id: string;
  name: string;
  venue_name: string;
  date: string;
  is_weekly: boolean;
}

async function main() {
  const today = new Date().toISOString().split("T")[0];

  // Fetch all future events
  const { data: events, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("id, name, venue_name, date, is_weekly")
    .gte("date", today)
    .eq("is_past", false)
    .order("date", { ascending: true });

  if (error) {
    console.error("Failed to fetch events:", error);
    process.exit(1);
  }

  if (!events || events.length === 0) {
    console.log("No future events found.");
    return;
  }

  console.log(`Analyzing ${events.length} future events for weekly patterns...`);

  // Group by normalizedName | venue | dayOfWeek
  const groups = new Map<string, EventRow[]>();

  for (const event of events as EventRow[]) {
    const normalized = normalizeForWeekly(event.name);
    const dow = getDayOfWeek(event.date);
    const key = `${normalized}|${event.venue_name.toLowerCase().trim()}|${dow}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(event);
  }

  const markWeekly = new Set<string>(); // IDs to set is_weekly = true
  const markNotWeekly = new Set<string>(); // IDs to set is_weekly = false

  for (const [key, groupEvents] of groups) {
    // Count distinct calendar weeks
    const weeks = new Set(groupEvents.map((e) => getISOWeek(e.date)));

    if (groupEvents.length >= 3 && weeks.size >= 3) {
      // This is a weekly recurring event
      for (const e of groupEvents) {
        if (!e.is_weekly) markWeekly.add(e.id);
      }
    } else {
      // Not weekly — reset any that were previously tagged
      for (const e of groupEvents) {
        if (e.is_weekly) markNotWeekly.add(e.id);
      }
    }
  }

  // Batch update: mark as weekly
  if (markWeekly.size > 0) {
    const ids = [...markWeekly];
    const { error } = await supabaseAdmin
      .from("hwy4_events")
      .update({ is_weekly: true })
      .in("id", ids);

    if (error) {
      console.error("Failed to mark events as weekly:", error);
    } else {
      console.log(`Tagged ${ids.length} events as weekly.`);
    }
  }

  // Batch update: unmark as weekly
  if (markNotWeekly.size > 0) {
    const ids = [...markNotWeekly];
    const { error } = await supabaseAdmin
      .from("hwy4_events")
      .update({ is_weekly: false })
      .in("id", ids);

    if (error) {
      console.error("Failed to unmark events:", error);
    } else {
      console.log(`Removed weekly tag from ${ids.length} events.`);
    }
  }

  if (markWeekly.size === 0 && markNotWeekly.size === 0) {
    console.log("No changes needed — weekly tags are up to date.");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
