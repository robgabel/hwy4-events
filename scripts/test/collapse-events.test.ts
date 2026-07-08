// Regression lock for the homepage feed collapse (lib/collapse-events.ts).
//
// The 60-day homepage window carries ~530 rows of which ~2/3 are instances of
// ~30 recurring series (Big Trees guided walks 40×, Junior Rangers 35×, weekly
// storytimes/trivia/maker sessions) — the same card wallpapered onto every
// day-group. The collapse says each happening once:
//   - runs (span ≤7 days, or near-daily cadence over a longer span) become one
//     DATE-RANGE card (endDate/dayCount), preserving the old multi-day behavior;
//   - spaced weekly-ish series become their NEXT not-yet-ended occurrence with
//     a data-derived cadence chip (seriesCadence/seriesCount).
// isHighlightEvent is the "Highlights" toggle lens: recurring regulars drop,
// picks/festivals/named-act live music/one-offs stay.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collapseEventList,
  isHighlightEvent,
  getBaseName,
} from "../../lib/collapse-events.js";
import type { EventListItem, CollapsedEvent } from "../../lib/types.js";

let nextId = 0;
const ev = (
  date: string,
  name: string,
  overrides: Partial<EventListItem> = {}
): EventListItem => ({
  id: `e${nextId++}`,
  name,
  description: null,
  date,
  start_time: "10:30",
  end_time: "11:30",
  venue_name: "Somewhere",
  town: "Arnold",
  category: "kids",
  artists: null,
  status: "confirmed",
  price: null,
  cost_tier: "unknown",
  image_url: null,
  visibility: "public",
  org_slug: null,
  robs_pick: false,
  is_weekly: false,
  verification_status: "unchecked",
  community_sourced: false,
  ...overrides,
});

// Pacific wall-clock minutes in the same scheme as lib/event-time.ts
// (year*525960 + (month-1)*43830 + day*1440 + hour*60 + minute).
const clock = (dateIso: string, hhmm: string): number => {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return y * 525960 + (m - 1) * 43830 + d * 1440 + h * 60 + min;
};

const sortByDate = (events: EventListItem[]) =>
  [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

test("multi-day run within a week collapses to a range card (old behavior kept)", () => {
  const events = sortByDate([
    ev("2026-07-10", "Frog Jump - Day 1", { artists: ["Band A"] }),
    ev("2026-07-11", "Frog Jump - Day 2", { artists: ["Band B"] }),
    ev("2026-07-12", "Frog Jump - Day 3"),
    ev("2026-07-11", "Something Else"),
  ]);
  const out = collapseEventList(events, null);
  assert.equal(out.length, 2);
  const run = out.find((e) => e.name === "Frog Jump")!;
  assert.equal(run.isCollapsed, true);
  assert.equal(run.date, "2026-07-10");
  assert.equal(run.endDate, "2026-07-12");
  assert.equal(run.dayCount, 3);
  assert.deepEqual(run.artists, ["Band A", "Band B"]);
  assert.equal(run.seriesCadence, undefined);
});

test("a weeks-long near-daily run (weekday camp) also collapses to a range card", () => {
  // Mon-Fri for 3 weeks: gaps of 1 with weekend gaps of 3 — median gap 1.
  const dates = [
    "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
    "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
    "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24",
  ];
  const out = collapseEventList(
    sortByDate(dates.map((d) => ev(d, "Forest School Adventure Camp"))),
    null
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].isCollapsed, true);
  assert.equal(out[0].endDate, "2026-07-24");
  assert.equal(out[0].dayCount, 15);
});

test("weekly series collapses to next occurrence with a weekly cadence chip", () => {
  const dates = ["2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29", "2026-08-05"];
  const events = sortByDate([
    ...dates.map((d) => ev(d, "Storytime with Miss Debbie", { is_weekly: true })),
    ev("2026-07-09", "One Off Concert", { category: "live_music" }),
  ]);
  const out = collapseEventList(events, null);
  assert.equal(out.length, 2);
  const series = out.find((e) => e.name === "Storytime with Miss Debbie")!;
  assert.equal(series.date, "2026-07-08");
  assert.equal(series.seriesCadence, "weekly");
  assert.equal(series.seriesCount, 5);
  assert.equal(series.isCollapsed, undefined);
  // the collapsed card sits in the anchor's chronological slot
  assert.equal(out[0].name, "Storytime with Miss Debbie");
  assert.equal(out[1].name, "One Off Concert");
});

test("series card re-anchors to the next date once today's instance has ended", () => {
  const dates = ["2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"];
  const events = sortByDate(
    dates.map((d) => ev(d, "Storytime with Miss Debbie"))
  );
  // 4 PM on the day of the first 10:30-11:30 instance: it has ended.
  const out = collapseEventList(events, clock("2026-07-08", "16:00"));
  assert.equal(out.length, 1);
  assert.equal(out[0].date, "2026-07-15");
  assert.equal(out[0].seriesCount, 3);
});

test("non-daily, non-weekly cadence gets the generic Repeats chip", () => {
  // Roughly monthly-ish: gaps of ~18 days.
  const dates = ["2026-07-08", "2026-07-26", "2026-08-13", "2026-08-31"];
  const out = collapseEventList(
    sortByDate(dates.map((d) => ev(d, "Quilt Guild Meetup"))),
    null
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].seriesCadence, "recurring");
});

test("two instances far apart are left alone (not a series)", () => {
  const events = sortByDate([
    ev("2026-07-08", "Blood Drive"),
    ev("2026-08-20", "Blood Drive"),
  ]);
  const out = collapseEventList(events, null);
  assert.equal(out.length, 2);
});

test("same name in different towns never merges", () => {
  const events = sortByDate([
    ev("2026-07-08", "Farmers Market", { town: "Murphys" }),
    ev("2026-07-15", "Farmers Market", { town: "Murphys" }),
    ev("2026-07-22", "Farmers Market", { town: "Murphys" }),
    ev("2026-07-10", "Farmers Market", { town: "Angels Camp" }),
    ev("2026-07-17", "Farmers Market", { town: "Angels Camp" }),
    ev("2026-07-24", "Farmers Market", { town: "Angels Camp" }),
  ]);
  const out = collapseEventList(events, null);
  assert.equal(out.length, 2);
  assert.deepEqual(new Set(out.map((e) => e.town)), new Set(["Murphys", "Angels Camp"]));
});

test("getBaseName strips run suffixes", () => {
  assert.equal(getBaseName("Fair - Day 2"), "Fair");
  assert.equal(getBaseName("Festival (through Aug 2)"), "Festival");
  assert.equal(getBaseName("Festival (Opening Day)"), "Festival");
});

test("Highlights lens: recurring regulars drop; picks, festivals, one-offs, named-act music stay", () => {
  const card = (overrides: Partial<CollapsedEvent>): CollapsedEvent => ({
    ...ev("2026-07-10", "x"),
    ...overrides,
  });
  // one-off stays
  assert.equal(isHighlightEvent(card({})), true);
  // multi-day range card (camp/festival run) stays
  assert.equal(isHighlightEvent(card({ isCollapsed: true, dayCount: 5 })), true);
  // weekly series card drops
  assert.equal(isHighlightEvent(card({ seriesCadence: "weekly" })), false);
  // lone is_weekly row drops
  assert.equal(isHighlightEvent(card({ is_weekly: true })), false);
  // ...unless it's a Rob's Pick
  assert.equal(isHighlightEvent(card({ seriesCadence: "weekly", robs_pick: true })), true);
  // ...or a festival
  assert.equal(isHighlightEvent(card({ is_weekly: true, category: "festival" })), true);
  // recurring live music with a named act stays; without one it drops
  assert.equal(
    isHighlightEvent(card({ seriesCadence: "weekly", category: "live_music", artists: ["Poison Oakies"] })),
    true
  );
  assert.equal(
    isHighlightEvent(card({ seriesCadence: "weekly", category: "live_music", artists: [] })),
    false
  );
});
