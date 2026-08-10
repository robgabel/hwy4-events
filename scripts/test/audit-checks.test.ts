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
  findVenueSlotCollisions,
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

test("findTimelessNearDupes ignores marked festival umbrellas (HWY-10)", () => {
  // The umbrella + its opening-night show share a date and venue and one has no
  // start time — the exact shape this check reports. It is intentional, so the
  // marked row is excluded rather than nagging the operator every day.
  const rows = [
    {
      id: "u",
      name: "Bear Valley Music Festival 2026",
      date: "2026-07-17",
      start_time: null,
      end_time: null,
      venue_name: "Big White Tent",
      category: "festival",
      description: "Three weeks of music under the Big White Tent.",
      status: "confirmed",
      series_umbrella: true,
    },
    {
      id: "n",
      name: "Bear Valley Music Festival",
      date: "2026-07-17",
      start_time: "19:00",
      end_time: null,
      venue_name: "Big White Tent",
      category: "live_music",
      description: "Opening night of the Bear Valley Music Festival.",
      status: "confirmed",
    },
  ];
  assert.equal(findTimelessNearDupes(rows).length, 0);
  // Unmarked, the same pair is still a finding — the exclusion is the flag,
  // not the shape.
  const unmarked = rows.map((r) => ({ ...r, series_umbrella: false }));
  assert.equal(findTimelessNearDupes(unmarked).length, 1);
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

// ---------- findVenueSlotCollisions ----------

test("venue slot collisions: the pub phantom-trio shape flags, chaining 30-min starts", () => {
  // The 2026-08-09 live shape: one real act (Kyle Cox, pinned by the pub's own
  // permalink) plus two invented rows stacked onto the same Thursday slot.
  const rows = [
    row({ name: "Kyle Cox", venue_name: "Murphys Irish Pub", start_time: "18:00", end_time: null }),
    row({ name: "Rod Harris & Friends", venue_name: "Murphys Irish Pub", start_time: "18:00", end_time: null }),
    row({ name: "Steve Ashman & Joe Barretta", venue_name: "Murphys Irish Pub", start_time: "18:30", end_time: null }),
    // Another venue the same night is unrelated.
    row({ name: "Trivia Night", venue_name: "The Watering Hole", start_time: "18:00" }),
  ];
  const found = findVenueSlotCollisions(rows);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].names, [
    "Kyle Cox",
    "Rod Harris & Friends",
    "Steve Ashman & Joe Barretta",
  ]);
});

test("venue slot collisions: sequential shows, parks, members-only, routine, timeless stay quiet", () => {
  const rows = [
    // Sequential same-venue programming (>30 min apart) is normal.
    row({ name: "Alan Drown", venue_name: "Murphys Irish Pub", start_time: "16:00" }),
    row({ name: "Kyle Cox", venue_name: "Murphys Irish Pub", start_time: "19:00" }),
    // Parks host simultaneous different events legitimately (Big Trees).
    row({ name: "North Grove Guided Walk", venue_name: "Calaveras Big Trees State Park", start_time: "10:00" }),
    row({ name: "Junior Rangers", venue_name: "Calaveras Big Trees State Park", start_time: "10:00" }),
    // Members-only golf and a hidden routine dinner beside a public show is
    // club-normal (Sequoia Woods) — only the public non-routine row remains,
    // and one row is no collision.
    row({ name: "Club Championship", venue_name: "Sequoia Woods Country Club", start_time: "18:00", visibility: "private" }),
    row({ name: "Thursday Night Dinner", venue_name: "Sequoia Woods Country Club", start_time: "18:00", is_routine: true }),
    row({ name: "Live Music - Jill Warren", venue_name: "Sequoia Woods Country Club", start_time: "18:30" }),
    // Timeless rows are findTimelessNearDupes territory, not this check's.
    row({ name: "Mystery Listing", venue_name: "Murphys Irish Pub", start_time: null }),
  ];
  assert.deepEqual(findVenueSlotCollisions(rows), []);
});

test("venue slot collisions: same normalized name twice is dedup work, not a collision", () => {
  const rows = [
    row({ name: "Open Mic Night", venue_name: "Murphys Irish Pub", start_time: "18:00" }),
    row({ name: "Open Mic Night", venue_name: "Murphys Irish Pub", start_time: "18:00" }),
  ];
  assert.deepEqual(findVenueSlotCollisions(rows), []);
});

test("venue slot collisions: outdoor bases legitimately overlap and stay quiet", () => {
  // The live 2026-09-06 pair this check would have false-flagged daily: an
  // adventure company is single-operator for links but not one room.
  const rows = [
    row({ name: "Hike with a Ranger: Birds", venue_name: "Bear Valley Adventure Company", start_time: "09:30" }),
    row({ name: "Bear Valley Triathlon", venue_name: "Bear Valley Adventure Company", start_time: "10:00" }),
  ];
  assert.deepEqual(findVenueSlotCollisions(rows), []);
});
