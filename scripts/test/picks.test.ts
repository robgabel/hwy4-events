// Regression lock for the homepage curation modules (lib/picks.ts).
//
// The spotlight header says "this week", so it must only surface a pick that
// actually falls inside the window — a pick three weeks out in the spotlight
// slot is lying copy. The row is capped so curation stays curation. Two rules
// added 2026-07-05 (the July 5 screenshot: an ended festival held the spotlight
// at 4:53 PM, and the Bear Valley festival read as one night):
//   1. Time-aware — an ended pick drops (shared hasEventEnded predicate).
//   2. Guide-aware — a live festival guide is a range entry for the whole run
//      and absorbs any event pick it matches (umbrella or nightly).
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectPicks,
  addDaysIso,
  MAX_PICK_CARDS,
} from "../../lib/picks.js";
import type { FestivalGuide } from "../../lib/event-guides.js";

const pick = (
  date: string,
  name = "x",
  times: { start?: string | null; end?: string | null } = {}
) => ({
  date,
  name,
  start_time: times.start ?? null,
  end_time: times.end ?? null,
  robs_pick: true,
  visibility: "public",
});

const TODAY = "2026-07-03";

// The absolute-minutes scheme from lib/event-time.ts, reproduced so tests can
// build a deterministic Pacific "now" without touching the real clock (same
// helper shape as event-time.test.ts).
function at(time24: string, dateStr = TODAY): number {
  const [h, m] = time24.split(":").map(Number);
  const [y, mo, d] = dateStr.split("-").map(Number);
  return y * 525960 + (mo - 1) * 43830 + d * 1440 + h * 60 + m;
}

const MORNING = at("08:00");

const guide = (over: Partial<FestivalGuide> = {}): FestivalGuide => ({
  path: "/fest-2026",
  title: "Fest 2026",
  town: "Bear Valley",
  label: "Festival guide",
  heading: "Planning for Fest?",
  blurb: "b",
  townSlug: "bear-valley",
  startDate: "2026-07-17",
  hideAfter: "2026-08-02",
  matchEvent: (e) =>
    e.venue_key === "big-white-tent" ||
    (e.name?.toLowerCase().includes("fest") ?? false),
  ...over,
});

function names(entries: ReturnType<typeof selectPicks>["picks"]): string[] {
  return entries.map((e) => (e.kind === "event" ? e.event.name : e.guide.title));
}

test("spotlight = soonest pick inside the 7-day window; row excludes it", () => {
  const events = [pick("2026-07-04", "parade"), pick("2026-07-06"), pick("2026-07-20")];
  const { spotlight, picks } = selectPicks(events, TODAY, MORNING);
  assert.equal(spotlight?.kind, "event");
  assert.equal(spotlight?.kind === "event" && spotlight.event.name, "parade");
  assert.equal(picks.length, 2);
  assert.ok(!picks.includes(spotlight!));
});

test("no pick inside the window: spotlight null, row leads with the soonest", () => {
  const events = [pick("2026-07-17", "festival umbrella"), pick("2026-08-01")];
  const { spotlight, picks } = selectPicks(events, TODAY, MORNING);
  assert.equal(spotlight, null);
  assert.equal(names(picks)[0], "festival umbrella");
});

test("row caps at MAX_PICK_CARDS", () => {
  const events = Array.from({ length: 9 }, (_, i) =>
    pick(addDaysIso(TODAY, i + 1), `p${i}`)
  );
  const { spotlight, picks } = selectPicks(events, TODAY, MORNING);
  assert.ok(spotlight);
  assert.equal(picks.length, MAX_PICK_CARDS);
});

test("filters non-picks, private rows, and past dates", () => {
  const events = [
    { ...pick("2026-07-04", "not a pick"), robs_pick: false },
    { ...pick("2026-07-04", "club night"), visibility: "private" },
    pick("2026-07-01", "already happened"),
    pick("2026-07-05", "keeper"),
  ];
  const { spotlight, picks } = selectPicks(events, TODAY, MORNING);
  assert.equal(spotlight?.kind === "event" && spotlight.event.name, "keeper");
  assert.equal(picks.length, 0);
});

test("today's pick counts as this week (boundary), and empty input is graceful", () => {
  const { spotlight } = selectPicks([pick(TODAY, "tonight")], TODAY, MORNING);
  assert.equal(spotlight?.kind === "event" && spotlight.event.name, "tonight");
  const none = selectPicks([], TODAY, MORNING);
  assert.equal(none.spotlight, null);
  assert.equal(none.picks.length, 0);
});

test("addDaysIso rolls months without timezone drift", () => {
  assert.equal(addDaysIso("2026-07-28", 7), "2026-08-04");
  assert.equal(addDaysIso("2026-12-30", 7), "2027-01-06");
});

// ── Time-aware selection (the July 5 screenshot bug) ────────────────────────

test("a pick that ended earlier today drops; a still-running one stays", () => {
  // The real case: 54th Annual Arts & Crafts Festival, 10 AM – 4 PM, seen still
  // spotlighted at 4:53 PM.
  const festival = pick(TODAY, "arts and crafts", { start: "10:00", end: "16:00" });
  const later = pick("2026-07-06", "next up");

  const during = selectPicks([festival, later], TODAY, at("15:00"));
  assert.equal(during.spotlight?.kind === "event" && during.spotlight.event.name, "arts and crafts");

  const after = selectPicks([festival, later], TODAY, at("16:53"));
  assert.equal(after.spotlight?.kind === "event" && after.spotlight.event.name, "next up");
  assert.ok(!names(after.picks).includes("arts and crafts"));
});

test("no end time: assumed over 4h after start (shared hasEventEnded default)", () => {
  const parade = pick(TODAY, "parade", { start: "10:00" });
  assert.ok(selectPicks([parade], TODAY, at("13:00")).spotlight);
  assert.equal(selectPicks([parade], TODAY, at("14:00")).spotlight, null);
});

test("timeless all-day pick holds until the end of its day", () => {
  const allDay = pick(TODAY, "all day");
  assert.ok(selectPicks([allDay], TODAY, at("23:00")).spotlight);
});

// ── Guide-aware selection (highlight the festival page, not one night) ──────

test("an upcoming guide inside the window is the spotlight, anchored on opening day", () => {
  const { spotlight } = selectPicks([], "2026-07-12", at("08:00", "2026-07-12"), [guide()]);
  assert.equal(spotlight?.kind, "guide");
  assert.equal(spotlight?.kind === "guide" && spotlight.inProgress, false);
  assert.equal(spotlight?.date, "2026-07-17");
});

test("an upcoming guide outside the window sits in the row, not the spotlight", () => {
  const { spotlight, picks } = selectPicks([], TODAY, MORNING, [guide()]);
  assert.equal(spotlight, null);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].kind, "guide");
});

test("an in-progress guide stays spotlighted through the whole run (the Jul 18 – Aug 2 gap)", () => {
  const MID_RUN = "2026-07-25";
  const { spotlight } = selectPicks([], MID_RUN, at("08:00", MID_RUN), [guide()]);
  assert.equal(spotlight?.kind, "guide");
  assert.equal(spotlight?.kind === "guide" && spotlight.inProgress, true);
  assert.equal(spotlight?.date, MID_RUN);
});

test("a guide past hideAfter is gone", () => {
  const AFTER = "2026-08-03";
  const { spotlight, picks } = selectPicks([], AFTER, at("08:00", AFTER), [guide()]);
  assert.equal(spotlight, null);
  assert.equal(picks.length, 0);
});

test("a live guide absorbs the picks it matches (umbrella + nightly), keeps the rest", () => {
  const events = [
    pick("2026-07-17", "Fest 2026"), // the umbrella row
    { ...pick("2026-07-18", "Symphony Night"), venue_key: "big-white-tent" }, // a nightly show
    pick("2026-07-20", "unrelated bbq"),
  ];
  const { spotlight, picks } = selectPicks(events, "2026-07-12", at("08:00", "2026-07-12"), [guide()]);
  assert.equal(spotlight?.kind, "guide");
  assert.deepEqual(names(picks), ["unrelated bbq"]);
});

test("an in-progress guide outranks a same-day event pick for the spotlight", () => {
  const MID_RUN = "2026-07-25";
  const events = [pick(MID_RUN, "tonight elsewhere", { start: "19:00" })];
  const { spotlight, picks } = selectPicks(events, MID_RUN, at("08:00", MID_RUN), [guide()]);
  assert.equal(spotlight?.kind, "guide");
  assert.deepEqual(names(picks), ["tonight elsewhere"]);
});
