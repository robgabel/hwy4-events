// Regression lock for the HWY-29 follow-up (2026-08-16): the write-path
// residues #262's treadmill fix left open.
//
// #262 null-guarded the exact-match payloads (keepStr) — but rowChanged still
// counted a wipe-shaped diff as a change, so a flaky-feed row re-marked itself
// "updated" every run forever while the guard wrote nothing — churning the
// per-source updated counts on /admin/scrapers and holding flaky-feed sources
// out of the weekly memo's quiet-source bucket (which gates on zero inserted
// AND zero updated; the insert-rate anomaly detector reads inserted only). And no write path
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

// ---------------------------------------------------------------------------
// B1 (adversarial review of #264): the steal predicate must be NARROWER than
// isGenericTitle. A TBD/TBA tail is an ORGANIZER RETRACTION — Sequoia Woods
// really reverts "Patio Party #4 … - The Hit Men" to "… (TBD)" when an act
// cancels — and isGenericTitle's live-music arm is prefix-anchored, so titles
// that NAME the act ("Live Music - Jill Warren") classify as generic.

test("isActlessPlaceholderTitle: aggregator shapes only — retractions and act-naming titles excluded", async () => {
  const { isActlessPlaceholderTitle } = await load();
  // Actless aggregator shapes: blocked from stealing a specific name.
  assert.equal(isActlessPlaceholderTitle("Murphys Creek Theatre presents"), true);
  assert.equal(isActlessPlaceholderTitle("Live Music"), true);
  assert.equal(isActlessPlaceholderTitle("Live Music @ The Lube Room"), true);
  assert.equal(isActlessPlaceholderTitle("Bistro Summer Concerts Series"), true);
  // An organizer stating the act is UNKNOWN is information, not a lazy title.
  assert.equal(isActlessPlaceholderTitle("Patio Party #4 featuring live music (TBD)"), false);
  // Prefix-anchored generic ≠ actless: these name the act.
  assert.equal(isActlessPlaceholderTitle("Live Music - Jill Warren"), false);
  assert.equal(isActlessPlaceholderTitle("Live Music - Sequoia Blue"), false);
});

test("an organizer's TBD retraction still writes over a cancelled act's name", async () => {
  const { placeholderNameSteal, rowChanged, buildStrongMatchUpdate } = await load();
  const hitMen = {
    ...storedRow,
    name: "Patio Party #4 featuring live music - The Hit Men",
    venue_name: "Sequoia Woods Country Club",
  };
  const tbd = {
    ...(placeholderScrape as object),
    name: "Patio Party #4 featuring live music (TBD)",
    venue_name: "Sequoia Woods Country Club",
    source_event_id: "sequoia-woods|2026-08-28|patio-party-4-featuring-live-music-tbd",
  } as never;
  // The retraction is NOT a steal: it must count as a change and must write.
  assert.equal(placeholderNameSteal(hitMen, tbd), false);
  assert.equal(rowChanged(hitMen as never, tbd), true);
  const merged = buildStrongMatchUpdate(
    { ...hitMen, artists: null, series_umbrella: false } as never,
    { ...(tbd as object), date: "2026-08-28", town: "Arnold" } as never,
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "2026-08-16T00:00:00Z"
  ) as Record<string, unknown>;
  assert.equal(merged.name, "Patio Party #4 featuring live music (TBD)");
  assert.equal(merged.dedup_key, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
});

// ---------------------------------------------------------------------------
// N4: both exact-match paths now build their payload through the ONE exported
// buildExactMatchUpdate, so pinning the builder pins both (a mutation deleting
// the name guard from "one of the two payloads" is no longer expressible).

test("buildExactMatchUpdate: name guard, key consistency, guards, category self-heal", async () => {
  const { buildExactMatchUpdate } = await load();
  const incomingKey = "cccccccccccccccccccccccccccccccc";
  const p = buildExactMatchUpdate(
    storedRow as never,
    { ...(placeholderScrape as object), category: "fine_arts" } as never,
    incomingKey,
    "2026-08-16T00:00:00Z"
  );
  // Placeholder name kept out; key recomputed from the KEPT name.
  assert.equal(p.name, "WHAT THE CONSTITUTION MEANS TO ME");
  assert.equal(
    p.dedup_key,
    generateDedupKey("WHAT THE CONSTITUTION MEANS TO ME", storedRow.date, storedRow.town)
  );
  // keepStr on every display field: barren scrape keeps stored content.
  assert.equal(p.description, storedRow.description);
  assert.equal(p.end_time, storedRow.end_time);
  assert.equal(p.price, storedRow.price);
  assert.equal(p.image_url, storedRow.image_url);
  assert.equal(p.event_url, storedRow.event_url);
  assert.equal(p.address, storedRow.address);
  // Upgrade-only category self-heal is present (the batched path lacked it).
  assert.equal(p.category, "fine_arts");
  const noDowngrade = buildExactMatchUpdate(
    storedRow as never,
    { ...(placeholderScrape as object), category: "other" } as never,
    incomingKey,
    "2026-08-16T00:00:00Z"
  );
  assert.equal("category" in noDowngrade, false);
  // A specific incoming name writes normally and carries the incoming key.
  const renamed = buildExactMatchUpdate(
    storedRow as never,
    { ...(placeholderScrape as object), name: "Constitution (final weekend)" } as never,
    incomingKey,
    "2026-08-16T00:00:00Z"
  );
  assert.equal(renamed.name, "Constitution (final weekend)");
  assert.equal(renamed.dedup_key, incomingKey);
});

// N5: an EMPTY incoming name falls back to the stored name via pick — the key
// must follow the kept name, never store the empty title's hash beside it.

test("buildStrongMatchUpdate: an empty incoming name keeps the stored name AND its key", async () => {
  const { buildStrongMatchUpdate } = await load();
  const merged = buildStrongMatchUpdate(
    { ...storedRow, artists: null, series_umbrella: false } as never,
    {
      ...(placeholderScrape as object),
      name: "",
      date: "2026-08-28",
      town: "Murphys",
    } as never,
    "dddddddddddddddddddddddddddddddd",
    "2026-08-16T00:00:00Z"
  ) as Record<string, unknown>;
  assert.equal(merged.name, "WHAT THE CONSTITUTION MEANS TO ME");
  assert.equal(
    merged.dedup_key,
    generateDedupKey("WHAT THE CONSTITUTION MEANS TO ME", "2026-08-28", "Murphys")
  );
});

// --- updated_at is a real last-modified, not a scrape heartbeat (2026-08-18) ---
//
// The column defaulted to now() on INSERT, had no trigger, and no scraper path
// set it — so every row read updated_at === created_at forever while
// lib/sitemap.ts fed it to Google as <lastmod> and called it DB-maintained.
//
// Both update builders are reached ONLY when rowChanged() is true, so stamping
// there is what makes the name true. These pin the distinction from
// last_scraped_at ("when we last looked", every night) — confusing the two
// would claim the whole catalog changed daily and burn the crawl budget
// PRD-search-indexing.md exists to protect.

test("exact-match update stamps updated_at alongside last_scraped_at", async () => {
  const { buildExactMatchUpdate } = await load();
  const now = "2026-08-18T08:30:00.000Z";
  const payload = buildExactMatchUpdate(
    storedRow as never,
    { ...(placeholderScrape as object) } as never,
    "k",
    now
  );
  assert.equal(payload.updated_at, now);
  assert.equal(payload.last_scraped_at, now);
});

test("strong-match merge stamps updated_at — a merge is a content change", async () => {
  const { buildStrongMatchUpdate } = await load();
  const now = "2026-08-18T08:30:00.000Z";
  const payload = buildStrongMatchUpdate(
    storedRow as never,
    { ...(placeholderScrape as object) } as never,
    "k",
    now
  ) as Record<string, unknown>;
  assert.equal(payload.updated_at, now);
  assert.equal(payload.last_scraped_at, now);
});

// ---------------------------------------------------------------------------
// placeholderVenueSteal (2026-09-04): the venue-level twin of the name guard.
// GoCalaveras served the Arnold Angels Music Festival with no location
// attached (venue "Unknown Venue", town GUESSED "Arnold" off the charity's
// name), and the daily exact-match pass wiped the resolved row (Brice Station
// Vineyards / Murphys / venue_key) back to that shape while keepStr kept the
// stored Murphys street address — a standing TOWN_CONFLICT that failed the
// location sanity check on every such run (red 2026-08-26/27/29, 09-03/04),
// hand-healed each afternoon, re-broken the next morning.
// ---------------------------------------------------------------------------

// The resolved row as reconcile/venue-detection left it.
const briceRow = {
  id: "e2",
  name: "Arnold Angels Music Festival",
  date: "2026-10-04",
  venue_name: "Brice Station Vineyards",
  description: "Benefit festival for the Arnold Angels.",
  start_time: "12:00",
  end_time: null,
  price: null,
  event_url: "https://www.gocalaveras.com/events/arnold-angels-music-festival/",
  address: "3353 East Highway 4, Murphys CA 95247",
  town: "Murphys",
  image_url: null,
  category: "live_music",
};

// The degraded aggregator shape for the same sid: no location, guessed town,
// nothing else extracted.
const degradedScrape = {
  ...briceRow,
  venue_name: "Unknown Venue",
  town: "Arnold",
  description: null,
  start_time: null,
  address: null,
  event_url: null,
  artists: null,
  source_event_id: "192816",
} as never;

test("placeholderVenueSteal: generic loses to specific, in exactly one direction", async () => {
  const { placeholderVenueSteal } = await load();
  // The steal the guard exists to block — and the bare-town variant.
  assert.equal(placeholderVenueSteal(briceRow, { venue_name: "Unknown Venue" }), true);
  assert.equal(placeholderVenueSteal(briceRow, { venue_name: "Murphys" }), true);
  // The HEALING direction — a specific incoming venue over a stored generic —
  // must still write (that's how an Unknown Venue row resolves the first time
  // a source names the place, and with the guard it stays resolved).
  assert.equal(
    placeholderVenueSteal(
      { venue_name: "Unknown Venue" },
      { venue_name: "Brice Station Vineyards" }
    ),
    false
  );
  // Generic-over-generic is a normal write.
  assert.equal(
    placeholderVenueSteal({ venue_name: "Unknown Venue" }, { venue_name: "Murphys" }),
    false
  );
  // A stored ARTIFACT venue carries no clean signal — never "kept".
  assert.equal(
    placeholderVenueSteal(
      { venue_name: "@Murphys Park featuring The Star Dogs" },
      { venue_name: "Unknown Venue" }
    ),
    false
  );
});

test("a degraded venue re-scrape is not a change; a real venue change still is", async () => {
  const { rowChanged } = await load();
  // venue/town wipe + null display fields: the payload would keep everything,
  // so the row must read unchanged (no daily "updated" re-mark).
  assert.equal(rowChanged(briceRow as never, degradedScrape), false);
  // A specific-to-specific venue change is a genuine correction and counts.
  assert.equal(
    rowChanged(briceRow as never, {
      ...(degradedScrape as object),
      venue_name: "Ironstone Vineyards",
      town: "Murphys",
    } as never),
    true
  );
});

test("buildExactMatchUpdate keeps venue AND town, resolves venue_key from the kept name, keys the kept town", async () => {
  const { buildExactMatchUpdate } = await load();
  const now = "2026-09-04T12:27:21.000Z";
  const incomingKey = generateDedupKey("Arnold Angels Music Festival", "2026-10-04", "Arnold");
  const payload = buildExactMatchUpdate(
    briceRow as never,
    degradedScrape,
    incomingKey,
    now
  ) as Record<string, unknown>;
  assert.equal(payload.venue_name, "Brice Station Vineyards");
  assert.equal(payload.town, "Murphys");
  // The key must be the registry key of the venue the row KEEPS — resolving
  // from the degraded incoming shape would null it every morning.
  assert.equal(payload.venue_key, "brice-station");
  // dedup_key hashes what the row actually carries: kept town, not "Arnold".
  assert.equal(
    payload.dedup_key,
    generateDedupKey("Arnold Angels Music Festival", "2026-10-04", "Murphys")
  );
  // keepStr family unchanged alongside the venue guard.
  assert.equal(payload.address, briceRow.address);
  assert.equal(payload.start_time, "12:00");
});

test("buildExactMatchUpdate still lets a specific venue heal a stored generic one", async () => {
  const { buildExactMatchUpdate } = await load();
  const now = "2026-09-04T12:27:21.000Z";
  const storedGeneric = {
    ...briceRow,
    venue_name: "Unknown Venue",
    town: "Arnold",
  };
  const healingScrape = {
    ...(degradedScrape as object),
    venue_name: "Brice Station Vineyards",
    town: "Murphys",
  } as never;
  const key = generateDedupKey("Arnold Angels Music Festival", "2026-10-04", "Murphys");
  const payload = buildExactMatchUpdate(
    storedGeneric as never,
    healingScrape,
    key,
    now
  ) as Record<string, unknown>;
  assert.equal(payload.venue_name, "Brice Station Vineyards");
  assert.equal(payload.town, "Murphys");
  assert.equal(payload.venue_key, "brice-station");
  assert.equal(payload.dedup_key, key);
});

test("buildStrongMatchUpdate: a generic venue never replaces a specific one", async () => {
  const { buildStrongMatchUpdate } = await load();
  const now = "2026-09-04T12:27:21.000Z";
  const merged = buildStrongMatchUpdate(
    { ...briceRow, artists: null } as never,
    degradedScrape,
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    now
  ) as Record<string, unknown>;
  assert.equal(merged.venue_name, "Brice Station Vineyards");
});
