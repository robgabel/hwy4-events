// Drift guard for HWY-25: a venue fact hardcoded in a scraper must equal the
// scripts/lib/venues.ts registry entry that owns it.
//
// Why it exists. `app/api/scrape-moose-lodge/route.ts` carried
// `LODGE.address = "3049 CA-4, Arnold, CA 95223"`. The lodge is on Blagen Rd at
// White Pines Lake, nowhere near that stretch of Highway 4, and 18 upcoming rows
// shipped the wrong address — wrong static-map thumbnail, wrong Get Directions.
// The root cause is structural: this route (like /api/scrape-bls and
// scripts/scrapers/bistro-espresso.ts) writes its own INSERT instead of going
// through `upsertEvents`, so it never receives the registry address fill that
// `normalizeEventLocation` gives every other scraper. That leaves a SECOND,
// drifting copy of a fact the registry already owns. The literal was corrected
// in #249, but nothing stopped it drifting again, which is the same shape as
// the bug.
//
// This is the image-hosts.test.ts pattern: the duplicate is allowed to exist,
// but CI fails the moment it stops matching its source of truth. Edit the
// registry and this test tells you which literal has to follow.
//
// Two classes are pinned:
//   * ADDRESS literals — the actual #249 bug.
//   * VENUE NAME literals — a raw-insert writer's name string lands in the row
//     verbatim, so it must be a registry CANONICAL, not an alias. /api/scrape-bls
//     emitted "BLS Amphitheater" and "BLS Pool" (alias spellings), which no
//     venue_key could resolve, so those rows got no hub page and no facts.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KNOWN_VENUES } from "../lib/venues.js";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Pull `<name>: "<value>"` or `const <NAME> = "<value>"` out of a source file. */
function literal(src: string, pattern: RegExp, label: string): string {
  const m = src.match(pattern);
  assert.ok(m, `could not find ${label} — did the constant get renamed?`);
  return m![1];
}

const registryAddress = (key: string): string => {
  const v = KNOWN_VENUES[key];
  assert.ok(v, `registry has no entry "${key}"`);
  assert.ok(v.address, `registry entry "${key}" has no address to pin against`);
  return v.address!;
};

const CANONICALS = new Set(Object.values(KNOWN_VENUES).map((v) => v.canonical));

test("scrape-moose-lodge address matches the registry (the #249 bug)", () => {
  const src = read("../../app/api/scrape-moose-lodge/route.ts");
  const addr = literal(src, /address:\s*"([^"]+)"/, "LODGE.address");
  assert.equal(
    addr,
    registryAddress("ebbetts-pass-moose-lodge"),
    "the hardcoded lodge address drifted from scripts/lib/venues.ts. The registry is the source of truth; update the literal to match it."
  );
});

test("scrape-moose-lodge venue name is the registry canonical", () => {
  const src = read("../../app/api/scrape-moose-lodge/route.ts");
  const venue = literal(src, /venue:\s*"([^"]+)"/, "LODGE.venue");
  assert.equal(venue, KNOWN_VENUES["ebbetts-pass-moose-lodge"].canonical);
});

test("bistro-espresso address matches the registry", () => {
  const src = read("../scrapers/bistro-espresso.ts");
  const addr = literal(src, /const ADDRESS = "([^"]+)"/, "ADDRESS");
  assert.equal(addr, registryAddress("bistro-espresso"));
});

test("bistro-espresso venue name is the registry canonical", () => {
  const src = read("../scrapers/bistro-espresso.ts");
  const venue = literal(src, /const VENUE_NAME = "([^"]+)"/, "VENUE_NAME");
  assert.equal(venue, KNOWN_VENUES["bistro-espresso"].canonical);
});

// /api/scrape-bls carries no address literal at all (it writes none), but it
// picks a venue NAME from a fixed list, and that string is what lands in the row.
test("every venue name /api/scrape-bls can emit is a registry canonical", () => {
  const src = read("../../app/api/scrape-bls/route.ts");
  const fn = src.slice(src.indexOf("function resolveVenue"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  const pairs = [...body.matchAll(/name: "([^"]+)", venueKey: "([^"]+)"/g)].map((m) => ({
    name: m[1],
    key: m[2],
  }));

  assert.ok(pairs.length >= 5, `expected resolveVenue to return several venues, saw ${pairs.length}`);
  for (const { name, key } of pairs) {
    assert.ok(
      CANONICALS.has(name),
      `resolveVenue returns "${name}", which is not a canonical in scripts/lib/venues.ts. ` +
        "This route raw-INSERTs, so the string lands in venue_name verbatim and an " +
        "alias spelling can never resolve to a venue_key (HWY-25)."
    );
    assert.equal(
      KNOWN_VENUES[key]?.canonical,
      name,
      `resolveVenue pairs "${name}" with venue_key "${key}", which is not that entry's key`
    );
  }
});

// HWY-48. These three writers insert (and, for bistro and the lodge, update)
// without going through upsertEvents, so a missing venue_key stays NULL forever.
// The drift guard is the same shape as the address pin above: the write has to
// name the column, and a hardcoded key has to be the registry key.
test("raw-insert writers stamp venue_key", () => {
  const bistro = read("../scrapers/bistro-espresso.ts");
  const bistroInsert = bistro.slice(bistro.lastIndexOf(".insert({"));
  assert.match(bistroInsert, /venue_key:\s*resolvedKey/);
  assert.match(bistro, /venue_key:\s*nextKey/);
  assert.match(bistro, /venue_key:\s*keepStr\(resolvedKey, existing\.venue_key\)/);

  const moose = read("../../app/api/scrape-moose-lodge/route.ts");
  const venueKey = literal(moose, /venueKey:\s*"([^"]+)"/, "LODGE.venueKey");
  assert.equal(venueKey, "ebbetts-pass-moose-lodge");
  assert.equal(KNOWN_VENUES[venueKey].canonical, literal(moose, /venue:\s*"([^"]+)"/, "LODGE.venue"));
  assert.match(moose, /venue_key:\s*LODGE\.venueKey/);

  const bls = read("../../app/api/scrape-bls/route.ts");
  const blsInsert = bls.slice(bls.indexOf('.from("hwy4_events").insert({'));
  assert.match(blsInsert, /venue_key:\s*venue\.venueKey/);
});

// The registry entries these writers depend on must keep a street address, or
// the pin above silently becomes unenforceable.
test("registry entries backing the raw-insert writers still carry addresses", () => {
  for (const key of ["ebbetts-pass-moose-lodge", "bistro-espresso", "blue-lake-bistro"]) {
    assert.ok(
      KNOWN_VENUES[key]?.address,
      `registry entry "${key}" lost its address; a raw-insert writer depends on it`
    );
  }
});
