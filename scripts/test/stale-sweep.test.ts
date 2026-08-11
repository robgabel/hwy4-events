// Locks scripts/lib/stale-sweep.ts — the window-scoped retraction primitive
// (2026-08-09). Every guardrail asserted here is the difference between "an
// organizer edited their calendar and the ghost vanished" and "a bad fetch
// mass-deleted a venue" — treat removals from this file as production risk.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inAnyWindow,
  isProtectedRow,
  maxSweepAllowed,
  monthWindowFromLabel,
  selectStaleRows,
  sweepWindowsFromMonths,
  type SweepRow,
} from "../lib/stale-sweep.js";

let seq = 0;
const row = (partial: Partial<SweepRow>): SweepRow => ({
  id: `id-${++seq}`,
  name: "Test Event",
  date: "2026-08-20",
  source_event_id: null,
  event_url: null,
  ...partial,
});

// ---------- windows ----------

test("monthWindowFromLabel parses widget month headers, incl. leap months", () => {
  assert.deepEqual(monthWindowFromLabel("August 2026"), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(monthWindowFromLabel("february 2028"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(monthWindowFromLabel("(unresolved)"), null);
  assert.equal(monthWindowFromLabel("Agosto 2026"), null);
});

test("sweepWindowsFromMonths: failed or thin month views contribute NO window", () => {
  const today = "2026-08-09";
  const windows = sweepWindowsFromMonths(
    [
      { label: "August 2026", eventCount: 14 }, // healthy → clamped to today
      { label: null, eventCount: 12 }, // header didn't parse → fetch suspect
      { label: "September 2026", eventCount: 2 }, // parsed almost nothing → suspect
      { label: "October 2026", eventCount: 9 }, // healthy
      { label: "July 2026", eventCount: 20 }, // entirely past → irrelevant
    ],
    today
  );
  assert.deepEqual(windows, [
    { from: "2026-08-09", to: "2026-08-31" },
    { from: "2026-10-01", to: "2026-10-31" },
  ]);
  // September sits between two healthy windows but was NOT healthy itself —
  // a September resident row must be unsweepable.
  assert.equal(inAnyWindow("2026-09-15", windows), false);
});

// ---------- protection ----------

test("human-touched rows are never sweepable", () => {
  assert.equal(isProtectedRow(row({ robs_pick: true })), "robs_pick");
  assert.equal(isProtectedRow(row({ community_sourced: true })), "community_sourced");
  assert.equal(isProtectedRow(row({ series_umbrella: true })), "series_umbrella");
  assert.equal(isProtectedRow(row({ times_locked: true })), "locked");
  assert.equal(isProtectedRow(row({ poster_locked: true })), "locked");
  assert.equal(isProtectedRow(row({})), null);
});

// ---------- selection ----------

const WINDOWS = [{ from: "2026-08-09", to: "2026-08-31" }];

test("selectStaleRows: present rows survive by ANY key (sid or url slug)", () => {
  const present = new Set(["sequoia-woods|2026-08-14|karaoke-taylor-made", "george-haskell-1"]);
  const keysOf = (r: SweepRow) => [
    r.source_event_id,
    r.event_url ? r.event_url.split("/").pop() : null,
  ];
  const kept1 = row({ source_event_id: "sequoia-woods|2026-08-14|karaoke-taylor-made" });
  // The merged-row shape: a foreign (aggregator) sid but our page's URL —
  // still present because the URL slug matches the batch.
  const kept2 = row({
    source_event_id: "192812",
    event_url: "https://www.murphysirishpubca.com/event-details/george-haskell-1",
  });
  const gone = row({ source_event_id: "sequoia-woods|2026-08-20|patio-party-tbd" });
  const { stale } = selectStaleRows([kept1, kept2, gone], {
    windows: WINDOWS,
    presentKeys: present,
    keysOf,
  });
  assert.deepEqual(stale.map((r) => r.id), [gone.id]);
});

test("selectStaleRows: outside-window and foreign rows are untouchable", () => {
  const outsideWindow = row({ date: "2026-09-15" }); // September never fetched
  const pastRow = row({ date: "2026-08-01" }); // before the clamped window
  const foreign = row({
    date: "2026-08-20",
    event_url: "https://www.gocalaveras.com/events/live-music-murphys-irish-pub/",
  });
  const ours = row({ date: "2026-08-20" });
  const { stale } = selectStaleRows([outsideWindow, pastRow, foreign, ours], {
    windows: WINDOWS,
    presentKeys: new Set(),
    keysOf: (r) => [r.source_event_id],
    ownRow: (r) => !r.event_url || /murphysirishpubca\.com/.test(r.event_url),
  });
  assert.deepEqual(stale.map((r) => r.id), [ours.id]);
});

test("selectStaleRows: protected rows report separately instead of deleting", () => {
  const pick = row({ robs_pick: true });
  const plain = row({});
  const { stale, protectedRows } = selectStaleRows([pick, plain], {
    windows: WINDOWS,
    presentKeys: new Set(),
    keysOf: (r) => [r.source_event_id],
  });
  assert.deepEqual(stale.map((r) => r.id), [plain.id]);
  assert.deepEqual(
    protectedRows.map((p) => [p.row.id, p.reason]),
    [[pick.id, "robs_pick"]]
  );
});

// The phantom-era shape the first pub sweep must clean: key-less, link-less
// rows from the old LLM extractor, absent from the structured batch.
test("selectStaleRows: legacy key-less rows sweep once the source is structured", () => {
  const phantom = row({ date: "2026-08-14", name: "Nathan Ignacio" });
  const real = row({
    date: "2026-08-14",
    name: "Blue Monday Band",
    source_event_id: "murphys-irish-pub|blue-monday-band-5",
  });
  const { stale } = selectStaleRows([phantom, real], {
    windows: WINDOWS,
    presentKeys: new Set(["murphys-irish-pub|blue-monday-band-5"]),
    keysOf: (r) => [r.source_event_id],
  });
  assert.deepEqual(stale.map((r) => r.name), ["Nathan Ignacio"]);
});

// ---------- relative abort cap ----------

test("maxSweepAllowed scales the abort cap to the venue's resident count (2026-08-09 review)", () => {
  // Sequoia-sized venue (29 future rows): a partially-rendered month view
  // stranding 12 rows must abort — the flat 20 ceiling alone was inert here.
  assert.equal(maxSweepAllowed(29), 10);
  // Tiny venue still gets to retract a real cancellation.
  assert.equal(maxSweepAllowed(4), 3);
  assert.equal(maxSweepAllowed(0), 3);
  // Large catalogs hit the hard ceiling.
  assert.equal(maxSweepAllowed(200), 20);
});
