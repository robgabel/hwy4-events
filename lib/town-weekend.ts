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
    const key = e.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(e);
  }
  // Stable: picks float up, everything else keeps chronological order.
  return [...distinct.filter((e) => e.robs_pick), ...distinct.filter((e) => !e.robs_pick)];
}

function clause(e: WeekendEvent): string {
  const day = WEEKDAYS[parts(e.date).dow];
  const venue = e.venue_name?.trim();
  const showVenue = venue && venue.toLowerCase() !== e.town.trim().toLowerCase();
  return `${e.name.trim().replace(/[.:;,]+$/, "")} on ${day}${showVenue ? ` at ${venue}` : ""}`;
}

function joinClauses(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * The answer sentence(s). Names at most `max` events; a remainder becomes
 * "Plus N more below." Returns null for an empty weekend, which the page
 * renders as its own honest empty state (with links) instead.
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
  return `${lead} Plus ${rest} more ${rest === 1 ? "event" : "events"} below.`;
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
