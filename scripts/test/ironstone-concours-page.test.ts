// Lock for HWY-58: the Ironstone Concours event page that Search Console
// ranks for "ironstone concours 2026" gets that phrase as its H1, plus a
// short Q&A from facts already on the event and the venue page. The public
// slug does not change. Ticket price is not stated, so that item is absent.
//
// Run: `cd scripts && npx tsx --test test/ironstone-concours-page.test.ts`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateEventSlug } from "../../lib/slugs.js";
import {
  IRONSTONE_CONCOURS_EVENT_PATH,
  IRONSTONE_CONCOURS_H1,
  IRONSTONE_CONCOURS_SLUG,
  IRONSTONE_VENUE_PATH,
  ironstoneConcoursPage,
  ironstoneConcoursVenueLink,
} from "../../lib/ironstone-concours-page.js";

const eventPage = readFileSync(
  fileURLToPath(new URL("../../app/events/[slug]/page.tsx", import.meta.url)),
  "utf8",
);
const venuePage = readFileSync(
  fileURLToPath(new URL("../../app/venues/[slug]/page.tsx", import.meta.url)),
  "utf8",
);

test("the public slug is the live concours URL, not a retitle", () => {
  assert.equal(
    IRONSTONE_CONCOURS_EVENT_PATH,
    "/events/ironstone-concours-delegance-2026-09-26-murphys",
  );
  // The stored name uses a curly apostrophe. Both forms strip to the same slug.
  assert.equal(
    generateEventSlug(
      "Ironstone Concours d\u2019Elegance",
      "2026-09-26",
      "Murphys",
    ),
    IRONSTONE_CONCOURS_SLUG,
  );
  assert.equal(
    generateEventSlug("Ironstone Concours d'Elegance", "2026-09-26", "Murphys"),
    IRONSTONE_CONCOURS_SLUG,
  );
  // The year in the H1 would double up inside the date slug. Display only.
  assert.notEqual(
    generateEventSlug(IRONSTONE_CONCOURS_H1, "2026-09-26", "Murphys"),
    IRONSTONE_CONCOURS_SLUG,
  );
});

test("the H1 is the exact query phrase", () => {
  const page = ironstoneConcoursPage(IRONSTONE_CONCOURS_SLUG);
  assert.ok(page);
  assert.equal(page.h1, "Ironstone Concours d'Elegance 2026");
  assert.equal(page.h1.includes("\u2014"), false);
  assert.equal(page.h1.includes("!"), false);
});

test("the Q&A states date, place, and the venue's free parking, and nothing about tickets", () => {
  const page = ironstoneConcoursPage(IRONSTONE_CONCOURS_SLUG);
  assert.ok(page);
  assert.equal(page.qa.length, 3);

  const when = page.qa[0];
  assert.match(when.question, /When is Ironstone Concours d'Elegance 2026/);
  assert.match(when.answer, /Saturday, September 26, 2026/);
  assert.match(when.answer, /9:00 AM to 4:00 PM/);

  const where = page.qa[1];
  assert.match(where.question, /Where is Ironstone Concours d'Elegance 2026/);
  assert.match(where.answer, /Ironstone Vineyards/);
  assert.match(where.answer, /1894 Six Mile Road, Murphys CA 95247/);
  assert.equal(where.href, IRONSTONE_VENUE_PATH);
  assert.equal(where.linkLabel, "Ironstone Vineyards venue page");

  const parking = page.qa[2];
  assert.match(parking.question, /park/i);
  assert.equal(parking.answer, "Ironstone Vineyards has free parking.");
  assert.equal(parking.href, undefined);

  const blob = page.qa.map((item) => `${item.question} ${item.answer}`).join("\n");
  assert.equal(blob.includes("\u2014"), false);
  assert.equal(blob.includes("\u2013"), false);
  assert.equal(blob.includes("!"), false);
  assert.equal(/\$\d/.test(blob), false);
  assert.equal(/\b(ticket|admission|price|cost)\b/i.test(blob), false);
  assert.equal(/\b(shuttle|valet|overflow|reserved)\b/i.test(blob), false);
});

test("other event slugs and other venues are left alone", () => {
  assert.equal(ironstoneConcoursPage("ironstone-summer-concert-series-2026-10-02-murphys"), null);
  assert.equal(ironstoneConcoursPage("ironstone"), null);
  assert.equal(ironstoneConcoursPage(""), null);
  assert.equal(ironstoneConcoursVenueLink("brice-station"), null);
  assert.equal(ironstoneConcoursVenueLink("ironstone-vineyards"), null);
  assert.equal(ironstoneConcoursVenueLink(""), null);
});

test("the ironstone venue page links to this event, and only this event", () => {
  const link = ironstoneConcoursVenueLink("ironstone");
  assert.ok(link);
  assert.equal(link.href, IRONSTONE_CONCOURS_EVENT_PATH);
  assert.equal(link.heading, IRONSTONE_CONCOURS_H1);
  assert.match(link.blurb, /Saturday, September 26, 2026/);
  assert.match(link.blurb, /9:00 AM to 4:00 PM/);
  assert.match(link.blurb, /Ironstone Vineyards/);
  assert.equal(link.blurb.includes("\u2014"), false);
});

test("the event page applies the H1 and renders the Q&A under it", () => {
  assert.ok(eventPage.includes('from "@/lib/ironstone-concours-page"'));
  assert.match(
    eventPage,
    /\{hermitSeo\?\.h1 \?\? concoursPage\?\.h1 \?\? event\.name\}/,
  );
  assert.match(eventPage, /concoursPage\.qa\.map/);
  assert.match(eventPage, /buildFaqPage/);
  assert.match(eventPage, /item\.href/);
});

test("the venue page renders the concours callout", () => {
  assert.ok(venuePage.includes('from "@/lib/ironstone-concours-page"'));
  assert.match(venuePage, /ironstoneConcoursVenueLink\(slug\)/);
  assert.match(venuePage, /concoursLink\.href/);
  assert.match(venuePage, /concoursLink\.heading/);
});
