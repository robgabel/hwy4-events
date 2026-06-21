// Locks the pure core of email-to-event ingestion (lib/inbound-email.ts): the
// model-output parser, the field normalizer, and the webhook signature check.
// These run with no network and no DB. (Dedup/merge is NOT here — an email
// submission rides the existing Agent Cockpit triage engine, tested separately.)
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExtractedEvents,
  normalizeExtracted,
  canonicalizeTown,
  extractEmailAddress,
  buildExtractionPrompt,
  signWebhook,
  verifyWebhookSignature,
} from "../../lib/inbound-email.js";

// ─── parseExtractedEvents ───────────────────────────────────────────────────

test("parseExtractedEvents: handles fenced, bare, object, prose-wrapped, garbage", () => {
  assert.deepEqual(parseExtractedEvents('[{"name":"A"}]'), [{ name: "A" }]);
  assert.deepEqual(parseExtractedEvents('```json\n[{"name":"A"}]\n```'), [{ name: "A" }]);
  // A bare object is coerced to a single-element array.
  assert.deepEqual(parseExtractedEvents('{"name":"A"}'), [{ name: "A" }]);
  // Leading prose before the array is salvaged.
  assert.deepEqual(parseExtractedEvents('Here you go:\n[{"name":"A"}]'), [{ name: "A" }]);
  // Unparseable degrades to empty, never throws.
  assert.deepEqual(parseExtractedEvents("not json at all"), []);
  assert.deepEqual(parseExtractedEvents(""), []);
  // The model's explicit "no events" sentinel.
  assert.deepEqual(parseExtractedEvents("[]"), []);
});

// ─── normalizeExtracted ─────────────────────────────────────────────────────

test("normalizeExtracted: requires name + valid date, else null", () => {
  assert.equal(normalizeExtracted({ name: "Show" }), null); // no date
  assert.equal(normalizeExtracted({ date: "2026-07-04" }), null); // no name
  assert.equal(normalizeExtracted({ name: "Show", date: "July 4" }), null); // bad date
  assert.equal(normalizeExtracted(null), null);
  assert.equal(normalizeExtracted("nope"), null);
});

test("normalizeExtracted: normalizes time, category, town, artists", () => {
  const n = normalizeExtracted({
    name: "  Summer Jam  ",
    date: "2026-07-04",
    start_time: "7:00",
    end_time: "22:00:00",
    venue_name: "Murphys Park",
    town: "murphys",
    description: "  A concert.  ",
    category: "LIVE_MUSIC",
    artists: ["The Band", "  ", "Opener"],
    price: "$20",
    confidence: "HIGH",
  });
  assert.ok(n);
  assert.equal(n!.name, "Summer Jam");
  assert.equal(n!.start_time, "07:00");
  assert.equal(n!.end_time, "22:00");
  assert.equal(n!.town, "Murphys"); // canonical casing
  assert.equal(n!.category, "live_music");
  assert.deepEqual(n!.artists, ["The Band", "Opener"]);
  assert.equal(n!.price, "$20");
  assert.equal(n!.confidence, "high");
});

test("normalizeExtracted: unknown category and confidence fall back", () => {
  const n = normalizeExtracted({ name: "X", date: "2026-07-04", category: "concert" });
  assert.equal(n!.category, "other");
  assert.equal(n!.confidence, "medium");
  assert.equal(n!.artists, null);
});

test("canonicalizeTown: corridor match, alias, unknown kept", () => {
  assert.equal(canonicalizeTown("white pines"), "White Pines");
  assert.equal(canonicalizeTown("ARNOLD"), "Arnold");
  assert.equal(canonicalizeTown("hathaway pines"), "Arnold"); // address alias
  assert.equal(canonicalizeTown("Sonora"), "Sonora"); // out-of-corridor kept for human
  assert.equal(canonicalizeTown(""), null);
  assert.equal(canonicalizeTown(null), null);
});

// ─── extractEmailAddress ────────────────────────────────────────────────────

test("extractEmailAddress: angle-bracket, bare, and empty", () => {
  assert.equal(extractEmailAddress("Rob Gabel <rob@example.com>"), "rob@example.com");
  assert.equal(extractEmailAddress("ROB@Example.com"), "rob@example.com");
  assert.equal(extractEmailAddress(""), "");
  assert.equal(extractEmailAddress(null), "");
});

// ─── buildExtractionPrompt ──────────────────────────────────────────────────

test("buildExtractionPrompt: injects today + corridor towns + the JSON contract", () => {
  const p = buildExtractionPrompt({ today: "2026-06-04", subject: "Concert!", body: "Tonight at 7" });
  assert.match(p, /Today is 2026-06-04/);
  assert.match(p, /Murphys/);
  assert.match(p, /JSON array/);
  assert.match(p, /Concert!/);
  assert.match(p, /return exactly \[\]/);
});

// ─── Webhook signature (Svix / Standard Webhooks) ───────────────────────────

test("verifyWebhookSignature: accepts a valid signature, rejects tamper/replay", () => {
  const secret = "whsec_" + Buffer.from("super-secret-key").toString("base64");
  const id = "msg_123";
  const now = 1_780_000_000;
  const ts = String(now);
  const body = JSON.stringify({ type: "email.received", data: { subject: "hi" } });
  const sig = signWebhook(secret, id, ts, body);
  const header = `v1,${sig}`;

  assert.equal(
    verifyWebhookSignature({ secret, id, timestamp: ts, signatureHeader: header, body, nowSeconds: now }),
    true
  );
  // Tampered body
  assert.equal(
    verifyWebhookSignature({ secret, id, timestamp: ts, signatureHeader: header, body: body + "x", nowSeconds: now }),
    false
  );
  // Wrong secret
  assert.equal(
    verifyWebhookSignature({ secret: "whsec_" + Buffer.from("other").toString("base64"), id, timestamp: ts, signatureHeader: header, body, nowSeconds: now }),
    false
  );
  // Stale timestamp (outside the 300s window)
  assert.equal(
    verifyWebhookSignature({ secret, id, timestamp: ts, signatureHeader: header, body, nowSeconds: now + 4000 }),
    false
  );
  // Missing header
  assert.equal(
    verifyWebhookSignature({ secret, id, timestamp: ts, signatureHeader: null, body, nowSeconds: now }),
    false
  );
});
