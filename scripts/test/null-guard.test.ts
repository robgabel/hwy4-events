// Regression lock for the HWY-29 follow-up (2026-08-16): the write-path
// residues #262's treadmill fix left open.
//
// #262 null-guarded the exact-match payloads (keepStr) — but rowChanged still
// counted a wipe-shaped diff as a change, so a flaky-feed row re-marked itself
// "updated" every run forever while the guard wrote nothing (churn in the
// exact telemetry the insert-rate anomaly detector reads). And no write path
// guarded the NAME: "whoever scraped last takes the name" let the daily
// GoCalaveras pass rename Visit Murphys' properly-titled play row to "Murphys
// Creek Theatre presents" within a day of every merge (live on 2026-08-15,
// the Aug-21 row), with the organizer-adjacent source stealing it back on its
// next pass — a permanent rename ping-pong.
//
// These assertions pin: (1) rowChanged is defined as "what the payload WOULD
// write differs from what is stored" for every keepStr-guarded field; (2) a
// placeholder title never overwrites a specific one on any path, the healing
// direction still writes, and a kept name keeps a dedup_key recomputed from
// itself (name↔key consistency).
//
// dedup.ts imports scripts/lib/supabase-admin, which THROWS at import time if
// the service-role env is unset. Set dummy env then dynamic-import (the client
// makes no network call at construction), same as times-locked.test.ts.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDedupKey } from "../../lib/event-identity.js";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

async function load() {
  return import("../lib/dedup.js");
}

// The treadmill survivor the morning after the reconcile enriched it.
const storedRow = {
  id: "e1",
  name: "WHAT THE CONSTITUTION MEANS TO ME",
  date: "2026-08-28",
  venue_name: "Murphys Creek Theatre",
  description: "By Heidi Schreck. 90 minutes, no intermission.",
  start_time: "19:30",
  end_time: "21:00",
  price: "PAY-WHAT-YOU-CAN or PAY-IT-FORWARD",
  event_url: "https://visitmurphys.com/event/what-the-constitution-means-to-me/2026-08-28/",
  address: "580 S. Algiers Street, Murphys, CA 95247",
  town: "Murphys",
  image_url: "https://example.com/poster.png",
  category: "fine_arts",
};

// The aggregator's own barren entry for the same occurrence: placeholder
// title, and nothing extracted for the fields reconcile back-filled.
const placeholderScrape = {
  ...storedRow,
  name: "Murphys Creek Theatre presents",
  description: null,
  end_time: null,
  price: null,
  image_url: null,
  event_url: null,
  address: null,
  artists: null,
  source_event_id: "190744",
} as never;

test("a wipe-shaped re-scrape is not a change; a stated value still is", async () => {
  const { rowChanged } = await load();
  // Every diff here is either null-vs-content (keepStr writes the stored value
  // back) or the placeholder name (which would not be written) — the update
  // would change nothing, so the row must read as unchanged. Before this,
  // flaky per-occurrence EventON data re-marked such rows "updated" daily.
  assert.equal(rowChanged(storedRow as never, placeholderScrape), false);
  // A genuine correction arrives as a VALUE and still counts.
  assert.equal(
    rowChanged(storedRow as never, { ...(placeholderScrape as object), end_time: "22:00" } as never),
    true
  );
  // A specific rename still counts (that's a retitle, not a steal).
  assert.equal(
    rowChanged(storedRow as never, {
      ...(placeholderScrape as object),
      name: "What the Constitution Means to Me (final weekend)",
    } as never),
    true
  );
});

test("placeholderNameSteal: placeholder loses to specific, in exactly one direction", async () => {
  const { placeholderNameSteal } = await load();
  // The steal the guard exists to block.
  assert.equal(
    placeholderNameSteal(storedRow, { name: "Murphys Creek Theatre presents" }),
    true
  );
  assert.equal(placeholderNameSteal(storedRow, { name: "Live Music" }), true);
  // The HEALING direction — a specific incoming name over a stored placeholder
  // — must still write (that's how a gocal-only date gets its real title the
  // first time Visit Murphys lists it, and with the guard it keeps it).
  assert.equal(
    placeholderNameSteal(
      { name: "Murphys Creek Theatre presents" },
      { name: "WHAT THE CONSTITUTION MEANS TO ME" }
    ),
    false
  );
  // Placeholder-over-placeholder and specific-over-specific are normal writes.
  assert.equal(
    placeholderNameSteal(
      { name: "Murphys Creek Theatre presents" },
      { name: "Live Music @ Murphys Creek Theatre" }
    ),
    false
  );
  assert.equal(
    placeholderNameSteal(storedRow, { name: "Constitution (final weekend)" }),
    false
  );
});

test("buildStrongMatchUpdate keeps the specific name and a key consistent with it", async () => {
  const { buildStrongMatchUpdate } = await load();
  const incomingKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const merged = buildStrongMatchUpdate(
    { ...storedRow, artists: null, series_umbrella: false } as never,
    { ...(placeholderScrape as object), date: "2026-08-28", town: "Murphys" } as never,
    incomingKey,
    "2026-08-16T00:00:00Z"
  ) as Record<string, unknown>;
  assert.equal(merged.name, "WHAT THE CONSTITUTION MEANS TO ME");
  // The key is the kept name's hash, never the incoming placeholder's — a
  // name↔key mismatch would break every future exact-key lookup.
  assert.equal(
    merged.dedup_key,
    generateDedupKey("WHAT THE CONSTITUTION MEANS TO ME", "2026-08-28", "Murphys")
  );
  // Healing direction: the specific incoming name wins and carries ITS key.
  const healed = buildStrongMatchUpdate(
    { ...storedRow, name: "Murphys Creek Theatre presents", artists: null, series_umbrella: false } as never,
    {
      ...(placeholderScrape as object),
      name: "WHAT THE CONSTITUTION MEANS TO ME",
      date: "2026-08-28",
      town: "Murphys",
    } as never,
    incomingKey,
    "2026-08-16T00:00:00Z"
  ) as Record<string, unknown>;
  assert.equal(healed.name, "WHAT THE CONSTITUTION MEANS TO ME");
  assert.equal(healed.dedup_key, incomingKey);
});

test("keepStr now also guards event_url and address on the exact-match paths", async () => {
  const { rowChanged, keepStr } = await load();
  // A scraped-null event_url must not strip a row's pinning URL (retraction
  // sweeps key ownership off it) nor its registry-backfilled address.
  assert.equal(keepStr(null, storedRow.event_url), storedRow.event_url);
  assert.equal(keepStr("", storedRow.address), storedRow.address);
  // And rowChanged agrees: url/address-only wipe diffs are not changes.
  assert.equal(
    rowChanged(storedRow as never, {
      ...(placeholderScrape as object),
      name: storedRow.name,
      description: storedRow.description,
      end_time: storedRow.end_time,
      price: storedRow.price,
      image_url: storedRow.image_url,
    } as never),
    false
  );
});
