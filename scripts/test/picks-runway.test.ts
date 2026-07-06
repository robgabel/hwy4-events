// Regression lock for the Rob's Picks runway signal (lib/agent/picks-runway.ts).
//
// robs_pick is hand-curated only, so the chief-of-staff digest must warn Rob
// BEFORE the homepage picks module quietly goes empty, and the nudge must be
// deterministic (not dependent on the reasoner choosing to mention it).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePicksRunway,
  picksRunwayItem,
  ensurePicksRunwayItem,
  PICKS_RUNWAY_WARN_DAYS,
} from "../../lib/agent/picks-runway.js";
import { emptyDigest } from "../../lib/agent/types.js";
import type { FestivalGuide } from "../../lib/event-guides.js";

const TODAY = "2026-07-05";

const guide = (startDate: string, hideAfter: string): FestivalGuide => ({
  path: "/fest",
  title: "Fest",
  town: "Bear Valley",
  label: "Festival guide",
  heading: "h",
  blurb: "b",
  townSlug: "bear-valley",
  startDate,
  hideAfter,
  matchEvent: () => false,
});

test("runway = days to the last pick date when no guide is live", () => {
  const r = computePicksRunway(TODAY, 2, "2026-07-12", []);
  assert.equal(r.runway_days, 7);
  assert.equal(r.live_guide_until, null);
});

test("a live festival guide extends the runway past the last event pick", () => {
  // The real July shape: umbrella pick Jul 17, guide runs through Aug 2.
  const r = computePicksRunway(TODAY, 1, "2026-07-17", [guide("2026-07-17", "2026-08-02")]);
  assert.equal(r.runway_days, 28);
  assert.equal(r.live_guide_until, "2026-08-02");
});

test("an expired guide contributes nothing; no picks + no live guide = null (empty now)", () => {
  const r = computePicksRunway("2026-08-03", 0, null, [guide("2026-07-17", "2026-08-02")]);
  assert.equal(r.runway_days, null);
  assert.equal(r.live_guide_until, null);
});

test("a stale last-pick date (already past) does not fake runway", () => {
  const r = computePicksRunway(TODAY, 0, "2026-07-01", []);
  assert.equal(r.runway_days, null);
});

test("item: null when healthy, warns at the boundary, 'today' at zero, empty when gone", () => {
  assert.equal(picksRunwayItem(computePicksRunway(TODAY, 1, "2026-08-01", [])), null);
  const atBoundary = picksRunwayItem(
    computePicksRunway(TODAY, 1, "2026-07-05", []) // 0 days
  );
  assert.ok(atBoundary?.title.includes("runs dry today"));
  const warn = picksRunwayItem({
    upcoming_picks: 1,
    last_pick_date: "2026-07-10",
    live_guide_until: null,
    runway_days: PICKS_RUNWAY_WARN_DAYS,
  });
  assert.ok(warn && /runs dry in 7 days/.test(warn.title));
  const empty = picksRunwayItem({
    upcoming_picks: 0,
    last_pick_date: null,
    live_guide_until: null,
    runway_days: null,
  });
  assert.ok(empty?.title.includes("empty"));
});

test("ensurePicksRunwayItem appends to needs_you exactly when warranted", () => {
  const shortRunway = computePicksRunway(TODAY, 1, "2026-07-08", []);

  const digest = emptyDigest("quiet day");
  ensurePicksRunwayItem(digest, shortRunway);
  assert.equal(digest.needs_you.length, 1);
  assert.ok(/runs dry/.test(digest.needs_you[0].title));

  // Healthy runway: nothing appended.
  const healthy = emptyDigest("quiet day");
  ensurePicksRunwayItem(healthy, computePicksRunway(TODAY, 1, "2026-09-01", []));
  assert.equal(healthy.needs_you.length, 0);

  // The reasoner already covered it (any bucket): no duplicate.
  const covered = emptyDigest("quiet day");
  covered.fyi.push({ title: "Rob's Picks thinning out", detail: "flag one soon" });
  ensurePicksRunwayItem(covered, shortRunway);
  assert.equal(covered.needs_you.length, 0);
});
