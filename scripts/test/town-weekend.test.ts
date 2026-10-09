// HWY-61 locks: the dated "this weekend" answer block on town pages, plus the
// Bear Valley vs Big Bear disambiguation sentence.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildWeekendAnswer,
  nearestTownWithEvents,
  selectWeekendEvents,
  weekendHeading,
  weekendLabel,
  weekendEmptyLine,
  type WeekendEvent,
} from "../../lib/town-weekend.js";
import { thisWeekendRange } from "../../lib/date-windows.js";
import { BEAR_VALLEY_DISAMBIGUATION } from "../../lib/disambiguation.js";
import { PERSONA_HUBS } from "../../lib/persona-hubs.js";

const WEEKEND = { start: "2026-10-09", end: "2026-10-11" }; // Fri-Sun
// Thursday Oct 8 2026, noon Pacific, in the absolute-minutes scale
// nowPacificMinutes uses (year*525960 + (month-1)*43830 + day*1440 + h*60 + m).
const minutes = (y: number, mo: number, d: number, h: number, mi = 0) =>
  y * 525960 + (mo - 1) * 43830 + d * 1440 + h * 60 + mi;
const THU_NOON = minutes(2026, 10, 8, 12);

let n = 0;
function ev(over: Partial<WeekendEvent>): WeekendEvent {
  n += 1;
  return {
    id: `e${n}`,
    name: `Event ${n}`,
    date: "2026-10-10",
    start_time: "19:00:00",
    end_time: null,
    venue_name: "Snowshoe Brewing",
    town: "Arnold",
    visibility: "public",
    robs_pick: false,
    ...over,
  };
}

test("heading states the dates in the question", () => {
  assert.equal(weekendHeading("Arnold", WEEKEND), "What's happening in Arnold this weekend (Oct 9–11)?");
  assert.equal(weekendLabel({ start: "2026-10-30", end: "2026-11-01" }), "Oct 30–Nov 1");
  assert.ok(!weekendHeading("Arnold", WEEKEND).includes("—"), "no em dash");
});

test("weekend range is Friday through Sunday", () => {
  assert.deepEqual(thisWeekendRange({ iso: "2026-10-08", dow: 4 }), WEEKEND);
  assert.deepEqual(thisWeekendRange({ iso: "2026-10-11", dow: 0 }), WEEKEND);
});

test("zero events: no answer sentence (the page renders its empty state)", () => {
  assert.equal(buildWeekendAnswer("Arnold", []), null);
  assert.deepEqual(selectWeekendEvents([], "Arnold", WEEKEND, THU_NOON), []);
});

test("one event", () => {
  const sel = selectWeekendEvents(
    [ev({ name: "Trivia Night", date: "2026-10-09" })],
    "Arnold",
    WEEKEND,
    THU_NOON
  );
  assert.equal(buildWeekendAnswer("Arnold", sel), "This weekend in Arnold: Trivia Night on Friday at Snowshoe Brewing.");
});

test("many events: top three named in order, remainder counted", () => {
  const rows = [
    ev({ name: "Sunday Brunch Band", date: "2026-10-11", start_time: "11:00" }),
    ev({ name: "Friday Rock Show", date: "2026-10-09" }),
    ev({ name: "Saturday Market", date: "2026-10-10", start_time: "09:00", venue_name: "Arnold" }),
    ev({ name: "Saturday Night Live Music", date: "2026-10-10", start_time: "20:00" }),
    ev({ name: "Late Sunday", date: "2026-10-11", start_time: "17:00" }),
  ];
  const sel = selectWeekendEvents(rows, "Arnold", WEEKEND, THU_NOON);
  assert.equal(
    buildWeekendAnswer("Arnold", sel),
    "This weekend in Arnold: Friday Rock Show on Friday at Snowshoe Brewing, Saturday Market on Saturday, and Saturday Night Live Music on Saturday at Snowshoe Brewing. Plus 2 more events this weekend."
  );
  const two = buildWeekendAnswer("Arnold", sel.slice(0, 2));
  assert.equal(two, "This weekend in Arnold: Friday Rock Show on Friday at Snowshoe Brewing and Saturday Market on Saturday.");
  assert.match(buildWeekendAnswer("Arnold", sel.slice(0, 4))!, /Plus 1 more event this weekend\.$/);
});

test("selection: other towns, private, out-of-window and finished events drop", () => {
  const rows = [
    ev({ name: "Murphys Thing", town: "Murphys" }),
    ev({ name: "Members Dinner", visibility: "private" }),
    ev({ name: "Next Week", date: "2026-10-16" }),
    ev({ name: "Last Thursday", date: "2026-10-08" }),
    ev({ name: "Friday Early", date: "2026-10-09", start_time: "08:00", end_time: "10:00" }),
    ev({ name: "Keeper", date: "2026-10-10" }),
  ];
  const satNoon = minutes(2026, 10, 10, 12);
  const names = selectWeekendEvents(rows, "Arnold", WEEKEND, satNoon).map((e) => e.name);
  assert.deepEqual(names, ["Keeper"], "Sunday-of view never lists Friday's finished show");
});

test("empty state says 'nothing else' once the weekend has started", () => {
  assert.equal(weekendEmptyLine("Arnold", WEEKEND, "2026-10-08"), "Nothing is listed in Arnold this weekend yet.");
  for (const today of ["2026-10-09", "2026-10-10", "2026-10-11"]) {
    assert.equal(
      weekendEmptyLine("Arnold", WEEKEND, today),
      "Nothing else is on in Arnold for the rest of this weekend."
    );
  }
});

test("venue already in the name is not repeated; same name at two venues stays two", () => {
  const sel = selectWeekendEvents(
    [
      ev({ name: "Live Music @ Prospect 772", venue_name: "Prospect 772 Winery", date: "2026-10-10" }),
      ev({ name: "Live Music", venue_name: "Stevenot Winery", date: "2026-10-10", start_time: "13:00" }),
      ev({ name: "Live Music", venue_name: "Snowshoe Brewing", date: "2026-10-10", start_time: "15:00" }),
    ],
    "Arnold",
    WEEKEND,
    THU_NOON
  );
  assert.equal(sel.length, 3);
  assert.equal(
    buildWeekendAnswer("Arnold", sel),
    "This weekend in Arnold: Live Music on Saturday at Stevenot Winery, Live Music on Saturday at Snowshoe Brewing, and Live Music @ Prospect 772 on Saturday."
  );
});

test("a series with a row per night is one happening; picks float up", () => {
  const rows = [
    ev({ name: "Fall Festival", date: "2026-10-09" }),
    ev({ name: "Fall Festival", date: "2026-10-10" }),
    ev({ name: "Pick Of The Week", date: "2026-10-11", robs_pick: true }),
  ];
  const names = selectWeekendEvents(rows, "Arnold", WEEKEND, THU_NOON).map((e) => e.name);
  assert.deepEqual(names, ["Pick Of The Week", "Fall Festival"]);
});

test("empty weekend finds the nearest town that has something", () => {
  const rows = [ev({ name: "Far", town: "Bear Valley" }), ev({ name: "Near", town: "Dorrington" })];
  assert.deepEqual(
    nearestTownWithEvents(["Avery", "Dorrington", "Bear Valley"], rows, WEEKEND, THU_NOON),
    { town: "Dorrington", count: 1 }
  );
  assert.equal(nearestTownWithEvents(["Avery"], rows, WEEKEND, THU_NOON), null);
});

test("Bear Valley pages carry the Big Bear disambiguation", () => {
  assert.match(BEAR_VALLEY_DISAMBIGUATION, /Alpine County/);
  assert.match(BEAR_VALLEY_DISAMBIGUATION, /Big Bear Lake in Southern California/);
  assert.ok(!BEAR_VALLEY_DISAMBIGUATION.includes("—"));

  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const towns = read("../../app/towns/town-content.ts");
  assert.match(towns, /"disambiguation": BEAR_VALLEY_DISAMBIGUATION/);
  const bvmf = read("../../app/bear-valley-music-festival-2026/page.tsx");
  assert.ok(bvmf.includes("${BEAR_VALLEY_DISAMBIGUATION}"));

  const hermit = PERSONA_HUBS.find((h) => h.town === "Bear Valley");
  assert.ok(hermit, "a Bear Valley persona hub exists");
  assert.ok(hermit!.qa.some((x) => x.a.includes(BEAR_VALLEY_DISAMBIGUATION)));
});

test("town page renders the weekend block for every town page", () => {
  const page = readFileSync(
    fileURLToPath(new URL("../../app/towns/[slug]/page.tsx", import.meta.url)),
    "utf8"
  );
  const live = readFileSync(
    fileURLToPath(new URL("../../components/TownWeekendLive.tsx", import.meta.url)),
    "utf8"
  );
  assert.ok(page.includes("weekendHeading(town.name, weekend)"));
  assert.ok(page.includes("<TownWeekendLive"), "the answer re-checks the clock after hydration");
  assert.ok(live.includes("buildWeekendAnswer(town, selected)"));
  assert.ok(live.includes('href="/this-weekend"'), "empty state points to /this-weekend");
  assert.ok(live.includes("WEEKEND_LIST_CAP"), "block lists the weekend itself");
  assert.ok(!page.includes("What&apos;s happening in {town.name}\n"), "no duplicate evergreen heading");
});
