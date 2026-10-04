/**
 * Locks the pure parsing/mapping core of the shared Tribe (The Events Calendar)
 * client — the module both `visit-murphys` and `arnold-rim-trail` read through.
 *
 * `stripTitleDateSuffix` is the one with teeth: ART titles every occurrence of a
 * series with its own date, and over-stripping would silently rename real events.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchTribePage,
  htmlToText,
  joinAddress,
  normalizeCost,
  splitDateTime,
  stripTitleDateSuffix,
} from "../lib/tribe.js";

test("splitDateTime pulls an HH:MM time out of Tribe's datetime", () => {
  assert.deepEqual(splitDateTime("2026-07-25 18:15:00", false), {
    date: "2026-07-25",
    time: "18:15",
  });
});

test("splitDateTime returns a null time for all-day and midnight stamps", () => {
  // An all-day event has no meaningful clock time — never invent "00:00".
  assert.equal(splitDateTime("2026-07-25 00:00:00", true).time, null);
  // Tribe also writes midnight when the organizer set no time at all.
  assert.equal(splitDateTime("2026-07-25 00:00:00", false).time, null);
  assert.equal(splitDateTime("2026-07-25", false).time, null);
});

test("stripTitleDateSuffix removes an organizer's per-occurrence date suffix", () => {
  assert.equal(
    stripTitleDateSuffix("Guided Sunset Hike to Cougar Rock – July 25, 2026"),
    "Guided Sunset Hike to Cougar Rock"
  );
  // Hyphen and em dash, abbreviated months, and an ordinal day all appear in the wild.
  assert.equal(
    stripTitleDateSuffix("Volunteer Trail Workday - Aug. 15, 2026"),
    "Volunteer Trail Workday"
  );
  assert.equal(
    stripTitleDateSuffix("Volunteer Trail Workday — September 19th 2026"),
    "Volunteer Trail Workday"
  );
});

test("stripTitleDateSuffix leaves a title that merely ends in a name alone", () => {
  // The guard that matters: only a *trailing full date* is a suffix. A title
  // ending in a place, an act, or a year alone must survive untouched.
  for (const title of [
    "Guided Sunset Hike to Cougar Rock",
    "Ironstone Summer Concert Series: Lynyrd Skynyrd",
    "Bear Valley Music Festival 2026",
    "Live at The Lube: Poison Oakies",
    "4th of July Parade",
  ]) {
    assert.equal(stripTitleDateSuffix(title), title);
  }
});

test("stripTitleDateSuffix never strips a title down to nothing", () => {
  assert.equal(stripTitleDateSuffix("– July 25, 2026"), "– July 25, 2026");
});

test("normalizeCost dollar-signs a bare number and passes prose through", () => {
  assert.equal(normalizeCost("15"), "$15");
  assert.equal(normalizeCost("Free"), "Free");
  assert.equal(normalizeCost("Pay what you can"), "Pay what you can");
  assert.equal(normalizeCost(""), null);
  assert.equal(normalizeCost(null), null);
});

test("joinAddress builds a street address, falling back to city/state", () => {
  assert.equal(
    joinAddress({
      venue: "ART Trailhead",
      address: "Valley View Dr & Forest Rte 5N95Y",
      city: "Arnold",
      state: "CA",
      zip: "95223",
    }),
    "Valley View Dr & Forest Rte 5N95Y, Arnold, CA 95223"
  );
  assert.equal(joinAddress({ venue: "Somewhere", city: "Arnold" }), "Arnold, CA");
  assert.equal(joinAddress({ venue: "Somewhere" }), null);
  assert.equal(joinAddress(undefined), null);
});

test("htmlToText strips markup and decodes entities", () => {
  assert.equal(
    htmlToText("<p>Watch the sunset &amp; hike&nbsp;up.</p><p>It&#8217;s special!</p>"),
    "Watch the sunset & hike up.\n\nIt’s special!"
  );
});

// 2026-09-28: visitmurphys.com timed out from the runner. The plain fetch
// threw, the throw skipped the Firecrawl fallback, and the whole Visit Murphys
// scrape died. With no FIRECRAWL_API_KEY the fallback's own refusal is the
// proof the fallback was reached instead of the raw TypeError escaping.
test("fetchTribePage falls back to Firecrawl when the plain fetch gets no answer", async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.FIRECRAWL_API_KEY;
  const { warn } = console;
  delete process.env.FIRECRAWL_API_KEY;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
  }) as typeof fetch;
  console.warn = () => {};
  try {
    await assert.rejects(
      fetchTribePage("https://visitmurphys.com/wp-json/tribe/events/v1/events?page=1", 1),
      /no fallback available/
    );
  } finally {
    globalThis.fetch = realFetch;
    console.warn = warn;
    if (realKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = realKey;
  }
});
