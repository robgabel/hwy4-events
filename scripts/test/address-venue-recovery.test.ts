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
