// Regression lock for fail-CLOSED cron auth (lib/cron-auth.ts).
//
// The pre-fix pattern `if (cronSecret && authHeader !== ...)` failed OPEN: an
// unset CRON_SECRET disabled auth entirely (2026-07-02 review, P1). These cases
// pin that a missing secret DENIES, and that a present secret still requires the
// exact bearer token.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { isCronAuthorized } from "../../lib/cron-auth";

const req = (auth?: string) =>
  new Request("https://hwy4events.com/api/whatever", {
    headers: auth ? { authorization: auth } : {},
  });

function withEnv(value: string | undefined, fn: () => void) {
  const prev = process.env.CRON_SECRET;
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
}

test("unset CRON_SECRET denies everything (fail closed)", () => {
  withEnv(undefined, () => {
    assert.equal(isCronAuthorized(req("Bearer anything")), false);
    assert.equal(isCronAuthorized(req()), false);
  });
});

test("empty CRON_SECRET also denies (fail closed)", () => {
  withEnv("", () => {
    assert.equal(isCronAuthorized(req("Bearer ")), false);
    assert.equal(isCronAuthorized(req()), false);
  });
});

test("correct bearer token authorizes", () => {
  withEnv("s3cret", () => {
    assert.equal(isCronAuthorized(req("Bearer s3cret")), true);
  });
});

test("wrong / missing token denies when secret is set", () => {
  withEnv("s3cret", () => {
    assert.equal(isCronAuthorized(req("Bearer nope")), false);
    assert.equal(isCronAuthorized(req("s3cret")), false); // missing "Bearer "
    assert.equal(isCronAuthorized(req()), false);
  });
});
