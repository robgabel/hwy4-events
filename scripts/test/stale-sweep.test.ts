// Locks scripts/lib/stale-sweep.ts — the window-scoped retraction primitive
// (2026-08-09). Every guardrail asserted here is the difference between "an
// organizer edited their calendar and the ghost vanished" and "a bad fetch
// mass-deleted a venue" — treat removals from this file as production risk.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveSweepCap,
  inAnyWindow,
  isProtectedRow,
  maxSweepAllowed,
  monthWindowFromLabel,
  selectStaleRows,
  sweepExecuteEnabled,
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

// ---------- per-source execute gate ----------

test("sweepExecuteEnabled: anything that is not a slug list means dry-run", () => {
  assert.equal(sweepExecuteEnabled(undefined, "sequoia-woods"), false);
  assert.equal(sweepExecuteEnabled("", "sequoia-woods"), false);
  assert.equal(sweepExecuteEnabled("  ", "sequoia-woods"), false);
  assert.equal(sweepExecuteEnabled("false", "sequoia-woods"), false);
  assert.equal(sweepExecuteEnabled("1", "sequoia-woods"), false);
  assert.equal(sweepExecuteEnabled("yes please", "sequoia-woods"), false);
  assert.equal(sweepExecuteEnabled(",,", "sequoia-woods"), false);
});

// There is NO "all sources" value, on purpose (HWY-21). The natural way to
// graduate the pub sweep is to type "true"; when that armed everything, it
// would have armed the corridor-wide aggregator sweep over hundreds of rows on
// the same run, with zero dry-run review. "true" is just an unknown slug now.
test("sweepExecuteEnabled: \"true\" arms nothing — a sweep is armed only by name", () => {
  assert.equal(sweepExecuteEnabled("true", "sequoia-woods"), false);
  assert.equal(sweepExecuteEnabled("true", "gocalaveras"), false);
  assert.equal(sweepExecuteEnabled(" TRUE ", "murphys-irish-pub"), false);
  // …and it doesn't poison a list that also names a real source.
  assert.equal(sweepExecuteEnabled("true,sequoia-woods", "sequoia-woods"), true);
  assert.equal(sweepExecuteEnabled("true,sequoia-woods", "gocalaveras"), false);
});

test("sweepExecuteEnabled: an allowlist graduates named sources only", () => {
  const flag = "murphys-irish-pub, sequoia-woods";
  assert.equal(sweepExecuteEnabled(flag, "murphys-irish-pub"), true);
  assert.equal(sweepExecuteEnabled(flag, "sequoia-woods"), true);
  assert.equal(sweepExecuteEnabled(flag, "gocalaveras"), false);
  // No partial matches: a slug is in the list or it isn't.
  assert.equal(sweepExecuteEnabled("sequoia", "sequoia-woods"), false);
  assert.equal(sweepExecuteEnabled("sequoia-woods-annex", "sequoia-woods"), false);
  assert.equal(sweepExecuteEnabled("sequoia-woods", "sequoia"), false);
  assert.equal(sweepExecuteEnabled("Sequoia-Woods", "sequoia-woods"), true);
  assert.equal(sweepExecuteEnabled("gocalaveras", ""), false);
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

// A big catalog pins the relative cap to the flat ceiling — 20 of an
// aggregator's ~169 future rows is ~12% deletable every night — so a source
// that knows its own blast radius sets a tighter budget (HWY-21).
test("effectiveSweepCap takes the LOWER of the relative cap and the source budget", () => {
  assert.equal(effectiveSweepCap(169), 20); // relative cap alone: the flat ceiling
  assert.equal(effectiveSweepCap(169, 10), 10); // source budget is tighter
  assert.equal(effectiveSweepCap(12, 10), 5); // relative cap is tighter — it wins
  assert.equal(effectiveSweepCap(4, 10), 3); // small-venue floor still governs
  assert.equal(effectiveSweepCap(169, 50), 20); // a looser budget can never raise it
  assert.equal(effectiveSweepCap(169, 0), 0); // a zero budget disables deletion
});
