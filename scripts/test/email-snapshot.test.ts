// Byte-level snapshot lock for the newsletter email shell.
//
// The region-parameterization refactor (docs/REGIONS.md) moves the email's
// brand strings (hero, footer, tip line, From address, host regex) into the
// region config layer. The refactor's contract is ZERO drift: the rendered
// email must stay byte-identical for Calaveras. These fixtures were generated
// from the pre-refactor code (base d5a66ce) with NEXT_PUBLIC_SITE_URL unset,
// so any accidental byte change in the shell — copy, escaping, UTM tagging,
// click-tracking rewrite, or the env-fallback SITE_URL path — fails loudly
// with a diff.
//
// If you change email copy ON PURPOSE, regenerate the fixture in the same
// commit and say so in the PR (the fixture diff is the review surface).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildEmailHtml,
  buildWelcomeEmailHtml,
  buildSubject,
} from "../../lib/newsletter.js";
import { SITE_URL } from "../../lib/constants.js";

// The fixtures pin the env-unset fallback path (lib/constants.ts reads
// NEXT_PUBLIC_SITE_URL at module load, so it can't be unset here). CI and the
// default local shell leave it unset; this precondition turns a polluted shell
// into a clear failure instead of a confusing byte diff.
test("precondition: NEXT_PUBLIC_SITE_URL is unset for snapshot runs", () => {
  assert.equal(
    SITE_URL,
    "https://hwy4events.com",
    "run the test suite with NEXT_PUBLIC_SITE_URL unset — the email fixtures pin the fallback SITE_URL path"
  );
});

const FIXTURES = join(__dirname, "fixtures", "email");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

// Inputs mirrored exactly from the fixture generator (see PR that added this
// test). They exercise: CRLF paragraph normalization, internal event link
// (click-tracking rewrite), internal page link (UTM tagging), external link,
// javascript: link (must render inert), HTML injection (must stay escaped),
// a dated weekday anchor + "Rob's Pick" lead-in (bold spine), and the
// sign-off line.
const ROB_NOTE = `Hey, Rob here. Quick note with a link to [the site](https://hwy4events.com/about).\r\n\r\nSecond paragraph after a CRLF break.`;

const CONTENT = `Friday, July 24 kicks things off. [Poison Oakies at the Lube Room](https://hwy4events.com/events/live-at-the-lube-poison-oakies-2026-07-24-arnold) is the one to beat, and [this weekend's lineup](https://hwy4events.com/this-weekend) has the rest.

Rob's Pick: the car show. Details on [the venue's page](https://www.theluberoom.com/pages/events) if you want the source.

Watch out for <script>alert("x")</script> & "quoted" text staying inert. And [never click this](javascript:alert(1)).

— Millie 🐾`;

const UNSUB = "https://hwy4events.com/api/newsletter/unsubscribe?token=fixture-token";

test("weekly email HTML is byte-identical to the pre-refactor snapshot", () => {
  assert.equal(buildEmailHtml(ROB_NOTE, CONTENT, UNSUB), read("weekly.html"));
});

test("click-tracked weekly email HTML is byte-identical", () => {
  const tracked = buildEmailHtml(ROB_NOTE, CONTENT, UNSUB, {
    campaignId: "fixture-campaign",
    slugToEventId: new Map([
      [
        "live-at-the-lube-poison-oakies-2026-07-24-arnold",
        "11111111-1111-1111-1111-111111111111",
      ],
    ]),
  });
  assert.equal(tracked, read("weekly-tracked.html"));
});

test("welcome email subject + HTML are byte-identical", () => {
  const welcome = buildWelcomeEmailHtml(UNSUB);
  assert.equal(welcome.subject, read("welcome-subject.txt"));
  assert.equal(welcome.html, read("welcome.html"));
});

test("subject line is byte-identical", () => {
  assert.equal(buildSubject("2026-07-23"), read("subject.txt"));
});
