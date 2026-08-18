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

test("a non-registry street address still swaps but adopts nothing", async () => {
  const { normalizeEventLocation } = await load();
  const ev = {
    name: "Yard Sale",
    description: null,
    date: "2026-10-04",
    town: "Arnold",
    venue_name: "9999 Nowhere Lane, Arnold CA 95223",
    address: null,
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
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
