import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isConfiguredPage,
  eventsTabUrl,
  type FacebookPageConfig,
} from "../lib/fb-page-config.js";

const base: FacebookPageConfig = {
  orgSlug: "fb-page-copperopolis-town-square",
  label: "Copperopolis Town Square",
  defaultTown: "Copperopolis",
  pageUrl: "https://www.facebook.com/TheTownSquareAtCV",
};

test("isConfiguredPage: accepts a real page and a real group", () => {
  assert.equal(isConfiguredPage(base), true);
  assert.equal(
    isConfiguredPage({ ...base, pageUrl: "https://facebook.com/mysticsaloon/" }),
    true
  );
  assert.equal(
    isConfiguredPage({ ...base, pageUrl: "https://www.facebook.com/groups/uh4ccc" }),
    true
  );
  // A numeric page id is a page like any other.
  assert.equal(
    isConfiguredPage({ ...base, pageUrl: "https://www.facebook.com/388331564555121" }),
    true
  );
});

test("isConfiguredPage: an empty or half-pasted URL is inert, not dangerous", () => {
  for (const pageUrl of ["", "   ", "facebook.com/mysticsaloon", "https://"]) {
    assert.equal(isConfiguredPage({ ...base, pageUrl }), false, pageUrl);
  }
  assert.equal(isConfiguredPage({ ...base, pageUrl: undefined }), false);
});

test("isConfiguredPage: refuses the global feed", () => {
  // The whole reason the gate is strict: this URL does not fail, it succeeds
  // at scraping the wrong thing — Facebook's global events, attributed to one
  // venue's org_slug. Same failure class as an empty locationId.
  for (const pageUrl of [
    "https://www.facebook.com/",
    "https://www.facebook.com",
    "https://facebook.com//",
  ]) {
    assert.equal(isConfiguredPage({ ...base, pageUrl }), false, pageUrl);
  }
});

test("isConfiguredPage: refuses a URL that is already an events URL", () => {
  // A config carrying /events would build ".../events/events"; an explore URL
  // belongs in fb-town-config, and scraped from here would re-ingest a whole
  // town under one page's org_slug.
  for (const pageUrl of [
    "https://www.facebook.com/TheTownSquareAtCV/events",
    "https://www.facebook.com/events/explore/copperopolis-ca/106218426077047",
    "https://www.facebook.com/events/search/?q=Party",
  ]) {
    assert.equal(isConfiguredPage({ ...base, pageUrl }), false, pageUrl);
  }
});

test("isConfiguredPage: refuses a non-Facebook or non-https host", () => {
  for (const pageUrl of [
    "http://www.facebook.com/mysticsaloon",
    "https://facebook.com.evil.example/mysticsaloon",
    "https://m.facebook.com/mysticsaloon",
    "https://www.instagram.com/mysticsaloon",
  ]) {
    assert.equal(isConfiguredPage({ ...base, pageUrl }), false, pageUrl);
  }
});

test("isConfiguredPage: refuses the bare group directory", () => {
  assert.equal(
    isConfiguredPage({ ...base, pageUrl: "https://www.facebook.com/groups" }),
    false
  );
  assert.equal(
    isConfiguredPage({ ...base, pageUrl: "https://www.facebook.com/groups/" }),
    false
  );
});

test("isConfiguredPage: requires the identity fields, not just a URL", () => {
  assert.equal(isConfiguredPage({ ...base, orgSlug: "" }), false);
  assert.equal(isConfiguredPage({ ...base, label: "  " }), false);
  assert.equal(isConfiguredPage({ ...base, defaultTown: "" }), false);
});

test("eventsTabUrl: appends exactly one /events", () => {
  assert.equal(
    eventsTabUrl(base),
    "https://www.facebook.com/TheTownSquareAtCV/events"
  );
  assert.equal(
    eventsTabUrl({ ...base, pageUrl: "https://www.facebook.com/mysticsaloon/" }),
    "https://www.facebook.com/mysticsaloon/events"
  );
  assert.equal(
    eventsTabUrl({ ...base, pageUrl: "https://www.facebook.com/mysticsaloon///" }),
    "https://www.facebook.com/mysticsaloon/events"
  );
  assert.equal(
    eventsTabUrl({ ...base, pageUrl: "  https://www.facebook.com/groups/uh4ccc  " }),
    "https://www.facebook.com/groups/uh4ccc/events"
  );
});
