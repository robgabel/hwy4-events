// CI pin for the *_locked consumer registry (lib/lock-consumers.ts, HWY-50).
//
// Five consumers check different subsets of the lock columns, on purpose.
// This test fails when repo SQL grows an eighth hwy4_events.*_locked column
// that any consumer has not guarded or acknowledged, and it fails when a
// `guards` claim is not what the source actually does. The daily
// scripts/check-qa-schema-drift.ts job is the live-table twin.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ACKNOWLEDGED_UNGUARDED_LOCKS,
  LOCK_GUARDS,
} from "../../lib/agent/qa-fix-event.js";
import {
  LOCK_CONSUMERS,
  describeLockConsumerDrift,
  findLockConsumerDrift,
  hasLockConsumerDrift,
  hwy4EventLockColumnsFromSql,
  locksGuardedBy,
  type LockConsumer,
} from "../../lib/lock-consumers.js";
import { isProtectedRow, type SweepRow } from "../lib/stale-sweep.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function consumer(id: string): LockConsumer {
  const found = LOCK_CONSUMERS.find((c) => c.id === id);
  assert.ok(found, `missing lock consumer ${id}`);
  return found;
}

/**
 * The body of a named function, brace-matched from its declaration.
 * Parameter lists are skipped first so a type literal (`existing: { ... }`)
 * is not mistaken for the body.
 */
function functionBody(src: string, decl: string): string {
  const start = src.indexOf(decl);
  assert.ok(start >= 0, `could not find ${decl}`);
  let i = start + decl.length;
  const paren = src.indexOf("(", i);
  if (paren >= 0 && paren < i + 80) {
    let depth = 0;
    for (i = paren; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
  }
  const open = src.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, j + 1);
    }
  }
  throw new Error(`unbalanced braces after ${decl}`);
}

function repoEventLockSql(): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".sql")) files.push(path);
    }
  };
  walk(join(repoRoot, "supabase"));
  return files.map((path) => readFileSync(path, "utf8")).join("\n");
}

function sweepRow(extra: Record<string, unknown>): SweepRow {
  return {
    id: "1",
    name: "Patio Party",
    date: "2026-08-14",
    source_event_id: "sid",
    event_url: null,
    ...extra,
  } as SweepRow;
}

test("five consumers are registered, each with its own stance", () => {
  assert.deepEqual(
    LOCK_CONSUMERS.map((c) => c.id),
    [
      "qa-fix-event",
      "stale-sweep",
      "dedup-update",
      "scrape-moose-lodge",
      "scrape-bls",
    ]
  );
});

test("qa-fix-event's stance is the object the executor already reads", () => {
  const qa = consumer("qa-fix-event");
  assert.equal(qa.guards, LOCK_GUARDS);
  assert.equal(qa.acknowledged, ACKNOWLEDGED_UNGUARDED_LOCKS);
});

test("every acknowledgement is a human-readable reason", () => {
  for (const c of LOCK_CONSUMERS) {
    for (const [lock, reason] of Object.entries(c.acknowledged)) {
      assert.equal(lock.endsWith("_locked"), true, `${c.id} ack key ${lock}`);
      assert.ok(
        reason.trim().length >= 40,
        `${c.id} acknowledgement of ${lock} needs a one-line why, not a token`
      );
      assert.equal(
        /^(n\/a|todo|tbd|ack|acknowledged)$/i.test(reason.trim()),
        false,
        `${c.id} ${lock}`
      );
    }
  }
});

test("stale-sweep guards visibility_locked instead of acknowledging the old gap", () => {
  const sweep = consumer("stale-sweep");
  assert.equal(Object.keys(sweep.acknowledged).length, 0);
  assert.ok(locksGuardedBy(sweep.guards).includes("visibility_locked"));

  const body = functionBody(read(sweep.sourceFile), "export function isProtectedRow");
  assert.match(body, /STALE_SWEEP_LOCK_GUARDS/);
  assert.doesNotMatch(body, /row\.visibility_locked/);

  for (const lock of locksGuardedBy(sweep.guards)) {
    assert.equal(
      isProtectedRow(sweepRow({ [lock]: true })),
      "locked",
      `${lock} must protect the row from the sweep`
    );
  }
  assert.equal(isProtectedRow(sweepRow({})), null);
});

test("dedup update path reads every lock it claims to guard", () => {
  const dedup = consumer("dedup-update");
  const src = read(dedup.sourceFile);
  const guarded = locksGuardedBy(dedup.guards).sort();
  const mentioned = [
    ...new Set([...src.matchAll(/existing\.(\w+_locked)/g)].map((m) => m[1])),
  ].sort();
  assert.deepEqual(
    mentioned,
    guarded,
    "existing.<lock> reads in dedup.ts must match DEDUP_UPDATE_LOCK_GUARDS"
  );
  assert.equal(mentioned.includes("visibility_locked"), false);
  assert.match(dedup.acknowledged.visibility_locked, /INSERT only/);

  const rowChanged = functionBody(src, "export function rowChanged");
  for (const lock of guarded) {
    assert.match(rowChanged, new RegExp(`existing\\.${lock}\\b`), `rowChanged drops ${lock}`);
  }
  // familyFriendlyPatch's return type is an object literal, so a brace match
  // from the signature stops on the type. The guard itself is this line.
  assert.match(src, /if \(existing\.family_friendly_locked\) return \{\};/);

  for (const decl of [
    "export function buildStrongMatchUpdate",
    "export function buildExactMatchUpdate",
  ]) {
    const body = functionBody(src, decl);
    assert.match(body, /familyFriendlyPatch\(/, `${decl} must call familyFriendlyPatch`);
    for (const lock of guarded) {
      if (lock === "family_friendly_locked") continue;
      assert.match(
        body,
        new RegExp(`existing\\.${lock}\\b`),
        `${decl} must honor ${lock}`
      );
    }
  }

  // Column lists are single-line quoted strings. A `[^"]*` match walks into
  // comment quotes ("whoever scraped last…") and then through the function.
  const selects = [...src.matchAll(/"([^"\n]*price_locked[^"\n]*)"/g)].map((m) => m[1]);
  assert.ok(selects.length >= 4, "expected the update-path selects to mention price_locked");
  for (const select of selects) {
    for (const lock of guarded) {
      assert.ok(select.includes(lock), `select omits ${lock}: ${select}`);
    }
  }
});

test("moose-lodge update drops every field its guards name", () => {
  const moose = consumer("scrape-moose-lodge");
  const src = read(moose.sourceFile);
  const guarded = locksGuardedBy(moose.guards).sort();
  const mentioned = [
    ...new Set([...src.matchAll(/existing\.(\w+_locked)/g)].map((m) => m[1])),
  ].sort();
  assert.deepEqual(mentioned, guarded);
  assert.equal(src.includes("poster_locked"), false);
  assert.equal(src.includes("image_url"), false);
  assert.match(moose.acknowledged.poster_locked, /image_url/);

  for (const lock of guarded) {
    assert.match(src, new RegExp(`existing\\.${lock}\\b`));
  }
  for (const [field, lock] of Object.entries(moose.guards)) {
    assert.match(
      src,
      new RegExp(`delete updateRow\\.${field}\\b`),
      `${lock} must drop ${field} from the moose update`
    );
  }
});

test("scrape-bls is insert-only, so every lock is an acknowledgement", () => {
  const bls = consumer("scrape-bls");
  const src = read(bls.sourceFile);
  assert.deepEqual(locksGuardedBy(bls.guards), []);
  assert.equal(
    src.includes(".update("),
    false,
    "an update path must take a per-lock stance in LOCK_CONSUMERS before it ships"
  );
  assert.equal(/_locked\b/.test(src), false);
  assert.match(src, /\.insert\(/);
});

test("repo SQL lock columns and the registry agree", () => {
  const columns = hwy4EventLockColumnsFromSql(repoEventLockSql());
  assert.equal(columns.includes("places_locked"), false);
  for (const lock of [
    "description_locked",
    "family_friendly_locked",
    "notability_locked",
    "poster_locked",
    "price_locked",
    "times_locked",
    "visibility_locked",
  ]) {
    assert.ok(columns.includes(lock), `repo SQL is missing ${lock}`);
  }
  const drift = findLockConsumerDrift(columns);
  assert.equal(hasLockConsumerDrift(drift), false, describeLockConsumerDrift(drift));
});

test("SQL parser ignores comments and locks on other tables", () => {
  const columns = hwy4EventLockColumnsFromSql(`
    -- phantom_locked is only a comment, and places_locked is hwy4_venues.
    ALTER TABLE hwy4_venues ADD COLUMN IF NOT EXISTS places_locked boolean;
    CREATE TABLE hwy4_events (
      price_locked boolean not null default false
    );
    ALTER TABLE hwy4_events
      ADD COLUMN IF NOT EXISTS eighth_locked boolean NOT NULL DEFAULT false;
    COMMENT ON COLUMN hwy4_events.price_locked IS 'mentions poster_locked in prose';
  `);
  assert.deepEqual(columns, ["eighth_locked", "price_locked"]);
});

test("an eighth *_locked column fails until every consumer takes a stance", () => {
  const columns = [...hwy4EventLockColumnsFromSql(repoEventLockSql()), "brand_new_locked"];
  const drift = findLockConsumerDrift(columns);
  assert.equal(hasLockConsumerDrift(drift), true);
  assert.deepEqual(
    drift.unguarded.map((g) => g.consumer),
    LOCK_CONSUMERS.map((c) => c.id)
  );
  assert.ok(drift.unguarded.every((g) => g.lock === "brand_new_locked"));
  assert.match(describeLockConsumerDrift(drift), /brand_new_locked/);
  assert.match(describeLockConsumerDrift(drift), /scrape-bls/);
  assert.match(describeLockConsumerDrift(drift), /stale-sweep/);
});

test("a blank reason, a conflict, and a guard for a missing column are drift", () => {
  const live = ["price_locked"];
  const blank = findLockConsumerDrift(live, [
    {
      id: "example",
      sourceFile: "example.ts",
      guards: {},
      acknowledged: { price_locked: "   " },
    },
  ]);
  assert.deepEqual(blank.blankReasons, [{ consumer: "example", lock: "price_locked" }]);
  assert.equal(hasLockConsumerDrift(blank), true);

  const conflict = findLockConsumerDrift(live, [
    {
      id: "example",
      sourceFile: "example.ts",
      guards: { price: "price_locked" },
      acknowledged: { price_locked: "Guarded and acknowledged at once." },
    },
  ]);
  assert.deepEqual(conflict.conflicts, [{ consumer: "example", lock: "price_locked" }]);

  const missing = findLockConsumerDrift(live, [
    {
      id: "example",
      sourceFile: "example.ts",
      guards: { image_url: "poster_locked" },
      acknowledged: {},
    },
  ]);
  assert.deepEqual(missing.missingGuards, [{ consumer: "example", lock: "poster_locked" }]);
  assert.deepEqual(missing.unguarded, [{ consumer: "example", lock: "price_locked" }]);
});
