// Regression lock for the welcome email (lib/newsletter.ts buildWelcomeEmailHtml).
//
// Sent once on first confirm. The copy is fixed and human-written; this pins
// the load-bearing parts: the subscriber's own unsubscribe link is present
// (CAN-SPAM), the cadence promise is stated, and nothing interpolated leaks
// as "undefined".
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWelcomeEmailHtml } from "../../lib/newsletter.js";

const UNSUB = "https://hwy4events.com/api/newsletter/unsubscribe?token=abc";

test("welcome email carries the subscriber's unsubscribe link", () => {
  const { html } = buildWelcomeEmailHtml(UNSUB);
  assert.ok(html.includes(UNSUB));
});

test("welcome email states the Thursday cadence and links the site", () => {
  const { subject, html } = buildWelcomeEmailHtml(UNSUB);
  assert.equal(subject, "You're on the list");
  assert.ok(html.includes("Thursday"));
  assert.ok(html.includes("/this-weekend"));
  assert.ok(html.includes("/submit"));
});

test("no template interpolation leaks", () => {
  const { html } = buildWelcomeEmailHtml(UNSUB);
  assert.ok(!html.includes("undefined"));
  assert.ok(!html.includes("[object Object]"));
});
