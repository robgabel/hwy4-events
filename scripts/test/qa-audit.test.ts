// Regression lock for the QA agent's pure page evaluator (lib/agent/qa-audit.ts).
// The fetch + DB dedup are integration concerns, but checkPage decides what counts
// as a bug (and thus what gets filed onto the board), so pin it.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPage, checkKey } from "../../lib/agent/qa-audit.js";

test("checkPage: a non-200 is the only finding, regardless of kind", () => {
  for (const kind of ["page", "event", "sitemap"] as const) {
    const f = checkPage(kind, 500, "");
    assert.equal(f.length, 1);
    assert.equal(f[0].check, "status");
    assert.equal(f[0].severity, "p1");
  }
  // connection error (status 0) also reads as a status finding
  assert.equal(checkPage("page", 0, "")[0].check, "status");
});

test("checkPage: a healthy page with a title and no jsonld is clean", () => {
  assert.deepEqual(checkPage("page", 200, "<html><head><title>Hwy4 Events</title></head></html>"), []);
});

test("checkPage: a page missing a non-empty title is flagged", () => {
  const f = checkPage("page", 200, "<html><head><title></title></head></html>");
  assert.equal(f.length, 1);
  assert.equal(f[0].check, "title");
});

test("checkPage: an event page must carry JSON-LD", () => {
  const withTitleNoLd = "<html><head><title>An Event</title></head><body>no structured data</body></html>";
  const f = checkPage("event", 200, withTitleNoLd);
  assert.equal(f.length, 1);
  assert.equal(f[0].check, "jsonld");
  // with JSON-LD present it's clean
  assert.deepEqual(
    checkPage("event", 200, '<title>An Event</title><script type="application/ld+json">{}</script>'),
    []
  );
});

test("checkPage: sitemap must be a valid urlset/sitemapindex document", () => {
  assert.deepEqual(checkPage("sitemap", 200, '<?xml version="1.0"?><urlset><url><loc>x</loc></url></urlset>'), []);
  assert.deepEqual(checkPage("sitemap", 200, "<sitemapindex></sitemapindex>"), []);
  const bad = checkPage("sitemap", 200, "<html>not a sitemap</html>");
  assert.equal(bad.length, 1);
  assert.equal(bad[0].check, "malformed");
});

test("checkKey is stable and namespaced", () => {
  assert.equal(checkKey("jsonld", "event-detail"), "qa:jsonld:event-detail");
  assert.equal(checkKey("status", "/free"), "qa:status:/free");
});

test("checkPage flags a doubled brand suffix in the title", () => {
  // The 2026-07-16 town-page bug: metaTitle carried "| Hwy 4 Events" AND the
  // root layout template appended it again.
  const doubled = `<html><head><title>Arnold CA Events This Week | Hwy 4 Events | Hwy 4 Events</title></head><body></body></html>`;
  const findings = checkPage("page", 200, doubled);
  assert.deepEqual(findings.map((f) => f.check), ["title_doubled_brand"]);

  const clean = `<html><head><title>Arnold CA Events This Week | Hwy 4 Events</title></head><body></body></html>`;
  assert.deepEqual(checkPage("page", 200, clean), []);
});
