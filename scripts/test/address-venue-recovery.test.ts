// Regression lock for the address-in-venue-name recovery re-running venue
// detection (2026-08-18).
//
// EventON sometimes puts a venue's street address in the LOCATION NAME field.
// The per-scraper venue-detection pass runs before normalizeEventLocation, so
// it sees a street string as venue_name with a null address — neither its name
// layer nor its address layer can fire. normalizeEventLocation then swaps the
// fields (address := venue string, venue_name := "Unknown Venue") and, before
// this fix, stopped there: the row landed unresolved with whatever town the
// extractor guessed, and every re-scrape compared equal so it could never
// self-heal. Live case: "Arnold Angels Music Festival" (a charity's festival
// AT Brice Station Vineyards) — EventON's location name was Brice's street
// address, the town label "Arnold" came from the charity's name, and the row
// failed the daily location sanity check two days running with no self-repair
// possible.
//
// dedup.ts imports scripts/lib/supabase-admin, which THROWS at import time if
// the service-role env is unset. Set dummy env then dynamic-import, same as
// times-locked.test.ts.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

async function load() {
  return import("../lib/dedup.js");
}

test("a registry venue's address in the venue_name field resolves venue AND town", async () => {
  const { normalizeEventLocation } = await load();
  // Deliberate registry lock: this pins Brice Station's live registry entry
  // (address prefix, canonical name, town). If the registry entry changes,
  // update this fixture with it — the coupling is the point, since the
  // recovery's whole promise is "the registry's data wins".
  const ev = {
    name: "Arnold Angels Music Festival",
    description: "Tickets are on sale now for the Arnold Angels Music Festival.",
    date: "2026-10-04",
    town: "Arnold",
    venue_name: "3353 East Highway 4, Murphys CA 95247",
    address: null,
    start_time: null,
    end_time: null,
    price: null,
    event_url: "https://www.gocalaveras.com/events/arnold-angels-music-festival/",
    category: "live_music",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.venue_name, "Brice Station Vineyards");
  // The registry's town outranks the label the extractor guessed off the
  // charity's name — this is what un-reds the location sanity check.
  assert.equal(ev.town, "Murphys");
  assert.ok((ev.address ?? "").startsWith("3353"));
});

test("a non-registry street address swaps but adopts NOTHING — even with registry mentions in text", async () => {
  const { normalizeEventLocation } = await load();
  // The load-bearing lock (adversarial review of #265, finding 1): after the
  // swap the venue is generic, and the FULL matcher's text layer would adopt
  // any registry venue merely mentioned in the title/description/URL — moving
  // town off a mention, contradicting the row's own address, and killing the
  // event's town-bearing URL. The recovery must accept the ADDRESS layer only,
  // so this event mentions Ironstone three ways and must still adopt nothing.
  const ev = {
    name: "Shuttle to Ironstone Vineyards",
    description: "Wine tasting featuring Ironstone Vineyards pours. Hosted at a private residence.",
    date: "2026-10-04",
    town: "Arnold",
    venue_name: "9999 Nowhere Lane, Arnold CA 95223",
    address: null,
    start_time: null,
    end_time: null,
    price: null,
    event_url: "https://www.gocalaveras.com/events/shuttle-to-ironstone-vineyards/",
    category: "other",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.venue_name, "Unknown Venue");
  assert.equal(ev.address, "9999 Nowhere Lane, Arnold CA 95223");
  assert.equal(ev.town, "Arnold");
});

test("a properly-named venue with its own address is untouched", async () => {
  const { normalizeEventLocation } = await load();
  const ev = {
    name: "Hilltop Concert",
    description: null,
    date: "2026-10-04",
    town: "Murphys",
    venue_name: "Brice Station Vineyards",
    address: "3353 East Highway 4, Murphys, CA 95247",
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
    category: "live_music",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.venue_name, "Brice Station Vineyards");
  assert.equal(ev.town, "Murphys");
});

test("a generic venue beside a street address in the ADDRESS field adopts venue AND town", async () => {
  const { normalizeEventLocation } = await load();
  // Generic venue_name beside a street address in the address field proper.
  // The original recovery only fired on the swap shape, so a source that
  // never runs applyVenueDetection (red-cross, mystic-saloon) — or any
  // resolvable-but-unresolved shape reaching the write boundary — got no
  // address-layer look here at all. The detecting scrapers' events arrive
  // non-generic whenever this could fire (their own detection accepts a
  // superset of address matches), so this arm is the non-detecting sources'
  // recovery plus choke-point self-sufficiency. Same registry lock as above.
  const ev = {
    name: "Arnold Angels Music Festival",
    description: "Tickets are on sale now for the Arnold Angels Music Festival.",
    date: "2026-10-04",
    town: "Arnold",
    venue_name: "Unknown Venue",
    address: "3353 East Highway 4, Murphys CA 95247",
    start_time: null,
    end_time: null,
    price: null,
    event_url: "https://www.gocalaveras.com/events/arnold-angels-music-festival/",
    category: "live_music",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.venue_name, "Brice Station Vineyards");
  assert.equal(ev.town, "Murphys");
  assert.equal(ev.address, "3353 East Highway 4, Murphys CA 95247");
});

test("a generic venue with NO street address adopts nothing off text mentions", async () => {
  const { normalizeEventLocation } = await load();
  // The #265 invariant, re-asserted for the widened entry condition: only the
  // ADDRESS layer earns adoption. A generic venue whose event merely mentions
  // a registry venue in title/description/URL must stay unresolved.
  const ev = {
    name: "Shuttle to Ironstone Vineyards",
    description: "Wine tasting featuring Ironstone Vineyards pours.",
    date: "2026-10-04",
    town: "Arnold",
    venue_name: "Unknown Venue",
    address: "Arnold, CA",
    start_time: null,
    end_time: null,
    price: null,
    event_url: "https://www.gocalaveras.com/events/shuttle-to-ironstone-vineyards/",
    category: "other",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.venue_name, "Unknown Venue");
  assert.equal(ev.town, "Arnold");
});

// ---------------------------------------------------------------------------
// Registry-address correction (2026-09-05, the Mystic Saloon red run): a
// name-matched registry venue whose scraped address shares the registry's
// street number but asserts a DIFFERENT corridor town is carrying the
// source's postal-city guess — the curated registry string wins, and the
// venue's town rides with it.
// ---------------------------------------------------------------------------

test("a registry venue's scraped address with the same street number but a conflicting town adopts the registry address AND town", async () => {
  const { normalizeEventLocation } = await load();
  // Deliberate registry lock on mystic-saloon (4529 Highway 4, Avery, CA
  // 95224) — the live shape: GoCalaveras says "4529 CA-4, Murphys, CA 95247".
  const ev = {
    name: "Live Music @ Howard's Mystic Saloon",
    description: null,
    date: "2026-09-05",
    town: "Avery",
    venue_name: "Howard's Mystic Saloon",
    address: "4529 CA-4, Murphys, CA 95247",
    start_time: "18:00",
    end_time: null,
    price: null,
    event_url: "https://www.gocalaveras.com/events/live-music-howards-mystic-saloon/",
    category: "live_music",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.address, "4529 Highway 4, Avery, CA 95224");
  assert.equal(ev.town, "Avery");
  assert.equal(ev.venue_name, "Howard's Mystic Saloon");
});

test("a DIFFERENT street number under a registry venue's name is left alone", async () => {
  const { normalizeEventLocation } = await load();
  // A real discrepancy (the event claims another location) stays visible for
  // a human — never silently rewritten.
  const ev = {
    name: "Offsite Party",
    description: null,
    date: "2026-09-05",
    town: "Avery",
    venue_name: "Howard's Mystic Saloon",
    address: "123 Main St, Murphys, CA 95247",
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
    category: "other",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.address, "123 Main St, Murphys, CA 95247");
  assert.equal(ev.town, "Avery");
});

test("an address whose town AGREES with the registry is untouched however it's formatted", async () => {
  const { normalizeEventLocation } = await load();
  // The Brice comma-variant every GoCalaveras row carries: same number, same
  // town, different punctuation — must NOT rewrite (zero steady-state churn).
  const ev = {
    name: "Hilltop Concert",
    description: null,
    date: "2026-10-04",
    town: "Murphys",
    venue_name: "Brice Station Vineyards",
    address: "3353 East Highway 4, Murphys CA 95247",
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
    category: "live_music",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.address, "3353 East Highway 4, Murphys CA 95247");
});

test("the town RIDES with the adopted registry address (mutation lock M4)", async () => {
  const { normalizeEventLocation } = await load();
  // Same live shape but with the town label ALSO wrong on the way in — the
  // prior fixture's input town was already Avery, so deleting the town
  // adoption passed it trivially (review of #278, mutant M4).
  const ev = {
    name: "Live Music @ Howard's Mystic Saloon",
    description: null,
    date: "2026-09-05",
    town: "Murphys",
    venue_name: "Howard's Mystic Saloon",
    address: "4529 CA-4, Murphys, CA 95247",
    start_time: "18:00",
    end_time: null,
    price: null,
    event_url: null,
    category: "live_music",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.address, "4529 Highway 4, Avery, CA 95224");
  assert.equal(ev.town, "Avery");
});

test("an address that names NO town is untouched (mutation lock M3)", async () => {
  const { normalizeEventLocation } = await load();
  // "names none" half of the contract: without the non-null town guard the
  // arm would rewrite this real live shape (Copperopolis Town Square, whose
  // address states no city). Registry lock on copperopolis-town-square.
  const ev = {
    name: "Saturday Night Music",
    description: null,
    date: "2026-09-12",
    town: "Copperopolis",
    venue_name: "Copperopolis Town Square",
    address: "100 Town Square Road",
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
    category: "live_music",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.address, "100 Town Square Road");
  assert.equal(ev.town, "Copperopolis");
});

test("the correction is exact-NAME-anchored — a superstring of an alias does not fire (mutation lock M6)", async () => {
  const { normalizeEventLocation } = await load();
  const ev = {
    name: "Live Music",
    description: null,
    date: "2026-09-05",
    town: "Avery",
    venue_name: "Howard's Mystic Saloon Bar",
    address: "4529 CA-4, Murphys, CA 95247",
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
    category: "live_music",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.address, "4529 CA-4, Murphys, CA 95247");
  assert.equal(ev.town, "Avery");
});

test("a letter-suffixed street number is NOT the same number (448 vs 448B)", async () => {
  const { normalizeEventLocation } = await load();
  // leadingStreetNumber keeps the suffix: the registry holds two different
  // venues at 448 and 448B one street apart, so dropping it would anchor
  // them together (review of #278). A registry venue at 448B must not adopt
  // over an event address at bare 448 in another town.
  const ev = {
    name: "Live Music Upstairs",
    description: null,
    date: "2026-09-12",
    town: "Murphys",
    venue_name: "Boyle MacDonald Wines",
    address: "448 Main St, Arnold, CA 95223",
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
    category: "live_music",
  } as never as Parameters<typeof normalizeEventLocation>[0];
  normalizeEventLocation(ev);
  assert.equal(ev.address, "448 Main St, Arnold, CA 95223");
});
