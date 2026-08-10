// Regression lock for URL-stated date/time recovery (scripts/lib/url-date.ts).
//
// The Wolf Jett bug, 2026-07-26: our Brice Station scraper wrote a row dated
// 2026-07-26 for an event whose own product URL says
// ".../products/wolf-jett-july-25-2026-7pm". The correct July 25 row already
// existed, so the site advertised a duplicate of a show that had already
// happened. The organizer had stated the date in a string they authored — the
// slug — and we ignored it in favor of the model's reading.
//
// Every case below is a real URL shape from the live catalog.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyUrlDate, dateFromUrl, timeFromUrl } from "../lib/url-date.js";

test("reads a month-name slug date (Shopify product permalinks)", () => {
  assert.equal(
    dateFromUrl("https://www.bricestation.com/products/wolf-jett-july-25-2026-7pm"),
    "2026-07-25"
  );
  assert.equal(
    dateFromUrl("https://www.bricestation.com/products/greg-sutton-and-friends-september-19-2026-6pm"),
    "2026-09-19"
  );
  assert.equal(
    dateFromUrl("https://arnoldrimtrail.org/event/volunteer-trail-workday-august-15-2026/"),
    "2026-08-15"
  );
  // Abbreviated months and ordinal days both appear in the wild.
  assert.equal(dateFromUrl("https://x.com/e/show-aug-1-2026"), "2026-08-01");
  assert.equal(dateFromUrl("https://x.com/e/show-july-4th-2026"), "2026-07-04");
});

test("reads an ISO date path segment (Tribe permalinks)", () => {
  assert.equal(
    dateFromUrl("https://visitmurphys.com/event/music-on-the-rooftop/2026-07-31/"),
    "2026-07-31"
  );
});

test("returns null when the URL states no date", () => {
  for (const u of [
    "https://www.gocalaveras.com/events/guided-sunset-hike-to-cougar-rock-arnold-rim-trail-4/",
    "https://www.bricestation.com/collections/events",
    "https://murphyswinebar.com/events/",
    // "4th of July 2026" is a NAME, not a month-day-year: must not parse.
    "https://x.com/e/arnold-4th-of-july-2026",
    // A bare year or season is not a date.
    "https://x.com/e/bear-valley-music-festival-2026",
    "https://x.com/e/summer-concert-series-2026",
    null,
    undefined,
    "",
  ]) {
    assert.equal(dateFromUrl(u), null, `should not parse a date from: ${String(u)}`);
  }
});

test("rejects a calendar-impossible date rather than coercing it", () => {
  assert.equal(dateFromUrl("https://x.com/e/show-february-31-2026"), null);
  assert.equal(dateFromUrl("https://x.com/e/show-june-31-2026"), null);
});

test("reads a slug time only when a meridiem is stated", () => {
  assert.equal(timeFromUrl("https://x.com/p/wolf-jett-july-25-2026-7pm"), "19:00");
  assert.equal(timeFromUrl("https://x.com/p/act-september-19-2026-6pm"), "18:00");
  assert.equal(timeFromUrl("https://x.com/p/brunch-may-3-2026-11am"), "11:00");
  assert.equal(timeFromUrl("https://x.com/p/show-6-30pm"), "18:30");
  assert.equal(timeFromUrl("https://x.com/p/noon-show-12pm"), "12:00");
  assert.equal(timeFromUrl("https://x.com/p/midnight-12am"), "00:00");
  // A bare number in a slug is far too ambiguous to trust.
  assert.equal(timeFromUrl("https://x.com/p/wolf-jett-july-25-2026"), null);
  assert.equal(timeFromUrl("https://x.com/p/suite-7"), null);
});

test("the Wolf Jett case: the URL's date overrides the extractor's", () => {
  const event = {
    name: "Wolf Jett",
    date: "2026-07-26", // what the LLM wrongly produced
    start_time: "19:00",
    event_url: "https://www.bricestation.com/products/wolf-jett-july-25-2026-7pm",
  };
  const r = applyUrlDate(event);
  assert.equal(event.date, "2026-07-25");
  assert.equal(r.correctedDate, true);
  assert.equal(r.fromDate, "2026-07-26");
  assert.equal(r.toDate, "2026-07-25");
  // 7pm was already right, so nothing to correct there.
  assert.equal(r.correctedTime, false);
  assert.equal(event.start_time, "19:00");
});

test("a correct extraction is left completely alone", () => {
  const event = {
    name: "Greg Sutton and Friends",
    date: "2026-09-19",
    start_time: "18:00",
    event_url: "https://www.bricestation.com/products/greg-sutton-and-friends-september-19-2026-6pm",
  };
  const r = applyUrlDate(event);
  assert.equal(r.correctedDate, false);
  assert.equal(r.correctedTime, false);
  assert.equal(event.date, "2026-09-19");
  assert.equal(event.start_time, "18:00");
});

test("a URL that states nothing can never change an event", () => {
  const event = {
    name: "Live Music @ The Lube Room",
    date: "2026-08-14",
    start_time: "19:00",
    event_url: "https://www.gocalaveras.com/events/live-music-the-lube-room-3/",
  };
  const r = applyUrlDate(event);
  assert.equal(r.correctedDate, false);
  assert.equal(r.correctedTime, false);
  assert.equal(event.date, "2026-08-14");
  assert.equal(event.start_time, "19:00");
  // Nor can a missing URL.
  const noUrl = { name: "x", date: "2026-08-14", start_time: null, event_url: null };
  assert.equal(applyUrlDate(noUrl).correctedDate, false);
  assert.equal(noUrl.date, "2026-08-14");
});

test("applyUrlDate defers to an extractor-authoritative date (2026-08-09 review finding)", () => {
  // The rescheduled-Wix-occurrence case: JSON-LD (live data) says Aug 19, the
  // slug (frozen at creation) says Aug 12. The extractor marked the date
  // authoritative, so the URL correction must be a no-op — otherwise the
  // stale slug date gets re-imposed on every nightly pass.
  const event = {
    name: "Open Mic Night",
    date: "2026-08-19",
    start_time: "18:00",
    event_url: "https://www.murphysirishpubca.com/event-details/open-mic-night-2026-08-12-18-00",
    date_authoritative: true,
  };
  const r = applyUrlDate(event);
  assert.equal(r.correctedDate, false);
  assert.equal(r.correctedTime, false);
  assert.equal(event.date, "2026-08-19");
  // Without the flag the same event IS corrected — the guard is the only gate.
  const unflagged = { ...event, date: "2026-08-19", date_authoritative: false };
  assert.equal(applyUrlDate(unflagged).correctedDate, true);
  assert.equal(unflagged.date, "2026-08-12");
});
