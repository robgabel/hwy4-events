import { test } from "node:test";
import assert from "node:assert/strict";
import {
  venueMetaTitle,
  venueMetaDescription,
  venueListSection,
  sitemapVenueKeys,
  venueGateCounts,
  nameWithArtists,
} from "../../lib/venue-pages";

const brice = { canonical: "Brice Station Vineyards", town: "Murphys" };

const music = [{ category: "live_music" }, { category: "wine" }] as never[];
const noMusic = [{ category: "kids" }] as never[];

test("venueMetaTitle: music venue gets Concerts + year", () => {
  assert.equal(
    venueMetaTitle(brice, music, 2026),
    "Brice Station Vineyards Concerts & Events 2026 | Murphys, CA"
  );
});

test("venueMetaTitle: non-music venue gets plain events title", () => {
  assert.equal(
    venueMetaTitle({ canonical: "Arnold Library", town: "Arnold" }, noMusic, 2026),
    "Arnold Library | Upcoming Events in Arnold, CA"
  );
});

test("venueListSection: music venue gets a concert heading + lede (HWY-28)", () => {
  const s = venueListSection(brice, music, 2026);
  assert.equal(s.heading, "Upcoming Concerts at Brice Station Vineyards 2026");
  assert.ok(s.lede && s.lede.includes("Brice Station Vineyards") && s.lede.includes("2026"));
  assert.ok(!s.lede!.includes("—")); // no em dash
});

test("venueListSection: non-music venue keeps the plain heading, no lede", () => {
  const s = venueListSection({ canonical: "Arnold Library", town: "Arnold" }, noMusic, 2026);
  assert.equal(s.heading, "What's coming up at Arnold Library");
  assert.equal(s.lede, null);
});

test("venueMetaDescription: counts events and pluralizes", () => {
  assert.match(venueMetaDescription(brice, music), /2 upcoming concert and event dates/);
  assert.match(
    venueMetaDescription(brice, [music[0]]),
    /1 upcoming concert and event date /
  );
  assert.match(venueMetaDescription(brice, []), /the current event calendar/);
});

test("sitemapVenueKeys: gates on >=3 upcoming public events", () => {
  const events = [
    ...Array.from({ length: 3 }, () => ({ venue_key: "brice-station", visibility: "public" })),
    ...Array.from({ length: 5 }, () => ({ venue_key: "moose-lodge", visibility: "private" })),
    { venue_key: "my-bar", visibility: "public" },
    { venue_key: null, visibility: "public" },
  ] as never[];
  assert.deepEqual(
    sitemapVenueKeys(["brice-station", "moose-lodge", "my-bar", "unknown"], events),
    ["brice-station"]
  );
});

test("venueGateCounts: counts advertised venues at each candidate gate", () => {
  const events = [
    ...Array.from({ length: 10 }, () => ({ venue_key: "big", visibility: "public" })),
    ...Array.from({ length: 4 }, () => ({ venue_key: "mid", visibility: "public" })),
    { venue_key: "small", visibility: "public" },
    ...Array.from({ length: 6 }, () => ({ venue_key: "club", visibility: "private" })),
  ] as never[];
  assert.deepEqual(venueGateCounts(["big", "mid", "small", "club", "empty"], events), {
    "1": 3,
    "3": 2,
    "5": 1,
    "10": 1,
  });
});

test("nameWithArtists: appends missing acts, capped, with & more", () => {
  assert.equal(
    nameWithArtists("Ironstone Summer Concert Series", [
      "Lynyrd Skynyrd",
      "Foghat",
      "Molly Hatchet",
    ]),
    "Ironstone Summer Concert Series: Lynyrd Skynyrd & Foghat & more"
  );
});

test("nameWithArtists: no-op when the name already names an act (word overlap)", () => {
  assert.equal(
    nameWithArtists("Gene Simmons – Murphys", [
      "GENE SIMMONS BAND",
      "SEBASTIAN BACH ORIGINAL VOICE OF SKID ROW",
    ]),
    "Gene Simmons – Murphys"
  );
});

test("nameWithArtists: unshouts an all-caps scraped act name", () => {
  assert.equal(
    nameWithArtists("Ironstone Summer Concert Series", ["QUIET RIOT"]),
    "Ironstone Summer Concert Series: Quiet Riot"
  );
});

test("nameWithArtists: null/empty artists are a no-op", () => {
  assert.equal(nameWithArtists("Willie Nelson & Family – Murphys", null), "Willie Nelson & Family – Murphys");
  assert.equal(nameWithArtists("Some Show", []), "Some Show");
});
