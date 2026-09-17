// Regression locks for the pure core of the ledger-backed newsletter send
// (lib/newsletter-send.ts). The one that matters most: mapBatchSendResult must
// map Resend's DENSE success array back to the right recipients when
// validation errors are interleaved by index — mapping by position alone would
// attribute message ids to the wrong recipients, and a wrong ledger poisons
// the very idempotency (skip-if-sent) the ledger exists to provide.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chunk,
  selectSubscribersForSend,
  mapBatchSendResult,
  batchRecipientHash,
  resendErrorMessage,
  rankSubscribersForSend,
  withRecentClicks,
  applyDailySendBudget,
  shouldMarkDraftSent,
  pickCampaignDraft,
  NEWSLETTER_DAILY_SEND_BUDGET,
  NEWSLETTER_CLICK_RANK_DAYS,
  type SendLogState,
  type RankableSubscriber,
} from "../../lib/newsletter-send.js";

const sub = (email: string) => ({ email, unsubscribe_token: `tok-${email}` });

test("chunk splits into fixed-size groups with a short tail", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 100), []);
  assert.deepEqual(chunk([1], 100), [[1]]);
});

test("selectSubscribersForSend buckets by ledger state + suppression", () => {
  const subs = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"].map(sub);
  const prior = new Map<string, SendLogState>([
    ["a@x.com", { email: "a@x.com", status: "sent" }],
    ["b@x.com", { email: "b@x.com", status: "pending" }],
    ["c@x.com", { email: "c@x.com", status: "failed" }],
  ]);
  const suppressed = new Set(["d@x.com"]);

  const r = selectSubscribersForSend(subs, prior, suppressed);

  // sent → skipped (the idempotent-resume guarantee)
  assert.deepEqual(r.alreadySent.map((s) => s.email), ["a@x.com"]);
  // pending from a crashed run → blocked, never re-sent blindly
  assert.deepEqual(r.blockedPending.map((s) => s.email), ["b@x.com"]);
  // suppression list wins
  assert.deepEqual(r.suppressedSubscribers.map((s) => s.email), ["d@x.com"]);
  // failed rows are retryable; fresh addresses send
  assert.deepEqual(r.toSend.map((s) => s.email), ["c@x.com", "e@x.com"]);
});

test("suppression outranks a prior sent state", () => {
  const subs = [sub("a@x.com")];
  const prior = new Map<string, SendLogState>([
    ["a@x.com", { email: "a@x.com", status: "sent" }],
  ]);
  const r = selectSubscribersForSend(subs, prior, new Set(["a@x.com"]));
  assert.equal(r.suppressedSubscribers.length, 1);
  assert.equal(r.alreadySent.length, 0);
  assert.equal(r.toSend.length, 0);
});

test("mapBatchSendResult: whole-batch error fails every recipient with the message", () => {
  const subs = ["a@x.com", "b@x.com"].map(sub);
  const r = mapBatchSendResult({
    campaignId: "c1",
    subscribers: subs,
    result: { error: new Error("rate limited") },
  });
  assert.equal(r.sent, 0);
  assert.equal(r.rows.length, 2);
  for (const row of r.rows) {
    assert.equal(row.status, "failed");
    assert.equal(row.error, "rate limited");
  }
  assert.equal(r.errors.length, 2);
});

test("mapBatchSendResult: clean success maps one id per recipient, in order", () => {
  const subs = ["a@x.com", "b@x.com", "c@x.com"].map(sub);
  const r = mapBatchSendResult({
    campaignId: "c1",
    subscribers: subs,
    result: { data: { data: [{ id: "id-a" }, { id: "id-b" }, { id: "id-c" }] } },
  });
  assert.equal(r.sent, 3);
  assert.deepEqual(
    r.rows.map((row) => [row.email, row.status, row.resendId]),
    [
      ["a@x.com", "sent", "id-a"],
      ["b@x.com", "sent", "id-b"],
      ["c@x.com", "sent", "id-c"],
    ]
  );
});

test("mapBatchSendResult: interleaved validation errors do NOT shift ids onto the wrong recipients", () => {
  // Permissive batch validation: Resend reports failures by recipient index and
  // returns successes as a DENSE array. With b@ failing at index 1, the second
  // success id belongs to c@ — a naive index-for-index zip would hand b@'s
  // "slot" id to the wrong address.
  const subs = ["a@x.com", "b@x.com", "c@x.com", "d@x.com"].map(sub);
  const r = mapBatchSendResult({
    campaignId: "c1",
    subscribers: subs,
    result: {
      data: {
        data: [{ id: "id-1" }, { id: "id-2" }, { id: "id-3" }],
        errors: [{ index: 1, message: "invalid recipient" }],
      },
    },
  });
  assert.equal(r.sent, 3);
  assert.deepEqual(
    r.rows.map((row) => [row.email, row.status, row.resendId ?? row.error]),
    [
      ["a@x.com", "sent", "id-1"],
      ["b@x.com", "failed", "invalid recipient"],
      ["c@x.com", "sent", "id-2"],
      ["d@x.com", "sent", "id-3"],
    ]
  );
});

test("mapBatchSendResult: a short success array fails the unmatched tail instead of inventing ids", () => {
  const subs = ["a@x.com", "b@x.com"].map(sub);
  const r = mapBatchSendResult({
    campaignId: "c1",
    subscribers: subs,
    result: { data: { data: [{ id: "id-1" }] } },
  });
  assert.equal(r.sent, 1);
  assert.equal(r.rows[0].status, "sent");
  assert.equal(r.rows[1].status, "failed");
  assert.match(r.rows[1].error ?? "", /did not include a message id/);
});

test("batchRecipientHash is stable for the same list and distinct for different lists", () => {
  const a = [sub("a@x.com"), sub("b@x.com")];
  assert.equal(batchRecipientHash(a), batchRecipientHash([...a]));
  assert.notEqual(batchRecipientHash(a), batchRecipientHash([sub("a@x.com")]));
  assert.equal(batchRecipientHash(a).length, 32);
});

test("resendErrorMessage normalizes the shapes Resend actually returns", () => {
  assert.equal(resendErrorMessage("boom"), "boom");
  assert.equal(resendErrorMessage(new Error("kapow")), "kapow");
  assert.equal(resendErrorMessage({ message: "nope" }), "nope");
  assert.equal(resendErrorMessage(null), "unknown Resend error");
  assert.equal(resendErrorMessage({ code: 429 }), '{"code":429}');
});

function rankable(
  email: string,
  over: Partial<RankableSubscriber> = {}
): RankableSubscriber {
  return {
    email,
    unsubscribe_token: `tok-${email}`,
    visitor_class: null,
    confirmed_at: null,
    created_at: null,
    recentClick: false,
    ...over,
  };
}

test("rankSubscribersForSend: local/hub, then clickers, then newest confirmed", () => {
  const visitorOld = rankable("visitor-old@x.com", {
    visitor_class: "visitor",
    confirmed_at: "2026-01-01T00:00:00.000Z",
  });
  const visitorNew = rankable("visitor-new@x.com", {
    visitor_class: "visitor",
    confirmed_at: "2026-09-01T00:00:00.000Z",
  });
  const clicker = rankable("clicker@x.com", {
    visitor_class: "visitor",
    confirmed_at: "2026-02-01T00:00:00.000Z",
    recentClick: true,
  });
  const hubOld = rankable("hub@x.com", {
    visitor_class: "hub",
    confirmed_at: "2026-03-01T00:00:00.000Z",
  });
  const localNew = rankable("local@x.com", {
    visitor_class: "local",
    confirmed_at: "2026-08-01T00:00:00.000Z",
  });
  const unknown = rankable("unknown@x.com", {
    visitor_class: "unknown",
    created_at: "2026-07-01T00:00:00.000Z",
  });

  const ranked = rankSubscribersForSend([
    visitorOld,
    clicker,
    unknown,
    hubOld,
    visitorNew,
    localNew,
  ]);

  assert.deepEqual(
    ranked.map((s) => s.email),
    [
      "local@x.com", // local, newer than hub
      "hub@x.com",
      "clicker@x.com",
      "visitor-new@x.com",
      "unknown@x.com", // created_at fallback, newer than visitor-old
      "visitor-old@x.com",
    ]
  );
});

test("withRecentClicks is case-insensitive and does not invent clickers", () => {
  const stamped = withRecentClicks(
    [rankable("A@x.com"), rankable("b@x.com")],
    ["a@x.com"]
  );
  assert.equal(stamped[0].recentClick, true);
  assert.equal(stamped[1].recentClick, false);
  const ranked = rankSubscribersForSend(stamped);
  assert.equal(ranked[0].email, "A@x.com");
});

test("rankSubscribersForSend is stable on email and does not mutate input", () => {
  const a = rankable("a@x.com", { visitor_class: "local", confirmed_at: "2026-01-01T00:00:00.000Z" });
  const b = rankable("b@x.com", { visitor_class: "local", confirmed_at: "2026-01-01T00:00:00.000Z" });
  const input = [b, a];
  const ranked = rankSubscribersForSend(input);
  assert.deepEqual(ranked.map((s) => s.email), ["a@x.com", "b@x.com"]);
  assert.deepEqual(input.map((s) => s.email), ["b@x.com", "a@x.com"]);
});

test("applyDailySendBudget stops mid-list and leaves the tail for later", () => {
  const list = [1, 2, 3, 4, 5];
  const r = applyDailySendBudget(list, 3);
  assert.deepEqual(r.thisWave, [1, 2, 3]);
  assert.deepEqual(r.remainder, [4, 5]);
  assert.equal(NEWSLETTER_DAILY_SEND_BUDGET, 85);
  assert.equal(NEWSLETTER_CLICK_RANK_DAYS, 30);
  const defaulted = applyDailySendBudget(new Array(100).fill("x"));
  assert.equal(defaulted.thisWave.length, 85);
  assert.equal(defaulted.remainder.length, 15);
});

test("daily cap is applied after skipping already-sent (Friday resume)", () => {
  const ranked = ["sent@x.com", "next@x.com", "later@x.com", "tail@x.com"].map(sub);
  const prior = new Map<string, SendLogState>([
    ["sent@x.com", { email: "sent@x.com", status: "sent" }],
  ]);
  const selected = selectSubscribersForSend(ranked, prior, new Set());
  assert.deepEqual(selected.alreadySent.map((s) => s.email), ["sent@x.com"]);
  const wave = applyDailySendBudget(selected.toSend, 2);
  assert.deepEqual(wave.thisWave.map((s) => s.email), ["next@x.com", "later@x.com"]);
  assert.deepEqual(wave.remainder.map((s) => s.email), ["tail@x.com"]);
});

test("shouldMarkDraftSent is false while remainder or failures remain", () => {
  assert.equal(shouldMarkDraftSent({ remainder: 25, failures: [] }), false);
  assert.equal(shouldMarkDraftSent({ remainder: 0, failures: [{ email: "a@x.com" }] }), false);
  assert.equal(shouldMarkDraftSent({ remainder: 0, failures: [] }), true);
});

test("pickCampaignDraft: Thursday pending today ships wave 1; Friday resumes leftover", () => {
  const todayDraft = {
    status: "pending",
    target_send_date: "2026-09-17",
  };
  const leftover = {
    status: "pending",
    target_send_date: "2026-09-10",
  };

  const thu = pickCampaignDraft({
    today: "2026-09-17",
    utcWeekday: 4,
    todayDraft,
    incompleteDrafts: [leftover],
  });
  assert.equal(thu.action, "send");
  if (thu.action === "send") {
    assert.equal(thu.resume, false);
    assert.equal(thu.draft.target_send_date, "2026-09-17");
  }

  const fri = pickCampaignDraft({
    today: "2026-09-18",
    utcWeekday: 5,
    todayDraft: null,
    incompleteDrafts: [leftover],
  });
  assert.equal(fri.action, "send");
  if (fri.action === "send") {
    assert.equal(fri.resume, true);
    assert.equal(fri.draft.target_send_date, "2026-09-10");
  }
});

test("pickCampaignDraft: Friday with nothing to drain is a quiet skip", () => {
  const r = pickCampaignDraft({
    today: "2026-09-18",
    utcWeekday: 5,
    todayDraft: null,
    incompleteDrafts: [],
  });
  assert.equal(r.action, "skip");
  if (r.action === "skip") {
    assert.equal(r.slack, false);
    assert.match(r.reason, /No incomplete campaign/);
  }
});

test("pickCampaignDraft: Thursday missing draft still warns; a veto holds the whole Thursday run", () => {
  const missing = pickCampaignDraft({
    today: "2026-09-17",
    utcWeekday: 4,
    todayDraft: null,
    incompleteDrafts: [],
  });
  assert.equal(missing.action, "skip");
  if (missing.action === "skip") assert.equal(missing.slack, true);

  const vetoed = pickCampaignDraft({
    today: "2026-09-17",
    utcWeekday: 4,
    todayDraft: { status: "vetoed", target_send_date: "2026-09-17" },
    incompleteDrafts: [{ status: "pending", target_send_date: "2026-09-10" }],
  });
  assert.equal(vetoed.action, "skip");
  if (vetoed.action === "skip") {
    assert.equal(vetoed.slack, true);
    assert.match(vetoed.reason, /vetoed/);
  }
});

