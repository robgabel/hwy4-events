// Region config completeness + resolution locks (regions/, lib/region*.ts).
//
// The region layer's contract: (1) unset env resolves to "calaveras" so the
// live deployment needs no env change; (2) an unknown slug fails loudly at
// boot, never mid-request; (3) every region defines BOTH layers with no
// empty/placeholder values; (4) the Calaveras data matches what the engine
// files hardcoded before the extraction (spot-pinned here; the byte-level
// proof lives in the email/prompt snapshot tests + rendered-output diff).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegionSlug } from "../../regions/resolve.js";
import { REGIONS, regionForSlug, ACTIVE_SLUG, REGION } from "../../regions/index.js";
import { REGIONS_OPS, regionOpsForSlug, REGION_OPS } from "../../regions/ops.js";

test("unset env resolves to calaveras (the zero-env-change default)", () => {
  const prevPublic = process.env.NEXT_PUBLIC_REGION;
  const prevPlain = process.env.REGION;
  delete process.env.NEXT_PUBLIC_REGION;
  delete process.env.REGION;
  try {
    assert.equal(resolveRegionSlug(), "calaveras");
  } finally {
    if (prevPublic !== undefined) process.env.NEXT_PUBLIC_REGION = prevPublic;
    if (prevPlain !== undefined) process.env.REGION = prevPlain;
  }
});

test("env override wins, NEXT_PUBLIC_REGION over REGION", () => {
  const prevPublic = process.env.NEXT_PUBLIC_REGION;
  const prevPlain = process.env.REGION;
  try {
    process.env.REGION = "plain";
    delete process.env.NEXT_PUBLIC_REGION;
    assert.equal(resolveRegionSlug(), "plain");
    process.env.NEXT_PUBLIC_REGION = "public";
    assert.equal(resolveRegionSlug(), "public");
  } finally {
    if (prevPublic !== undefined) process.env.NEXT_PUBLIC_REGION = prevPublic;
    else delete process.env.NEXT_PUBLIC_REGION;
    if (prevPlain !== undefined) process.env.REGION = prevPlain;
    else delete process.env.REGION;
  }
});

test("unknown region slugs throw loudly in both registries", () => {
  assert.throws(() => regionForSlug("atlantis"), /Unknown region "atlantis"/);
  assert.throws(() => regionOpsForSlug("atlantis"), /Unknown region "atlantis"/);
});

test("active region is calaveras in the test environment", () => {
  assert.equal(ACTIVE_SLUG, "calaveras");
  assert.equal(REGION.slug, "calaveras");
});

test("core and ops registries define the same regions", () => {
  assert.deepEqual(Object.keys(REGIONS).sort(), Object.keys(REGIONS_OPS).sort());
});

// Every leaf value present and non-empty — a half-filled region config must
// not build. Walks arbitrarily nested objects/arrays of the config shape.
function assertNoEmptyLeaves(value: unknown, path: string) {
  if (typeof value === "string") {
    assert.ok(value.trim().length > 0, `${path} is empty`);
  } else if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} is not a finite number`);
  } else if (Array.isArray(value)) {
    assert.ok(value.length > 0, `${path} is an empty array`);
    value.forEach((v, i) => assertNoEmptyLeaves(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    assert.ok(entries.length > 0, `${path} is an empty object`);
    for (const [k, v] of entries) assertNoEmptyLeaves(v, `${path}.${k}`);
  } else if (typeof value === "boolean") {
    // fine
  } else {
    assert.fail(`${path} is ${String(value)}`);
  }
}

test("every region's core + ops config is fully populated", () => {
  for (const [slug, core] of Object.entries(REGIONS)) {
    assertNoEmptyLeaves(core, `REGIONS.${slug}`);
  }
  for (const [slug, ops] of Object.entries(REGIONS_OPS)) {
    assertNoEmptyLeaves(ops, `REGIONS_OPS.${slug}`);
  }
});

test("region geo invariants: unique town names, sane box, bias inside box", () => {
  for (const [slug, core] of Object.entries(REGIONS)) {
    const names = core.geo.towns.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, `${slug}: duplicate town names`);
    const box = core.geo.visitorBox;
    assert.ok(box.latMin < box.latMax, `${slug}: visitorBox lat inverted`);
    assert.ok(box.lngMin < box.lngMax, `${slug}: visitorBox lng inverted`);
    const bias = core.geo.placesBias;
    assert.ok(
      bias.lat > box.latMin && bias.lat < box.latMax &&
        bias.lng > box.lngMin && bias.lng < box.lngMax,
      `${slug}: placesBias center outside the visitor box`
    );
    for (const t of core.geo.towns) {
      assert.ok(
        t.lat > box.latMin && t.lat < box.latMax && t.lng > box.lngMin && t.lng < box.lngMax,
        `${slug}: town ${t.name} outside the visitor box`
      );
    }
  }
});

test("IP city lists are lowercased, trimmed, and hub is disjoint from local", () => {
  for (const [slug, core] of Object.entries(REGIONS)) {
    const local = core.geo.localIpCities;
    const hub = core.geo.hubIpCities ?? [];
    for (const c of [...local, ...hub]) {
      assert.equal(c, c.toLowerCase().trim(), `${slug}: "${c}" must be lowercased + trimmed`);
    }
    assert.equal(new Set(local).size, local.length, `${slug}: duplicate localIpCities`);
    assert.equal(new Set(hub).size, hub.length, `${slug}: duplicate hubIpCities`);
    for (const c of hub) {
      assert.ok(!local.includes(c), `${slug}: "${c}" is both a hub and a local city`);
    }
  }
});

// Spot-pins of extracted-verbatim Calaveras values. These are the values the
// engine hardcoded before the region extraction; if one changes, the live
// site changes — do that knowingly, in its own commit.
test("calaveras spot-pins match the pre-extraction engine literals", () => {
  assert.equal(REGION.siteName, "Hwy 4 Events");
  assert.equal(REGION.defaultSiteUrl, "https://hwy4events.com");
  assert.equal(REGION.botName, "Hwy4EventsBot");
  assert.equal(REGION.timezone, "America/Los_Angeles");
  assert.equal(REGION.stateCode, "CA");
  assert.equal(REGION.geo.towns.length, 9);
  assert.equal(REGION.geo.towns[0].name, "Copperopolis");
  assert.equal(REGION.geo.towns[8].name, "Bear Valley");
  assert.deepEqual(REGION.geo.townAddressAliases, ["Hathaway Pines"]);
  // 15 at extraction; widened to the rest of Calaveras County 2026-09-04 (the
  // Valley Springs fix, see lib/geo.ts + scripts/test/geo.test.ts).
  assert.equal(REGION.geo.localIpCities.length, 30);
  assert.deepEqual(REGION.geo.hubIpCities, ["sacramento", "stockton", "lodi", "modesto", "sonora"]);
  assert.equal(REGION.sourceHostLabels["gocalaveras.com"], "GoCalaveras");
  assert.equal(REGION_OPS.emails.newsletterFrom, "newsletter@hwy4events.com");
  assert.equal(REGION_OPS.seo.gscPropertyDefault, "sc-domain:hwy4events.com");
  assert.equal(REGION_OPS.schemaOrg.founderName, "Rob Gabel");
  assert.equal(REGION_OPS.newsletter.subjectPrefix, "What's happening on the 4");
});
