// Read-time merge behavior for the umbrella-series + act case.
//
// `dedupeEvents` must collapse the GoCalaveras umbrella row ("Bistro Summer
// Concerts Series") and the venue feed's act ("Avalon Revival") into ONE card
// that keeps the band's name/photo but backfills the umbrella's blurb. Uses the
// repo's node:test + tsx harness (same as event-identity.test.ts).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeEvents,
  mergeCluster,
  type DedupableEvent,
} from "../../lib/dedupe-events.js";

const slot = {
  date: "2026-06-13",
  town: "Arnold",
  venue_name: "Bistro Espresso",
  start_time: "18:00",
  end_time: "21:00",
  visibility: "public" as const,
};

const umbrella: DedupableEvent = {
  ...slot,
  name: "Bistro Summer Concerts Series",
  description:
    "Summer concert season is back. Live music every Saturday 6-9 PM, smoky BBQ.",
  artists: null,
  image_url: "https://example.com/poster.jpg",
  source_event_id: "192236",
  event_url: "https://gocalaveras.com/event/192236",
};

const act: DedupableEvent = {
  ...slot,
  name: "Avalon Revival",
  description: null,
  artists: ["Avalon Revival"],
  image_url: "https://example.com/band.jpg",
};

test("collapses the umbrella + act pair to a single card (either order)", () => {
  assert.equal(dedupeEvents([umbrella, act]).length, 1);
  assert.equal(dedupeEvents([act, umbrella]).length, 1);
});

test("keeps the band name + its photo, backfills the umbrella blurb", () => {
  const [card] = dedupeEvents([umbrella, act]);
  assert.equal(card.name, "Avalon Revival");
  assert.equal(card.image_url, "https://example.com/band.jpg");
  assert.ok((card.description ?? "").includes("Summer concert season"));
  assert.deepEqual(card.artists, ["Avalon Revival"]);
});

test("does not mutate the input rows", () => {
  dedupeEvents([umbrella, act]);
  assert.equal(act.description, null);
  assert.equal(umbrella.name, "Bistro Summer Concerts Series");
});

test("mergeCluster returns the row unchanged for a singleton", () => {
  assert.equal(mergeCluster([act]), act);
});

test("leaves genuinely different shows alone (different venue)", () => {
  const elsewhere: DedupableEvent = {
    ...act,
    venue_name: "Cameo Plaza",
    name: "Snarky Cats",
    artists: ["Snarky Cats"],
  };
  assert.equal(dedupeEvents([act, elsewhere]).length, 2);
});
