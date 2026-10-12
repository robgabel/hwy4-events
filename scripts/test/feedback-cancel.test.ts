// Visitor "didn't happen" reports become a proposed cancel_event (#384).
// Approval is the only path that sets status. The auto-runner cannot.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canAutoExecute } from "../../lib/agent/policy.js";
import {
  CANCEL_EVENT_ACTION_TYPE,
  CANCEL_EVENT_AUTONOMY,
  buildCancelEventProposal,
  cancelEventAutoReady,
  cancelEventWritePayload,
  cancelRevertPayload,
  isOpenCancelForEvent,
  reportsEventDidNotHappen,
  seriesSiblingsToFlag,
} from "../../lib/feedback-cancel.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a didn't-happen note matches, and a correction does not", () => {
  for (const note of [
    "This didn't happen",
    "It did not happen",
    "The hike never happened",
    "It wasn't happening when we got there",
    "This is not happening",
    "The trail is no longer happening",
    "Didn't take place",
    "The show did not occur",
    "It wasn't held",
    "Nobody was there",
    "No one showed",
    "Nothing was happening",
    "The park cancelled it",
    "Called off",
    "The trail was closed",
    "It got closed for the burn",
  ]) {
    assert.equal(reportsEventDidNotHappen(note), true, note);
  }
  for (const note of [
    "",
    "Starts at 7, not 6",
    "The band changed to Hired Gunn",
    "Please don't cancel this",
    "This was not cancelled",
    "It wasn't closed",
    "Doors closed at 9",
    "Kids welcome",
  ]) {
    assert.equal(reportsEventDidNotHappen(note), false, note);
  }
});

test("the proposal is human-gated and names the series without cancelling it", () => {
  assert.equal(
    buildCancelEventProposal({
      eventId: "e1",
      eventSlug: "storytime",
      eventName: "Storytime",
      eventDate: "2026-10-14",
      town: "Arnold",
      note: "Starts at 7, not 6",
      feedbackId: "f1",
      submitterRole: "visitor",
    }),
    null
  );

  const proposal = buildCancelEventProposal({
    eventId: "e1",
    eventSlug: "south-grove",
    eventName: "South Grove Guided Hike",
    eventDate: "2026-10-11",
    town: "Arnold",
    note: "We showed up and it didn't happen. The trail was closed.",
    feedbackId: "f1",
    submitterRole: "visitor",
    seriesEventIds: ["e2", "e3"],
  });
  assert.ok(proposal);
  assert.equal(proposal.type, CANCEL_EVENT_ACTION_TYPE);
  assert.equal(proposal.status, "proposed");
  assert.deepEqual(
    {
      blast_radius: proposal.blast_radius,
      reversible: proposal.reversible,
      outward_facing: proposal.outward_facing,
    },
    CANCEL_EVENT_AUTONOMY
  );
  assert.equal(proposal.payload.event_id, "e1");
  assert.deepEqual(proposal.payload.series_event_ids, ["e2", "e3"]);
  assert.match(proposal.rationale, /this occurrence only/);
  assert.match(proposal.rationale, /not cancelled/);
  assert.equal(proposal.rationale.includes("—"), false);
  assert.equal(
    canAutoExecute(proposal, { auto_execute: true }),
    false
  );
  assert.equal(cancelEventAutoReady(), false);
});

test("series siblings are other upcoming dates of the same listing", () => {
  const reported = { id: "self", name: "South Grove Guided Hike", town: "Arnold" };
  const ids = seriesSiblingsToFlag(
    reported,
    [
      { id: "self", name: "South Grove Guided Hike", date: "2026-10-11", town: "Arnold" },
      { id: "next", name: "south grove guided hike", date: "2026-10-17", town: "arnold" },
      { id: "past", name: "South Grove Guided Hike", date: "2026-09-27", town: "Arnold" },
      { id: "gone", name: "South Grove Guided Hike", date: "2026-10-18", town: "Arnold", status: "cancelled" },
      { id: "other", name: "North Grove Guided Walk", date: "2026-10-17", town: "Arnold" },
      { id: "town", name: "South Grove Guided Hike", date: "2026-10-17", town: "Murphys" },
    ],
    "2026-10-11"
  );
  assert.deepEqual(ids, ["next"]);

  const many = Array.from({ length: 50 }, (_, i) => ({
    id: `id-${i}`,
    name: "Storytime",
    date: "2026-12-30",
    town: "Arnold",
  }));
  assert.equal(seriesSiblingsToFlag({ id: "none", name: "Storytime", town: "Arnold" }, many, "2026-10-01").length, 40);
});

test("an open proposal for the same event or slug is not filed twice", () => {
  const open = [{ payload: { event_id: null, event_slug: "south-grove" } }];
  assert.equal(
    isOpenCancelForEvent(open, { eventId: "e1", eventSlug: "south-grove" }),
    true
  );
  assert.equal(
    isOpenCancelForEvent(open, { eventId: null, eventSlug: "other" }),
    false
  );
  assert.equal(isOpenCancelForEvent([{ payload: null }], { eventId: "e1", eventSlug: "south-grove" }), false);
});

test("approval and revert touch status only", () => {
  assert.deepEqual(cancelEventWritePayload(), { status: "cancelled" });
  assert.deepEqual(cancelRevertPayload({ status: "confirmed", description_locked: false, name: "x" }), {
    status: "confirmed",
  });
  assert.equal(cancelRevertPayload({ status: "sold_out" }), null);
  assert.equal(cancelRevertPayload(null), null);
  assert.deepEqual(cancelRevertPayload({ status: "tentative" }), { status: "tentative" });
});

test("the feedback route files the proposal and does not Slack that note", () => {
  const route = readFileSync(join(repoRoot, "app/api/events/feedback/route.ts"), "utf8");
  const fileAt = route.indexOf("fileProposedCancellation(");
  const slackAt = route.indexOf("SLACK_WEBHOOK_URL");
  assert.ok(fileAt > 0);
  assert.ok(slackAt > fileAt);
  const between = route.slice(fileAt, slackAt);
  assert.match(between, /return NextResponse\.json\(\{ ok: true \}\)/);
  assert.equal(route.includes('status: "cancelled"'), false);
});

test("the executor cancels by status and the auto-runner refuses the type", () => {
  const executor = readFileSync(join(repoRoot, "lib/agent/actions-executor.ts"), "utf8");
  assert.match(executor, /case "cancel_event":/);
  assert.match(executor, /cancelEventWritePayload\(\)/);
  assert.match(executor, /cancelRevertPayload\(/);
  const runner = readFileSync(join(repoRoot, "lib/agent/auto-runner.ts"), "utf8");
  assert.match(runner, /CANCEL_EVENT_ACTION_TYPE/);
  assert.match(runner, /cancelEventAutoReady\(\)/);
});
