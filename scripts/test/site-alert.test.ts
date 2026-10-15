// Show/hide window for the site-wide safety banner (lib/site-alert.ts).
//
// expiresAt is an absolute instant: Sunday Oct 18, 2026 11:59:59.999pm
// Pacific (PDT, UTC-7). A UTC clock reading "Oct 18" must not hide the
// banner during the Pacific evening, and Monday 12:00am Pacific must.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSiteAlertActive,
  isSiteAlertDismissed,
  resolveSiteAlert,
  SITE_ALERT,
  siteAlertGuardScript,
  type SiteAlert,
} from "../../lib/site-alert";

const WINDOW: Pick<SiteAlert, "startsAt" | "expiresAt"> = {
  startsAt: "2026-10-15T00:00:00-07:00",
  expiresAt: "2026-10-18T23:59:59.999-07:00",
};

test("visible through Sun Oct 18, 2026 11:59pm Pacific and hidden at midnight", () => {
  // Sat Oct 17, 2026 12:00pm PDT
  assert.equal(isSiteAlertActive(WINDOW, new Date("2026-10-17T19:00:00.000Z")), true);
  // Sun Oct 18, 2026 11:59:59.999pm PDT
  assert.equal(isSiteAlertActive(WINDOW, new Date("2026-10-19T06:59:59.999Z")), true);
  // Mon Oct 19, 2026 12:00:00.000am PDT
  assert.equal(isSiteAlertActive(WINDOW, new Date("2026-10-19T07:00:00.000Z")), false);
});

test("hidden before startsAt and at the inclusive start instant", () => {
  // Thu Oct 14, 2026 11:59:59.999pm PDT
  assert.equal(isSiteAlertActive(WINDOW, new Date("2026-10-15T06:59:59.999Z")), false);
  // Thu Oct 15, 2026 12:00:00.000am PDT
  assert.equal(isSiteAlertActive(WINDOW, new Date("2026-10-15T07:00:00.000Z")), true);
});

test("null, reversed, and unparseable windows stay hidden", () => {
  const now = new Date("2026-10-17T19:00:00.000Z");
  assert.equal(isSiteAlertActive(null, now), false);
  assert.equal(isSiteAlertActive(undefined, now), false);
  assert.equal(
    isSiteAlertActive(
      { startsAt: "2026-10-18T00:00:00-07:00", expiresAt: "2026-10-15T00:00:00-07:00" },
      now,
    ),
    false,
  );
  assert.equal(
    isSiteAlertActive({ startsAt: "not-a-date", expiresAt: "2026-10-18T23:59:59.999-07:00" }, now),
    false,
  );
  assert.equal(
    isSiteAlertActive({ startsAt: "2026-10-15T00:00:00-07:00", expiresAt: "" }, now),
    false,
  );
});

test("shipped PG&E alert matches the Pacific window and the notice copy", () => {
  assert.ok(SITE_ALERT);
  assert.equal(Date.parse(SITE_ALERT.startsAt), Date.parse("2026-10-15T07:00:00.000Z"));
  assert.equal(Date.parse(SITE_ALERT.expiresAt), Date.parse("2026-10-19T06:59:59.999Z"));
  assert.equal(SITE_ALERT.link.href, "https://www.pge.com/pspsupdates");
  assert.equal(SITE_ALERT.link.label, "PG&E outage status");
  assert.equal(
    SITE_ALERT.message,
    "Power outages along Highway 4: PG&E planned safety shutoffs are affecting parts of Hwy 4 (Arnold to the county line), Hwy 26 and West Point through at least Saturday, Oct 17. Some events may be canceled, moved, or run without power. Check with the organizer before you go.",
  );
  assert.equal(isSiteAlertActive(SITE_ALERT, new Date("2026-10-17T19:00:00.000Z")), true);
  assert.equal(isSiteAlertActive(SITE_ALERT, new Date("2026-10-19T06:59:59.999Z")), true);
  assert.equal(isSiteAlertActive(SITE_ALERT, new Date("2026-10-19T07:00:00.000Z")), false);
});

test("only the Calaveras region renders the alert, and only inside the window", () => {
  assert.ok(SITE_ALERT);
  const during = new Date("2026-10-17T19:00:00.000Z");
  const after = new Date("2026-10-19T07:00:00.000Z");
  assert.equal(resolveSiteAlert("calaveras", SITE_ALERT, during), SITE_ALERT);
  assert.equal(resolveSiteAlert("calaveras", SITE_ALERT, after), null);
  assert.equal(resolveSiteAlert("calaveras", null, during), null);
  assert.equal(resolveSiteAlert("30a", SITE_ALERT, during), null);
});

test("a dismiss sticks for the same message and clears when the text changes", () => {
  assert.equal(isSiteAlertDismissed(null, "Power is out"), false);
  assert.equal(isSiteAlertDismissed("Power is out", "Power is out"), true);
  assert.equal(isSiteAlertDismissed("Power is out", "Power is out through Monday"), false);
});

test("the guard script escapes < so a message cannot close the script tag", () => {
  const alert: SiteAlert = {
    message: '</script><script>alert("x")</script>',
    link: { label: "Status", href: "https://example.com" },
    startsAt: "2026-10-15T00:00:00-07:00",
    expiresAt: "2026-10-18T23:59:59.999-07:00",
  };
  const script = siteAlertGuardScript(alert);
  assert.equal(script.includes("</script>"), false);
  assert.equal(script.includes("\\u003c"), true);
  assert.equal(script.includes(String(Date.parse(alert.expiresAt))), true);
});
