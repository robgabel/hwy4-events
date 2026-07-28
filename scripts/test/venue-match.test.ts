// Lock for the app-side venue registry lookup (lib/venue-match.ts).
//
// This exists because the community-submission publish path was the one writer
// that never resolved a venue: every scraper goes through `resolveVenueKey` and
// stamps `venue_key`, while a published submission raw-inserted the reviewer's
// free text. That is how the 2026-07-28 Doc Nancy duplicate entered the catalog
// with `venue_key IS NULL`, stripped of the strongest signal the dedup layers
// have. The rule that matters here is the ambiguity rule: guessing a wrong key
// would assert a shared physical room and could merge two different events, so
// an ambiguous name must resolve to null.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchVenueRow, type VenueRegistryRow } from "../../lib/venue-match.js";

const REGISTRY: VenueRegistryRow[] = [
  {
    venue_key: "big-trees-state-park",
    canonical: "Calaveras Big Trees State Park",
    town: "Arnold",
    address: "1170 CA-4, Arnold, CA 95223",
  },
  {
    venue_key: "murphys-community-park",
    canonical: "Murphys Community Park",
    town: "Murphys",
    address: "505 Jones St, Murphys, CA 95247",
  },
  {
    venue_key: "bear-valley-lodge",
    canonical: "Bear Valley Lodge",
    town: "Bear Valley",
    address: null,
  },
  {
    venue_key: "bear-valley-adventure-company",
    canonical: "Bear Valley Adventure Company",
    town: "Bear Valley",
    address: null,
  },
];

test("resolves an exact venue name", () => {
  const hit = matchVenueRow("Calaveras Big Trees State Park", REGISTRY);
  assert.equal(hit?.venue_key, "big-trees-state-park");
});

test("resolves a submitter's loose rewrite of the venue name", () => {
  // The live submission text. Neither string contains the other (a dropped
  // "Calaveras" AND an added "overlook"), so only token overlap can see it.
  const hit = matchVenueRow("Big tree State Park overlook", REGISTRY);
  assert.equal(hit?.venue_key, "big-trees-state-park");
  assert.equal(hit?.address, "1170 CA-4, Arnold, CA 95223");
});

test("resolves through case and punctuation noise", () => {
  assert.equal(
    matchVenueRow("the  BIG TREES State Park", REGISTRY)?.venue_key,
    "big-trees-state-park"
  );
});

test("returns null rather than guessing on an unknown venue", () => {
  assert.equal(matchVenueRow("Somebody's Back Yard", REGISTRY), null);
  assert.equal(matchVenueRow("", REGISTRY), null);
  assert.equal(matchVenueRow(null, REGISTRY), null);
  assert.equal(matchVenueRow("TBA", REGISTRY), null);
});

test("does not collapse two registry venues that share a naming convention", () => {
  // "Bear Valley Lodge" must not drag in "Bear Valley Adventure Company".
  assert.equal(matchVenueRow("Bear Valley Lodge", REGISTRY)?.venue_key, "bear-valley-lodge");
  // A name that leans on only the shared prefix resolves to neither.
  assert.equal(matchVenueRow("Bear Valley", REGISTRY), null);
});

test("an exact match wins even when a fuzzy sibling also matches", () => {
  const rows: VenueRegistryRow[] = [
    ...REGISTRY,
    {
      venue_key: "murphys-community-park-stage",
      canonical: "Murphys Community Park Stage",
      town: "Murphys",
      address: null,
    },
  ];
  // Containment would match both; exact equality settles it without ambiguity.
  assert.equal(
    matchVenueRow("Murphys Community Park", rows)?.venue_key,
    "murphys-community-park"
  );
});
