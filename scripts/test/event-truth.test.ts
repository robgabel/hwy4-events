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
  decodeEntities,
  isOrganizerPageCheck,
  longDate,
  priceClause,
  spokenTime,
  type AnswerEvent,
} from "../../lib/event-answer.js";
import { pageDateModified } from "../../lib/date-modified.js";
import { matchOrganizerForEvent, type LinkOrg } from "../../lib/event-link.js";
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
    "Ironstone Summer Concert Series is at Ironstone Amphitheatre in Murphys, CA on Sunday, August 16, 2026 at 7 PM. Kane Brown is on the bill. Tickets from $59 to $129."
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
  assert.equal(priceClause({ ...base, price: "$1,250" }), "Tickets are $1250.");
  assert.equal(priceClause({ ...base, price: "$40 to $25" }), "Tickets from $25 to $40.");
  assert.equal(priceClause({ ...base, price: "$25-$25" }), "Tickets are $25.");
  assert.equal(priceClause({ ...base, category: "community", price: "$25" }), "Cost is $25.");
  assert.equal(priceClause({ ...base, category: "community", price: "$10 - $20" }), "Cost from $10 to $20.");
  // words around a number: left to the verbatim Price row, never summarized
  for (const price of [
    "$20 to register a car, free to spectators",
    "Free for kids, $10 adults",
    "$25+",
    "$5 parking",
    "$40 GA, $25 kids",
    "Ticketed",
  ]) {
    assert.equal(priceClause({ ...base, price }), null, price);
  }
  assert.equal(priceClause({ ...base, cost_tier: "varies", price: "Pay what you can" }), null);
  assert.equal(priceClause({ ...base, cost_tier: "unknown", price: "$15 each" }), null);
});

test("past events read in the past tense with no price or tentative clause", () => {
  const out = buildEventAnswer({ ...base, status: "tentative", artists: ["A", "B"] }, "2026-09-01")!;
  assert.match(out, /^Ironstone Summer Concert Series was at /);
  assert.match(out, /A and B were on the bill\./);
  assert.doesNotMatch(out, /Tickets|tentative/);
  assert.match(buildEventAnswer(base, "2026-08-16")!, / is at /, "today is still present tense");
});

test("dated titles, HTML entities, locality venues and possessives", () => {
  assert.equal(
    buildEventAnswer({
      ...base,
      name: "Volunteer Trail Workday \u2013 October 17, 2026",
      date: "2026-10-17",
      venue_name: "Hathaway Pines",
      town: "Arnold",
      category: "hike",
      artists: null,
      cost_tier: "free",
      price: null,
    }),
    "Volunteer Trail Workday is at Hathaway Pines in Arnold, CA on Saturday, October 17, 2026 at 7 PM. Admission is free."
  );
  assert.match(
    buildEventAnswer({ ...base, venue_name: "Murphys Diggin&#039;s Club House", artists: null })!,
    /at Murphys Diggin's Club House in/
  );
  assert.equal(decodeEntities("Rock &amp; Roll"), "Rock & Roll");
  assert.match(
    buildEventAnswer({ ...base, venue_name: "Murphys, California", artists: null })!,
    /Series is in Murphys, CA on/
  );
  assert.doesNotMatch(
    buildEventAnswer({ ...base, name: "Ty's Party", artists: ["Ty"] })!,
    /on the bill/
  );
});

test("lead sentence and trust line carry no em dashes", () => {
  const out = buildEventAnswer({ ...base, artists: ["A", "B"], status: "tentative" })!;
  assert.ok(!out.includes("—"));
  const line = buildVerifiedLine({
    verificationStatus: "verified",
    verificationReason: "The event appears on the canonical page.",
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

const AUTO = "The event 'Deep Thicket Dwellers' appears on the canonical page with the same date.";

test("verified line renders only for a dated, organizer-page verification", () => {
  assert.equal(
    buildVerifiedLine({
      verificationStatus: "verified",
      verificationReason: AUTO,
      checkedAt: "2026-09-30T15:00:00Z",
      orgName: "Arnold Rim Trail",
    }),
    "Checked against Arnold Rim Trail's site on September 30, 2026."
  );
  // Pacific civil date, not UTC: 03:00Z Oct 1 is Sept 30 in Murphys.
  assert.equal(
    buildVerifiedLine({
      verificationStatus: "verified",
      verificationReason: "Time applied from the organizer's page and locked.",
      checkedAt: "2026-10-01T03:00:00Z",
      orgName: null,
    }),
    "Checked against the organizer's site on September 30, 2026."
  );
  assert.match(
    buildVerifiedLine({ verificationStatus: "verified", verificationReason: AUTO, checkedAt: "2026-09-30T15:00:00Z", orgName: "Friends of Big Trees" })!,
    /Friends of Big Trees' site/
  );
  const v = (over: Record<string, unknown>) =>
    buildVerifiedLine({ verificationStatus: "verified", verificationReason: AUTO, checkedAt: "2026-09-30", orgName: "X", ...over });
  assert.equal(v({ verificationStatus: "unchecked" }), null);
  assert.equal(v({ verificationStatus: "needs_verification" }), null);
  assert.equal(v({ checkedAt: null }), null);
});

test("a human Confirm, a published submission or a seed never claims a site check", () => {
  for (const reason of ["Manually confirmed by admin.", "Confirmed by Rob", null, "", "  "]) {
    assert.equal(isOrganizerPageCheck(reason), false, String(reason));
    assert.equal(
      buildVerifiedLine({ verificationStatus: "verified", verificationReason: reason, checkedAt: "2026-09-30T15:00:00Z", orgName: "Murphys Wine & Beer Garden" }),
      null
    );
  }
  assert.equal(isOrganizerPageCheck(AUTO), true);
  assert.equal(isOrganizerPageCheck("Times corrected from arnoldrimtrail.org (organizer canonical)"), true);
});

test("organizer: direct org_slug or a pattern in the NAME, never the venue", () => {
  const orgs: LinkOrg[] = [
    { slug: "brice-station", display_name: "Brice Station Vineyards", canonical_url: "https://bricestation.com/", match_patterns: ["brice station", "hilltop concert"] },
    { slug: "ironstone-vineyards", display_name: "Ironstone Vineyards", canonical_url: "https://ironstonevineyards.com/", match_patterns: ["ironstone"] },
    { slug: "arnold-rim-trail", display_name: "Arnold Rim Trail", canonical_url: "https://arnoldrimtrail.org/events/", match_patterns: ["arnold rim trail"] },
  ];
  const e = (name: string, venue: string, org_slug: string | null = "gocalaveras", description: string | null = null) => ({ name, venue_name: venue, org_slug, description });
  // held at a venue is not organized by it
  assert.equal(matchOrganizerForEvent(e("Arnold Angels Music Festival", "Brice Station Vineyards"), orgs), null);
  assert.equal(matchOrganizerForEvent(e("Firewise Calaveras Festival", "Ironstone Vineyards"), orgs), null);
  assert.equal(matchOrganizerForEvent(e("Trail Day", "Somewhere", "gocalaveras", "Hosted by Arnold Rim Trail volunteers"), orgs), null);
  // name names the org, or we scraped the org's own calendar
  assert.equal(matchOrganizerForEvent(e("Brice Station Hilltop Concert Series", "Brice Station Vineyards"), orgs)?.slug, "brice-station");
  assert.equal(matchOrganizerForEvent(e("Mimosa Sundays at Ironstone", "Ironstone Vineyards"), orgs)?.slug, "ironstone-vineyards");
  assert.equal(matchOrganizerForEvent(e("Guided Sunset Hike", "Cougar Rock", "arnold-rim-trail"), orgs)?.slug, "arnold-rim-trail");
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
