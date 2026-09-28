// Regression lock for the degraded-insert hold (dedup v2 Phase 0.4,
// PRD-dedup-merge-v2.md, scripts/lib/degraded-hold.ts).
//
// The shape it exists for: on 2026-09-27 GoCalaveras's detail pages were
// rate-limited, and its "Bear Valley Trail Stewardship" listing for 2026-10-10
// (EventON 192106) arrived from the month feed alone: venue "Unknown Venue", no
// description. Its keys had been lost to an earlier merge into the BVAC row, so
// it could not exact-match, and with no venue and no prose the fuzzy matcher
// had nothing to work with. It inserted as a fresh duplicate, the fifth copy of
// that one event in 30 days.
//
// These tests pin what must be HELD as hard as what must still INSERT, because
// the hold is only safe if it can defer an event and never lose one.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEGRADED_HOLD_MIN_DAYS_OUT,
  degradedHoldLine,
  isDegradedListing,
  shouldHoldDegradedInsert,
} from "../lib/degraded-hold.js";
import { isEnrichFailure, type EnrichOutcome } from "../lib/enrich-report.js";

const RUN = "2026-09-27";

// The live row, as it arrived.
const bvts = {
  name: "Bear Valley Trail Stewardship",
  date: "2026-10-10",
  venue_name: "Unknown Venue",
  description: null as string | null,
  enrichment_failed: true,
};

test("the 2026-09-27 BVTS re-insert is held", () => {
  assert.equal(isDegradedListing(bvts), true);
  assert.equal(shouldHoldDegradedInsert(bvts, RUN), true);
});

test("a detail page that loaded and was bare is not a failure: the row inserts", () => {
  // `empty` means the page answered 200 with nothing extractable. Waiting a day
  // buys nothing, and holding would lose the listing for good.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, enrichment_failed: false }, RUN), false);
  assert.equal(shouldHoldDegradedInsert({ ...bvts, enrichment_failed: undefined }, RUN), false);
});

test("a named venue OR a description is enough signal to let the row through", () => {
  assert.equal(
    shouldHoldDegradedInsert({ ...bvts, venue_name: "Bear Valley Adventure Company" }, RUN),
    false,
    "the AJAX feed sometimes carries the venue; the matcher can use it"
  );
  assert.equal(
    shouldHoldDegradedInsert(
      { ...bvts, description: "Help maintain the trails around Bear Valley." },
      RUN
    ),
    false,
    "a description gives the matcher its text signals"
  );
});

test("every generic venue shape counts as no venue", () => {
  // A bare town name is the scraper's fallback, not a place.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, venue_name: "Bear Valley" }, RUN), true);
  // Blank and whitespace venues.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, venue_name: "" }, RUN), true);
  assert.equal(shouldHoldDegradedInsert({ ...bvts, venue_name: "   " }, RUN), true);
  // Subtitle text that leaked into venue_name is not a venue either.
  assert.equal(
    shouldHoldDegradedInsert({ ...bvts, venue_name: "Featuring The Star Dogs" }, RUN),
    true
  );
  // Whitespace-only prose is no prose.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, description: " \n " }, RUN), true);
});

test("the hold defers, never loses: an event happening today always inserts", () => {
  assert.equal(DEGRADED_HOLD_MIN_DAYS_OUT, 1);
  assert.equal(
    shouldHoldDegradedInsert({ ...bvts, date: RUN }, RUN),
    false,
    "no later scrape can help an event that is already happening"
  );
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "2026-09-28" }, RUN), true);
  // A past-dated row is not ours to judge here (the future floor owns it).
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "2026-09-20" }, RUN), false);
});

test("the day count is calendar-exact across a DST change and a month edge", () => {
  // 2026-11-01 is the PDT -> PST change; the count must not drift by an hour
  // into a different day.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "2026-11-01" }, "2026-10-31"), true);
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "2026-11-01" }, "2026-11-01"), false);
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "2026-10-01" }, "2026-09-30"), true);
});

test("an unparseable date never holds: when in doubt, the old behavior wins", () => {
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "TBD" }, RUN), false);
  assert.equal(shouldHoldDegradedInsert(bvts, "not-a-date"), false);
});

test("only a failure a later run can fix counts as failed enrichment", () => {
  const failed: EnrichOutcome[] = ["rate_limited", "http_error", "network_error", "skipped"];
  const ok: EnrichOutcome[] = ["enriched", "empty"];
  for (const o of failed) assert.equal(isEnrichFailure(o), true, o);
  for (const o of ok) assert.equal(isEnrichFailure(o), false, o);
});

test("the held-row log line is greppable and names the row", () => {
  const line = degradedHoldLine(bvts);
  assert.match(line, /DEGRADED_INSERT_HELD/);
  assert.match(line, /"Bear Valley Trail Stewardship" 2026-10-10/);
});

// The anti-drift lock. dedup.ts has two insert paths (serial, and the batched
// one behind BATCH_DEDUP), and the two have drifted before (the inline
// rowChanged copy, HWY-33's unchecked counter). Every hwy4_events INSERT site
// must consult the hold, so a third insert path cannot quietly skip it.
test("every hwy4_events insert site in dedup.ts consults the hold", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/dedup.ts", import.meta.url)),
    "utf8"
  );
  const insertSites = [...src.matchAll(/\.insert\(/g)].length;
  const holdCalls = [...src.matchAll(/if \(holdDegradedInsert\(/g)].length;
  assert.ok(insertSites >= 2, "expected the serial and batched insert paths");
  assert.equal(
    holdCalls,
    insertSites,
    `${insertSites} insert site(s) but ${holdCalls} hold check(s). Route every new ` +
      "row through holdDegradedInsert before it is written (dedup v2 0.4)."
  );
});
