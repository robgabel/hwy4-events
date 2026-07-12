// Regression lock for the seasonal 301 registry (lib/seasonal-redirects.ts,
// PRD-july4-evergreen.md).
//
// Load-bearing: every entry targets a real evergreen guide path (a typo'd
// target would 301 indexed URLs into a 404, torching the equity this exists
// to save), and the past-date activation guard (a mistakenly-listed future
// slug must keep rendering its live event page, never black-hole it).
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEASONAL_REDIRECTS,
  seasonalRedirectFor,
} from "../../lib/seasonal-redirects.js";
import { HOLIDAY_GUIDES } from "../../lib/holiday-pages.js";

test("every entry targets a live guide path and carries a parseable date", () => {
  const guidePaths = new Set(HOLIDAY_GUIDES.map((g) => g.path));
  const seen = new Set<string>();
  for (const r of SEASONAL_REDIRECTS) {
    assert.ok(guidePaths.has(r.to), `${r.fromSlug} -> unknown target ${r.to}`);
    assert.ok(
      /\d{4}-\d{2}-\d{2}/.test(r.fromSlug),
      `${r.fromSlug} has no embedded date; the activation guard needs one`
    );
    assert.ok(!seen.has(r.fromSlug), `duplicate entry: ${r.fromSlug}`);
    seen.add(r.fromSlug);
  }
});

test("the 2026 July 4th pages redirect once the date is past", () => {
  assert.equal(
    seasonalRedirectFor(
      "arnold-independence-day-parade-2026-07-04-arnold",
      "2026-07-12"
    ),
    "/arnold-4th-of-july"
  );
  assert.equal(
    seasonalRedirectFor(
      "4th-of-july-celebration-at-the-murphys-historic-hotel-2026-07-04-murphys",
      "2026-07-12"
    ),
    "/murphys-4th-of-july"
  );
});

test("guard: never redirects a live page", () => {
  const slug = "arnold-independence-day-parade-2026-07-04-arnold";
  // Before the event
  assert.equal(seasonalRedirectFor(slug, "2026-07-01"), null);
  // The day OF the event (strictly-past rule: the page must work on the day)
  assert.equal(seasonalRedirectFor(slug, "2026-07-04"), null);
  // The day after, it fires
  assert.equal(seasonalRedirectFor(slug, "2026-07-05"), "/arnold-4th-of-july");
});

test("unknown slugs pass through untouched", () => {
  assert.equal(
    seasonalRedirectFor("murphys-4th-of-july-parade-2027-07-04-murphys", "2027-08-01"),
    null
  );
  assert.equal(seasonalRedirectFor("some-other-event-2026-01-01-arnold", "2026-07-12"), null);
});
