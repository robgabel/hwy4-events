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
  LOCK_GUARDS,
  describeQaSchemaDrift,
  findQaSchemaDrift,
  hasQaSchemaDrift,
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
  // town/venue_name carry no lock flag; start_time does (times_locked) and is
  // asserted in the times_locked test below.
  assert.deepEqual(lockColumnsFor(["town", "venue_name"]), []);
});

test("lockedViolations flags exactly the locked touched columns", () => {
  const row = { description_locked: true, price_locked: false };
  assert.deepEqual(lockedViolations(row, ["description", "price", "start_time"]), [
    "description",
  ]);
  assert.deepEqual(lockedViolations({}, ["description"]), []);
});

// --- Schema-drift guard ------------------------------------------------------
// The whitelist is plain strings, so nothing here can prove a column still
// exists — that needs the live table (scripts/check-qa-schema-drift.ts). What
// these lock is the comparison itself, so the sensor can't rot into a no-op
// that reports "clean" no matter what the DB says.

// The real hwy4_events column set at the time of writing, trimmed to what this
// module references. Not a mirror of the table — just a realistic input.
const LIVE_COLUMNS = [
  ...QA_FIXABLE_COLUMNS,
  "description_locked",
  "price_locked",
  "poster_locked",
  "notability_locked",
  "times_locked",
  "id",
  "dedup_key",
  "robs_pick",
];

test("no drift when every whitelisted column and lock flag exists", () => {
  const drift = findQaSchemaDrift(LIVE_COLUMNS);
  assert.deepEqual(drift.missingFixable, []);
  assert.deepEqual(drift.missingGuards, []);
  assert.deepEqual(drift.unguardedLocks, []);
  assert.equal(hasQaSchemaDrift(drift), false);
});

test("times_locked guards BOTH clock fields, as the scrapers treat it", () => {
  // scripts/lib/dedup.ts drops start_time AND end_time from the merge payload
  // when times_locked is set; an approved QA fix must refuse for the same reason.
  assert.deepEqual(lockColumnsFor(["start_time"]), ["times_locked"]);
  assert.deepEqual(lockColumnsFor(["end_time"]), ["times_locked"]);
  assert.deepEqual(lockColumnsFor(["start_time", "end_time"]), ["times_locked"]);
  assert.deepEqual(
    lockedViolations({ times_locked: true }, ["start_time", "end_time", "town"]).sort(),
    ["end_time", "start_time"]
  );
  assert.deepEqual(lockedViolations({ times_locked: false }, ["start_time"]), []);
});

test("a NEW lock flag on the table fails until it is guarded or acknowledged", () => {
  // The HWY-24 visibility_locked case: the schema grows a protection and the QA
  // agent silently does not honor it. Drift in the direction the old check missed.
  const drift = findQaSchemaDrift([...LIVE_COLUMNS, "visibility_locked"]);
  assert.deepEqual(drift.missingFixable, []);
  assert.deepEqual(drift.unguardedLocks, ["visibility_locked"]);
  assert.equal(hasQaSchemaDrift(drift), true);
  assert.match(describeQaSchemaDrift(drift), /visibility_locked/);
});

test("an acknowledged lock is not reported as unguarded", () => {
  // notability_locked guards robs_pick / is_routine — neither QA-fixable.
  assert.ok(LIVE_COLUMNS.includes("notability_locked"));
  assert.equal(findQaSchemaDrift(LIVE_COLUMNS).unguardedLocks.length, 0);
});

test("a dropped fixable column is caught (the `importance` / HWY-19 case)", () => {
  // Exactly the 2026-08-18 regression: the whitelist still named a column the
  // migration had dropped, and every unit test stayed green.
  const withStale = findQaSchemaDrift(LIVE_COLUMNS.filter((c) => c !== "venue_name"));
  assert.deepEqual(withStale.missingFixable, ["venue_name"]);
  assert.equal(hasQaSchemaDrift(withStale), true);
  assert.match(describeQaSchemaDrift(withStale), /venue_name/);
});

test("a dropped lock flag is caught, not just a dropped fixable column", () => {
  const drift = findQaSchemaDrift(LIVE_COLUMNS.filter((c) => c !== "poster_locked"));
  assert.deepEqual(drift.missingFixable, []);
  assert.deepEqual(drift.missingGuards, ["poster_locked"]);
  assert.equal(hasQaSchemaDrift(drift), true);
});

test("every LOCK_GUARDS key is itself a fixable column", () => {
  // A guard on a column the agent can't touch is dead config; a guard whose key
  // was removed from the whitelist would silently stop being enforced.
  for (const key of Object.keys(LOCK_GUARDS)) {
    assert.ok(
      (QA_FIXABLE_COLUMNS as readonly string[]).includes(key),
      `LOCK_GUARDS key "${key}" is not in QA_FIXABLE_COLUMNS`
    );
  }
});

test("the whitelist never admits an identity, provenance, or lock column", () => {
  const forbidden = [
    "id", "dedup_key", "source_event_id", "source_name", "source_url",
    "org_slug", "venue_key", "created_at", "updated_at", "community_sourced",
    "robs_pick", "series_umbrella", "is_routine",
    "description_locked", "price_locked", "poster_locked", "notability_locked",
    "times_locked", "places_locked",
  ];
  for (const col of forbidden) {
    assert.ok(
      !(QA_FIXABLE_COLUMNS as readonly string[]).includes(col),
      `${col} must never be QA-fixable`
    );
  }
});
