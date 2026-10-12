// The Big Trees schedule watcher must see the program list, not the intro.
//
// The June 2026 baseline hashed from "all programs are free" to the first
// "Related Pages", so a later schedule edit and a removed list never moved
// the hash. These fixtures put Related Pages between the intro and the list,
// and an intro-only page (the list gone) must read as missing.
//
// Run: `cd scripts && npm test`

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIGTREES_FINGERPRINT_KEY,
  BIGTREES_PROGRAMS_PAGE,
  MISSING_FINGERPRINT,
  SCHEDULE_WATCH_ACTION_TYPE,
  decideBigTreesWatch,
  fingerprintProgramText,
  isDuplicateWatchAlert,
  readBigTreesProgram,
  watchAlertCanAutoExecute,
} from "../../lib/bigtrees-watch.js";

const INTRO = `
<main>
  <h1>Park Programs &amp; Events</h1>
  <!--<div class="alert alert-danger"><li>Fix it</li></div>-->
  <p>All programs are free with entrance fee ($10/vehicle) and do not require a reservation.</p>
  <p>Taking a large group (15+ people) on one of our guided hikes? Email us.</p>
</main>
`;

// Related Pages sits between the intro and the list. The old slice stopped there.
const LATE_SUMMER = `
${INTRO.replace("</main>", "")}
  <h4>Related Pages</h4>
  <ul><li>Camping and Cabins</li></ul>
  <h2>Late Summer - Fall Guided Hikes and Walks</h2>
  <p>South Grove: 10am - about 1:00pm</p>
  <p>Saturdays and Sundays through September.</p>
  <aside><h4>Related Pages</h4><a>South Grove trail map UNIQUE_SIDEBAR_TOKEN</a></aside>
</main>
<footer><h2>Connect with California State Parks</h2><p>UNIQUE_FOOTER</p></footer>
`;

const SPRING = LATE_SUMMER.replace(
  "Saturdays and Sundays through September.",
  "Fridays, Saturdays, Sundays late May through early September. Sundays also in October"
);

const INTRO_ONLY = `
${INTRO}
<aside><h4>Related Pages</h4><ul><li>Camping and Cabins</li></ul></aside>
<footer><h2>Connect with California State Parks</h2></footer>
`;

test("the program list is fingerprinted even when Related Pages comes first", () => {
  const read = readBigTreesProgram(LATE_SUMMER);
  assert.equal(read.state, "program");
  if (read.state !== "program") return;
  assert.equal(read.text.includes("Saturdays and Sundays through September"), true);
  assert.equal(read.text.includes("South Grove"), true);
  assert.equal(read.text.includes("All programs are free"), false);
  assert.equal(read.text.includes("Camping and Cabins"), false);
  assert.equal(read.text.includes("UNIQUE_SIDEBAR_TOKEN"), false);
  assert.equal(read.text.includes("UNIQUE_FOOTER"), false);
  assert.equal(read.text.includes("Fix it"), false);
});

test("a schedule wording change moves the fingerprint", () => {
  const late = readBigTreesProgram(LATE_SUMMER);
  const spring = readBigTreesProgram(SPRING);
  assert.equal(late.state, "program");
  assert.equal(spring.state, "program");
  if (late.state !== "program" || spring.state !== "program") return;
  assert.equal(spring.text.includes("Sundays also in October"), true);
  assert.notEqual(fingerprintProgramText(late.text), fingerprintProgramText(spring.text));
});

test("an intro-only page is a missing program list, not a stable baseline", () => {
  const read = readBigTreesProgram(INTRO_ONLY);
  assert.equal(read.state, "missing");
  const decision = decideBigTreesWatch({
    html: INTRO_ONLY,
    previousFingerprint: "intro-hash-from-june",
  });
  assert.equal(decision.read, "missing");
  assert.equal(decision.storeFingerprint, MISSING_FINGERPRINT);
  assert.ok(decision.alert);
  assert.equal(decision.alert?.payload.kind, "missing");
  assert.equal(decision.alert?.payload.program_text, null);
  assert.equal(decision.alert?.type, SCHEDULE_WATCH_ACTION_TYPE);
  assert.equal(decision.alert?.status, "proposed");
  assert.equal(decision.alert?.reversible, false);
  assert.equal(decision.alert?.outward_facing, false);
  assert.equal(decision.alert?.payload.page_url, BIGTREES_PROGRAMS_PAGE);
  assert.equal(decision.alert?.payload.config_key, BIGTREES_FINGERPRINT_KEY);
  assert.equal(BIGTREES_FINGERPRINT_KEY, "bigtrees_schedule_fingerprint");
  assert.equal(BIGTREES_PROGRAMS_PAGE, "https://www.parks.ca.gov/?page_id=25994");
  assert.equal(watchAlertCanAutoExecute(decision.alert!), false);
});

test("a missing list alerts once, then stays quiet while it is still missing", () => {
  const again = decideBigTreesWatch({
    html: INTRO_ONLY,
    previousFingerprint: MISSING_FINGERPRINT,
  });
  assert.equal(again.alert, null);
  assert.equal(again.storeFingerprint, null);

  const first = decideBigTreesWatch({ html: INTRO_ONLY, previousFingerprint: null });
  assert.equal(first.alert, null);
  assert.equal(first.storeFingerprint, MISSING_FINGERPRINT);
});

test("a changed program list files one proposed alert and stores the new hash", () => {
  const spring = readBigTreesProgram(SPRING);
  assert.equal(spring.state, "program");
  if (spring.state !== "program") return;
  const previous = fingerprintProgramText(spring.text);
  const decision = decideBigTreesWatch({ html: LATE_SUMMER, previousFingerprint: previous });
  assert.equal(decision.read, "program");
  assert.equal(decision.alert?.payload.kind, "changed");
  assert.equal(decision.alert?.payload.previous_fingerprint, previous);
  assert.equal(decision.storeFingerprint, decision.fingerprint);
  assert.equal(decision.alert?.payload.program_text?.includes("through September"), true);
  assert.equal(decision.alert?.payload.program_text?.includes("October"), false);
  assert.equal(watchAlertCanAutoExecute(decision.alert!), false);

  const same = decideBigTreesWatch({
    html: LATE_SUMMER,
    previousFingerprint: decision.fingerprint,
  });
  assert.equal(same.alert, null);
  assert.equal(same.storeFingerprint, null);
});

test("an unreadable page does not replace the baseline", () => {
  const decision = decideBigTreesWatch({
    html: "<html><body>Attention Required</body></html>",
    previousFingerprint: "abc",
  });
  assert.equal(decision.read, "unreadable");
  assert.equal(decision.storeFingerprint, null);
  assert.equal(decision.alert?.payload.kind, "unreadable");
  assert.equal(decision.alert?.payload.fingerprint, null);

  const first = decideBigTreesWatch({
    html: "<html><body>Attention Required</body></html>",
    previousFingerprint: null,
  });
  assert.equal(first.alert, null);
});

test("an open proposed alert for the same reading is a duplicate", () => {
  const decision = decideBigTreesWatch({
    html: INTRO_ONLY,
    previousFingerprint: "intro-hash-from-june",
  });
  assert.ok(decision.alert);
  assert.equal(isDuplicateWatchAlert([{ payload: decision.alert?.payload }], decision.alert!), true);
  assert.equal(
    isDuplicateWatchAlert([{ payload: { kind: "changed", fingerprint: "other" } }], decision.alert!),
    false
  );
});

test("the route files agent_actions and does not post to Slack", () => {
  const route = readFileSync(
    new URL("../../app/api/check-bigtrees-schedule/route.ts", import.meta.url),
    "utf8"
  );
  assert.equal(route.includes("SLACK_WEBHOOK"), false);
  assert.equal(route.includes("decideBigTreesWatch"), true);
  assert.equal(route.includes('from("agent_actions")'), true);
  assert.equal(route.includes(SCHEDULE_WATCH_ACTION_TYPE) || route.includes("SCHEDULE_WATCH_ACTION_TYPE"), true);
  assert.equal(route.includes('from("hwy4_events")'), false);
});
