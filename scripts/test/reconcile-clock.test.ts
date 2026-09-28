// Reconcile's half of the clock-conflict flag (dedup v2 review #5).
//
// When the cross-source rule clusters two feeds' listings that disagree on the
// start, reconcile keeps the richest row and deletes the other. The deleted
// row's clock used to go with it; now it is staged on the survivor for a
// human at /admin/verification. Only a DIRECT cross-source match flags: a
// series placeholder's default clock (the standard path's start tolerance) is
// the aggregator's leftover, not a competing claim about the event.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileDuplicates } from "../../lib/reconcile.js";

type Row = Record<string, unknown>;

function fakeClient(rows: Row[], opts: { failUpdates?: boolean } = {}) {
  const db = rows.map((r) => ({ ...r }));
  const updates: { id: unknown; patch: Row }[] = [];
  const logged: Row[] = [];
  const deleted: unknown[] = [];
  const client = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "update" | "delete" | "insert" = "select";
      let payload: unknown = null;
      const run = () => {
        if (table === "event_merge_log") {
          logged.push(...((Array.isArray(payload) ? payload : [payload]) as Row[]));
          return { data: null, error: null };
        }
        const hits = db.filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          if (opts.failUpdates) return { data: null, error: { message: "update rejected" } };
          for (const h of hits) {
            updates.push({ id: h.id, patch: payload as Row });
            Object.assign(h, payload);
          }
          return { data: null, error: null };
        }
        if (op === "delete") {
          for (const h of hits) deleted.push(h.id);
          return { data: null, error: null };
        }
        return { data: hits, error: null };
      };
      const q = {
        select: () => q,
        insert: (p: unknown) => ((op = "insert"), (payload = p), q),
        update: (p: unknown) => ((op = "update"), (payload = p), q),
        delete: () => ((op = "delete"), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
        gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve(run()).then(ok, fail),
      };
      return q;
    },
  };
  return { client, db, updates, logged, deleted };
}

const DAY = "2099-10-03";
const row = (over: Row): Row => ({
  date: DAY,
  status: "confirmed",
  visibility: "public",
  description: null,
  artists: null,
  image_url: null,
  event_url: null,
  address: null,
  price: null,
  source_event_id: null,
  times_locked: false,
  verification_status: "unchecked",
  community_sourced: false,
  is_routine: false,
  series_umbrella: false,
  ...over,
});

// The Murphys Gathering, 2026: GoCalaveras 11:00 (richer, so it survives) and
// the organizer's own Visit Murphys listing at 12:00.
const goCal = row({
  id: "gocal",
  created_at: "2026-08-01T00:00:00Z",
  name: "The Gathering on Murphys Main Street",
  town: "Murphys",
  venue_name: "Murphys Main Street",
  start_time: "11:00:00",
  end_time: "17:00:00",
  source_name: "GoCalaveras.com",
  description:
    "Wizards, fairies and costume contests up and down Main Street, with vendors, music and a parade for all ages.",
  image_url: "https://example.com/poster.jpg",
  address: "Main St, Murphys, CA 95247",
});
const organizer = row({
  id: "vm",
  created_at: "2026-09-01T00:00:00Z",
  name: "Murphys Gathering – A Celebration of All Things Magical",
  town: "Murphys",
  venue_name: "Murphys Main Street",
  start_time: "12:00:00",
  end_time: "17:00:00",
  source_name: "Visit Murphys",
  event_url: "https://visitmurphys.com/event/murphys-gathering/",
});

test("a cross-source merge stages the deleted listing's clock on the survivor", async () => {
  const f = fakeClient([goCal, organizer]);
  const r = await reconcileDuplicates(f.client, { dryRun: false, fromDate: DAY });
  assert.deepEqual(f.deleted, ["vm"]);
  assert.equal(f.logged.length, 1, "the loser is snapshotted before the delete");
  const survivor = f.db.find((x) => x.id === "gocal")!;
  assert.equal(survivor.start_time, "11:00:00", "the merge never rewrites the clock");
  assert.equal(survivor.verification_status, "needs_verification");
  assert.equal(survivor.verification_suggested_start, "12:00");
  assert.match(String(survivor.verification_reason), /Visit Murphys says 12:00 PM; we show 11:00 AM/);
  assert.equal(r.clockFlags.length, 1);
  assert.equal(r.clockFlags[0].id, "gocal");
});

test("a flag alone writes no updated_at: a verification note is not a content change", async () => {
  const f = fakeClient([goCal, { ...organizer, event_url: null }]);
  await reconcileDuplicates(f.client, { dryRun: false, fromDate: DAY });
  const patch = f.updates.find((u) => u.id === "gocal")!.patch;
  assert.equal(patch.verification_status, "needs_verification");
  assert.ok(!("updated_at" in patch));
});

test("a flag whose write failed is not reported as raised", async () => {
  const f = fakeClient([goCal, organizer], { failUpdates: true });
  const r = await reconcileDuplicates(f.client, { dryRun: false, fromDate: DAY });
  assert.equal(r.clockFlags.length, 0);
  assert.equal(f.db.find((x) => x.id === "gocal")!.verification_status, "unchecked");
});

test("dry-run reports the flag and writes nothing", async () => {
  const f = fakeClient([goCal, organizer]);
  const r = await reconcileDuplicates(f.client, { dryRun: true, fromDate: DAY });
  assert.equal(r.clockFlags.length, 1);
  assert.equal(f.updates.length, 0);
  assert.equal(f.deleted.length, 0);
});

test("a series placeholder's default clock never flags the named act that absorbs it", async () => {
  // Brice Hilltop, 2026-09-19: the venue moved Greg Sutton to 6:00 PM while
  // GoCalaveras kept the series default 7:00 PM on a placeholder title.
  const named = row({
    id: "brice",
    created_at: "2026-08-01T00:00:00Z",
    name: "Greg Sutton",
    artists: ["Greg Sutton"],
    town: "Murphys",
    venue_name: "Brice Station Vineyards",
    venue_key: "brice-station",
    start_time: "18:00:00",
    end_time: "21:00:00",
    source_name: "Brice Station Vineyards",
    description: "Greg Sutton plays the hilltop one hour earlier than our usual start time.",
    price: "$25",
  });
  const placeholder = row({
    id: "gc",
    created_at: "2026-08-02T00:00:00Z",
    name: "Brice Station Vineyards – Hilltop Concert Series",
    town: "Murphys",
    venue_name: "Brice Station Vineyards",
    venue_key: "brice-station",
    start_time: "19:00:00",
    end_time: "22:00:00",
    source_name: "GoCalaveras.com",
  });
  const f = fakeClient([named, placeholder]);
  const r = await reconcileDuplicates(f.client, { dryRun: false, fromDate: DAY });
  assert.deepEqual(f.deleted, ["gc"], "the pair still merges");
  assert.equal(r.clockFlags.length, 0);
  assert.equal(f.db.find((x) => x.id === "brice")!.verification_status, "unchecked");
});
