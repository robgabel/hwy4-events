// Regression lock for the unpinned-row guard (scripts/lib/unpinned-guard.ts).
//
// A row with neither `source_event_id` nor `event_url` is unverifiable (nothing
// to re-read), uncorrectable (correctFromUrl has no URL to check the date
// against) and unretractable (a stale sweep cannot key it) — the exact shape of
// the Murphys Irish Pub phantom lineup, 36 of 50 upcoming rows, 2026-08-09.
//
// The cases that matter most here are the ones that must NOT change: the seed
// scripts and the vision/PDF sources transcribe schedules that have no per-event
// page anywhere, so their rows are unpinned by design and "allow" must be a
// total no-op for them. A guard that eats hand-curated events is worse than the
// bug it closes.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  partitionUnpinned,
  isUnpinned,
  type PinnableEvent,
} from "../lib/unpinned-guard.js";

type Row = PinnableEvent & { name: string };

const pinnedBySid: Row = { name: "Open Mic Night", source_event_id: "murphys-irish-pub|open-mic-2026-08-05" };
const pinnedByUrl: Row = { name: "Wolf Jett", event_url: "https://bricestation.com/products/wolf-jett-july-25-2026-7pm" };
const pinnedByBoth: Row = { name: "Trivia", source_event_id: "12345", event_url: "https://example.com/e/12345" };
// The seeded shape: lib/bigtrees-schedule.ts writes both fields as literal null.
const seeded: Row = { name: "Creek Critters", source_event_id: null, event_url: null };
const phantom: Row = { name: "Phantom Thursday Act" };

test("isUnpinned needs BOTH handles missing", () => {
  assert.equal(isUnpinned(pinnedBySid), false);
  assert.equal(isUnpinned(pinnedByUrl), false);
  assert.equal(isUnpinned(pinnedByBoth), false);
  assert.equal(isUnpinned(seeded), true);
  assert.equal(isUnpinned(phantom), true, "absent fields count as missing, not present");
});

test("a blank or whitespace-only field does not pin a row", () => {
  assert.equal(isUnpinned({ source_event_id: "", event_url: "" }), true);
  assert.equal(isUnpinned({ source_event_id: "   ", event_url: "\n" }), true);
});

test("allow: keeps everything and reports 0 (seeds are unpinned BY DESIGN)", () => {
  const events = [seeded, seeded, seeded, pinnedByUrl];
  const r = partitionUnpinned(events, "allow");

  assert.equal(r.kept.length, 4, "a seed script must never lose a row to this guard");
  assert.equal(r.rejected.length, 0);
  assert.equal(
    r.unpinnedCount,
    0,
    "not an anomaly for these sources — reporting a count would train the operator to ignore it"
  );
});

test("warn: keeps everything but reports the count", () => {
  const r = partitionUnpinned([pinnedBySid, phantom, pinnedByUrl, seeded], "warn");

  assert.equal(r.kept.length, 4, "warn is observation only — it drops nothing");
  assert.equal(r.rejected.length, 0);
  assert.equal(r.unpinnedCount, 2);
});

test("reject: refuses the unpinned rows, keeps the pinned ones", () => {
  const r = partitionUnpinned([pinnedBySid, phantom, pinnedByUrl, seeded], "reject");

  assert.deepEqual(r.kept.map((e) => e.name), ["Open Mic Night", "Wolf Jett"]);
  assert.deepEqual(r.rejected.map((e) => e.name), ["Phantom Thursday Act", "Creek Critters"]);
  assert.equal(r.unpinnedCount, 2);
  assert.equal(r.kept.length + r.rejected.length, 4, "no event vanishes");
});

test("every policy is order-preserving and non-mutating", () => {
  const events: Row[] = [phantom, pinnedBySid, seeded, pinnedByUrl];
  const before = JSON.stringify(events);

  for (const policy of ["allow", "warn", "reject"] as const) {
    const r = partitionUnpinned(events, policy);
    const names = [...r.kept, ...r.rejected].map((e) => e.name).sort();
    assert.deepEqual(
      names,
      ["Creek Critters", "Open Mic Night", "Phantom Thursday Act", "Wolf Jett"],
      `${policy} lost or duplicated an event`
    );
    // kept keeps the scraper's own ordering (pinned rows in input order)
    const keptPinned = r.kept.filter((e) => !isUnpinned(e)).map((e) => e.name);
    assert.deepEqual(keptPinned, ["Open Mic Night", "Wolf Jett"], `${policy} reordered kept`);
  }

  assert.equal(JSON.stringify(events), before, "input array/objects must not be mutated");
});

test("an empty batch is a no-op under every policy", () => {
  for (const policy of ["allow", "warn", "reject"] as const) {
    const r = partitionUnpinned([], policy);
    assert.deepEqual(r.kept, []);
    assert.deepEqual(r.rejected, []);
    assert.equal(r.unpinnedCount, 0);
  }
});
