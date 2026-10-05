// Fetch for the "mark your calendar" Rob's Picks that fall after a surface's
// own window (lib/briefing-picks.ts is the pure half). The weekend briefing and
// the newsletter query only their own days, so a pick two weeks out never
// reaches the prompt without this. Relative imports for the scripts/ runner.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BriefingPickRow } from "./briefing-picks";

/** Columns the shared pick rule (eligiblePickEntries) and the prompt need. */
export const PICK_COLUMNS =
  "name, date, start_time, end_time, venue_name, venue_key, town, robs_pick, pick_reason, sold_out, visibility";

/** Public, live robs_pick rows dated fromIso..toIso inclusive. The shared rule
 *  still re-checks sold_out / ended / visibility, so this only narrows the read.
 *  Best-effort: a failed read returns [] so a generator never dies over a
 *  teaser line. */
export async function getPickRowsBetween(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string
): Promise<BriefingPickRow[]> {
  if (toIso < fromIso) return [];
  const { data, error } = await supabase
    .from("hwy4_events")
    .select(PICK_COLUMNS)
    .eq("robs_pick", true)
    .eq("visibility", "public")
    .gte("date", fromIso)
    .lte("date", toIso)
    .neq("status", "cancelled")
    .neq("is_routine", true)
    .order("date", { ascending: true });
  if (error) {
    console.error("[briefing-picks] lookahead read failed:", error.message);
    return [];
  }
  return (data ?? []) as BriefingPickRow[];
}
