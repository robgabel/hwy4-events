// Regression lock for the agent cockpit's autonomy guardrail (lib/agent/policy.ts).
// The invariant: an outward-facing action can NEVER auto-run, no matter what the
// policy row says. If someone loosens canAutoExecute, this fails loudly.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { canAutoExecute } from "../../lib/agent/policy.js";

const safe = { blast_radius: "low" as const, reversible: true, outward_facing: false };
const policyOn = { auto_execute: true };

test("auto-runs only when low + reversible + internal + policy on", () => {
  assert.equal(canAutoExecute(safe, policyOn), true);
});

test("outward-facing can NEVER auto-run, even with policy on", () => {
  assert.equal(canAutoExecute({ ...safe, outward_facing: true }, policyOn), false);
});

test("non-low blast radius cannot auto-run", () => {
  assert.equal(canAutoExecute({ ...safe, blast_radius: "med" }, policyOn), false);
  assert.equal(canAutoExecute({ ...safe, blast_radius: "high" }, policyOn), false);
});

test("irreversible cannot auto-run", () => {
  assert.equal(canAutoExecute({ ...safe, reversible: false }, policyOn), false);
});

test("no policy row, or auto_execute off, queues for a human", () => {
  assert.equal(canAutoExecute(safe, null), false);
  assert.equal(canAutoExecute(safe, undefined), false);
  assert.equal(canAutoExecute(safe, { auto_execute: false }), false);
});
