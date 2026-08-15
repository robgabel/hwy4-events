// Regression lock for lib/briefing-links.ts (repairEventLinks).
//
// The three cases here are the real 2026-08-15 briefing: Opus was handed the
// correct URL for every event and still emitted three dead links — two minted
// from its own prose rename (Kane Brown, Brice Station) and one resurrecting a
// slug that died in the 2026-08-11 rename-merge (shrimp feed). The repair pass
// must map each to the event it plainly meant, never guess when two events
// tie, and leave every legitimate link byte-identical.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  repairEventLinks,
  type LinkableEvent,
} from "../../lib/briefing-links.js";
import { generateEventSlug } from "../../lib/slugs.js";

const SITE = "https://hwy4events.com";

const ev = (
  name: string,
  date: string,
  town: string,
  extra: Partial<LinkableEvent> = {}
): LinkableEvent => ({ name, date, town, ...extra });

// The real 2026-08-15/16 field (abridged): every event Opus could link.
const kaneBrown = ev("Ironstone Summer Concert Series", "2026-08-16", "Murphys", {
  venue_name: "Ironstone Vineyards",
  artists: ["Kane Brown"],
});
const mimosa = ev("Mimosa Sundays at Ironstone Vineyards", "2026-08-16", "Murphys", {
  venue_name: "Ironstone Vineyards",
});
const shrimpFeed = ev("Annual Shrimp & Pasta Feed Fundraiser", "2026-08-15", "Murphys", {
  venue_name: "Murphys Community Park",
});
const deepThicket = ev("Deep Thicket Dwellers", "2026-08-15", "Murphys", {
  venue_name: "Brice Station Vineyards",
  artists: ["Deep Thicket Dwellers"],
});
const irishPub = ev("Live Music @ Murphys Irish Pub", "2026-08-15", "Murphys", {
  venue_name: "Murphys Irish Pub",
});
const farmersMarket = ev("Murphys Park Farmers Market", "2026-08-16", "Murphys", {
  venue_name: "Murphys Community Park",
});
const FIELD = [kaneBrown, mimosa, shrimpFeed, deepThicket, irishPub, farmersMarket];

const slugOf = (e: LinkableEvent) => generateEventSlug(e.name, e.date, e.town);

test("real case: artist-first mint repairs to the series row (Kane Brown)", () => {
  const text = `Tomorrow's headliner is [Kane Brown at Ironstone](${SITE}/events/kane-brown-murphys-2026-08-16-murphys) at 7.`;
  const { text: out, repaired, unlinked } = repairEventLinks(text, FIELD);
  assert.equal(unlinked.length, 0);
  assert.equal(repaired.length, 1);
  assert.equal(
    out,
    `Tomorrow's headliner is [Kane Brown at Ironstone](${SITE}/events/${slugOf(kaneBrown)}) at 7.`
  );
});

test("real case: mint disambiguates against a same-venue sibling (Mimosa Sundays)", () => {
  // Both Aug-16 Ironstone events share the "ironstone" token; the artist
  // tokens must make the concert row the clear winner.
  const text = `[Kane Brown at Ironstone](${SITE}/events/kane-brown-murphys-2026-08-16-murphys)`;
  const { repaired } = repairEventLinks(text, FIELD);
  assert.equal(repaired[0]?.to, `${SITE}/events/${slugOf(kaneBrown)}`);
});

test("real case: rename-rotted slug repairs to the surviving title (shrimp feed)", () => {
  // rotarys-annual-shrimp-feed-auction was this row's real slug until the
  // 2026-08-11 merge kept the other title.
  const text = `the [Rotary Shrimp Feed & Auction](${SITE}/events/rotarys-annual-shrimp-feed-auction-2026-08-15-murphys) at Murphys Park at 4 ($60)`;
  const { text: out, repaired } = repairEventLinks(text, FIELD);
  assert.equal(repaired.length, 1);
  assert.ok(out.includes(`${SITE}/events/${slugOf(shrimpFeed)}`));
});

test("real case: venue-shaped mint repairs via venue tokens (Brice Station)", () => {
  const text = `[Deep Thicket Dwellers at Brice Station](${SITE}/events/live-music-brice-station-vineyards-2026-08-15-murphys) at 7`;
  const { text: out, repaired } = repairEventLinks(text, FIELD);
  assert.equal(repaired.length, 1);
  assert.ok(out.includes(`${SITE}/events/${slugOf(deepThicket)}`));
});

test("a canonical link is byte-identical through the pass", () => {
  const text = `[Farmers Market](${SITE}/events/${slugOf(farmersMarket)}) at 9, plus prose.`;
  const { text: out, repaired, unlinked } = repairEventLinks(text, FIELD);
  assert.equal(out, text);
  assert.equal(repaired.length, 0);
  assert.equal(unlinked.length, 0);
});

test("external and non-event internal links are never touched", () => {
  const text =
    `[GoCalaveras](https://gocalaveras.com/events/some-thing-2026-08-15-murphys) and ` +
    `[this weekend](${SITE}/this-weekend) and [submit](/submit)`;
  const { text: out, repaired, unlinked } = repairEventLinks(text, FIELD);
  assert.equal(out, text);
  assert.equal(repaired.length + unlinked.length, 0);
});

test("an unmatchable slug unlinks to plain text (a mention beats a 404)", () => {
  const text = `Catch [Yoga in the Meadow](${SITE}/events/yoga-in-the-meadow-2026-08-15-arnold) at 8.`;
  const { text: out, unlinked } = repairEventLinks(text, FIELD);
  assert.equal(out, "Catch Yoga in the Meadow at 8.");
  assert.equal(unlinked.length, 1);
});

test("two same-date candidates that tie stay unlinked (never guess)", () => {
  const a = ev("Junior Rangers @ Big Trees State Park", "2026-08-15", "Arnold", {
    venue_name: "Calaveras Big Trees State Park",
  });
  const b = ev("Meadow Walk @ Big Trees State Park", "2026-08-15", "Arnold", {
    venue_name: "Calaveras Big Trees State Park",
  });
  // Venue-only slug: both park programs match it equally.
  const text = `[Big Trees program](${SITE}/events/big-trees-state-park-2026-08-15-arnold)`;
  const { text: out, unlinked } = repairEventLinks(text, [a, b]);
  assert.equal(out, "Big Trees program");
  assert.equal(unlinked.length, 1);
});

test("a members-only event is never a repair target", () => {
  const club = ev("Trivia Night", "2026-08-15", "Arnold", {
    venue_name: "Blue Lake Springs Clubhouse",
    artists: null,
    visibility: "private",
  });
  const text = `[Trivia Night at the clubhouse](${SITE}/events/trivia-night-clubhouse-2026-08-15-arnold)`;
  const { text: out, repaired, unlinked } = repairEventLinks(text, [club]);
  assert.equal(repaired.length, 0);
  assert.equal(unlinked.length, 1);
  assert.equal(out, "Trivia Night at the clubhouse");
});

test("a members-only event's own canonical slug still passes untouched", () => {
  const club = ev("Trivia Night", "2026-08-15", "Arnold", { visibility: "private" });
  const text = `[Trivia](${SITE}/events/${slugOf(club)})`;
  const { text: out } = repairEventLinks(text, [club]);
  assert.equal(out, text);
});

test("relative /events/ links repair to relative URLs", () => {
  const text = `[Kane Brown](/events/kane-brown-murphys-2026-08-16-murphys)`;
  const { text: out } = repairEventLinks(text, FIELD);
  assert.equal(out, `[Kane Brown](/events/${slugOf(kaneBrown)})`);
});

test("activeRange: out-of-window slugs are left alone (stored-text safety)", () => {
  // Yesterday's link in a stored weekend briefing: the feed no longer covers
  // the date, so the render pass must not judge (or unlink) it.
  const text = `[Friday's show](${SITE}/events/some-old-show-2026-08-14-murphys)`;
  const { text: out, unlinked } = repairEventLinks(text, FIELD, {
    activeRange: { start: "2026-08-15", end: "2026-10-14" },
  });
  assert.equal(out, text);
  assert.equal(unlinked.length, 0);
});

test("activeRange: in-window broken slugs still repair", () => {
  const text = `[Kane Brown at Ironstone](${SITE}/events/kane-brown-murphys-2026-08-16-murphys)`;
  const { repaired } = repairEventLinks(text, FIELD, {
    activeRange: { start: "2026-08-15", end: "2026-10-14" },
  });
  assert.equal(repaired[0]?.to, `${SITE}/events/${slugOf(kaneBrown)}`);
});

test("a dateless event URL unlinks at generation time, survives render time", () => {
  const text = `[mystery](${SITE}/events/some-undated-slug)`;
  assert.equal(repairEventLinks(text, FIELD).text, "mystery");
  assert.equal(
    repairEventLinks(text, FIELD, {
      activeRange: { start: "2026-08-15", end: "2026-10-14" },
    }).text,
    text
  );
});

test("multiple links in one text each get the right treatment", () => {
  const text =
    `[Kane Brown at Ironstone](${SITE}/events/kane-brown-murphys-2026-08-16-murphys), ` +
    `[Farmers Market](${SITE}/events/${slugOf(farmersMarket)}), and ` +
    `[Ghost Event](${SITE}/events/ghost-event-2026-08-16-murphys).`;
  const { text: out, repaired, unlinked } = repairEventLinks(text, FIELD);
  assert.ok(out.includes(`[Kane Brown at Ironstone](${SITE}/events/${slugOf(kaneBrown)})`));
  assert.ok(out.includes(`[Farmers Market](${SITE}/events/${slugOf(farmersMarket)})`));
  assert.ok(out.includes("and Ghost Event."));
  assert.equal(repaired.length, 1);
  assert.equal(unlinked.length, 1);
});

test("query/hash suffixes on an event link survive a repair", () => {
  const text = `[Kane Brown](${SITE}/events/kane-brown-murphys-2026-08-16-murphys?src=briefing)`;
  const { text: out } = repairEventLinks(text, FIELD);
  assert.equal(out, `[Kane Brown](${SITE}/events/${slugOf(kaneBrown)}?src=briefing)`);
});

test("empty inputs are safe no-ops", () => {
  assert.equal(repairEventLinks("", FIELD).text, "");
  const text = `[Kane Brown](${SITE}/events/kane-brown-murphys-2026-08-16-murphys)`;
  // No events supplied: nothing can be validated against, so the link unlinks
  // at generation time (the prompt had no events, so no link is legitimate).
  assert.equal(repairEventLinks(text, []).text, "Kane Brown");
});
