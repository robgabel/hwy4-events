// Regression lock for the persona-QA fix primitive (lib/agent/qa-fix-event.ts):
// the column whitelist, the reason requirement, and the lock-respect rules.
// If someone widens the whitelist to an identity/provenance column or lets a
// fix through without a reason, this fails loudly.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QA_FIX_LOCKS_SET_KEY,
  QA_FIXABLE_COLUMNS,
  LOCK_GUARDS,
  describeQaSchemaDrift,
  findQaSchemaDrift,
  hasQaSchemaDrift,
  lockColumnsFor,
  lockedViolations,
  locksTurnedOn,
  qaFixBeforeSnapshot,
  qaFixRevertPayload,
  qaFixSnapshotRestores,
  qaFixWritePayload,
  validateQaFixPayload,
  type QaFixableColumn,
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
  assert.deepEqual(lockColumnsFor(["family_friendly"]), ["family_friendly_locked"]);
  assert.deepEqual(lockColumnsFor(["visibility"]), ["visibility_locked"]);
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
  "visibility_locked",
  "family_friendly_locked",
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
  const drift = findQaSchemaDrift([...LIVE_COLUMNS, "brand_new_locked"]);
  assert.deepEqual(drift.missingFixable, []);
  assert.deepEqual(drift.unguardedLocks, ["brand_new_locked"]);
  assert.equal(hasQaSchemaDrift(drift), true);
  assert.match(describeQaSchemaDrift(drift), /brand_new_locked/);
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

// Sample value an approved fix would write. A new LOCK_GUARDS key fails this
// map until someone names what "fixed" looks like for that column.
const FIXED_VALUE: Record<QaFixableColumn, unknown> = {
  name: "SPIRIT/SONG",
  date: "2026-10-10",
  start_time: "19:30",
  end_time: "21:45",
  venue_name: "Murphys Creek Theatre",
  town: "Murphys",
  address: "580 S. Algiers Street, Murphys, CA 95247",
  category: "fine_arts",
  price: "$25",
  cost_tier: "paid",
  event_url: "https://www.murphyscreektheatre.org/spirit-song",
  description: "Run time: approximately 2 hours 15 minutes, with intermission.",
  image_url: "https://example.com/spirit-song.jpg",
  artists: ["Company"],
  status: "confirmed",
  visibility: "public",
  family_friendly: false,
};

function otherHumanLock(lock: string): string {
  return lock === "description_locked" ? "price_locked" : "description_locked";
}

test("execute sets the matching lock for every guarded column, and revert clears only that lock", () => {
  for (const [column, lock] of Object.entries(LOCK_GUARDS) as [QaFixableColumn, string][]) {
    const next = FIXED_VALUE[column];
    const payload = qaFixWritePayload({ [column]: next });
    assert.equal(payload[column], next, column);
    assert.equal(payload[lock], true, `${column} must set ${lock}`);
    for (const other of new Set(Object.values(LOCK_GUARDS))) {
      if (other === lock) continue;
      assert.equal(other in payload, false, `${column} must not set ${other}`);
    }

    const previous = column === "family_friendly" ? true : "previous-value";
    const humanLock = otherHumanLock(lock);
    const snap = qaFixBeforeSnapshot(
      { [column]: previous, [lock]: false, [humanLock]: true },
      [column]
    );
    assert.deepEqual(snap[QA_FIX_LOCKS_SET_KEY], [lock], column);
    assert.equal(snap[column], previous);

    const revert = qaFixRevertPayload(snap);
    assert.equal(revert[column], previous, column);
    assert.equal(revert[lock], false, `${column} revert must clear ${lock}`);
    assert.equal(QA_FIX_LOCKS_SET_KEY in revert, false, column);
    assert.equal(humanLock in revert, false, `${humanLock} set earlier must survive revert of ${column}`);
  }
});

test("start_time and end_time share one times_locked", () => {
  const payload = qaFixWritePayload({ start_time: "19:30", end_time: "21:45" });
  assert.equal(payload.times_locked, true);
  assert.equal(payload.start_time, "19:30");
  assert.equal(payload.end_time, "21:45");
  const snap = qaFixBeforeSnapshot(
    { start_time: "19:30", end_time: "21:00", times_locked: false, description_locked: true },
    ["end_time", "start_time"]
  );
  assert.deepEqual(snap[QA_FIX_LOCKS_SET_KEY], ["times_locked"]);
  const revert = qaFixRevertPayload(snap);
  assert.equal(revert.start_time, "19:30");
  assert.equal(revert.end_time, "21:00");
  assert.equal(revert.times_locked, false);
  assert.equal("description_locked" in revert, false);
});

test("a lock already set is not recorded, so revert would not clear it", () => {
  // The executor refuses this fix before writing. The snapshot rule is the
  // backstop: a human lock that was already true is not in __locks_set.
  assert.deepEqual(
    locksTurnedOn({ end_time: "21:45", times_locked: true }, ["end_time"]),
    []
  );
  const snap = qaFixBeforeSnapshot({ end_time: "21:45", times_locked: true }, ["end_time"]);
  assert.equal(QA_FIX_LOCKS_SET_KEY in snap, false);
  assert.equal(qaFixRevertPayload(snap).times_locked, undefined);
});

test("unguarded columns are written with no lock flag", () => {
  const payload = qaFixWritePayload({
    name: "SPIRIT/SONG",
    town: "Murphys",
    category: "fine_arts",
    cost_tier: "paid",
  });
  assert.deepEqual(Object.keys(payload).sort(), ["category", "cost_tier", "name", "town"]);
  const snap = qaFixBeforeSnapshot(
    { name: "old", town: "Arnold", category: "other", cost_tier: "unknown" },
    ["name", "town", "category", "cost_tier"]
  );
  assert.equal(QA_FIX_LOCKS_SET_KEY in snap, false);
  assert.deepEqual(qaFixRevertPayload(snap), snap);
});

test("a snapshot from before locks were recorded restores the fields and clears nothing", () => {
  const revert = qaFixRevertPayload({ end_time: "21:00", description: "old" });
  assert.deepEqual(revert, { end_time: "21:00", description: "old" });
});

test("revert ignores a lock name this executor does not set", () => {
  const revert = qaFixRevertPayload({
    end_time: "21:00",
    [QA_FIX_LOCKS_SET_KEY]: ["times_locked", "notability_locked", "updated_at"],
  });
  assert.equal(revert.end_time, "21:00");
  assert.equal(revert.times_locked, false);
  assert.equal("notability_locked" in revert, false);
  assert.equal("updated_at" in revert, false);
  assert.equal(QA_FIX_LOCKS_SET_KEY in revert, false);
});

test("a snapshot that is only __locks_set does not count as reversible", () => {
  assert.equal(qaFixSnapshotRestores({ [QA_FIX_LOCKS_SET_KEY]: ["times_locked"] }), false);
  assert.equal(qaFixSnapshotRestores({}), false);
  assert.equal(qaFixSnapshotRestores({ end_time: "21:00" }), true);
});

test("the whitelist never admits an identity, provenance, or lock column", () => {
  const forbidden = [
    "id", "dedup_key", "source_event_id", "source_name", "source_url",
    "org_slug", "venue_key", "created_at", "updated_at", "community_sourced",
    "robs_pick", "series_umbrella", "is_routine",
    "description_locked", "price_locked", "poster_locked", "notability_locked",
    "times_locked", "visibility_locked", "family_friendly_locked", "places_locked",
  ];
  for (const col of forbidden) {
    assert.ok(
      !(QA_FIXABLE_COLUMNS as readonly string[]).includes(col),
      `${col} must never be QA-fixable`
    );
  }
});

// In-memory stand-in for the two calls execQaFixEvent / revert make:
// select().eq().maybeSingle() and update().eq().
function memoryEvents(row: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  let current = row ? { ...row } : null;
  const client = {
    from(table: string) {
      if (table !== "hwy4_events") throw new Error(`unexpected table ${table}`);
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _id: string) {
              return {
                maybeSingle: async () => ({ data: current, error: null }),
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          return {
            eq: async (_col: string, id: string) => {
              if (!current || current.id !== id) return { error: { message: "missing row" } };
              current = { ...current, ...payload };
              updates.push(payload);
              return { error: null };
            },
          };
        },
      };
    },
  };
  return {
    client,
    updates,
    get row() {
      return current;
    },
  };
}

test("the executor sets each guarded lock on approve and clears only that lock on revert", async () => {
  const { executeAction, revertAction } = await import("../../lib/agent/actions-executor.js");
  for (const [column, lock] of Object.entries(LOCK_GUARDS) as [QaFixableColumn, string][]) {
    const previous = column === "family_friendly" ? true : "previous-value";
    const humanLock = otherHumanLock(lock);
    const db = memoryEvents({
      id: "evt-1",
      [column]: previous,
      [lock]: false,
      [humanLock]: true,
    });
    const executed = await executeAction(db.client as never, {
      type: "qa_fix_event",
      payload: {
        event_id: "evt-1",
        updates: { [column]: FIXED_VALUE[column] },
        reason: "Checked against the organizer's page.",
      },
    } as never);
    assert.equal(executed.ok, true, `${column}: ${executed.error ?? ""}`);
    assert.equal(db.updates.length, 1, column);
    const write = db.updates[0];
    assert.equal(write[column], FIXED_VALUE[column], column);
    assert.equal(write[lock], true, `${column} execute must set ${lock}`);
    assert.equal(humanLock in write, false, column);
    const snap = executed.beforeSnapshot ?? {};
    assert.deepEqual(snap[QA_FIX_LOCKS_SET_KEY], [lock], column);
    assert.equal(snap[column], previous, column);
    assert.equal(db.row?.[lock], true, column);
    assert.equal(db.row?.[humanLock], true, column);

    const reverted = await revertAction(db.client as never, {
      type: "qa_fix_event",
      target_id: "evt-1",
      before_snapshot: snap,
    } as never);
    assert.equal(reverted.ok, true, `${column}: ${reverted.error ?? ""}`);
    assert.equal(db.row?.[column], previous, `${column} revert restores the value`);
    assert.equal(db.row?.[lock], false, `${column} revert clears ${lock}`);
    assert.equal(db.row?.[humanLock], true, `${humanLock} set earlier survives revert of ${column}`);
    const revertWrite = db.updates[1];
    assert.equal(QA_FIX_LOCKS_SET_KEY in revertWrite, false, column);
  }
});

test("the executor refuses a fix whose lock is already set and writes nothing", async () => {
  const { executeAction } = await import("../../lib/agent/actions-executor.js");
  const db = memoryEvents({ id: "evt-1", end_time: "21:45", times_locked: true });
  const executed = await executeAction(db.client as never, {
    type: "qa_fix_event",
    payload: {
      event_id: "evt-1",
      updates: { end_time: "21:00" },
      reason: "Aggregator still says 90 minutes.",
    },
  } as never);
  assert.equal(executed.ok, false);
  assert.match(executed.error ?? "", /human-locked/);
  assert.equal(db.updates.length, 0);
  assert.equal(db.row?.end_time, "21:45");
  assert.equal(db.row?.times_locked, true);
});

// dedup.ts imports scripts/lib/supabase-admin, which throws at import time
// without the service-role env. Dummy values: createClient makes no network
// call at construction. Same setup as times-locked.test.ts.
process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

test("a times_locked row keeps the corrected end_time through an exact-key re-scrape", async () => {
  const { buildExactMatchUpdate, buildStrongMatchUpdate, rowChanged } = await import("../lib/dedup.js");
  // SPIRIT/SONG shape from #366: the theatre runs ~2h15, both aggregators
  // publish a 90-minute window. The approved fix wrote 21:45 and times_locked.
  const stored = {
    id: "5e8b7ef8-6301-4aa2-9725-3c4cbcc6b3d4",
    name: "SPIRIT/SONG",
    date: "2026-10-10",
    venue_name: "Murphys Creek Theatre",
    venue_key: "murphys-creek-theatre",
    description: "Run time: approximately 2 hours 15 minutes, with intermission.",
    start_time: "19:30",
    end_time: "21:45",
    price: null,
    event_url: "https://www.murphyscreektheatre.org/spirit-song",
    address: "580 S. Algiers Street, Murphys, CA 95247",
    town: "Murphys",
    image_url: null,
    category: "fine_arts",
    artists: null,
    family_friendly: false,
    times_locked: true,
  };
  const scrape = {
    ...stored,
    end_time: "21:00",
    source_event_id: "190744",
  };
  assert.equal(
    rowChanged(stored as never, scrape as never),
    false,
    "a stale end_time alone must not mark a locked row changed"
  );

  // A description diff still updates the row. The clock stays out of the payload.
  const now = "2026-10-09T15:00:00.000Z";
  const exact = buildExactMatchUpdate(
    stored as never,
    { ...scrape, description: "90 minutes." } as never,
    "key",
    now
  ) as Record<string, unknown>;
  assert.equal("end_time" in exact, false);
  assert.equal("start_time" in exact, false);
  assert.equal(exact.description, "90 minutes.");

  const strong = buildStrongMatchUpdate(
    stored as never,
    scrape as never,
    "key",
    now
  ) as Record<string, unknown>;
  assert.equal("end_time" in strong, false);
  assert.equal("start_time" in strong, false);
});
