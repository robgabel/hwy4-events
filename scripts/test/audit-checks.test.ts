// Locks lib/audit-checks.ts — the data-plausibility checks the daily
// /api/check-events audit runs (added after the 2026-07-16 persona QA passes).
// Each test reproduces the real-world shape that motivated the check.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findImpossibleTimes,
  findCategoryInconsistencies,
  findTimelessNearDupes,
  findSuspectTicketLinks,
  type AuditRow,
} from "../../lib/audit-checks.js";

let seq = 0;
const row = (partial: Partial<AuditRow>): AuditRow => ({
  id: `id-${++seq}`,
  name: "Test Event",
  date: "2026-08-08",
  start_time: "19:00",
  end_time: "22:00",
  venue_name: "Test Venue",
  category: "live_music",
  description: null,
  status: "confirmed",
  ...partial,
});

// ---------- findImpossibleTimes ----------

test("impossible times: zero-length, end-before-start, small-hours start", () => {
  const rows = [
    // The Jazz Cellars shape.
    row({ name: "Live Music @ The Jazz Cellars", start_time: "01:00", end_time: "01:00" }),
    // The BVMF shape (end before start, not overnight).
    row({ name: "Bear Valley Music Festival", start_time: "19:00", end_time: "14:00" }),
    // Lone small-hours start with no end.
    row({ name: "Mystery Row", start_time: "02:30", end_time: null }),
    // Fine: normal window.
    row({ start_time: "17:00", end_time: "19:00" }),
    // Fine: genuine overnight (ends by ~3 AM).
    row({ name: "Karaoke", start_time: "21:00", end_time: "00:00" }),
    // Fine: midnight NYE start is excluded from the small-hours flag.
    row({ name: "NYE Countdown", start_time: "00:00", end_time: null }),
    // Cancelled rows are skipped.
    row({ start_time: "01:00", end_time: "01:00", status: "cancelled" }),
  ];
  const found = findImpossibleTimes(rows);
  assert.deepEqual(
    found.map((f) => [f.name, f.reason]),
    [
      ["Live Music @ The Jazz Cellars", "zero_length"],
      ["Bear Valley Music Festival", "end_before_start"],
      ["Mystery Row", "small_hours_start"],
    ]
  );
});

// ---------- findCategoryInconsistencies ----------

test("category inconsistency: one production, several categories", () => {
  // The "What the Constitution Means to Me" shape: same title+venue rows
  // carrying kids AND fine_arts across the run.
  const rows = [
    row({ name: "What the Constitution Means to Me", date: "2026-08-07", venue_name: "Murphys Creek Theatre", category: "kids" }),
    row({ name: "What the Constitution Means to Me", date: "2026-08-14", venue_name: "Murphys Creek Theatre", category: "kids" }),
    row({ name: "What the Constitution Means to Me", date: "2026-08-21", venue_name: "Murphys Creek Theatre", category: "fine_arts" }),
  ];
  const found = findCategoryInconsistencies(rows);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].categories, ["fine_arts", "kids"]);
  assert.equal(found[0].count, 3);
});

test("category inconsistency: consistent series and single rows stay quiet", () => {
  const rows = [
    row({ name: "Trivia Night", date: "2026-08-06", venue_name: "The Pub", category: "games" }),
    row({ name: "Trivia Night", date: "2026-08-13", venue_name: "The Pub", category: "games" }),
    // Same title at a DIFFERENT venue with another category — different thing,
    // not an inconsistency within a series.
    row({ name: "Trivia Night", date: "2026-08-13", venue_name: "Other Bar", category: "wine" }),
    row({ name: "One-Off", category: "civic" }),
  ];
  assert.equal(findCategoryInconsistencies(rows).length, 0);
});

// ---------- findTimelessNearDupes ----------

test("timeless near-dupes: the Kane Brown shape (act named in the umbrella's description)", () => {
  const rows = [
    row({
      name: "Ironstone Summer Concert Series",
      date: "2026-08-16",
      venue_name: "Ironstone Vineyards",
      start_time: "19:00",
      description: "Kane Brown is primarily a contemporary country artist known for his genre-bending style.",
    }),
    row({
      name: "Kane Brown - The High Road Tour",
      date: "2026-08-16",
      venue_name: "Ironstone Vineyards",
      start_time: null,
      end_time: null,
    }),
  ];
  const found = findTimelessNearDupes(rows);
  assert.equal(found.length, 1);
  assert.equal(found[0].venue_name, "Ironstone Vineyards");
  assert.equal(found[0].ids.length, 2);
});

test("timeless near-dupes: the Moose 'District 8' shape (shared title tokens, all timeless)", () => {
  const rows = [
    row({ name: "District 8 Meetings and Backyard BBQ", date: "2026-07-19", venue_name: "Ebbetts Pass Moose Lodge", start_time: null, end_time: null }),
    row({ name: "District 8 Annual Picnic and Backyard BBQ", date: "2026-07-19", venue_name: "Ebbetts Pass Moose Lodge", start_time: null, end_time: null }),
    row({ name: "District 8 and Hesperian Moose Legion Meetings", date: "2026-07-19", venue_name: "Ebbetts Pass Moose Lodge", start_time: null, end_time: null }),
  ];
  const found = findTimelessNearDupes(rows);
  assert.equal(found.length, 1);
  assert.equal(found[0].ids.length, 3);
});

test("timeless near-dupes: unrelated events sharing a venue+day stay quiet", () => {
  const rows = [
    // A timeless private dinner + a timed blood drive at the lodge: no shared
    // tokens, no cross-description mention — not a dupe.
    row({ name: "Private Dinner Party", date: "2026-07-18", venue_name: "Ebbetts Pass Moose Lodge", start_time: null, end_time: null }),
    row({
      name: "Red Cross Blood Drive at Ebbetts Pass Moose Lodge",
      date: "2026-07-18",
      venue_name: "Ebbetts Pass Moose Lodge",
      start_time: "10:00",
      end_time: "15:00",
      description: "Give blood with the American Red Cross.",
    }),
    // Both timed → not this check's business (the identity matcher owns it).
    row({ name: "Show A", date: "2026-07-18", venue_name: "Big Venue", start_time: "18:00" }),
    row({ name: "Show A Extra", date: "2026-07-18", venue_name: "Big Venue", start_time: "21:00" }),
  ];
  assert.equal(findTimelessNearDupes(rows).length, 0);
});

// ---------- findSuspectTicketLinks (HWY-11) ----------

const linkRow = (id: string, description: string) => ({
  id,
  name: `Show ${id}`,
  date: "2026-08-16",
  start_time: "19:00",
  end_time: null,
  venue_name: "Ironstone Vineyards",
  category: "live_music",
  description,
  status: "confirmed",
});

test("findSuspectTicketLinks flags an unrecognized ticket host", () => {
  const found = findSuspectTicketLinks([
    linkRow("a", "Grab seats at https://cheap-seats-now.example/tickets/kane before they go."),
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "unrecognized_ticket_host");
  assert.equal(found[0].host, "cheap-seats-now.example");
});

test("findSuspectTicketLinks flags a known resale host that slipped through", () => {
  // Should be impossible post-sanitizer; if it fires, the row predates the
  // scrub and needs a backfill.
  const found = findSuspectTicketLinks([
    linkRow("b", "Tickets at https://www.stubhub.com/kane-brown-tickets for this one."),
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "known_resale");
});

test("findSuspectTicketLinks stays quiet on organizer and vetted seller links", () => {
  const rows = [
    linkRow("c", "Full details at https://www.murphyscreektheatre.org/spirit-song tonight."),
    linkRow("d", "Buy at https://events.ticketleap.com/tickets/cstarskids/oz today."),
    linkRow("e", "Register at https://onecau.se/rotaryshrimpfeed for the feed."),
    linkRow("f", "Read more at http://www.angelsmurphysrotary.org about the club."),
  ];
  assert.deepEqual(findSuspectTicketLinks(rows), []);
});

test("findSuspectTicketLinks ignores a non-ticket link to an unknown host", () => {
  // A plain organizer page is not the target — only ticket-selling URLs are.
  const found = findSuspectTicketLinks([
    linkRow("g", "See the trail map at https://some-new-org.example/about for details."),
  ]);
  assert.deepEqual(found, []);
});
