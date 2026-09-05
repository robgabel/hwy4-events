// Regression lock for HWY-33: a failed row UPDATE must never be counted as a
// success.
//
// Why it exists: scripts/lib/dedup.ts had TWO exact-match update paths. The
// batched one destructured Supabase's `error` and skipped the counter; the
// SERIAL one (the default, since BATCH_DEDUP gates the other) never looked at
// `error` at all and ran `result.updated++` unconditionally. A run whose writes
// were all rejected still reported them as updated, and that count is what
// lands in scrape_runs.source_results and feeds /admin/scrapers plus the weekly
// memo. Same rule as the scrape_runs writer itself: a sensor that can fail
// silently is not a sensor.
//
// Two locks here, because the behavior fix alone would let the paths drift
// apart again (the drift family of the inline rowChanged copy fixed 2026-08-16):
//   1. countUpdateResult's own contract
//   2. a source-level guard that NO path bumps a success counter on its own
//
// dedup.ts imports scripts/lib/supabase-admin, which throws at import time when
// the service-role env is unset, so set dummy env then dynamic-import (the same
// preamble times-locked.test.ts uses).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

async function load() {
  return import("../lib/dedup.js");
}

const emptyResult = () => ({
  inserted: 0,
  updated: 0,
  unchanged: 0,
  skippedFuzzy: 0,
  unpinned: 0,
});

// Keep console.error quiet while asserting the failure path.
async function silently<T>(fn: () => T): Promise<T> {
  const real = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = real;
  }
}

test("a successful update increments its bucket and reports true", async () => {
  const { countUpdateResult } = await load();
  const r = emptyResult();
  assert.equal(countUpdateResult(r, "updated", null, "Wolf Jett"), true);
  assert.equal(r.updated, 1);
  assert.equal(r.unchanged, 0);
  assert.equal(r.skippedFuzzy, 0);
});

test("a FAILED update increments nothing and reports false (the HWY-33 bug)", async () => {
  const { countUpdateResult } = await load();
  const r = emptyResult();
  const ok = await silently(() =>
    countUpdateResult(r, "updated", { message: "permission denied" }, "Wolf Jett")
  );
  assert.equal(ok, false);
  // The whole point: a rejected write is NOT an update.
  assert.equal(r.updated, 0);
  assert.equal(r.unchanged, 0);
  assert.equal(r.skippedFuzzy, 0);
});

test("undefined error is treated as success, not failure", async () => {
  // Supabase returns `error: null`, but the batched path reads it off an array
  // element, so `undefined` has to mean the same thing.
  const { countUpdateResult } = await load();
  const r = emptyResult();
  assert.equal(countUpdateResult(r, "unchanged", undefined, "Open Mic"), true);
  assert.equal(r.unchanged, 1);
});

test("each bucket is counted independently", async () => {
  const { countUpdateResult } = await load();
  const r = emptyResult();
  countUpdateResult(r, "updated", null, "a");
  countUpdateResult(r, "unchanged", null, "b");
  countUpdateResult(r, "skippedFuzzy", null, "c");
  await silently(() => countUpdateResult(r, "skippedFuzzy", { message: "boom" }, "d"));
  assert.deepEqual(
    { u: r.updated, n: r.unchanged, f: r.skippedFuzzy },
    { u: 1, n: 1, f: 1 }
  );
});

// The anti-drift lock. countUpdateResult is the ONLY place allowed to bump a
// per-row success counter, so a future path (a third writer, a refactor) cannot
// reintroduce an unchecked `result.updated++` without failing here.
test("no update path increments a success counter outside countUpdateResult", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/dedup.ts", import.meta.url)),
    "utf8"
  );

  // The helper does the bump generically (result[bucket]++), so any bump that
  // names a counter directly is by definition some OTHER path doing its own
  // accounting — exactly the shape that let the serial path count failures as
  // successes. There must be none.
  const namedBumps = [
    ...src.matchAll(/result\.(updated|unchanged|skippedFuzzy)\s*(\+\+|\+=)/g),
  ].map((m) => m[0]);

  assert.deepEqual(
    namedBumps,
    [],
    `a success counter is bumped directly (${namedBumps.join(", ")}). Route it ` +
      "through countUpdateResult so the serial and batched paths cannot drift " +
      "on error handling again (HWY-33)."
  );

  // And the helper itself must still be the thing doing the counting.
  assert.match(
    src,
    /export function countUpdateResult[\s\S]*?result\[bucket\]\+\+/,
    "countUpdateResult should be the single place a per-row update is counted"
  );
});
