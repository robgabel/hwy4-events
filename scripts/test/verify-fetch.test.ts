// HWY-52: a canonical page that cannot be fetched is an outage, not a verdict.
//
// The 2026-08-12 Murphys Wine & Beer Garden run stamped two events
// needs_verification ("Could not fetch canonical events page") and never
// looked again. These tests lock the retry, the date-bearing page gate, and
// the alert copy that names the source.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_FETCH_FAILURE_REASON,
  assessCanonicalText,
  canonicalFetchAlert,
  canonicalUnreachableLog,
  fetchCanonicalPage,
  isCanonicalFetchFailure,
  shouldRetryCanonicalStatus,
  stripCanonicalHtml,
  type CanonicalFetcher,
} from "../../lib/verify-fetch.js";

const WINE_BAR_HTML = `
<html><head><title>Events &#8211; Murphys Wine Bar</title>
<script>var tracker = "10/02/2026 hidden in script";</script>
<style>.x{color:red}</style></head>
<body>
<h1>Events</h1>
<p>Wine Blending Night - Every First Friday</p>
<p>10/02/2026 5:00 pm - 7:00 pm Murphys Wine Bar &amp; Beer Garden</p>
<p>Wine-Down Wednesdays</p>
<p>10/07/2026 11:00 am - 5:00 pm</p>
<footer>Wednesday 11am-5pm (Except Sept 30th)</footer>
</body></html>`;

const NAV_ONLY_HTML = `
<html><body>
<nav>Home Wine Club Events Menus Contact Gift Cards</nav>
<p>Murphys Wine Bar &amp; Beer Garden est in building from 1856. Menu. Our Story. Blog.</p>
<p>Open Oct 2026. Wednesday 11am-5pm (Except Sept 30th). Copyright 2026.</p>
</body></html>`;

function okHtml(html: string, status = 200): Awaited<ReturnType<CanonicalFetcher>> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    url: "https://murphyswinebar.com/events/",
    text: async () => html,
  });
}

test("the historical fetch-failure reason is recognized exactly", () => {
  assert.equal(
    CANONICAL_FETCH_FAILURE_REASON,
    "Could not fetch canonical events page; flag for manual review."
  );
  assert.equal(isCanonicalFetchFailure(CANONICAL_FETCH_FAILURE_REASON), true);
  assert.equal(
    isCanonicalFetchFailure("The event does not appear on the canonical page for 2026-09-30."),
    false
  );
  assert.equal(isCanonicalFetchFailure(null), false);
});

test("strip drops script and style and keeps the wine bar dates", () => {
  const text = stripCanonicalHtml(WINE_BAR_HTML);
  assert.equal(text.includes("hidden in script"), false);
  assert.equal(text.includes("color:red"), false);
  assert.match(text, /10\/02\/2026/);
  assert.match(text, /10\/07\/2026/);
  assert.match(text, /Beer Garden/);
  assert.equal(assessCanonicalText(text).ok, true);
});

test("a page with no year-bearing date is not handed to the model", () => {
  const text = stripCanonicalHtml(NAV_ONLY_HTML);
  // Hours footer and a month-year heading must not count as a listing.
  assert.match(text, /Sept 30th/);
  assert.match(text, /Oct 2026/);
  const assessment = assessCanonicalText(text);
  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.equal(assessment.kind, "no_dates");
});

test("month-name dates with a year count (Brice Station / Arnold Rim Trail)", () => {
  const text =
    "Wolf Jett – July 25, 2026 @ 7pm at Brice Station Vineyards. Doors at 6. " +
    "Live music on the hilltop patio, food truck on site.";
  assert.equal(assessCanonicalText(text).ok, true);
  assert.equal(
    assessCanonicalText(
      "Sunset hike – July 25, 2026. Meet at the trailhead by the kiosk and bring water for the ridge."
    ).ok,
    true
  );
});

test("an empty or tiny body is its own failure", () => {
  assert.equal(assessCanonicalText("").ok, false);
  assert.equal(assessCanonicalText("Not found").ok, false);
  const tiny = assessCanonicalText("short");
  assert.equal(tiny.ok, false);
  if (!tiny.ok) assert.equal(tiny.kind, "empty");
});

test("permanent HTTP statuses are not retried", () => {
  assert.equal(shouldRetryCanonicalStatus(404), false);
  assert.equal(shouldRetryCanonicalStatus(410), false);
  assert.equal(shouldRetryCanonicalStatus(403), true);
  assert.equal(shouldRetryCanonicalStatus(429), true);
  assert.equal(shouldRetryCanonicalStatus(500), true);
  assert.equal(shouldRetryCanonicalStatus(503), true);
});

test("a 503 then a dated page succeeds on the second attempt", async () => {
  const calls: number[] = [];
  const fetchImpl: CanonicalFetcher = async () => {
    calls.push(1);
    if (calls.length === 1) return okHtml("", 503);
    return okHtml(WINE_BAR_HTML, 200);
  };
  const sleeps: number[] = [];
  const result = await fetchCanonicalPage("https://www.murphyswinebar.com/events", {
    userAgent: "Hwy4Events-Verifier/1.0",
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [750]);
  if (result.ok) assert.match(result.text, /10\/02\/2026/);
});

test("a 404 is returned once and does not burn a second attempt", async () => {
  let calls = 0;
  const fetchImpl: CanonicalFetcher = async () => {
    calls++;
    return okHtml("missing", 404);
  };
  const result = await fetchCanonicalPage("https://www.murphyswinebar.com/events", {
    userAgent: "test",
    fetchImpl,
    sleep: async () => {
      throw new Error("should not sleep");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  if (!result.ok) {
    assert.equal(result.kind, "http");
    assert.equal(result.status, 404);
    assert.equal(result.attempts, 1);
  }
});

test("a network error is retried, then reported", async () => {
  let calls = 0;
  const fetchImpl: CanonicalFetcher = async () => {
    calls++;
    throw new Error("connect ECONNRESET");
  };
  const result = await fetchCanonicalPage("https://www.murphyswinebar.com/events", {
    userAgent: "test",
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "network");
    assert.match(result.error, /ECONNRESET/);
    assert.equal(result.attempts, 2);
  }
});

test("a 200 with no dates is a structure failure, not an HTTP failure", async () => {
  let calls = 0;
  const fetchImpl: CanonicalFetcher = async () => {
    calls++;
    return okHtml(NAV_ONLY_HTML, 200);
  };
  const result = await fetchCanonicalPage("https://www.murphyswinebar.com/events", {
    userAgent: "test",
    fetchImpl,
    sleep: async () => {
      throw new Error("should not retry a rendered page");
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, "no_dates");
});

test("the alert names the org and does not tell a human to review an event", () => {
  const failure = {
    ok: false as const,
    kind: "network" as const,
    error: "HTTP 503",
    attempts: 2,
  };
  const text = canonicalFetchAlert({
    displayName: "Murphys Wine & Beer Garden",
    url: "https://www.murphyswinebar.com/events",
    failure,
  });
  assert.match(text, /Murphys Wine & Beer Garden/);
  assert.match(text, /murphyswinebar\.com\/events/);
  assert.match(text, /2 attempt/);
  assert.match(text, /source outage/);
  assert.match(text, /No events were flagged/);
  assert.equal(text.includes("flag for manual review"), false);

  const structure = canonicalFetchAlert({
    displayName: "Murphys Wine & Beer Garden",
    url: "https://www.murphyswinebar.com/events",
    failure: {
      ok: false,
      kind: "no_dates",
      error: "no year-bearing event date survived the tag strip",
      attempts: 1,
    },
  });
  assert.match(structure, /page structure may have changed/);
  assert.match(structure, /No events were flagged/);

  const log = canonicalUnreachableLog({
    slug: "murphys-wine-and-beer-garden",
    url: "https://www.murphyswinebar.com/events",
    failure,
  });
  assert.match(log, /CANONICAL_UNREACHABLE/);
  assert.match(log, /slug=murphys-wine-and-beer-garden/);
});
