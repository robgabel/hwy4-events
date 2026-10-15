// The generated poster (and the event page og:image, which is that poster)
// must not invent "All day" when the row never stated a start. hwy4_events
// has no all-day column, so a null start is unknown. A series umbrella is a
// run of dated shows, not one door time.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { posterTimeLabel } from "../../lib/poster.js";
import { EVENT_COLUMNS } from "../../lib/events.js";

const here = dirname(fileURLToPath(import.meta.url));
const POSTER_ROUTE = join(here, "..", "..", "app", "events", "[slug]", "poster", "route.tsx");

test("posterTimeLabel keeps a stated start and end", () => {
  assert.equal(posterTimeLabel("19:00", "22:00", false), "7pm–10pm");
  assert.equal(posterTimeLabel("11:00:00", "14:30:00", false), "11am–2:30pm");
  assert.equal(posterTimeLabel("00:30", "12:00", false), "12:30am–12pm");
});

test("posterTimeLabel keeps a start-only row", () => {
  assert.equal(posterTimeLabel("18:00", null, false), "6pm");
  assert.equal(posterTimeLabel("09:05", undefined), "9:05am");
});

test("posterTimeLabel says Time TBA when the start is unknown", () => {
  assert.equal(posterTimeLabel(null, null, false), "Time TBA");
  assert.equal(posterTimeLabel(null, "17:00", false), "Time TBA");
  assert.equal(posterTimeLabel(undefined, undefined), "Time TBA");
  assert.equal(posterTimeLabel("", "", false), "Time TBA");
});

test("posterTimeLabel says See dates for a series umbrella", () => {
  assert.equal(posterTimeLabel(null, null, true), "See dates");
  // An umbrella is a run of shows, even if a seed left a clock on the row.
  assert.equal(posterTimeLabel("19:00", "22:00", true), "See dates");
});

test("the poster route renders posterTimeLabel and does not say All day", () => {
  const src = readFileSync(POSTER_ROUTE, "utf8");
  assert.match(src, /posterTimeLabel\(/);
  assert.doesNotMatch(src, /All day/);
});

test("slug lookup selects series_umbrella so an umbrella poster can say See dates", () => {
  assert.match(EVENT_COLUMNS, /\bseries_umbrella\b/);
});
