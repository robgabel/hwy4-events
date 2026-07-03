// Regression lock for the homepage curation modules (lib/picks.ts).
//
// The spotlight header says "this week", so it must only surface a pick that
// actually falls inside the window — a pick three weeks out in the spotlight
// slot is lying copy. The row is capped so curation stays curation.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectPicks,
  addDaysIso,
  MAX_PICK_CARDS,
} from "../../lib/picks.js";

const pick = (date: string, name = "x") => ({
  date,
  name,
  robs_pick: true,
  visibility: "public",
});

const TODAY = "2026-07-03";

test("spotlight = soonest pick inside the 7-day window; row excludes it", () => {
  const events = [pick("2026-07-04", "parade"), pick("2026-07-06"), pick("2026-07-20")];
  const { spotlight, picks } = selectPicks(events, TODAY);
  assert.equal(spotlight?.name, "parade");
  assert.equal(picks.length, 2);
  assert.ok(!picks.includes(spotlight!));
});

test("no pick inside the window: spotlight null, row leads with the soonest", () => {
  const events = [pick("2026-07-17", "festival umbrella"), pick("2026-08-01")];
  const { spotlight, picks } = selectPicks(events, TODAY);
  assert.equal(spotlight, null);
  assert.equal(picks[0].name, "festival umbrella");
});

test("row caps at MAX_PICK_CARDS", () => {
  const events = Array.from({ length: 9 }, (_, i) =>
    pick(addDaysIso(TODAY, i + 1), `p${i}`)
  );
  const { spotlight, picks } = selectPicks(events, TODAY);
  assert.ok(spotlight);
  assert.equal(picks.length, MAX_PICK_CARDS);
});

test("filters non-picks, private rows, and past dates", () => {
  const events = [
    { date: "2026-07-04", name: "not a pick", robs_pick: false, visibility: "public" },
    { date: "2026-07-04", name: "club night", robs_pick: true, visibility: "private" },
    { date: "2026-07-01", name: "already happened", robs_pick: true, visibility: "public" },
    pick("2026-07-05", "keeper"),
  ];
  const { spotlight, picks } = selectPicks(events, TODAY);
  assert.equal(spotlight?.name, "keeper");
  assert.equal(picks.length, 0);
});

test("today's pick counts as this week (boundary), and empty input is graceful", () => {
  const { spotlight } = selectPicks([pick(TODAY, "tonight")], TODAY);
  assert.equal(spotlight?.name, "tonight");
  const none = selectPicks([], TODAY);
  assert.equal(none.spotlight, null);
  assert.equal(none.picks.length, 0);
});

test("addDaysIso rolls months without timezone drift", () => {
  assert.equal(addDaysIso("2026-07-28", 7), "2026-08-04");
  assert.equal(addDaysIso("2026-12-30", 7), "2027-01-06");
});
