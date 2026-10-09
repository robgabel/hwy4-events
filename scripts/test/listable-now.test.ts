// Ended-event filter for temporal and intent lists (issue #346).
//
// isListableNow is the homepage's "already over" rule, including multi-day
// range cards. nextWeekendRange / shouldOfferNextWeekend decide when
// /this-weekend points at the following Friday–Sunday. Pure: the clock is
// passed in. Run: cd scripts && npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isListableNow } from "../../lib/event-time.js";
import {
  NEXT_WEEKEND_FROM_MINUTE,
  nextWeekendHandoffLead,
  nextWeekendPath,
  nextWeekendRange,
  pacificNow,
  shouldOfferNextWeekend,
  thisWeekendRange,
} from "../../lib/date-windows.js";

const SUNDAY = "2026-10-04";
const WEEKEND = { start: "2026-10-02", end: SUNDAY }; // Fri–Sun of the repro

function at(dateStr: string, time24: string): number {
  const [h, m] = time24.split(":").map(Number);
  const [y, mo, d] = dateStr.split("-").map(Number);
  return y * 525960 + (mo - 1) * 43830 + d * 1440 + h * 60 + m;
}

function readRepo(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("Sunday 4 PM PT: ended morning and afternoon events drop, a later show stays", () => {
  const now = at(SUNDAY, "16:00");
  const market = { date: SUNDAY, start_time: "09:00", end_time: "13:00" };
  const hike = { date: SUNDAY, start_time: "10:00", end_time: "13:00" };
  const stevenot = { date: SUNDAY, start_time: "13:00", end_time: "16:00" };
  const matinee = { date: SUNDAY, start_time: "14:00", end_time: "15:30" };
  const tonight = { date: SUNDAY, start_time: "19:00", end_time: "22:00" };
  assert.equal(isListableNow(market, now), false);
  assert.equal(isListableNow(hike, now), false);
  assert.equal(isListableNow(stevenot, now), false);
  assert.equal(isListableNow(matinee, now), false);
  assert.equal(isListableNow(tonight, now), true);
});

test("no end time: still on until 4 hours after the start", () => {
  const row = { date: SUNDAY, start_time: "13:00", end_time: null };
  assert.equal(isListableNow(row, at(SUNDAY, "16:00")), true);
  assert.equal(isListableNow(row, at(SUNDAY, "17:00")), false);
});

test("timeless row stays through the end of its calendar day", () => {
  const row = { date: SUNDAY, start_time: null, end_time: null };
  assert.equal(isListableNow(row, at(SUNDAY, "16:00")), true);
  assert.equal(isListableNow(row, at(SUNDAY, "23:59")), false);
});

test("multi-day range card stays until the last day's slot ends", () => {
  const run = {
    date: "2026-10-02",
    endDate: SUNDAY,
    isCollapsed: true,
    start_time: "10:00",
    end_time: "13:00",
  };
  // Saturday evening: Sunday's 10–1 slot has not started, so the card stays.
  assert.equal(isListableNow(run, at("2026-10-03", "18:00")), true);
  // Sunday morning, still inside the last day's hours.
  assert.equal(isListableNow(run, at(SUNDAY, "11:00")), true);
  // Sunday afternoon, the last day is over.
  assert.equal(isListableNow(run, at(SUNDAY, "14:00")), false);
  // The same dates as an ordinary Friday row are over on Saturday.
  assert.equal(
    isListableNow({ ...run, isCollapsed: false }, at("2026-10-03", "18:00")),
    false
  );
});

test("next weekend after Oct 2–4 is Oct 9–11", () => {
  assert.deepEqual(nextWeekendRange(WEEKEND), {
    start: "2026-10-09",
    end: "2026-10-11",
  });
  assert.equal(
    nextWeekendPath(WEEKEND),
    "/this-weekend?from=2026-10-09&to=2026-10-11"
  );
  // Same answer from the Sunday thisWeekendRange, and across a month boundary.
  assert.deepEqual(nextWeekendRange(thisWeekendRange({ iso: SUNDAY, dow: 0 })), {
    start: "2026-10-09",
    end: "2026-10-11",
  });
  assert.deepEqual(nextWeekendRange({ start: "2026-10-30", end: "2026-11-01" }), {
    start: "2026-11-06",
    end: "2026-11-08",
  });
});

test("pacificNow: 2026-10-05T01:00Z is Sunday Oct 4 at 6:00 PM Pacific", () => {
  const clock = pacificNow(new Date("2026-10-05T01:00:00Z"));
  assert.equal(clock.iso, SUNDAY);
  assert.equal(clock.dow, 0);
  assert.equal(clock.minutesOfDay, NEXT_WEEKEND_FROM_MINUTE);
});

test("next-weekend link: all ended, or Sunday from 6 PM, not a fresh weekday", () => {
  const sunday = { iso: SUNDAY, dow: 0 };
  const saturday = { iso: "2026-10-03", dow: 6 };
  const friday = { iso: "2026-10-02", dow: 5 };
  const monday = { iso: "2026-10-05", dow: 1 };

  assert.equal(
    shouldOfferNextWeekend({
      pageRange: WEEKEND,
      today: sunday,
      minutesOfDay: 16 * 60,
      stillOnCount: 0,
    }),
    true,
    "Sunday 4 PM, nothing left"
  );
  assert.equal(
    shouldOfferNextWeekend({
      pageRange: WEEKEND,
      today: sunday,
      minutesOfDay: 15 * 60,
      stillOnCount: 2,
    }),
    false,
    "Sunday afternoon with shows still on"
  );
  assert.equal(
    shouldOfferNextWeekend({
      pageRange: WEEKEND,
      today: sunday,
      minutesOfDay: NEXT_WEEKEND_FROM_MINUTE,
      stillOnCount: 1,
    }),
    true,
    "Sunday 6:00 PM even with a late show"
  );
  assert.equal(
    shouldOfferNextWeekend({
      pageRange: WEEKEND,
      today: sunday,
      minutesOfDay: NEXT_WEEKEND_FROM_MINUTE - 1,
      stillOnCount: 1,
    }),
    false,
    "Sunday 5:59 PM with a show still on"
  );
  assert.equal(
    shouldOfferNextWeekend({
      pageRange: WEEKEND,
      today: saturday,
      minutesOfDay: 20 * 60,
      stillOnCount: 0,
    }),
    true,
    "Saturday night, nothing left in the window"
  );
  assert.equal(
    shouldOfferNextWeekend({
      pageRange: WEEKEND,
      today: saturday,
      minutesOfDay: 20 * 60,
      stillOnCount: 3,
    }),
    false,
    "Saturday night, Sunday shows still ahead"
  );
  assert.equal(
    shouldOfferNextWeekend({
      pageRange: WEEKEND,
      today: friday,
      minutesOfDay: 10 * 60,
      stillOnCount: 4,
    }),
    false
  );
  assert.equal(
    shouldOfferNextWeekend({
      pageRange: WEEKEND,
      today: monday,
      minutesOfDay: 10 * 60,
      stillOnCount: 5,
    }),
    false,
    "Monday already lists the upcoming weekend"
  );
  assert.equal(
    shouldOfferNextWeekend({
      pageRange: WEEKEND,
      today: monday,
      minutesOfDay: 30,
      stillOnCount: 0,
    }),
    true,
    "cached page still showing the weekend that just ended"
  );
});

test("handoff lead names wrapped-up vs still-on vs empty, with no em dash", () => {
  const wrapped = nextWeekendHandoffLead({
    stillOnCount: 0,
    listedCount: 4,
    todayIso: SUNDAY,
    pageRange: WEEKEND,
  });
  const still = nextWeekendHandoffLead({
    stillOnCount: 1,
    listedCount: 4,
    todayIso: SUNDAY,
    pageRange: WEEKEND,
  });
  const empty = nextWeekendHandoffLead({
    stillOnCount: 0,
    listedCount: 0,
    todayIso: "2026-10-01",
    pageRange: WEEKEND,
  });
  assert.match(wrapped, /wrapped up/);
  assert.match(still, /still on tonight/);
  assert.match(empty, /Nothing is listed this weekend yet/);
  for (const line of [wrapped, still, empty]) {
    assert.equal(line.includes("—"), false);
    assert.equal(line.includes("–"), false);
  }
});

test("list pages share the ended filter and the client island", () => {
  const temporal = readRepo("../../components/TemporalEventsView.tsx");
  const intent = readRepo("../../components/IntentPageView.tsx");
  const live = readRepo("../../components/LiveMusicView.tsx");
  const town = readRepo("../../app/towns/[slug]/page.tsx");
  const home = readRepo("../../components/EventList.tsx");

  for (const src of [temporal, intent, live]) {
    assert.match(src, /LiveEventDays/);
  }
  assert.match(temporal, /filterListableNow\(/);
  assert.match(temporal, /nextWeekendPath\(/);
  assert.match(intent, /filterListableNow\(/);
  assert.match(live, /selectLiveMusic\(/);
  assert.match(town, /filterListableNow\(/);
  assert.match(town, /dropEnded/);
  assert.match(town, /TownWeekendLive/);
  assert.match(home, /isListableNow\(/);
  // Hourly (or 30-min) ISR stays. The client island is what keeps a finished
  // event from sitting on the cached HTML for the rest of the hour.
  assert.match(readRepo("../../app/this-weekend/page.tsx"), /revalidate = 3600/);
  assert.match(readRepo("../../app/things-to-do/page.tsx"), /revalidate = 3600/);
});
