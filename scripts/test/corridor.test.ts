// Corridor-membership drop logic, with focus on the description-locative signal
// added after the "Calaveras Community Band" July 4 / Turner Park, San Andreas
// mislabel: the county-wide GoCalaveras aggregator tagged the row's
// town/venue/address as Murphys (in corridor) while the event's own description
// read "at Turner Park in San Andreas" (out of corridor). The address-only
// filter let it through; the description signal catches it — without nuking
// in-corridor listings that merely name the "San Andreas Fault".
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isNonCorridorAddress,
  isNonCorridorDescription,
  isOutOfCorridor,
  isOutOfCorridorLocation,
} from "../lib/corridor.js";

test("address-only corridor check is unchanged", () => {
  assert.equal(isNonCorridorAddress("Turner Park, San Andreas, CA 95249"), true);
  assert.equal(isNonCorridorAddress("Murphys Community Park, Murphys, CA"), false);
  assert.equal(isNonCorridorAddress(null), false);
});

test("description locative signal catches a mislabeled town", () => {
  // The exact failure: structured location said Murphys, prose said San Andreas.
  assert.equal(
    isNonCorridorDescription("Join us at Turner Park in San Andreas for the concert."),
    true
  );
  assert.equal(isNonCorridorDescription("Concert in San Andreas, CA."), true);
  assert.equal(isNonCorridorDescription("Held in Valley Springs this year."), true);
});

test("description signal does NOT trip on the San Andreas Fault", () => {
  // Geological feature, not a location — in-corridor trail/nature listings that
  // name the fault must survive.
  assert.equal(
    isNonCorridorDescription(
      "A guided hike along the San Andreas Fault, meeting in Murphys."
    ),
    false
  );
  assert.equal(isNonCorridorDescription("Views of the San Andreas fault zone."), false);
});

test("description signal ignores a bare, non-locative mention", () => {
  // A Murphys event that merely references a neighboring town isn't out of
  // corridor — only a locative phrase ("in <city>", "<city>, CA") trips it.
  assert.equal(
    isNonCorridorDescription("Easy drive from San Andreas or Angels Camp."),
    false
  );
  assert.equal(isNonCorridorDescription(null), false);
});

test("isOutOfCorridor folds in the description signal", () => {
  // The regression case, wired through the write-boundary drop test: corridor
  // town + corridor venue, but the description gives it away.
  assert.equal(
    isOutOfCorridor(
      "Murphys Community Park, Murphys, CA",
      "Murphys Community Park",
      "Celebration Concert at Turner Park in San Andreas."
    ),
    true
  );
  // Clean in-corridor event stays in.
  assert.equal(
    isOutOfCorridor(
      "Murphys Community Park, Murphys, CA",
      "Murphys Community Park",
      "An afternoon of music in the park."
    ),
    false
  );
  // Description is optional — old two-arg callers behave as before.
  assert.equal(isOutOfCorridor("123 Main St, Murphys, CA", "Some Venue"), false);
});

// The live miss (issue #378): Facebook Discover's Copperopolis radius returned
// a Farmington campout and the mapper stamped the feed town, so the site
// listed it as a Copperopolis kids event.
const GOONIES_ADDRESS =
  "7422 Rock Creek Road, Farmington, CA, United States, California 95230";

const CORRIDOR_TOWNS = [
  "Copperopolis, CA 95228",
  "Angels Camp, CA 95222",
  "Murphys, CA 95247",
  "Avery, CA 95224",
  "White Pines, CA",
  "Arnold, CA 95223",
  "Dorrington, CA 95223",
  "Camp Connell, CA 95223",
  "Bear Valley, CA 95223",
];

test("Farmington campout address is out of corridor", () => {
  assert.equal(
    isOutOfCorridor(GOONIES_ADDRESS, "Rocksteady Adventures", null),
    true
  );
  // The city can arrive in its own field, with the street kept separate.
  // That shape must still drop, or the mapper stamps Copperopolis.
  assert.equal(
    isOutOfCorridorLocation(
      ["7422 Rock Creek Road", "Farmington"],
      "Rocksteady Adventures",
      null
    ),
    true
  );
  // A bare ZIP, no city word, is the same place.
  assert.equal(
    isOutOfCorridor("7422 Rock Creek Road, CA 95230", "Rocksteady Adventures"),
    true
  );
});

test("valley towns west of Copperopolis are out of corridor", () => {
  const addresses = [
    "100 Main St, Oakdale, CA 95361",
    "Knight's Ferry, CA 95361",
    "200 Main, Escalon, CA 95320",
    "Linden, CA 95236",
    "Jenny Lind, CA 95252",
    "10 River Rd, Riverbank, CA 95367",
    "Waterford, California 95386",
  ];
  for (const address of addresses) {
    assert.equal(isOutOfCorridor(address, "Some Venue", null), true, address);
  }
  assert.equal(
    isNonCorridorDescription("Campout held in Farmington this weekend."),
    true
  );
  assert.equal(isNonCorridorDescription("Meet in Oakdale, CA."), true);
  // A town field of the real city drops even when the address is blank,
  // so the row is not published under a corridor town instead.
  assert.equal(isOutOfCorridor(null, "Rocksteady Adventures", null, "Farmington"), true);
});

test("corridor towns and Milton still pass", () => {
  for (const address of CORRIDOR_TOWNS) {
    assert.equal(isOutOfCorridor(address, "Town Park", null), false, address);
  }
  // Milton is in Calaveras, next to Copperopolis. Not on the denylist.
  assert.equal(isOutOfCorridor("Milton, CA 95684", "Milton Hall", null), false);
  // Some geocoders write Farmington's ZIP on a Milton address.
  assert.equal(
    isOutOfCorridor("123 Main St, Milton, CA 95230", "Milton Hall", null),
    false
  );
  assert.equal(isOutOfCorridor(null, "Some Venue", null, "Milton"), false);
  assert.equal(isOutOfCorridor(null, "Some Venue", null, "Copperopolis"), false);
});

test("a corridor street named like a valley town is not out of corridor", () => {
  assert.equal(
    isOutOfCorridor("123 Linden St, Murphys, CA 95247", "Murphys Park"),
    false
  );
  assert.equal(
    isOutOfCorridor("10 Oakdale Road, Copperopolis, CA 95228", "The Club"),
    false
  );
  assert.equal(
    isOutOfCorridor("100 Milton Road, Copperopolis, CA 95228", "A Venue"),
    false
  );
  assert.equal(
    isNonCorridorDescription("Turn in Linden Street, then park in Murphys."),
    false
  );
  assert.equal(
    isNonCorridorDescription("Picnic along the riverbank in Angels Camp."),
    false
  );
  // A street-only Copperopolis feed row (no valley city) stays in.
  assert.equal(
    isOutOfCorridorLocation(
      ["1001 Saddle Creek Dr", "Copperopolis"],
      "The Golf Club at Copper Valley",
      null
    ),
    false
  );
});

test("FB mapper drops an out-of-corridor location before stamping the feed town", () => {
  const src = readFileSync(new URL("../lib/facebook-events.ts", import.meta.url), "utf8");
  const start = src.indexOf("function mapApifyEvent");
  const end = src.indexOf("async function classifyCategoriesBatch");
  assert.ok(start !== -1 && end > start);
  const fn = src.slice(start, end);
  const dropAt = fn.indexOf("isOutOfCorridorLocation");
  const townAt = fn.indexOf("resolveTown(");
  assert.ok(dropAt !== -1, "mapper must consult the corridor filter");
  assert.ok(townAt !== -1 && dropAt < townAt, "filter runs before the feed town is stamped");
  // Upsert also passes the town field, so a row whose town is already
  // "Farmington" cannot sneak through on a blank address.
  const dedup = readFileSync(new URL("../lib/dedup.ts", import.meta.url), "utf8");
  assert.match(
    dedup,
    /isOutOfCorridor\(e\.address, e\.venue_name, e\.description, e\.town\)/
  );
});
