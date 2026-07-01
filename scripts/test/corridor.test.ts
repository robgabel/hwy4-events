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
import {
  isNonCorridorAddress,
  isNonCorridorDescription,
  isOutOfCorridor,
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
