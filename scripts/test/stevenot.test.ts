// Stevenot Winery's own Tribe calendar (scripts/lib/stevenot.ts).
//
// GoCalaveras is the only ingest, and it is wrong: Oct 25 says Perarez, the
// Halloween party says 7–10pm with no price, and the later Sundays are
// missing. The public title has to stay "{Act} Live Music @ Stevenot Winery"
// (or the existing Halloween title) so generateEventSlug does not 404 a URL
// that is already out.
//
// Fixture JSON is a slim copy of the live Tribe feed fetched 2026-10-09 with
// the Hwy4EventsBot user agent. This file must not hit the network.
//
// dedup.ts throws at import unless the service-role env is set. Dummy values
// plus a dynamic import, same as prospect-772.test.ts. No request is made.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyEventCategory } from "../../lib/categorize.js";
import { SITE_URL, WEATHER_USER_AGENT } from "../../lib/constants.js";
import { isSameEvent } from "../../lib/event-identity.js";
import { pickFallbackEvent } from "../../lib/events.js";
import { REGION } from "../../lib/region.js";
import { generateEventSlug } from "../../lib/slugs.js";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";
import {
  STEVENOT_UA,
  actsCompatible,
  assignStevenotShows,
  categoryForStevenot,
  correctionSnapshot,
  mapStevenotEvent,
  unparsedStevenotFeed,
  type StevenotResident,
  type StevenotShow,
} from "../lib/stevenot.js";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures/stevenot-tribe.json"), "utf8")
) as unknown[];

function show(id: number): StevenotShow {
  const raw = fixture.find((e) => (e as { id?: number }).id === id);
  const mapped = mapStevenotEvent(raw);
  assert.ok(mapped, `expected Tribe event ${id} to map`);
  return mapped;
}

async function loadDedup() {
  return import("../lib/dedup.js");
}

const skull = () => show(23164);
const halloween = () => show(23066);
const reserve = () => show(23033);
const greg = () => show(23035);

const liveResidents: StevenotResident[] = [
  {
    id: "oct-11",
    name: "Private Reserve Live Music @ Stevenot Winery",
    date: "2026-10-11",
    start_time: "13:00:00",
    artists: ["Private Reserve Band"],
  },
  {
    id: "oct-18",
    name: "Greg Sutton Live Music @ Stevenot Winery",
    date: "2026-10-18",
    start_time: "13:00:00",
    artists: ["Gregory Sutton"],
  },
  {
    id: "oct-25",
    name: "Perarez Live Music @ Stevenot Winery",
    date: "2026-10-25",
    start_time: "13:00:00",
    artists: ["Perarez"],
  },
  {
    id: "oct-30",
    name: "Stevenot Winery Halloween Party",
    date: "2026-10-30",
    start_time: "19:00:00",
    artists: null,
  },
];

test("the live feed maps every published Stevenot listing", () => {
  const shows = fixture.map(mapStevenotEvent);
  assert.equal(shows.filter(Boolean).length, 15);
  assert.equal(shows.every((s) => s === null || s.date >= "2026-10-11"), true);
});

test("Oct 25 is Skull Country, free, 1–4pm, under the stable title shape", () => {
  const s = skull();
  assert.equal(s.name, "Skull Country Live Music @ Stevenot Winery");
  assert.equal(s.act, "Skull Country");
  assert.equal(s.date, "2026-10-25");
  assert.equal(s.startTime, "13:00");
  assert.equal(s.endTime, "16:00");
  assert.equal(s.price, "Free");
  assert.equal(s.sundayMusic, true);
  assert.match(s.description ?? "", /Skull Country/);
  assert.match(s.description ?? "", /soft pretzels/);
  assert.equal(s.name.includes("CLICK HERE"), false);
});

test("Halloween keeps the stored title and takes the feed's 4–8pm and $25", () => {
  const s = halloween();
  assert.equal(s.name, "Stevenot Winery Halloween Party");
  assert.equal(s.act, null);
  assert.equal(s.startTime, "16:00");
  assert.equal(s.endTime, "20:00");
  assert.equal(s.price, "$25.00");
  assert.equal(
    generateEventSlug(s.name, s.date, "Murphys"),
    "stevenot-winery-halloween-party-2026-10-30-murphys"
  );
  assert.match(s.description ?? "", /Halloween Party/);
  assert.match(s.description ?? "", /DJ Lorraine/);
  assert.match(s.description ?? "", /Tickets are required/);
  assert.doesNotMatch(s.description ?? "", /7\s*[–—-]\s*10/i);
  assert.doesNotMatch(s.description ?? "", /click here/i);
});

test("Caroline & Jesse is decoded, and a draft or off-site row is dropped", () => {
  const caroline = show(23120);
  assert.equal(caroline.act, "Caroline & Jesse");
  assert.equal(caroline.name, "Caroline & Jesse Live Music @ Stevenot Winery");
  assert.equal(caroline.price, "Free");

  const wise = show(23155);
  assert.equal(wise.act, "The Wise Guyz");
  assert.match(wise.eventUrl ?? "", /miss-american-pie-free-live-music-click-here-2\/?$/);

  const draft = mapStevenotEvent({ ...(fixture[0] as object), status: "draft" });
  assert.equal(draft, null);
  const elsewhere = mapStevenotEvent({
    ...(fixture[0] as object),
    venue: { venue: "Ironstone Vineyards", city: "Murphys" },
  });
  assert.equal(elsewhere, null);
});

test("pairing keeps shortened titles, corrects Perarez in place, and inserts the rest", () => {
  const shows = fixture.map(mapStevenotEvent).filter((s): s is StevenotShow => s !== null);
  const assigned = assignStevenotShows(shows, liveResidents);
  const byDate = new Map(assigned.map((a) => [a.show.date, a]));

  const oct11 = byDate.get("2026-10-11")!;
  assert.equal(oct11.resident?.id, "oct-11");
  assert.equal(oct11.nameToWrite, "Private Reserve Live Music @ Stevenot Winery");
  assert.equal(oct11.replaceArtists, false);
  assert.equal(
    generateEventSlug(oct11.nameToWrite, "2026-10-11", "Murphys"),
    "private-reserve-live-music-stevenot-winery-2026-10-11-murphys"
  );

  const oct18 = byDate.get("2026-10-18")!;
  assert.equal(oct18.nameToWrite, "Greg Sutton Live Music @ Stevenot Winery");
  assert.equal(oct18.replaceArtists, false);
  assert.equal(
    generateEventSlug(oct18.nameToWrite, "2026-10-18", "Murphys"),
    "greg-sutton-live-music-stevenot-winery-2026-10-18-murphys"
  );

  const oct25 = byDate.get("2026-10-25")!;
  assert.equal(oct25.resident?.id, "oct-25");
  assert.equal(oct25.nameToWrite, "Skull Country Live Music @ Stevenot Winery");
  assert.equal(oct25.replaceArtists, true);

  const oct30 = byDate.get("2026-10-30")!;
  assert.equal(oct30.nameToWrite, "Stevenot Winery Halloween Party");
  assert.equal(oct30.replaceArtists, false);
  assert.equal(oct30.resident?.id, "oct-30");

  const inserts = assigned.filter((a) => a.resident === null);
  assert.equal(inserts.length, 11);
  assert.ok(inserts.some((a) => a.show.date === "2026-11-01" && a.show.act === "Blue Neon Serenade"));
  assert.ok(inserts.some((a) => a.nameToWrite.startsWith("SOLD OUT! Wine Club")));
  assert.ok(inserts.some((a) => a.nameToWrite === "Stevenot Winery Holiday Open House"));
});

test("a same-day row that already names Skull Country wins over the Perarez leftover", () => {
  const assigned = assignStevenotShows(
    [skull()],
    [
      liveResidents[2],
      {
        id: "already",
        name: "Skull Country Live Music @ Stevenot Winery",
        date: "2026-10-25",
        start_time: "13:00:00",
        artists: ["Skull Country"],
      },
    ]
  );
  assert.equal(assigned[0].resident?.id, "already");
  assert.equal(assigned[0].nameToWrite, "Skull Country Live Music @ Stevenot Winery");
  assert.equal(assigned[0].replaceArtists, false);
});

test("an actless Sunday stem at the same clock takes the feed's act", () => {
  const assigned = assignStevenotShows(
    [skull()],
    [
      {
        id: "stem",
        name: "Live Music @ Stevenot Winery",
        date: "2026-10-25",
        start_time: "13:00",
        artists: null,
      },
    ]
  );
  assert.equal(assigned[0].nameToWrite, "Skull Country Live Music @ Stevenot Winery");
  assert.equal(assigned[0].replaceArtists, true);
});

test("the Perarez slug 301s to Skull Country among the real Oct 25 Murphys rows", () => {
  const stale = "perarez-live-music-stevenot-winery-2026-10-25-murphys";
  const corrected = {
    name: "Skull Country Live Music @ Stevenot Winery",
    date: "2026-10-25",
    town: "Murphys",
    venue_name: "Stevenot Winery",
    artists: ["Skull Country"],
  };
  assert.notEqual(generateEventSlug(corrected.name, corrected.date, corrected.town), stale);
  const sameDay = [
    {
      name: "Murphys Park Farmers Market",
      date: "2026-10-25",
      town: "Murphys",
      venue_name: "Murphys Community Park",
      artists: null,
    },
    corrected,
    {
      name: "SPIRIT/SONG",
      date: "2026-10-25",
      town: "Murphys",
      venue_name: "Murphys Creek Theatre",
      artists: null,
    },
  ];
  assert.equal(pickFallbackEvent(sameDay, stale), corrected);
});

test("nickname and ensemble suffixes count as the same act; a different band does not", () => {
  assert.equal(actsCompatible("Greg Sutton", "Gregory Sutton"), true);
  assert.equal(actsCompatible("Private Reserve", "Private Reserve Band"), true);
  assert.equal(actsCompatible("Perarez", "Skull Country"), false);
  assert.equal(actsCompatible("Miss", "Mississippi"), false);
});

test("Halloween stays wine; a Sunday bill is live music", () => {
  const party = halloween();
  assert.equal(classifyEventCategory(party.name, party.description), "live_music");
  assert.equal(categoryForStevenot(party), "wine");
  assert.equal(categoryForStevenot(skull()), "live_music");
  assert.equal(categoryForStevenot(show(23099)), "wine");
});

test("the correction replaces a wrong act and does not take GoCalaveras's id", async () => {
  const { buildExactMatchUpdate, generateDedupKey, rowChanged } = await loadDedup();
  const s = skull();
  const now = "2026-10-09T15:00:00.000Z";
  const existing = {
    id: "oct-25",
    name: "Perarez Live Music @ Stevenot Winery",
    date: "2026-10-25",
    town: "Murphys",
    venue_name: "Stevenot Winery",
    venue_key: "stevenot",
    description: "Sunday Live Music Presents: Perarez FREE Live Music Sunday, October 25th 1:00-4:00pm wine by the glass",
    start_time: "13:00:00",
    end_time: "16:00:00",
    price: null,
    event_url: "https://www.gocalaveras.com/events/live-music-stevenot-winery-10/",
    address: "2849 Batten Rd, Vallecito, CA 95251",
    image_url: null,
    category: "live_music",
    artists: ["Perarez"],
    source_event_id: "192971",
    family_friendly: false,
  };
  const incoming = {
    name: s.name,
    description: s.description,
    date: s.date,
    start_time: s.startTime,
    end_time: s.endTime,
    venue_name: "Stevenot Winery",
    town: "Murphys",
    address: null,
    category: "live_music",
    price: s.price,
    artists: [s.act!],
    event_url: s.eventUrl,
    image_url: null,
  };
  const uncleared = buildExactMatchUpdate(
    existing as never,
    incoming as never,
    generateDedupKey(s.name, s.date, "Murphys"),
    now
  ) as Record<string, unknown>;
  assert.equal("artists" in uncleared, false);

  const snapshot = correctionSnapshot(existing, true);
  assert.equal(rowChanged(snapshot as never, incoming as never), true);
  const payload = buildExactMatchUpdate(
    snapshot as never,
    incoming as never,
    generateDedupKey(s.name, s.date, "Murphys"),
    now
  ) as Record<string, unknown>;
  assert.equal(payload.name, "Skull Country Live Music @ Stevenot Winery");
  assert.deepEqual(payload.artists, ["Skull Country"]);
  assert.equal(payload.price, "Free");
  assert.equal(payload.start_time, "13:00");
  assert.equal(payload.end_time, "16:00");
  assert.equal(payload.event_url, s.eventUrl);
  assert.equal("source_event_id" in payload, false);
  assert.equal(payload.town, "Murphys");

  const stored = {
    ...existing,
    name: payload.name,
    artists: ["Skull Country"],
    price: "Free",
    description: s.description,
    event_url: s.eventUrl,
    start_time: "13:00:00",
    end_time: "16:00:00",
  };
  const again = correctionSnapshot(stored, false);
  assert.equal(rowChanged(again as never, incoming as never), false);
});

test("Halloween's clock and price update under the same title, and the different start does not fuzzy-merge", async () => {
  const { buildExactMatchUpdate, generateDedupKey } = await loadDedup();
  const s = halloween();
  const existing = {
    id: "oct-30",
    name: "Stevenot Winery Halloween Party",
    date: "2026-10-30",
    town: "Murphys",
    venue_name: "Stevenot Winery",
    venue_key: "stevenot",
    description: "Join us for a Halloween Party at Stevenot Winery!",
    start_time: "19:00:00",
    end_time: "22:00:00",
    price: null,
    event_url: "https://www.gocalaveras.com/events/stevenot-winery-halloween-party/",
    address: "2849 Batten Rd, Vallecito, CA 95251",
    image_url: null,
    category: "wine",
    artists: null,
    source_event_id: "193044",
    family_friendly: false,
  };
  const incoming = {
    name: "Stevenot Winery Halloween Party",
    description: s.description,
    date: s.date,
    start_time: s.startTime,
    end_time: s.endTime,
    venue_name: "Stevenot Winery",
    town: "Murphys",
    address: null,
    category: categoryForStevenot(s),
    price: s.price,
    artists: null,
    event_url: s.eventUrl,
    image_url: null,
  };
  const payload = buildExactMatchUpdate(
    correctionSnapshot(existing, false) as never,
    incoming as never,
    generateDedupKey(incoming.name, incoming.date, "Murphys"),
    "2026-10-09T15:00:00.000Z"
  ) as Record<string, unknown>;
  assert.equal(payload.name, "Stevenot Winery Halloween Party");
  assert.equal(payload.start_time, "16:00");
  assert.equal(payload.end_time, "20:00");
  assert.equal(payload.price, "$25.00");
  assert.equal(payload.category, "wine");
  assert.equal("source_event_id" in payload, false);
  assert.equal("artists" in payload, false);

  assert.equal(
    isSameEvent(
      {
        name: existing.name,
        date: existing.date,
        town: existing.town,
        venue_name: existing.venue_name,
        venue_key: "stevenot",
        start_time: "19:00",
        end_time: "22:00",
        description: existing.description,
      },
      {
        name: s.name,
        date: s.date,
        town: "Murphys",
        venue_name: "Stevenot Winery",
        venue_key: "stevenot",
        start_time: s.startTime,
        end_time: s.endTime,
        description: s.description,
      }
    ),
    false
  );
});

test("a shared Sunday blurb fuzzy-matches, and that path would keep both acts", async () => {
  const { buildStrongMatchUpdate, generateDedupKey } = await loadDedup();
  const s = skull();
  const gocal = {
    name: "Perarez Live Music @ Stevenot Winery",
    date: "2026-10-25",
    town: "Murphys",
    venue_name: "Stevenot Winery",
    venue_key: "stevenot",
    start_time: "13:00",
    end_time: "16:00",
    artists: ["Perarez"],
    description:
      "Sunday Live Music Presents: Perarez FREE Live Music Sunday, October 25th 1:00-4:00pm wine by the glass • bottle • mimosas • wine slushies • root beer floats • orange soda floats • charcuterie plates • grilled cheese • hot dogs • corn dogs • pretzels",
  };
  const feed = {
    name: s.name,
    date: s.date,
    town: "Murphys",
    venue_name: "Stevenot Winery",
    venue_key: "stevenot",
    start_time: s.startTime,
    end_time: s.endTime,
    artists: [s.act!],
    description: s.description,
  };
  // The menu blurb is shared, so the matcher says these are one show. The
  // fuzzy write unions both acts. The correction therefore updates by id with
  // the list cleared. It does not write the Tribe id over the EventON id.
  // GoCalaveras is blocklisted from the venue so that id is never exact-matched
  // again; if it were, the payload would restore the Perarez name.
  assert.equal(isSameEvent(gocal, feed), true);
  const merged = buildStrongMatchUpdate(
    {
      id: "oct-25",
      name: gocal.name,
      date: gocal.date,
      town: gocal.town,
      venue_name: gocal.venue_name,
      venue_key: "stevenot",
      description: gocal.description,
      start_time: "13:00:00",
      end_time: "16:00:00",
      price: null,
      event_url: "https://www.gocalaveras.com/events/live-music-stevenot-winery-10/",
      address: "2849 Batten Rd, Vallecito, CA 95251",
      image_url: null,
      category: "live_music",
      artists: ["Perarez"],
    } as never,
    { ...feed, source_event_id: s.sourceEventId } as never,
    generateDedupKey(s.name, s.date, "Murphys"),
    "2026-10-09T15:00:00.000Z"
  ) as { artists?: string[] };
  assert.ok(merged.artists?.includes("Perarez"));
  assert.ok(merged.artists?.includes("Skull Country"));
});

test("aggregators are blocked from Stevenot; the organizer scraper is not", () => {
  const row = {
    name: "Skull Country Live Music @ Stevenot Winery",
    venue_name: "Stevenot Winery",
  };
  // GoCalaveras, Visit Murphys, and the Facebook scrapers call with no slug.
  assert.equal(isManuallyManagedEvent(row), true);
  assert.equal(isManuallyManagedEvent(row, "gocalaveras"), true);
  assert.equal(isManuallyManagedEvent(row, "stevenot"), false);
  // Venue alone covers a title that never says the winery (the wine club).
  assert.equal(
    isManuallyManagedEvent({ name: "SOLD OUT! Wine Club Release Party", venue_name: "Stevenot Winery" }),
    true
  );
  // A different venue stays on GoCalaveras.
  assert.equal(
    isManuallyManagedEvent({ name: "Live Music @ Murphys Irish Pub", venue_name: "Murphys Irish Pub" }),
    false
  );

  const src = readFileSync(join(here, "../scrape.ts"), "utf8");
  const block = src.slice(src.indexOf("const SPECIAL_SCRAPERS"), src.indexOf("const SCRAPERS"));
  const keys = [...block.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
  assert.equal(keys.at(-1), "stevenot");
  assert.equal(keys.at(-2), "prospect-772");
  assert.ok(keys.indexOf("gocalaveras") < keys.indexOf("stevenot"));

  const scraper = readFileSync(join(here, "../scrapers/stevenot.ts"), "utf8");
  assert.doesNotMatch(scraper, /fetchTribePage/);
  assert.doesNotMatch(scraper, /firecrawl/i);
  assert.doesNotMatch(scraper, /Hwy4EventsBot/);
  assert.match(scraper, /STEVENOT_UA/);
  assert.match(scraper, /ignoreDuplicates: true/);
  assert.match(scraper, /toExtracted\(assignment\.show, assignment\.nameToWrite, false\)/);
  assert.match(scraper, /unparsedStevenotFeed/);
  assert.equal(STEVENOT_UA, `${REGION.botName}/1.0 (${SITE_URL})`);
  assert.equal(STEVENOT_UA, WEATHER_USER_AGENT);
});

test("a feed that returns events and parses none is a failure; a past-only feed is quiet", () => {
  assert.equal(unparsedStevenotFeed(15, 0), true);
  assert.equal(unparsedStevenotFeed(0, 0), false);
  assert.equal(unparsedStevenotFeed(15, 15), false);
  assert.equal(unparsedStevenotFeed(3, 3), false);
});

test("day 2: GoCalaveras then Stevenot changes neither corrected row", async () => {
  const { buildExactMatchUpdate, generateDedupKey, rowChanged } = await loadDedup();
  const now = "2026-10-10T15:00:00.000Z";
  const skullShow = skull();
  const party = halloween();

  // Day 1 already happened: Stevenot corrected the GoCalaveras rows in place
  // and left the EventON ids where they were.
  const skullRow = {
    id: "oct-25",
    name: "Skull Country Live Music @ Stevenot Winery",
    date: "2026-10-25",
    town: "Murphys",
    venue_name: "Stevenot Winery",
    venue_key: "stevenot",
    description: skullShow.description,
    start_time: "13:00",
    end_time: "16:00",
    price: "Free",
    event_url: skullShow.eventUrl,
    address: "2849 Batten Rd, Vallecito, CA 95251",
    image_url: null,
    category: "live_music",
    artists: ["Skull Country"],
    source_event_id: "192971",
    family_friendly: false,
  };
  const partyRow = {
    id: "oct-30",
    name: "Stevenot Winery Halloween Party",
    date: "2026-10-30",
    town: "Murphys",
    venue_name: "Stevenot Winery",
    venue_key: "stevenot",
    description: party.description,
    start_time: "16:00",
    end_time: "20:00",
    price: "$25.00",
    event_url: party.eventUrl,
    address: "2849 Batten Rd, Vallecito, CA 95251",
    image_url: null,
    category: "wine",
    artists: null,
    source_event_id: "193044",
    family_friendly: false,
  };
  const gocalSkull = {
    name: "Perarez Live Music @ Stevenot Winery",
    description:
      "Sunday Live Music Presents: Perarez FREE Live Music Sunday, October 25th 1:00-4:00pm wine by the glass",
    date: "2026-10-25",
    start_time: "13:00",
    end_time: "16:00",
    venue_name: "Stevenot Winery",
    town: "Murphys",
    address: skullRow.address,
    category: "live_music" as const,
    price: null,
    artists: ["Perarez"],
    event_url: "https://www.gocalaveras.com/events/live-music-stevenot-winery-10/",
    image_url: null,
    source_event_id: "192971",
  };
  const gocalParty = {
    name: "Stevenot Winery Halloween Party",
    description: "Join us for a Halloween Party at Stevenot Winery! 7–10 PM | $25",
    date: "2026-10-30",
    start_time: "19:00",
    end_time: "22:00",
    venue_name: "Stevenot Winery",
    town: "Murphys",
    address: partyRow.address,
    category: "wine" as const,
    price: null,
    artists: null,
    event_url: "https://www.gocalaveras.com/events/stevenot-winery-halloween-party/",
    image_url: null,
    source_event_id: "193044",
  };
  const stevenotSkull = {
    name: skullShow.name,
    description: skullShow.description,
    date: skullShow.date,
    start_time: skullShow.startTime,
    end_time: skullShow.endTime,
    venue_name: "Stevenot Winery",
    town: "Murphys",
    address: null,
    category: "live_music" as const,
    price: skullShow.price,
    artists: [skullShow.act!],
    event_url: skullShow.eventUrl,
    image_url: null,
  };
  const stevenotParty = {
    name: "Stevenot Winery Halloween Party",
    description: party.description,
    date: party.date,
    start_time: party.startTime,
    end_time: party.endTime,
    venue_name: "Stevenot Winery",
    town: "Murphys",
    address: null,
    category: categoryForStevenot(party),
    price: party.price,
    artists: null,
    event_url: party.eventUrl,
    image_url: null,
  };

  // The exact-match path would revert both rows. resolveWrittenName does not
  // keep Skull Country against the specific Perarez title, and the Halloween
  // clock is not a placeholder.
  assert.equal(rowChanged(skullRow as never, gocalSkull as never), true);
  const reverted = buildExactMatchUpdate(
    skullRow as never,
    gocalSkull as never,
    generateDedupKey(gocalSkull.name, gocalSkull.date, gocalSkull.town),
    now
  ) as Record<string, unknown>;
  assert.equal(reverted.name, "Perarez Live Music @ Stevenot Winery");
  assert.equal(reverted.event_url, gocalSkull.event_url);
  assert.equal(rowChanged(partyRow as never, gocalParty as never), true);
  const retimed = buildExactMatchUpdate(
    partyRow as never,
    gocalParty as never,
    generateDedupKey(gocalParty.name, gocalParty.date, gocalParty.town),
    now
  ) as Record<string, unknown>;
  assert.equal(retimed.start_time, "19:00");
  assert.equal(retimed.end_time, "22:00");

  // Day 2, GoCalaveras first. The scraper drops a blocklisted event before
  // upsert, so rowChanged is never asked and the corrected row stays.
  function day2Changed(
    existing: object,
    event: { name: string; venue_name: string },
    askingOrg?: string
  ): boolean {
    if (isManuallyManagedEvent(event, askingOrg)) return false;
    return rowChanged(existing as never, event as never);
  }
  assert.equal(day2Changed(skullRow, gocalSkull), false);
  assert.equal(day2Changed(partyRow, gocalParty), false);

  // Stevenot second. Same fields it wrote yesterday.
  assert.equal(day2Changed(skullRow, stevenotSkull, "stevenot"), false);
  assert.equal(day2Changed(partyRow, stevenotParty, "stevenot"), false);
});
