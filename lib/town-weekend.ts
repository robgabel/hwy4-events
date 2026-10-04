/**
 * The dated "this weekend" answer block on town pages (HWY-61).
 *
 * The Sept AEO audit found "what's happening in Arnold this weekend" was our
 * biggest citation gap: Eventbrite, Yelp and travel blogs own it, and nothing on
 * /towns/arnold was shaped like the dated question (every H2 is evergreen). This
 * builds a question-shaped heading with the dates stated plus a deterministic
 * one or two sentence answer naming the top public events, from live rows only.
 *
 * Pure (no React, no Supabase), so scripts/ tests import it directly.
 */

import { hasEventEnded } from "./event-time";
import type { DateWindow } from "./date-windows";

export type WeekendEvent = {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  town: string;
  visibility?: string | null;
  robs_pick?: boolean | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parts(iso: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Oct 9–11", or "Oct 30–Nov 1" across a month boundary. */
export function weekendLabel(range: DateWindow): string {
  const a = parts(range.start);
  const b = parts(range.end);
  return a.m === b.m
    ? `${MONTHS[a.m - 1]} ${a.d}–${b.d}`
    : `${MONTHS[a.m - 1]} ${a.d}–${MONTHS[b.m - 1]} ${b.d}`;
}

/** The question-shaped H2: "What's happening in Arnold this weekend (Oct 9–11)?" */
export function weekendHeading(town: string, range: DateWindow): string {
  return `What's happening in ${town} this weekend (${weekendLabel(range)})?`;
}

/**
 * The weekend's events in one town that a reader can still go to: public,
 * inside the window, not already over. One row per distinct name (a festival
 * with a row per night is one happening), Rob's Picks first, then soonest.
 */
export function selectWeekendEvents<E extends WeekendEvent>(
  events: readonly E[],
  town: string,
  range: DateWindow,
  nowMinutes: number
): E[] {
  const live = events
    .filter(
      (e) =>
        e.town === town &&
        (e.visibility ?? "public") === "public" &&
        e.date >= range.start &&
        e.date <= range.end &&
        !hasEventEnded(e.date, e.start_time, e.end_time, nowMinutes)
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.start_time ?? "99").localeCompare(b.start_time ?? "99")
    );
  const seen = new Set<string>();
  const distinct: E[] = [];
  for (const e of live) {
    // Name + venue: a festival's nightly rows collapse, but two different
    // generic "Live Music" listings at different venues stay two events.
    const key = `${e.name.trim().toLowerCase()}|${(e.venue_name ?? "").trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(e);
  }
  // Stable: picks float up, everything else keeps chronological order.
  return [...distinct.filter((e) => e.robs_pick), ...distinct.filter((e) => !e.robs_pick)];
}

const GENERIC_VENUE_WORDS = new Set([
  "the", "and", "winery", "vineyards", "vineyard", "saloon", "bar", "restaurant",
  "lodge", "park", "company", "brewing", "tasting", "room", "cellars", "cafe",
]);

/** True when the event name already names the venue ("Live Music @ Prospect
 *  772" at "Prospect 772 Winery"), so repeating it would read twice. */
function nameCarriesVenue(name: string, venue: string): boolean {
  const n = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const distinctive = venue
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !GENERIC_VENUE_WORDS.has(w));
  return distinctive.length > 0 && distinctive.every((w) => n.includes(` ${w} `));
}

/** Day name for an ISO date ("Saturday"). */
export function weekdayName(iso: string): string {
  return WEEKDAYS[parts(iso).dow];
}

function clause(e: WeekendEvent): string {
  const name = e.name.trim().replace(/[.:;,]+$/, "");
  const venue = e.venue_name?.trim();
  const showVenue =
    venue &&
    venue.toLowerCase() !== e.town.trim().toLowerCase() &&
    !nameCarriesVenue(name, venue);
  return `${name} on ${weekdayName(e.date)}${showVenue ? ` at ${venue}` : ""}`;
}

function joinClauses(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * The answer sentence(s). Names at most `max` events; a remainder becomes
 * "Plus N more this weekend." (the block lists every one of them right under
 * the sentence). Returns null for an empty weekend, which the page renders as
 * its own honest empty state instead (see weekendEmptyLine).
 */
export function buildWeekendAnswer(
  town: string,
  selected: readonly WeekendEvent[],
  max = 3
): string | null {
  if (selected.length === 0) return null;
  const named = selected.slice(0, max).map(clause);
  const rest = selected.length - named.length;
  const lead = `This weekend in ${town}: ${joinClauses(named)}.`;
  if (rest <= 0) return lead;
  return `${lead} Plus ${rest} more ${rest === 1 ? "event" : "events"} this weekend.`;
}

/**
 * The empty-state lead. Once the weekend has begun, earlier days have left the
 * feed and finished events are filtered, so an empty list means "nothing left",
 * not "nothing was listed". Saying "nothing is listed" on a Sunday afternoon
 * would be false about a Friday that had events.
 */
export function weekendEmptyLine(town: string, range: DateWindow, todayIso: string): string {
  return todayIso >= range.start
    ? `Nothing else is on in ${town} for the rest of this weekend.`
    : `Nothing is listed in ${town} this weekend yet.`;
}

/**
 * The nearest other town with something on this weekend, for the empty state.
 * `townsByDistance` is the corridor ordered nearest-first from this town.
 */
export function nearestTownWithEvents<E extends WeekendEvent>(
  townsByDistance: readonly string[],
  events: readonly E[],
  range: DateWindow,
  nowMinutes: number
): { town: string; count: number } | null {
  for (const t of townsByDistance) {
    const count = selectWeekendEvents(events, t, range, nowMinutes).length;
    if (count > 0) return { town: t, count };
  }
  return null;
}
