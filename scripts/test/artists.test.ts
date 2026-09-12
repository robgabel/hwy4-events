// Locks lib/artists.ts — Phase 2 public artist render (HWY-36).
//
// Two contracts: (1) listed names match hwy4_artists via the same
// normalizeName key the drafter writes, and (2) Tier C is a hard blank —
// unknown names and draft-only rows produce nothing public. Never-guess:
// blurb_draft* must not leak into the public projection or JSON-LD.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artistChipLabel,
  artistGenreMap,
  artistKey,
  buildPerformers,
  hasPublishedFields,
  matchPublishedArtists,
  publishedLinkEntries,
  sanitizeArtistLinks,
  toPublicArtist,
  type PublicArtist,
} from "../../lib/artists";

const published = (over: Partial<PublicArtist> = {}): PublicArtist => ({
  artist_key: "poison oakies",
  name: "Poison Oakies",
  genre: "Hardcore country",
  blurb: "Calaveras cover-country band formed in 2015.",
  links: { website: "https://poisonoakies.example" },
  hometown: "Calaveras County, CA",
  is_local: true,
  ...over,
});

test("artistKey uses normalizeName: leading The and case collapse", () => {
  assert.equal(artistKey("Poison Oakies"), "poison oakies");
  assert.equal(artistKey("The Poison Oakies"), "poison oakies");
  assert.equal(artistKey("  the Poison Oakies  "), "poison oakies");
});

test("matchPublishedArtists: listed name hits the normalizeName key", () => {
  const catalog = [published()];
  const hits = matchPublishedArtists(["the Poison Oakies"], catalog);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].artist_key, "poison oakies");
  assert.equal(hits[0].genre, "Hardcore country");
});

test("matchPublishedArtists: unknown name is Tier C blank", () => {
  const catalog = [published()];
  assert.deepEqual(matchPublishedArtists(["Jill Warren"], catalog), []);
  assert.deepEqual(matchPublishedArtists([], catalog), []);
  assert.deepEqual(matchPublishedArtists(null, catalog), []);
});

test("matchPublishedArtists: preserves listing order and dedupes the same key", () => {
  const oakies = published();
  const grover = published({
    artist_key: "grover anderson",
    name: "Grover Anderson",
    genre: "Folk-rock",
  });
  const hits = matchPublishedArtists(
    ["Grover Anderson", "the Poison Oakies", "Grover Anderson"],
    [oakies, grover]
  );
  assert.deepEqual(
    hits.map((a) => a.artist_key),
    ["grover anderson", "poison oakies"]
  );
});

test("toPublicArtist: draft-only row is Tier C blank", () => {
  const draftOnly = toPublicArtist({
    artist_key: "surf creeps",
    name: "Surf Creeps",
    genre: null,
    blurb: null,
    links: null,
    hometown: null,
    is_local: false,
    blurb_draft: "A Santa Cruz surf band…",
    blurb_draft_at: "2026-07-20T00:00:00.000Z",
    blurb_draft_meta: {
      confidence: "low",
      genre: "Surf rock",
      blurb: "do not publish",
    },
  });
  assert.equal(draftOnly, null);
});

test("toPublicArtist: never copies draft fields onto a published row", () => {
  const row = toPublicArtist({
    artist_key: "poison oakies",
    name: "Poison Oakies",
    genre: "Hardcore country",
    blurb: "Calaveras cover-country band formed in 2015.",
    links: { website: "https://poisonoakies.example" },
    hometown: null,
    is_local: true,
    blurb_draft: "PENDING DRAFT must not render",
    blurb_draft_meta: { genre: "Wrong genre" },
  });
  assert.ok(row);
  assert.equal(row!.blurb, "Calaveras cover-country band formed in 2015.");
  assert.equal(row!.genre, "Hardcore country");
  assert.equal("blurb_draft" in row!, false);
  assert.equal("blurb_draft_meta" in row!, false);
  assert.equal("blurb_draft_at" in row!, false);
});

test("toPublicArtist: empty / whitespace published fields stay blank", () => {
  assert.equal(
    toPublicArtist({
      artist_key: "nobody",
      name: "Nobody",
      genre: "   ",
      blurb: "",
      links: {},
      hometown: " ",
      is_local: false,
    }),
    null
  );
});

test("hasPublishedFields: genre or links alone are enough; drafts are not a field", () => {
  assert.equal(hasPublishedFields(published({ blurb: null, hometown: null })), true);
  assert.equal(
    hasPublishedFields(
      published({ genre: null, blurb: null, hometown: null, is_local: false, links: {} })
    ),
    false
  );
  assert.equal(
    hasPublishedFields(
      published({
        genre: null,
        blurb: null,
        hometown: null,
        is_local: false,
        links: { website: "https://band.example" },
      })
    ),
    true
  );
});

test("sanitizeArtistLinks: drops non-http and unknown keys", () => {
  assert.deepEqual(
    sanitizeArtistLinks({
      website: "https://band.example",
      facebook: "javascript:alert(1)",
      spotify: "not-a-url",
      tiktok: "https://tiktok.com/nope",
    } as Record<string, unknown>),
    { website: "https://band.example" }
  );
  assert.deepEqual(publishedLinkEntries({ website: "https://a.example" }), [
    ["website", "https://a.example"],
  ]);
});

test("artistChipLabel: appends published genre; blank genre stays the name", () => {
  assert.equal(
    artistChipLabel("Poison Oakies", "Hardcore country"),
    "Poison Oakies · Hardcore country"
  );
  assert.equal(artistChipLabel("Jill Warren", null), "Jill Warren");
  assert.equal(artistChipLabel("Jill Warren", "  "), "Jill Warren");
});

test("artistGenreMap: only published genres, keyed by artist_key", () => {
  const map = artistGenreMap([
    published(),
    published({
      artist_key: "jill warren",
      name: "Jill Warren",
      genre: null,
      blurb: "A real published blurb with no genre.",
      links: {},
      is_local: false,
      hometown: null,
    }),
  ]);
  assert.deepEqual(map, { "poison oakies": "Hardcore country" });
});

test("buildPerformers: MusicGroup when a published row matches, Person otherwise", () => {
  const performers = buildPerformers(
    ["the Poison Oakies", "Jill Warren"],
    [published()]
  );
  assert.deepEqual(performers, [
    {
      "@type": "MusicGroup",
      name: "Poison Oakies",
      genre: "Hardcore country",
      description: "Calaveras cover-country band formed in 2015.",
      url: "https://poisonoakies.example",
      sameAs: ["https://poisonoakies.example"],
    },
    { "@type": "Person", name: "Jill Warren" },
  ]);
});

test("buildPerformers: MusicGroup JSON-LD never carries draft copy", () => {
  const catalog = [
    published({
      genre: "Americana",
      blurb: "Published sentences only.",
      links: {
        website: "https://band.example",
        facebook: "https://facebook.com/band",
      },
    }),
  ];
  const [group] = buildPerformers(["Poison Oakies"], catalog)!;
  const json = JSON.stringify(group);
  assert.equal(group["@type"], "MusicGroup");
  assert.ok(!json.includes("blurb_draft"));
  assert.ok(!json.includes("PENDING"));
  assert.ok(!json.toLowerCase().includes("draft"));
});

test("buildPerformers: no names → undefined (omit the property)", () => {
  assert.equal(buildPerformers(null, [published()]), undefined);
  assert.equal(buildPerformers([], [published()]), undefined);
});
