// Locks the submit-form contact rules (lib/submitter-contact.ts): phone
// normalization, the email/phone choice, and the rate-limit key.
//
// The stakes are asymmetric and that shapes these tests. A real local number
// wrongly rejected is a lost event and a neighbor who never comes back; a
// slightly loose parser costs nothing, because a human reads the number before
// dialing it. So these assert generously on the shapes people actually type,
// and reject only what genuinely cannot be a US number.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPhone,
  isContactError,
  isValidEmail,
  normalizePhone,
  rateLimitKey,
  resolveContact,
  telHref,
} from "../../lib/submitter-contact.js";

// ─── normalizePhone ─────────────────────────────────────────────────────────

test("normalizePhone: accepts every way a person types a number", () => {
  for (const raw of [
    "2095551234",
    "209-555-1234",
    "(209) 555-1234",
    "209.555.1234",
    "209 555 1234",
    "+1 209 555 1234",
    "1-209-555-1234",
    "  (209) 555-1234  ",
  ]) {
    assert.equal(normalizePhone(raw), "2095551234", `should accept: ${raw}`);
  }
});

test("normalizePhone: rejects what cannot be a US number", () => {
  assert.equal(normalizePhone("555-1234"), null, "7 digits, no area code");
  assert.equal(normalizePhone("20955512345"), null, "11 digits not starting with 1");
  assert.equal(normalizePhone("209555123"), null, "9 digits");
  assert.equal(normalizePhone("009-555-1234"), null, "area code starts with 0");
  assert.equal(normalizePhone("109-555-1234"), null, "area code starts with 1");
  assert.equal(normalizePhone("209-055-1234"), null, "exchange starts with 0");
  assert.equal(normalizePhone("209-155-1234"), null, "exchange starts with 1");
  assert.equal(normalizePhone("not a phone"), null);
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(undefined), null);
});

test("formatPhone / telHref: display vs dial", () => {
  assert.equal(formatPhone("2095551234"), "(209) 555-1234");
  assert.equal(telHref("2095551234"), "+12095551234");
  // Anything not 10 digits passes through rather than getting mangled.
  assert.equal(formatPhone("garbage"), "garbage");
  assert.equal(telHref("garbage"), "garbage");
});

// ─── isValidEmail ───────────────────────────────────────────────────────────

test("isValidEmail: the shape check, unchanged from the original route", () => {
  assert.equal(isValidEmail("jane@example.com"), true);
  assert.equal(isValidEmail("  jane@example.com  "), true);
  assert.equal(isValidEmail("jane+events@sub.example.co.uk"), true);
  assert.equal(isValidEmail("jane@example"), false, "no TLD");
  assert.equal(isValidEmail("jane example.com"), false);
  assert.equal(isValidEmail("@example.com"), false);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail(null), false);
});

// ─── resolveContact ─────────────────────────────────────────────────────────

test("resolveContact: fills exactly one column, never both", () => {
  const e = resolveContact({ method: "email", value: "jane@example.com" });
  assert.ok(!isContactError(e));
  assert.deepEqual(e, { email: "jane@example.com", phone: null });

  const p = resolveContact({ method: "phone", value: "(209) 555-1234" });
  assert.ok(!isContactError(p));
  // Stored bare; formatting is a render concern.
  assert.deepEqual(p, { email: null, phone: "2095551234" });
});

test("resolveContact: a blank value names the method the submitter picked", () => {
  const e = resolveContact({ method: "email", value: "  " });
  assert.ok(isContactError(e));
  assert.match(e.error, /email/i);

  const p = resolveContact({ method: "phone", value: "" });
  assert.ok(isContactError(p));
  assert.match(p.error, /phone/i);
});

test("resolveContact: a bad value is rejected with a usable message", () => {
  const e = resolveContact({ method: "email", value: "not-an-email" });
  assert.ok(isContactError(e));
  assert.match(e.error, /valid email/i);

  const p = resolveContact({ method: "phone", value: "555-1234" });
  assert.ok(isContactError(p));
  assert.match(p.error, /10-digit/i);
});

test("resolveContact: an unknown method falls back to email, not an error", () => {
  // A stale cached form posting a junk method should still be told what is
  // wrong with the address it actually sent, not lectured about the method.
  const ok = resolveContact({ method: "carrier-pigeon", value: "jane@example.com" });
  assert.ok(!isContactError(ok));
  assert.equal(ok.email, "jane@example.com");

  const bad = resolveContact({ method: undefined, value: "nope" });
  assert.ok(isContactError(bad));
  assert.match(bad.error, /valid email/i);
});

// ─── rateLimitKey ───────────────────────────────────────────────────────────

test("rateLimitKey: follows whichever contact was given", () => {
  // Keying on the email column alone would leave the phone path completely
  // uncapped, which is the whole point of this helper.
  assert.deepEqual(rateLimitKey({ email: "jane@example.com", phone: null }), {
    column: "submitter_email",
    value: "jane@example.com",
  });
  assert.deepEqual(rateLimitKey({ email: null, phone: "2095551234" }), {
    column: "submitter_phone",
    value: "2095551234",
  });
});
