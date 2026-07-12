// Regression lock for the evergreen Fourth of July guide pages
// (lib/holiday-pages.ts, PRD-july4-evergreen.md).
//
// Load-bearing: the year-less paths (the whole point is a URL that compounds
// equity annually), the July-window math (drives the self-filling event
// section AND the BrowseSimilar chip), and the fixed editorial copy's voice
// rules (no em dashes; every Q&A answer resolves the question).
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOLIDAY_GUIDES,
  julyWindow,
  holidayGuideForTown,
  holidayGuideForEvent,
} from "../../lib/holiday-pages.js";

function allStrings(guide: (typeof HOLIDAY_GUIDES)[number]): string[] {
  return [
    guide.h1,
    guide.lead,
    guide.metaTitle,
    guide.metaDescription,
    guide.heading,
    guide.blurb,
    guide.nextYear,
    ...guide.editorial,
    ...guide.qa.flatMap((item) => [item.q, item.a]),
  ];
}

test("guides are coherent: year-less paths, wired towns, enough copy", () => {
  assert.ok(HOLIDAY_GUIDES.length >= 2);
  const paths = new Set<string>();
  for (const g of HOLIDAY_GUIDES) {
    assert.ok(g.path.startsWith("/"), `${g.key} path`);
    // Year-less on purpose: a dated path can't inherit next year's searches.
    assert.ok(!/20\d\d/.test(g.path), `${g.key} path must not embed a year`);
    assert.ok(!paths.has(g.path), `${g.key} duplicate path`);
    paths.add(g.path);
    assert.ok(g.town.length > 0 && g.townSlug.length > 0, `${g.key} town`);
    assert.ok(g.editorial.length >= 2, `${g.key} editorial`);
    assert.ok(g.qa.length >= 3, `${g.key} qa`);
    assert.ok(g.nextYear.length > 40, `${g.key} nextYear block`);
  }
});

test("voice: no em dashes anywhere in the fixed copy", () => {
  for (const g of HOLIDAY_GUIDES) {
    for (const s of allStrings(g)) {
      assert.ok(!s.includes("—"), `em dash in ${g.key}: ${s.slice(0, 60)}`);
    }
  }
});

test("voice: Q&A answers are substantive (lift-able by answer engines)", () => {
  for (const g of HOLIDAY_GUIDES) {
    for (const item of g.qa) {
      assert.ok(item.q.endsWith("?"), `${g.key} question shape: ${item.q}`);
      assert.ok(item.a.length > 60, `${g.key} thin answer: ${item.q}`);
    }
  }
});

test("julyWindow: this year's window until it passes, then next year's", () => {
  // Well before the window
  assert.deepEqual(julyWindow("2026-03-01"), {
    start: "2026-07-01",
    end: "2026-07-06",
  });
  // Inside the window (mid-holiday-week the page still shows this year)
  assert.deepEqual(julyWindow("2026-07-04"), {
    start: "2026-07-01",
    end: "2026-07-06",
  });
  // Last day of the window still counts as this year
  assert.deepEqual(julyWindow("2026-07-06"), {
    start: "2026-07-01",
    end: "2026-07-06",
  });
  // The day after, the page looks ahead to next year
  assert.deepEqual(julyWindow("2026-07-07"), {
    start: "2027-07-01",
    end: "2027-07-06",
  });
  assert.deepEqual(julyWindow("2026-12-31"), {
    start: "2027-07-01",
    end: "2027-07-06",
  });
});

test("holidayGuideForTown: arnold + murphys wired, others null", () => {
  assert.equal(holidayGuideForTown("arnold")?.path, "/arnold-4th-of-july");
  assert.equal(holidayGuideForTown("murphys")?.path, "/murphys-4th-of-july");
  assert.equal(holidayGuideForTown("angels-camp"), null);
});

test("holidayGuideForEvent: town + July-window date, any year", () => {
  // In-window, matching town (2026 and a future year both match)
  assert.equal(
    holidayGuideForEvent({ town: "Arnold", date: "2026-07-04" })?.path,
    "/arnold-4th-of-july"
  );
  assert.equal(
    holidayGuideForEvent({ town: "Murphys", date: "2027-07-03" })?.path,
    "/murphys-4th-of-july"
  );
  // Window boundaries: Jul 1 and Jul 6 in, Jun 30 and Jul 7 out
  assert.ok(holidayGuideForEvent({ town: "Arnold", date: "2026-07-01" }));
  assert.ok(holidayGuideForEvent({ town: "Arnold", date: "2026-07-06" }));
  assert.equal(holidayGuideForEvent({ town: "Arnold", date: "2026-06-30" }), null);
  assert.equal(holidayGuideForEvent({ town: "Arnold", date: "2026-07-07" }), null);
  // Wrong town
  assert.equal(
    holidayGuideForEvent({ town: "Angels Camp", date: "2026-07-04" }),
    null
  );
});
