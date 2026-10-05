// Regression lock for lib/briefing-picks.ts (issue #356): the daily briefing,
// weekend briefing and newsletter see the same Rob's Picks the homepage would
// show for their window, under the homepage's own rule (eligiblePickEntries).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectBriefingPicks,
  pickTag,
  formatPicksSection,
  missingPicks,
  ROB_PICKS_RULE,
  type BriefingPickRow,
} from "../../lib/briefing-picks.js";
import { selectPicks } from "../../lib/picks.js";
import { generateEventSlug } from "../../lib/slugs.js";
import { SITE_URL } from "../../lib/constants.js";
import type { FestivalGuide } from "../../lib/event-guides.js";

const TODAY = "2026-10-05";

// Same absolute-minutes scheme as lib/event-time.ts (see picks.test.ts).
function at(time24: string, dateStr = TODAY): number {
  const [h, m] = time24.split(":").map(Number);
  const [y, mo, d] = dateStr.split("-").map(Number);
  return y * 525960 + (mo - 1) * 43830 + d * 1440 + h * 60 + m;
}
const MORNING = at("08:00");

const row = (over: Partial<BriefingPickRow> = {}): BriefingPickRow => ({
  name: "Harvest Fest",
  date: "2026-10-10",
  town: "Murphys",
  venue_name: "Murphys Community Park",
  start_time: "11:00",
  end_time: "16:00",
  robs_pick: true,
  visibility: "public",
  pick_reason: null,
  ...over,
});

const guide = (over: Partial<FestivalGuide> = {}): FestivalGuide => ({
  path: "/fest-2026",
  title: "Fest 2026",
  town: "Bear Valley",
  label: "Festival guide",
  heading: "h",
  blurb: "b",
  townSlug: "bear-valley",
  startDate: "2026-10-09",
  hideAfter: "2026-10-18",
  matchEvent: (e) => e.venue_key === "big-white-tent",
  ...over,
});

const win = (over: Partial<Parameters<typeof selectBriefingPicks>[1]> = {}) => ({
  todayIso: TODAY,
  nowMinutes: MORNING,
  windowStart: TODAY,
  windowEnd: "2026-10-12",
  guides: [] as FestivalGuide[],
  ...over,
});

test("an in-window pick carries its reason and its own event URL", () => {
  const { inWindow } = selectBriefingPicks(
    [row({ pick_reason: "  best apple cider on the 4  " })],
    win()
  );
  assert.equal(inWindow.length, 1);
  const p = inWindow[0];
  const slug = generateEventSlug("Harvest Fest", "2026-10-10", "Murphys");
  assert.equal(p.reason, "best apple cider on the 4");
  assert.equal(p.path, `/events/${slug}`);
  assert.equal(p.url, `${SITE_URL}/events/${slug}`);
});

test("window edges are inclusive and nothing outside them is in window", () => {
  const rows = [
    row({ name: "Start", date: TODAY, start_time: "18:00", end_time: "20:00" }),
    row({ name: "End", date: "2026-10-12" }),
    row({ name: "After", date: "2026-10-13" }),
  ];
  const { inWindow, lookahead } = selectBriefingPicks(rows, win());
  assert.deepEqual(inWindow.map((p) => p.title), ["Start", "End"]);
  assert.deepEqual(lookahead, [], "no lookahead unless asked for");
});

test("sold-out, ended, members-only and unpicked rows are never picks", () => {
  const rows = [
    row({ name: "Sold", sold_out: true }),
    row({ name: "Over", date: TODAY, start_time: "06:00", end_time: "07:00" }),
    row({ name: "Members", visibility: "private" }),
    row({ name: "Plain", robs_pick: false }),
    row({ name: "Good" }),
  ];
  const { inWindow } = selectBriefingPicks(rows, win());
  assert.deepEqual(inWindow.map((p) => p.title), ["Good"]);
});

test("the briefing pick set matches what the homepage would show", () => {
  const rows = [
    row({ name: "A", date: "2026-10-06" }),
    row({ name: "B", date: "2026-10-07", sold_out: true }),
    row({ name: "C", date: "2026-10-08" }),
  ];
  const home = selectPicks(rows, TODAY, MORNING, []);
  const homeTitles = [home.spotlight, ...home.picks]
    .filter(Boolean)
    .map((e) => (e!.kind === "event" ? e!.event.name : e!.guide.title));
  const { inWindow } = selectBriefingPicks(rows, win());
  assert.deepEqual(inWindow.map((p) => p.title), homeTitles);
});

test("a festival guide absorbs its nightly pick and links to the guide page", () => {
  const rows = [
    row({ name: "Night One", venue_key: "big-white-tent", town: "Bear Valley" }),
  ];
  const { inWindow } = selectBriefingPicks(rows, win({ guides: [guide()] }));
  assert.equal(inWindow.length, 1);
  assert.equal(inWindow[0].kind, "guide");
  assert.equal(inWindow[0].path, "/fest-2026");
  assert.equal(inWindow[0].url, `${SITE_URL}/fest-2026`);
  assert.equal(inWindow[0].endDate, "2026-10-18");
  assert.equal(pickTag(rows[0], inWindow), "", "the absorbed night is not tagged");
});

test("a festival overlapping the window counts even when it opened earlier", () => {
  const g = guide({ startDate: "2026-10-01", hideAfter: "2026-10-11" });
  const { inWindow } = selectBriefingPicks([], win({ windowStart: "2026-10-09" }));
  assert.equal(inWindow.length, 0);
  const withGuide = selectBriefingPicks(
    [],
    win({ windowStart: "2026-10-09", guides: [g] })
  );
  assert.equal(withGuide.inWindow.length, 1);
});

test("lookahead is capped, bounded, and never repeats an in-window pick", () => {
  const rows = [
    row({ name: "In", date: "2026-10-11" }),
    row({ name: "Soon", date: "2026-10-15" }),
    row({ name: "Later", date: "2026-10-20" }),
    row({ name: "TooFar", date: "2026-10-30" }),
  ];
  const { inWindow, lookahead } = selectBriefingPicks(
    rows,
    win({ lookaheadDays: 14, maxLookahead: 1 })
  );
  assert.deepEqual(inWindow.map((p) => p.title), ["In"]);
  assert.deepEqual(lookahead.map((p) => p.title), ["Soon"]);

  const wider = selectBriefingPicks(rows, win({ lookaheadDays: 14 }));
  assert.deepEqual(wider.lookahead.map((p) => p.title), ["Soon", "Later"]);
});

test("a festival opening after the window is a lookahead entry", () => {
  const g = guide({ startDate: "2026-10-20", hideAfter: "2026-10-25" });
  const { inWindow, lookahead } = selectBriefingPicks(
    [],
    win({ guides: [g], lookaheadDays: 14 })
  );
  assert.equal(inWindow.length, 0);
  assert.equal(lookahead[0]?.kind, "guide");
});

test("pickTag tags only in-window picks, with or without a reason", () => {
  const withReason = row({ name: "Why", pick_reason: "Rob's favorite" });
  const bare = row({ name: "Bare" });
  const sold = row({ name: "Sold", sold_out: true });
  const { inWindow } = selectBriefingPicks([withReason, bare, sold], win());
  assert.equal(pickTag(withReason, inWindow), "[ROB'S PICK: Rob's favorite]");
  assert.equal(pickTag(bare, inWindow), "[ROB'S PICK]");
  assert.equal(pickTag(sold, inWindow), "");
  assert.equal(pickTag(row({ name: "Never" }), inWindow), "");
});

test("formatPicksSection is empty with no picks and lists both groups otherwise", () => {
  assert.equal(formatPicksSection([], []), "");
  const { inWindow, lookahead } = selectBriefingPicks(
    [row({ pick_reason: "cider" }), row({ name: "Next", date: "2026-10-15" })],
    win({ lookaheadDays: 14 })
  );
  const s = formatPicksSection(inWindow, lookahead);
  assert.match(s, /ROB'S PICKS \(hand-picked by Rob/);
  assert.match(s, /Reason: cider/);
  assert.match(s, /UPCOMING ROB'S PICKS/);
  assert.match(s, new RegExp(`URL: ${SITE_URL.replace(/[.]/g, "\\.")}/events/`));
});

test("missingPicks finds unlinked picks, absolute or relative, with query strings", () => {
  const { inWindow } = selectBriefingPicks(
    [row(), row({ name: "Other", date: "2026-10-11" })],
    win({ guides: [guide()] })
  );
  const [fest, harvest, other] = inWindow;
  assert.equal(fest.kind, "guide");
  const text =
    `Go to [the fest](${fest.path}) and [Harvest Fest](${harvest.url}?utm_source=x). ` +
    `Other gets a mention but no link.`;
  assert.deepEqual(
    missingPicks(text, inWindow).map((p) => p.title),
    [other.title]
  );
  // A longer slug sharing the prefix is not a link to this pick.
  const near = `[x](${harvest.path}-2)`;
  assert.equal(missingPicks(near, [harvest]).length, 1);
});

test("the shared prompt rule has no em dashes", () => {
  assert.ok(!ROB_PICKS_RULE.includes("\u2014"));
  assert.ok(!formatPicksSection(selectBriefingPicks([row()], win()).inWindow).includes("\u2014"));
});

test("a lookahead pick's link survives repair when its row is in the repair set", async () => {
  // QA finding on #357: the generators repaired against in-window rows only,
  // so a correctly copied mark-your-calendar URL was unlinked.
  const { repairEventLinks } = await import("../../lib/briefing-links.js");
  const inWindow = [row({ robs_pick: false })];
  const later = row({ name: "Harvest Gala", date: "2026-10-17", town: "Arnold" });
  const { lookahead } = selectBriefingPicks([...inWindow, later], win({ lookaheadDays: 14 }));
  const text = `Mark your calendar: [Harvest Gala](${lookahead[0].url}).`;

  assert.equal(
    repairEventLinks(text, inWindow).unlinked.length,
    1,
    "without the lookahead row the repair unlinks a correct URL"
  );
  const fixed = repairEventLinks(text, [...inWindow, later]);
  assert.equal(fixed.unlinked.length, 0);
  assert.equal(fixed.text, text);
});
