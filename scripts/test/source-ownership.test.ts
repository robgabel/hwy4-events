import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  DISPATCH_ORG_SLUG,
  SOURCE_OWNERSHIP,
  classifySource,
  nightlyOrgSlugs,
  ownershipFor,
  type SourceFacts,
} from "../lib/source-ownership.js";
import { FIRECRAWL_SOURCES } from "../scrapers/firecrawl-sources.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function facts(over: Partial<SourceFacts> = {}): SourceFacts {
  return {
    orgSlug: "gocalaveras",
    futureEventCount: 12,
    daysSinceScrape: 0,
    ranThisRun: true,
    ...over,
  };
}

// --- the default is the loud one ------------------------------------------

test("an unknown org_slug defaults to nightly, not to silence", () => {
  const o = ownershipFor("some-new-venue");
  assert.equal(o.owner, "nightly");
});

test("a nightly source no scraper ran for warns, naming where to look", () => {
  const v = classifySource(facts({ orgSlug: "some-new-venue", ranThisRun: false }));
  assert.equal(v.owner, "nightly");
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /no scraper ran for it/);
  assert.match(v.warnings[0], /scripts\/scrape\.ts/);
});

test("a healthy nightly source warns about nothing", () => {
  const v = classifySource(facts());
  assert.deepEqual(v.warnings, []);
  assert.match(v.status, /^OK/);
});

// --- the false positives this replaces ------------------------------------

test("a nightly source that ran is never warned for a stale last write", () => {
  // Bear Valley Mountain Resort, 2026-09-05: scraper ran and read the page
  // correctly; the page held nothing but two lodging promos, and had for 11
  // days. "STALE: 11d — scraper may be silently failing" was a lie.
  const v = classifySource(
    facts({ orgSlug: "bear-valley", daysSinceScrape: 11, futureEventCount: 1 })
  );
  assert.deepEqual(v.warnings, []);
});

test("a seed-owned source is never warned for staleness", () => {
  // Big Trees' season is transcribed by hand; 97 days since the last seed run
  // is the normal resting state, and /api/check-bigtrees-schedule is what
  // actually watches the source page.
  const v = classifySource(
    facts({
      orgSlug: "calaveras-big-trees-state-park",
      daysSinceScrape: 97,
      futureEventCount: 11,
      ranThisRun: false,
    })
  );
  assert.equal(v.owner, "seed");
  assert.deepEqual(v.warnings, []);
});

test("an external-cron source is never warned for staleness", () => {
  // /api/scrape-bls stamps last_scraped_at only on INSERT, so the clock
  // measures how long since the HOA posted a flyer, not whether it ran.
  const v = classifySource(
    facts({
      orgSlug: "blue-lake-springs",
      daysSinceScrape: 33,
      futureEventCount: 5,
      ranThisRun: false,
    })
  );
  assert.equal(v.owner, "external-cron");
  assert.deepEqual(v.warnings, []);
});

test("a retired source is reported but never warns", () => {
  const v = classifySource(
    facts({ orgSlug: "fb-group-uh4ccc", futureEventCount: 0, daysSinceScrape: 67, ranThisRun: false })
  );
  assert.equal(v.owner, "retired");
  assert.deepEqual(v.warnings, []);
});

// --- what must still be caught --------------------------------------------

test("a seed source that has run dry warns, naming the script to re-run", () => {
  // hinterhaus-distilling on 2026-09-05: both seeded tour dates had passed and
  // nothing said so, because the source was invisible to the report entirely.
  const v = classifySource(
    facts({
      orgSlug: "hinterhaus-distilling",
      futureEventCount: 0,
      daysSinceScrape: 22,
      ranThisRun: false,
    })
  );
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /seed-hinterhaus-tours-2026\.ts/);
});

test("an external-cron source that has run dry warns, naming the route", () => {
  const v = classifySource(
    facts({ orgSlug: "blue-lake-springs", futureEventCount: 0, ranThisRun: false })
  );
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /api\/scrape-bls/);
});

test("a nightly source that ran and has no future events still warns", () => {
  const v = classifySource(facts({ futureEventCount: 0 }));
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /scraper ran but the source has no future events/);
});

test("a nightly source with future events but no timestamp warns", () => {
  const v = classifySource(facts({ daysSinceScrape: null }));
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /no last_scraped_at/);
});

// --- dispatch key vs org_slug ---------------------------------------------

test("nightlyOrgSlugs maps dispatch keys to the slugs they write", () => {
  // The live bug: health.ts asked scrapedSources.includes(org_slug), so
  // fb-discover-arnold never matched its hwy4-fb-discover dispatch key.
  const slugs = nightlyOrgSlugs(["hwy4-fb-discover", "gocalaveras"]);
  assert.deepEqual(slugs.sort(), ["fb-discover-arnold", "gocalaveras"]);
});

test("a scraper that writes no events contributes no source", () => {
  assert.deepEqual(nightlyOrgSlugs(["hwy4-fb-groups"]), []);
});

test("an unmapped dispatch key is assumed to write its own name", () => {
  assert.deepEqual(nightlyOrgSlugs(["brand-new-scraper"]), ["brand-new-scraper"]);
});

// --- pins: the map must not drift from the real dispatch table ------------

test("every dispatch key in scrape.ts is accounted for in DISPATCH_ORG_SLUG", () => {
  // scrape.ts runs main() on import, so it is read as text — the same pattern
  // as scraper-venue-literals.test.ts: the duplicate may exist, but CI fails
  // the moment it stops matching.
  const src = readFileSync(join(HERE, "..", "scrape.ts"), "utf8");
  const block = src.slice(
    src.indexOf("const SPECIAL_SCRAPERS"),
    src.indexOf("const SCRAPERS")
  );
  assert.ok(block.length > 0, "could not locate SPECIAL_SCRAPERS in scrape.ts");

  const keys = [...block.matchAll(/^\s*"([a-z0-9-]+)":\s*scrape/gim)].map((m) => m[1]);
  assert.ok(keys.length >= 10, `expected the full dispatch table, saw ${keys.length}`);

  for (const key of keys) {
    assert.ok(
      key in DISPATCH_ORG_SLUG,
      `${key} is dispatched by scrape.ts but missing from DISPATCH_ORG_SLUG`
    );
  }
});

test("every Firecrawl source slug is accounted for in DISPATCH_ORG_SLUG", () => {
  for (const s of FIRECRAWL_SOURCES) {
    assert.ok(
      s.slug in DISPATCH_ORG_SLUG,
      `${s.slug} is a Firecrawl source but missing from DISPATCH_ORG_SLUG`
    );
    assert.equal(DISPATCH_ORG_SLUG[s.slug], s.slug);
  }
});

test("no slug is both dispatched nightly and declared non-nightly", () => {
  // An entry in SOURCE_OWNERSHIP claims nothing in the nightly Action writes
  // this slug. If a scraper does, the claim silences a real warning.
  for (const [key, slug] of Object.entries(DISPATCH_ORG_SLUG)) {
    if (!slug) continue;
    assert.ok(
      !(slug in SOURCE_OWNERSHIP),
      `${slug} is written nightly by ${key} but SOURCE_OWNERSHIP calls it ` +
        `"${SOURCE_OWNERSHIP[slug]?.owner}"`
    );
  }
});

test("every ownership entry names its writer", () => {
  for (const [slug, o] of Object.entries(SOURCE_OWNERSHIP)) {
    assert.ok(o.writer.trim().length > 0, `${slug} has no writer named`);
  }
});
