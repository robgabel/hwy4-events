// Regression lock for the Sequoia Woods timezone bug (2026-07-12).
//
// The Duda calendar widget's `data-day-events` blobs serialize event times in
// US EASTERN, 3 hours ahead of the venue's Pacific reality; the widget's
// client JS converts for display but the raw attribute does not. The scraper
// decodes the attribute directly, so it recorded every timed event 3 hours
// late (the Groovy Judy patio party showed 10pm instead of 7pm — the blob's
// own description said "*7-10pm Live Music" while its start said "10pm").
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseClockTime,
  shiftClock,
  mapRawEvent,
  SOURCE_TZ_OFFSET_HOURS,
  type RawDayEvent,
} from "../lib/sequoia-woods-map.js";

test("parseClockTime handles the widget's clock formats", () => {
  assert.equal(parseClockTime("10pm"), "22:00");
  assert.equal(parseClockTime("9:30pm"), "21:30");
  assert.equal(parseClockTime("12am"), "00:00");
  assert.equal(parseClockTime("7:30am"), "07:30");
  assert.equal(parseClockTime(""), null);
  assert.equal(parseClockTime(undefined), null);
});

test("shiftClock moves Eastern to Pacific, wrapping across midnight", () => {
  assert.deepEqual(shiftClock("22:00", SOURCE_TZ_OFFSET_HOURS), {
    time: "19:00",
    dayDelta: 0,
  });
  assert.deepEqual(shiftClock("21:30", SOURCE_TZ_OFFSET_HOURS), {
    time: "18:30",
    dayDelta: 0,
  });
  // An Eastern 1am end is the same Pacific evening, 10pm.
  assert.deepEqual(shiftClock("01:00", SOURCE_TZ_OFFSET_HOURS), {
    time: "22:00",
    dayDelta: -1,
  });
});

test("the Groovy Judy patio party lands at 7pm-10pm Pacific, not 10pm-1am", () => {
  const raw: RawDayEvent = {
    date: "2026-07-25",
    summary: "Patio Party #3 featuring live music by Groovy Judy",
    start: "10pm",
    end: "1am",
    isAllDayEvent: false,
  };
  const mapped = mapRawEvent(raw);
  assert.ok(mapped);
  assert.equal(mapped.event.start_time, "19:00");
  assert.equal(mapped.event.end_time, "22:00");
  assert.equal(mapped.event.date, "2026-07-25"); // start didn't cross midnight
  assert.equal(mapped.visibility, "public");
  assert.equal(
    mapped.event.source_event_id,
    "sequoia-woods|2026-07-25|patio-party-3-featuring-live-music-by-groovy-judy"
  );
});

test("a start that rolls back across midnight moves the event to the prior Pacific date", () => {
  const raw: RawDayEvent = {
    date: "2026-08-01",
    summary: "Late Night Music",
    start: "1am", // Eastern -> 10pm Pacific the prior evening
    end: "3am",
    isAllDayEvent: false,
  };
  const mapped = mapRawEvent(raw);
  assert.ok(mapped);
  assert.equal(mapped.event.date, "2026-07-31");
  assert.equal(mapped.event.start_time, "22:00");
  assert.equal(mapped.event.end_time, "00:00");
});

test("all-day entries keep null times and member/private tagging still works", () => {
  const allDay = mapRawEvent({
    date: "2026-07-25",
    summary: "SWCC Men's Invitational (day 2) - Member Event",
    start: "12am",
    end: "12am",
    isAllDayEvent: true,
  });
  assert.ok(allDay);
  assert.equal(allDay.event.start_time, null);
  assert.equal(allDay.event.end_time, null);
  assert.equal(allDay.event.name, "SWCC Men's Invitational (day 2)");
  assert.equal(allDay.visibility, "private");

  const rental = mapRawEvent({
    date: "2026-07-25",
    summary: "Private Event - Wedding",
    start: "5pm",
    end: "11pm",
    isAllDayEvent: false,
  });
  assert.equal(rental, null);
});
