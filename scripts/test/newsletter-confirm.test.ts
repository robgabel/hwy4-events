// Regression lock for the double-opt-in confirm funnel
// (lib/newsletter-confirm.ts).
//
// Pins the load-bearing parts: the confirm URL is in both emails, tokens
// do not expire (a reminder reuses the same link), unsubscribed / confirmed
// / nameless rows never become reminder candidates, landing pages render
// success and failure (the old /?newsletter= redirects were unread), and
// the copy stays voice-clean (no em dash, no exclamation).
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRM_EMAIL_SUBJECT,
  REMINDER_EMAIL_SUBJECT,
  REMINDER_MIN_AGE_HOURS,
  TOKEN_RE,
  alreadySubscribedCopy,
  buildConfirmReminderDraft,
  buildConfirmationEmailHtml,
  checkEmailCopy,
  confirmLandingCopy,
  confirmUrlForToken,
  gmailComposeUrl,
  isPendingUnconfirmed,
  isReminderEligible,
  renderConfirmLandingHtml,
  selectReminderCandidates,
  SIGNUP_EXPECTATION,
  subscribeResponse,
  type ConfirmLandingKind,
  type PendingUnconfirmed,
} from "../../lib/newsletter-confirm.js";

const TOKEN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CONFIRM = `https://hwy4events.com/api/newsletter/confirm?token=${TOKEN}`;

function pending(over: Partial<PendingUnconfirmed> = {}): PendingUnconfirmed {
  return {
    email: "neighbor@example.com",
    unsubscribe_token: TOKEN,
    created_at: "2026-08-01T12:00:00.000Z",
    last_confirmation_sent_at: "2026-08-01T12:00:00.000Z",
    confirmed: false,
    unsubscribed_at: null,
    ...over,
  };
}

test("confirmation email carries the confirm URL and Thursday cadence", () => {
  const { subject, html } = buildConfirmationEmailHtml(CONFIRM);
  assert.equal(subject, CONFIRM_EMAIL_SUBJECT);
  assert.ok(html.includes(CONFIRM));
  assert.ok(html.includes("Thursday"));
  assert.ok(html.includes("scanner"));
});

test("confirmation email has no interpolation leaks", () => {
  const { html } = buildConfirmationEmailHtml(CONFIRM);
  assert.ok(!html.includes("undefined"));
  assert.ok(!html.includes("[object Object]"));
});

test("reminder draft reuses the same confirm URL and invents no name", () => {
  const { subject, body } = buildConfirmReminderDraft(CONFIRM);
  assert.equal(subject, REMINDER_EMAIL_SUBJECT);
  assert.ok(body.includes(CONFIRM));
  assert.ok(body.includes("ignore"));
  assert.ok(!body.includes("undefined"));
  assert.ok(!/\b(Hi|Hey) [A-Z]/.test(body));
});

test("subscribeResponse distinguishes already-on-the-list from check-email", () => {
  const already = subscribeResponse("already_subscribed");
  assert.equal(already.outcome, "already_subscribed");
  assert.match(already.message, /already on the Thursday list/i);

  const check = subscribeResponse("check_email");
  assert.equal(check.outcome, "check_email");
  assert.equal(check.message, "Confirmation email sent");
});

test("check-email copy names the real From and subject", () => {
  const copy = checkEmailCopy();
  assert.equal(copy.subject, CONFIRM_EMAIL_SUBJECT);
  assert.ok(copy.fromLabel.length > 0);
  assert.ok(copy.steps.some((s) => s.includes(CONFIRM_EMAIL_SUBJECT)));
  assert.match(copy.note, /Promotions or Spam/);
  assert.match(SIGNUP_EXPECTATION, /confirm link/);
});

test("already-subscribed copy does not tell them to check email", () => {
  const copy = alreadySubscribedCopy();
  assert.match(copy.heading, /already on the Thursday list/i);
  assert.ok(!/check your email/i.test(copy.heading + copy.note));
});

test("isPendingUnconfirmed rejects confirmed, unsubscribed, and incomplete rows", () => {
  assert.equal(isPendingUnconfirmed(pending()), true);
  assert.equal(isPendingUnconfirmed(pending({ confirmed: true })), false);
  assert.equal(
    isPendingUnconfirmed(pending({ unsubscribed_at: "2026-08-02T00:00:00.000Z" })),
    false
  );
  assert.equal(isPendingUnconfirmed(pending({ email: "" })), false);
  assert.equal(isPendingUnconfirmed(pending({ email: "not-an-email" })), false);
  assert.equal(isPendingUnconfirmed(pending({ unsubscribe_token: "nope" })), false);
  assert.equal(isPendingUnconfirmed({ email: null, unsubscribe_token: TOKEN }), false);
});

test("reminder eligibility waits a day and never includes unsubscribed rows", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");
  const stale = pending({ created_at: "2026-08-01T12:00:00.000Z" });
  const fresh = pending({
    email: "fresh@example.com",
    unsubscribe_token: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    created_at: "2026-08-03T06:00:00.000Z",
  });
  const unsub = pending({
    email: "gone@example.com",
    unsubscribe_token: "11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    unsubscribed_at: "2026-08-02T00:00:00.000Z",
  });

  assert.equal(REMINDER_MIN_AGE_HOURS, 24);
  assert.equal(isReminderEligible(stale, now), true);
  assert.equal(isReminderEligible(fresh, now), false);
  assert.equal(isReminderEligible(unsub, now), false);

  const picked = selectReminderCandidates([fresh, unsub, stale], now);
  assert.deepEqual(
    picked.map((r) => r.email),
    ["neighbor@example.com"]
  );
});

test("selectReminderCandidates sorts oldest first and caps the list", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const older = pending({
    email: "older@example.com",
    created_at: "2026-07-01T00:00:00.000Z",
    unsubscribe_token: "22222222-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  });
  const newer = pending({
    email: "newer@example.com",
    created_at: "2026-07-15T00:00:00.000Z",
    unsubscribe_token: "33333333-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  });
  const picked = selectReminderCandidates([newer, older], now, 1);
  assert.deepEqual(
    picked.map((r) => r.email),
    ["older@example.com"]
  );
});

test("confirm landing pages cover success and failure without a homepage redirect", () => {
  const kinds: ConfirmLandingKind[] = ["ask", "confirmed", "already", "invalid", "error"];
  for (const kind of kinds) {
    const copy = confirmLandingCopy(kind);
    assert.ok(copy.heading);
    assert.ok(copy.body);
    assert.ok(!copy.body.includes("undefined"));
  }

  const ask = renderConfirmLandingHtml("ask", { token: TOKEN });
  assert.ok(ask.includes('method="POST"'));
  assert.ok(ask.includes(TOKEN));
  assert.ok(ask.includes("Yes, add me"));

  const confirmed = renderConfirmLandingHtml("confirmed");
  assert.ok(confirmed.includes("/this-weekend"));
  assert.ok(!confirmed.includes("<form"));

  const invalid = renderConfirmLandingHtml("invalid", { token: TOKEN });
  assert.ok(!invalid.includes("<form"));
  assert.ok(!invalid.includes(TOKEN));
});

test("ask landing refuses to embed a non-UUID token", () => {
  const html = renderConfirmLandingHtml("ask", { token: '"><script>alert(1)</script>' });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<form"));
});

test("gmail compose URL carries to, subject, and body", () => {
  const url = gmailComposeUrl("a@b.com", REMINDER_EMAIL_SUBJECT, "body line");
  assert.ok(url.startsWith("https://mail.google.com/mail/?view=cm"));
  assert.ok(url.includes("to=a%40b.com"));
  assert.ok(url.includes("su="));
  assert.ok(url.includes("body="));
});

test("confirmUrlForToken is the live confirm path", () => {
  const url = confirmUrlForToken(TOKEN);
  assert.ok(url.includes("/api/newsletter/confirm?token=" + TOKEN));
  assert.equal(TOKEN_RE.test(TOKEN), true);
  assert.equal(TOKEN_RE.test("not-a-token"), false);
});

test("user-facing confirm copy has no em dash and no exclamation", () => {
  const blobs: string[] = [
    CONFIRM_EMAIL_SUBJECT,
    REMINDER_EMAIL_SUBJECT,
    SIGNUP_EXPECTATION,
    ...Object.values(checkEmailCopy()).flat(),
    alreadySubscribedCopy().heading,
    alreadySubscribedCopy().note,
    buildConfirmationEmailHtml(CONFIRM).html,
    buildConfirmReminderDraft(CONFIRM).body,
  ];
  for (const kind of ["ask", "confirmed", "already", "invalid", "error"] as const) {
    const c = confirmLandingCopy(kind);
    blobs.push(c.heading, c.body, c.buttonLabel ?? "", c.finePrint ?? "", c.ctaLabel ?? "");
  }
  for (const text of blobs) {
    assert.ok(!text.includes("\u2014"), `em dash in: ${text.slice(0, 80)}`);
    assert.ok(!text.includes("!"), `exclamation in: ${text.slice(0, 80)}`);
  }
});
