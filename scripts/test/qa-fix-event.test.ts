// Regression lock for the persona-QA fix primitive (lib/agent/qa-fix-event.ts):
// the column whitelist, the reason requirement, and the lock-respect rules.
// If someone widens the whitelist to an identity/provenance column or lets a
// fix through without a reason, this fails loudly.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QA_FIXABLE_COLUMNS,
  lockColumnsFor,
  lockedViolations,
  validateQaFixPayload,
} from "../../lib/agent/qa-fix-event.js";

const good = {
  event_id: "abc-123",
  updates: { start_time: "19:00", venue_name: "The Lube Room Saloon" },
  reason: "Detail page showed 7pm per the venue's poster; row said 9pm.",
};

test("a well-formed fix validates and lists its columns", () => {
  const v = validateQaFixPayload(good);
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.eventId, "abc-123");
    assert.deepEqual(v.columns.sort(), ["start_time", "venue_name"]);
  }
});

test("missing event_id / updates / reason each fail", () => {
  assert.equal(validateQaFixPayload({ ...good, event_id: " " }).ok, false);
  assert.equal(validateQaFixPayload({ ...good, updates: undefined }).ok, false);
  assert.equal(validateQaFixPayload({ ...good, updates: {} }).ok, false);
  assert.equal(validateQaFixPayload({ ...good, reason: "" }).ok, false);
});

test("identity and provenance columns are not fixable", () => {
  for (const col of [
    "id",
    "dedup_key",
    "source_name",
    "source_url",
    "org_slug",
    "venue_key",
    "community_sourced",
    "robs_pick",
    "created_at",
    "description_locked",
  ]) {
    assert.equal(
      (QA_FIXABLE_COLUMNS as readonly string[]).includes(col),
      false,
      `${col} must not be QA-fixable`
    );
    const v = validateQaFixPayload({ ...good, updates: { [col]: "x" } });
    assert.equal(v.ok, false, `updates.${col} must be rejected`);
  }
});

test("lock guards map the lockable fields to their flags", () => {
  assert.deepEqual(lockColumnsFor(["description", "price"]).sort(), [
    "description_locked",
    "price_locked",
  ]);
  assert.deepEqual(lockColumnsFor(["image_url"]), ["poster_locked"]);
  assert.deepEqual(lockColumnsFor(["start_time", "town"]), []);
});

test("lockedViolations flags exactly the locked touched columns", () => {
  const row = { description_locked: true, price_locked: false };
  assert.deepEqual(lockedViolations(row, ["description", "price", "start_time"]), [
    "description",
  ]);
  assert.deepEqual(lockedViolations({}, ["description"]), []);
});
