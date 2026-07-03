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
  type SendLogState,
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
