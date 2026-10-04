// Locks lib/agent/artist-worklist.ts: who the artist-blurb drafter researches,
// with which bookings, and which catalog row the result lands on
// (artist coverage + accuracy, 2026-10-04).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RETRY_AFTER_DAYS,
  buildArtistWorklist,
  collectActs,
  type CatalogRow,
  type ShowRow,
} from "../../lib/agent/artist-worklist.js";
import { buildArtistResearchPrompt, coerceArtistResearch } from "../../lib/agent/research-artist.js";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const show = (over: Partial<ShowRow> = {}): ShowRow => ({
  artists: ["Overdrive"],
  name: "Live Music - Overdrive",
  town: "Murphys",
  venue_name: "Murphys Irish Pub",
  date: "2026-10-10",
  event_url: "https://example.com/overdrive",
  description: null,
  ...over,
});

const row = (over: Partial<CatalogRow> = {}): CatalogRow => ({
  artist_key: "overdrive",
  name: "Overdrive",
  blurb: null,
  genre: null,
  links: null,
  blurb_draft: null,
  blurb_draft_at: daysAgo(10),
  blurb_draft_meta: { confidence: "low", context_venues: ["murphys irish pub"] },
  ...over,
});

test("a never-seen act is new and written under its own normalized key", () => {
  const [item, ...rest] = buildArtistWorklist([show()], [], NOW);
  assert.equal(rest.length, 0);
  assert.equal(item.reason, "new");
  assert.equal(item.artist_key, "overdrive");
  assert.equal(item.isNewRow, true);
  assert.deepEqual(item.venues, ["murphys irish pub"]);
  assert.equal(item.shows[0].url, "https://example.com/overdrive");
});

test("a variant spelling of a published act is not researched again", () => {
  const items = buildArtistWorklist(
    [show({ artists: ["Rod Harris"], name: "Rod Harris" })],
    [row({ artist_key: "rod harris and friends", name: "Rod Harris and Friends", blurb: "Jazz and swing." })],
    NOW
  );
  assert.equal(items.length, 0);
});

test("a variant with a pending draft is covered, not re-researched", () => {
  const items = buildArtistWorklist(
    [show({ artists: ["Blue Monday Band"] })],
    [row({ artist_key: "blue monday", name: "Blue Monday", blurb_draft: "A draft." })],
    NOW
  );
  assert.equal(items.length, 0);
});

test("a retry lands on the act's existing row, not a new variant row", () => {
  const [item] = buildArtistWorklist(
    [show({ artists: ["The Elder Berries"], venue_name: "Murphys Pourhouse" })],
    [row({ artist_key: "elderberries", name: "The ElderBerries" })],
    NOW
  );
  assert.equal(item.artist_key, "elderberries");
  assert.equal(item.name, "The ElderBerries");
  assert.equal(item.isNewRow, false);
  assert.equal(item.reason, "new_venue");
});

test("retry rules: blank stays blank without new evidence", () => {
  assert.equal(buildArtistWorklist([show()], [row()], NOW).length, 0);
});

test("retry rules: research that predates the listings context is retried", () => {
  const [item] = buildArtistWorklist([show()], [row({ blurb_draft_meta: { confidence: "low" } })], NOW);
  assert.equal(item.reason, "no_context");
});

test("retry rules: prose the voice floor dropped is retried exactly once", () => {
  const [item] = buildArtistWorklist(
    [show()],
    [row({ blurb_draft_meta: { confidence: "high", context_venues: ["murphys irish pub"], voice_rejected: true } })],
    NOW
  );
  assert.equal(item.reason, "voice_retry");
  const again = buildArtistWorklist(
    [show()],
    [
      row({
        blurb_draft_meta: {
          confidence: "high",
          context_venues: ["murphys irish pub"],
          voice_rejected: true,
          voice_retried: true,
        },
      }),
    ],
    NOW
  );
  assert.equal(again.length, 0);
});

test("retry rules: an old blank is retried after the window", () => {
  const [item] = buildArtistWorklist([show()], [row({ blurb_draft_at: daysAgo(RETRY_AFTER_DAYS + 1) })], NOW);
  assert.equal(item.reason, "stale");
});

test("a row with live genre or links is never retried", () => {
  const items = buildArtistWorklist(
    [show({ venue_name: "Somewhere New" })],
    [row({ links: { facebook: "https://facebook.com/x" } })],
    NOW
  );
  assert.equal(items.length, 0);
});

test("never-researched acts take the batch before retries", () => {
  const items = buildArtistWorklist(
    [show({ artists: ["Overdrive"] }), show({ artists: ["Hired Gunn"], name: "Music In The Square- Hired Gunn" })],
    [row({ blurb_draft_meta: { confidence: "low" } })],
    NOW
  );
  assert.deepEqual(items.map((i) => i.reason), ["new", "no_context"]);
});

test("karaoke hosts and theme nights never reach research", () => {
  const items = buildArtistWorklist(
    [
      show({ artists: ["Kim"], name: "Karaoke with Kim" }),
      show({ artists: ["KJ Johnny Rocksmith"], name: "Mic on Tap at The Pour House" }),
      show({ artists: ["Throw Back Thursday “Jazz Edition “"], name: "Throw Back Thursday" }),
    ],
    [],
    NOW
  );
  assert.equal(items.length, 0);
});

test("collectActs keeps three bookings, distinct venues first", () => {
  const acts = collectActs([
    show({ date: "2026-10-05", venue_name: "Murphys Irish Pub" }),
    show({ date: "2026-10-06", venue_name: "Murphys Irish Pub" }),
    show({ date: "2026-10-07", venue_name: "Stevenot Winery" }),
    show({ date: "2026-10-08", venue_name: "Brice Station Vineyards" }),
  ]);
  const act = acts.get("overdrive")!;
  assert.deepEqual(
    act.shows.map((s) => s.venue),
    ["Murphys Irish Pub", "Stevenot Winery", "Brice Station Vineyards"]
  );
});

test("the research prompt carries venue, date, link and a description snippet", () => {
  const prompt = buildArtistResearchPrompt(
    "Overdrive",
    [
      {
        date: "2026-10-10",
        venue: "Murphys Irish Pub",
        town: "Murphys",
        title: "Live Music - Overdrive",
        url: "https://example.com/overdrive",
        description: "x".repeat(600),
      },
    ],
    "Murphys"
  );
  assert.match(prompt, /2026-10-10 at Murphys Irish Pub, Murphys/);
  assert.match(prompt, /Listing link: https:\/\/example\.com\/overdrive/);
  assert.match(prompt, /x{400}\.\.\./);
  assert.doesNotMatch(prompt, /x{401}/);
});

test("coerce flags prose the voice floor dropped, and only that", () => {
  const base = {
    genre: "Rock",
    confidence: "high",
    sources: [{ title: "Site", url: "https://band.example" }],
  };
  const dropped = coerceArtistResearch({ ...base, blurb: "A rock band — from Murphys." });
  assert.equal(dropped.blurb, null);
  assert.equal(dropped.voiceRejected, true);
  const kept = coerceArtistResearch({ ...base, blurb: "A rock band from Murphys." });
  assert.equal(kept.voiceRejected, false);
  const none = coerceArtistResearch({ ...base, blurb: null });
  assert.equal(none.voiceRejected, false);
});
