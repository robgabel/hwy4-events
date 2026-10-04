// HWY-60 locks: event JSON-LD tells the truth, the event page carries one
// quotable lead sentence, and WebPage dateModified is derived, never `new Date()`.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildEvent,
  buildEventOrganizer,
  buildItemList,
  buildWebPage,
  eventStatusUrl,
} from "../../lib/schema.js";
import { SITE_NAME, SITE_URL } from "../../lib/constants.js";
import { REGION } from "../../lib/region.js";
import {
  buildEventAnswer,
  buildVerifiedLine,
  longDate,
  priceClause,
  spokenTime,
  type AnswerEvent,
} from "../../lib/event-answer.js";
import { pageDateModified } from "../../lib/date-modified.js";
import { INTENT_CONFIG } from "../../lib/intent-pages.js";
import { HOLIDAY_GUIDES } from "../../lib/holiday-pages.js";
import { MARKET_GUIDES } from "../../lib/market-pages.js";
import { MEET_ME_GUIDES } from "../../lib/meet-me-pages.js";
import { PERSONA_HUBS } from "../../lib/persona-hubs.js";
import type { Hwy4Event } from "../../lib/types.js";

function ev(over: Partial<Hwy4Event> = {}): Hwy4Event {
  return {
    id: "e1",
    name: "Ironstone Summer Concert Series",
    description: null,
    date: "2026-08-16",
    start_time: "19:00:00",
    end_time: null,
    venue_name: "Ironstone Amphitheatre",
    town: "Murphys",
    address: null,
    category: "live_music",
    artists: ["Kane Brown"],
    status: "confirmed",
    price: "$59 - $129",
    cost_tier: "paid",
    event_url: null,
    source_url: "https://example.com",
    source_name: null,
    visibility: "public",
    org_slug: null,
    dedup_key: null,
    last_scraped_at: null,
    image_url: null,
    robs_pick: false,
    is_weekly: false,
    ...over,
  } as Hwy4Event;
}

// ---------- 1. JSON-LD truth ----------

test("no event ever emits the site as its organizer", () => {
  const noOrg = buildEvent(ev()) as Record<string, unknown>;
  assert.equal("organizer" in noOrg, false, "unknown organizer is omitted, never guessed");

  const selfOrg = buildEvent(ev(), { organizer: { name: SITE_NAME, url: SITE_URL } });
  assert.equal("organizer" in selfOrg, false, "SITE_NAME can never be the organizer");

  const list = buildItemList([ev(), ev({ id: "e2", date: "2026-08-17" })]);
  for (const item of list.itemListElement) {
    assert.equal("organizer" in item.item, false);
  }
});

test("organizer is the matched org with its durable url", () => {
  const out = buildEvent(ev(), {
    organizer: { name: "Arnold Rim Trail", url: "https://arnoldrimtrail.org/events/" },
  }) as Record<string, unknown>;
  assert.deepEqual(out.organizer, {
    "@type": "Organization",
    name: "Arnold Rim Trail",
    url: "https://arnoldrimtrail.org/events/",
  });
});

test("an aggregator or non-http org url is dropped, the name kept", () => {
  assert.deepEqual(
    buildEventOrganizer({ name: "The Stitch Lounge", url: "https://gocalaveras.com/events/x" }),
    { "@type": "Organization", name: "The Stitch Lounge" }
  );
  assert.deepEqual(
    buildEventOrganizer({ name: "X", url: "javascript:alert(1)" }),
    { "@type": "Organization", name: "X" }
  );
  assert.equal(buildEventOrganizer({ name: "  " }), null);
  assert.equal(buildEventOrganizer(null), null);
});

test("tentative is never EventPostponed", () => {
  assert.equal(eventStatusUrl("tentative"), "https://schema.org/EventScheduled");
  assert.equal(eventStatusUrl("confirmed"), "https://schema.org/EventScheduled");
  assert.equal(eventStatusUrl("cancelled"), "https://schema.org/EventCancelled");
  const out = buildEvent(ev({ status: "tentative" }));
  assert.notEqual(out.eventStatus, "https://schema.org/EventPostponed");
});

test("event JSON-LD carries url + image and the region's state code", () => {
  const out = buildEvent(ev(), { slug: "my-slug" });
  assert.equal(out.url, `${SITE_URL}/events/my-slug`);
  assert.equal(out.image, `${SITE_URL}/events/my-slug/poster`);
  assert.equal(out.location.address.addressRegion, REGION.stateCode);

  const supplied = buildEvent(ev({ image_url: "https://cdn.example.com/p.jpg" }), { slug: "s" });
  assert.equal(supplied.image, "https://cdn.example.com/p.jpg");
});

test("offer url defaults to our page and honors the resolved durable link", () => {
  const def = buildEvent(ev(), { slug: "s" }) as { offers?: { url: string } };
  assert.equal(def.offers?.url, `${SITE_URL}/events/s`);
  const resolved = buildEvent(ev(), { slug: "s", offerUrl: "https://ironstonevineyards.com/" }) as {
    offers?: { url: string };
  };
  assert.equal(resolved.offers?.url, "https://ironstonevineyards.com/");
});

test("the detail page uses the shared builder, not an inline Event copy", () => {
  const page = readFileSync(
    fileURLToPath(new URL("../../app/events/[slug]/page.tsx", import.meta.url)),
    "utf8"
  );
  assert.ok(page.includes("buildEvent("), "detail page must call buildEvent");
  assert.ok(!page.includes('"@type": "Event"'), "no inline Event JSON-LD on the detail page");
  assert.ok(!page.includes("EventPostponed"));
});

// ---------- 2. answer sentence ----------

const base: AnswerEvent = {
  name: "Ironstone Summer Concert Series",
  date: "2026-08-16",
  start_time: "19:00:00",
  end_time: null,
  venue_name: "Ironstone Amphitheatre",
  town: "Murphys",
  category: "live_music",
  artists: ["Kane Brown"],
  status: "confirmed",
  price: "$59 - $129",
  cost_tier: "paid",
};

test("full lead sentence", () => {
  assert.equal(
    buildEventAnswer(base),
    "Ironstone Summer Concert Series is at Ironstone Amphitheatre in Murphys, CA on Sunday, August 16, 2026 at 7 PM. Kane Brown is on the bill. Tickets from $59."
  );
});

test("clauses drop when their field is unknown (blank beats wrong)", () => {
  const bare = buildEventAnswer({
    ...base,
    start_time: null,
    artists: null,
    price: null,
    cost_tier: "unknown",
    venue_name: null,
  });
  assert.equal(bare, "Ironstone Summer Concert Series is in Murphys, CA on Sunday, August 16, 2026.");

  // venue equal to the town is not a venue
  assert.equal(
    buildEventAnswer({ ...base, venue_name: "Murphys", artists: [], cost_tier: null }),
    "Ironstone Summer Concert Series is in Murphys, CA on Sunday, August 16, 2026 at 7 PM."
  );

  assert.equal(buildEventAnswer({ ...base, date: "2026-02-30" }), null, "bad date renders nothing");
  assert.equal(buildEventAnswer({ ...base, name: "  " }), null);
});

test("time range, tentative, multi-act and act-in-name cases", () => {
  const out = buildEventAnswer({
    ...base,
    name: "Lynyrd Skynyrd & Foghat",
    artists: ["Lynyrd Skynyrd", "Foghat"],
    start_time: "18:30",
    end_time: "22:00",
    status: "tentative",
  })!;
  assert.match(out, /from 6:30 PM to 10 PM\./);
  assert.match(out, /The date is tentative\./);
  assert.doesNotMatch(out, /on the bill/, "acts already in the name are not repeated");

  const many = buildEventAnswer({ ...base, artists: ["A", "B", "C", "D"] })!;
  assert.match(many, /A, B, C and more are on the bill\./);
  const two = buildEventAnswer({ ...base, artists: ["A", "B"] })!;
  assert.match(two, /A and B are on the bill\./);

  const notMusic = buildEventAnswer({ ...base, category: "festival" })!;
  assert.doesNotMatch(notMusic, /on the bill/);
});

test("price clause never overstates", () => {
  assert.equal(priceClause({ ...base, sold_out: true }), "Tickets are sold out.");
  assert.equal(priceClause({ ...base, cost_tier: "free", price: null }), "Admission is free.");
  assert.equal(priceClause({ ...base, cost_tier: "donation" }), "Admission is by donation.");
  assert.equal(priceClause({ ...base, price: "$25" }), "Tickets are $25.");
  assert.equal(priceClause({ ...base, price: "$25 / $25 at door" }), "Tickets are $25.");
  assert.equal(priceClause({ ...base, price: "$40 GA, $25 kids" }), "Tickets from $25.");
  assert.equal(priceClause({ ...base, price: "Ticketed" }), null);
  assert.equal(priceClause({ ...base, cost_tier: "varies", price: "Pay what you can" }), null);
  assert.equal(priceClause({ ...base, cost_tier: "unknown", price: "$15 each" }), null);
});

test("lead sentence and trust line carry no em dashes", () => {
  const out = buildEventAnswer({ ...base, artists: ["A", "B"], status: "tentative" })!;
  assert.ok(!out.includes("—"));
  const line = buildVerifiedLine({
    verificationStatus: "verified",
    checkedAt: "2026-09-30T15:00:00Z",
    orgName: "Brice Station",
  })!;
  assert.ok(!line.includes("—"));
});

test("date and time helpers", () => {
  assert.equal(longDate("2026-07-04"), "Saturday, July 4, 2026");
  assert.equal(longDate("nope"), null);
  assert.equal(spokenTime("00:00:00"), "12 AM");
  assert.equal(spokenTime("12:15"), "12:15 PM");
  assert.equal(spokenTime("25:00"), null);
  assert.equal(spokenTime(null), null);
});

test("verified line renders only for a dated verified row", () => {
  assert.equal(
    buildVerifiedLine({
      verificationStatus: "verified",
      checkedAt: "2026-09-30T15:00:00Z",
      orgName: "Arnold Rim Trail",
    }),
    "Checked against Arnold Rim Trail's site on September 30, 2026."
  );
  // Pacific civil date, not UTC: 03:00Z Oct 1 is Sept 30 in Murphys.
  assert.equal(
    buildVerifiedLine({
      verificationStatus: "verified",
      checkedAt: "2026-10-01T03:00:00Z",
      orgName: null,
    }),
    "Checked against the organizer's site on September 30, 2026."
  );
  assert.match(
    buildVerifiedLine({ verificationStatus: "verified", checkedAt: "2026-09-30T15:00:00Z", orgName: "Friends of Big Trees" })!,
    /Friends of Big Trees' site/
  );
  assert.equal(buildVerifiedLine({ verificationStatus: "unchecked", checkedAt: "2026-09-30", orgName: "X" }), null);
  assert.equal(buildVerifiedLine({ verificationStatus: "needs_verification", checkedAt: "2026-09-30", orgName: "X" }), null);
  assert.equal(buildVerifiedLine({ verificationStatus: "verified", checkedAt: null, orgName: "X" }), null);
});

// ---------- 3. dateModified ----------

test("dateModified is the latest rendered updated_at or editorial date", () => {
  assert.equal(
    pageDateModified([
      { updated_at: "2026-09-01T10:00:00Z" },
      { updated_at: "2026-09-20T08:00:00Z" },
      { updated_at: null },
    ]),
    "2026-09-20T08:00:00Z"
  );
  assert.equal(
    pageDateModified([{ updated_at: "2026-09-01T10:00:00Z" }], "2026-09-12"),
    "2026-09-12",
    "a newer copy edit wins"
  );
  assert.equal(pageDateModified([], "2026-08-15"), "2026-08-15", "empty off-season page keeps its copy date");
  assert.equal(pageDateModified([]), null, "nothing datable means omit, never today");
  assert.equal(pageDateModified([{ updated_at: "garbage" }]), null);
});

test("WebPage omits dateModified when unknown", () => {
  const page = buildWebPage({ url: "u", name: "n", dateModified: null }) as Record<string, unknown>;
  assert.equal("dateModified" in page, false);
});

test("every editorial config carries a real past editorialUpdated date", () => {
  const today = new Date().toISOString().slice(0, 10);
  const all = [
    ...Object.values(INTENT_CONFIG),
    ...HOLIDAY_GUIDES,
    ...MARKET_GUIDES,
    ...MEET_ME_GUIDES,
    ...PERSONA_HUBS,
  ];
  assert.ok(all.length >= 11);
  for (const c of all) {
    assert.match(c.editorialUpdated, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(longDate(c.editorialUpdated), `${c.editorialUpdated} is a real date`);
    assert.ok(c.editorialUpdated <= today, "editorialUpdated cannot be in the future");
  }
});

test("no page feeds dateModified from the render clock", () => {
  const files = [
    "components/IntentPageView.tsx",
    "components/TemporalEventsView.tsx",
    "components/LiveMusicView.tsx",
    "components/HolidayPageView.tsx",
    "components/MarketPageView.tsx",
    "components/MeetMePageView.tsx",
    "components/PersonaHubPageView.tsx",
    "app/venues/[slug]/page.tsx",
    "app/bear-valley-music-festival-2026/page.tsx",
  ];
  for (const f of files) {
    const src = readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), "utf8");
    const lines = src.split("\n").filter((l) => l.includes("dateModified:"));
    assert.ok(lines.length > 0, `${f} still renders a WebPage dateModified`);
    for (const l of lines) {
      assert.ok(l.includes("pageDateModified("), `${f}: ${l.trim()}`);
    }
  }
});
