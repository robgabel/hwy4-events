// Regression lock for the http(s)-only URL allowlist (lib/url.ts).
//
// Event/venue/org URLs come from public submissions, unattended scrapers, and
// Google Places. A value like `javascript://evil.com/%0aalert(1)` parses with
// `new URL` and survives a hostname check, so if it reaches an href it's a
// click-to-execute XSS (2026-07-02 review, P1). normalizeUrl (write boundary)
// and isHttpUrl (render gate) reject anything that isn't http/https.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, isHttpUrl } from "../../lib/url";

test("normalizeUrl rejects javascript: and other dangerous schemes", () => {
  assert.equal(normalizeUrl("javascript://evil.com/%0aalert(1)"), "");
  assert.equal(normalizeUrl("javascript:alert(1)"), "");
  assert.equal(normalizeUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(normalizeUrl("vbscript:msgbox(1)"), "");
  assert.equal(normalizeUrl("  JavaScript://evil.com "), ""); // trimmed + case-insensitive
});

test("normalizeUrl accepts and normalizes real websites", () => {
  assert.equal(normalizeUrl("example.com/event"), "https://example.com/event");
  assert.equal(normalizeUrl("www.mywinery.com"), "https://www.mywinery.com");
  assert.equal(normalizeUrl("https://arnoldrimtrail.org/events/"), "https://arnoldrimtrail.org/events/");
  assert.equal(normalizeUrl("http://example.com"), "http://example.com");
  assert.equal(normalizeUrl(""), "");
  assert.equal(normalizeUrl(null), "");
  assert.equal(normalizeUrl("   "), "");
});

test("isHttpUrl gates hrefs to http/https only", () => {
  assert.equal(isHttpUrl("https://example.com"), true);
  assert.equal(isHttpUrl("http://example.com/x?y=1"), true);
  assert.equal(isHttpUrl("javascript://evil.com/%0aalert(1)"), false);
  assert.equal(isHttpUrl("data:text/html,x"), false);
  assert.equal(isHttpUrl("mailto:a@b.com"), false);
  assert.equal(isHttpUrl("tel:2097950000"), false);
  assert.equal(isHttpUrl("not a url"), false);
  assert.equal(isHttpUrl(""), false);
  assert.equal(isHttpUrl(null), false);
});
