// Locks the daily expire-pending-submissions rules and the fixed email copy.
//
// The cron rejects status=pending rows whose event_date is before Pacific
// today, and emails only when there is an address and triage did not flag
// possible_spam. Copy is a template (outcome "expired"), not a model call.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPIRED_REVIEW_NOTE,
  expiredNotifyDecision,
  isExpiredPending,
  replyPanelMode,
} from "../../lib/agent/expire-submissions.js";
import {
  EXPIRED_REPLY_MODEL,
  buildExpiredReply,
  formatSubmissionDate,
  generateReply,
  markReplyAutoSent,
  type SubmissionForReply,
} from "../../lib/agent/submission-reply.js";

const TODAY = "2026-09-23";

function sub(over: Partial<SubmissionForReply> = {}): SubmissionForReply {
  return {
    event_name: "Murphys Park Potluck",
    event_date: "2026-09-12",
    start_time: "18:00",
    venue_name: "Murphys Community Park",
    town: "Murphys",
    description: "Bring a dish.",
    event_url: null,
    submitter_name: "Ada Lovelace",
    submitter_email: "ada@example.com",
    ...over,
  };
}

test("expired review note is the stable string the admin list matches", () => {
  assert.equal(EXPIRED_REVIEW_NOTE, "Expired: event date passed without review");
});

test("only a pending row dated before Pacific today is expired", () => {
  assert.equal(isExpiredPending({ status: "pending", event_date: "2026-09-22" }, TODAY), true);
  assert.equal(isExpiredPending({ status: "pending", event_date: TODAY }, TODAY), false);
  assert.equal(isExpiredPending({ status: "pending", event_date: "2026-09-24" }, TODAY), false);
  assert.equal(isExpiredPending({ status: "rejected", event_date: "2026-09-01" }, TODAY), false);
  assert.equal(isExpiredPending({ status: "approved", event_date: "2026-09-01" }, TODAY), false);
});

test("notify skips a blank address and possible_spam, sends otherwise", () => {
  assert.equal(
    expiredNotifyDecision({ submitter_email: "ada@example.com", ai_analysis: null }),
    "send"
  );
  assert.equal(
    expiredNotifyDecision({ submitter_email: "  ada@example.com  ", ai_analysis: { flags: [] } }),
    "send"
  );
  assert.equal(
    expiredNotifyDecision({ submitter_email: null, ai_analysis: null }),
    "no_email"
  );
  assert.equal(
    expiredNotifyDecision({ submitter_email: "   ", ai_analysis: { flags: ["possible_spam"] } }),
    "no_email"
  );
  assert.equal(
    expiredNotifyDecision({
      submitter_email: "ada@example.com",
      ai_analysis: { flags: ["possible_spam"] },
    }),
    "spam"
  );
  assert.equal(
    expiredNotifyDecision({
      submitter_email: "ada@example.com",
      ai_analysis: { flags: ["past_event"] },
    }),
    "send"
  );
  assert.equal(
    expiredNotifyDecision({ submitter_email: "ada@example.com", ai_analysis: { flags: "nope" } }),
    "send"
  );
});

test("formatSubmissionDate prints a real date and refuses a calendar-impossible one", () => {
  assert.equal(formatSubmissionDate("2026-09-12"), "September 12, 2026");
  assert.equal(formatSubmissionDate("2024-02-29"), "February 29, 2024");
  assert.equal(formatSubmissionDate("2026-02-31"), null);
  assert.equal(formatSubmissionDate("2025-02-29"), null);
  assert.equal(formatSubmissionDate("September 12"), null);
  assert.equal(formatSubmissionDate(""), null);
});

test("expired copy names the event, the date, and Rob, and invents nothing else", () => {
  const reply = buildExpiredReply(sub(), new Date("2026-09-23T14:30:00.000Z"));
  assert.equal(reply.outcome, "expired");
  assert.equal(reply.model, EXPIRED_REPLY_MODEL);
  assert.equal(reply.to, "ada@example.com");
  assert.equal(reply.auto_sent, undefined);
  assert.equal(reply.subject, "Your Hwy4Events submission: Murphys Park Potluck");
  assert.match(reply.body, /^Hi Ada,\n\n/);
  assert.match(reply.body, /Murphys Park Potluck/);
  assert.match(reply.body, /September 12, 2026/);
  assert.match(reply.body, /Highway 4 corridor/);
  assert.match(reply.body, /https:\/\/hwy4events\.com\/submit/);
  assert.match(reply.body, /\n\nRob$/);
  assert.doesNotMatch(reply.body, /[—–!]|[\u{1F300}-\u{1FAFF}]/u);
  assert.doesNotMatch(reply.subject, /[—–!]/);
  assert.doesNotMatch(reply.body, /Murphys Community Park|Bring a dish|18:00/);
});

test("expired copy omits a greeting and a date it cannot state", () => {
  const reply = buildExpiredReply(
    sub({ submitter_name: "ada@example.com", event_name: "  ", event_date: "not-a-date" })
  );
  assert.equal(reply.subject, "Your Hwy4Events submission");
  assert.doesNotMatch(reply.body, /^Hi /);
  assert.match(reply.body, /^Thanks for sending your event in\. The date on it has passed/);
  assert.doesNotMatch(reply.body, /not-a-date|dated/);
});

test("generateReply expired returns the template and does not call the model", async () => {
  const reply = await generateReply(sub({ event_name: "Creek Walk" }), null, "expired");
  assert.equal(reply.outcome, "expired");
  assert.equal(reply.model, EXPIRED_REPLY_MODEL);
  assert.match(reply.body, /Creek Walk/);
  assert.match(reply.body, /\n\nRob$/);
});

test("auto-sent replies are a read-only record; drafts still open in Gmail", () => {
  const draft = buildExpiredReply(sub());
  assert.equal(replyPanelMode(draft), "draft");
  assert.equal(replyPanelMode({ ...draft, to: null }), "none");
  assert.equal(replyPanelMode(markReplyAutoSent(draft, "2026-09-23T14:31:00.000Z")), "sent");
  assert.equal(
    replyPanelMode(markReplyAutoSent({ ...draft, to: "  " }, "2026-09-23T14:31:00.000Z")),
    "sent"
  );
});

test("markReplyAutoSent records the send without rewriting the copy", () => {
  const draft = buildExpiredReply(sub(), new Date("2026-09-23T14:30:00.000Z"));
  const sent = markReplyAutoSent(draft, "2026-09-23T14:31:00.000Z");
  assert.equal(sent.auto_sent, true);
  assert.equal(sent.sent_at, "2026-09-23T14:31:00.000Z");
  assert.equal(sent.subject, draft.subject);
  assert.equal(sent.body, draft.body);
  assert.equal(draft.auto_sent, undefined);
});
