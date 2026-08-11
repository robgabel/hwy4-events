// Locks scripts/lib/wix-events.ts — the structured (never-guess) parser behind
// the Murphys Irish Pub scraper. Born 2026-08-09 from the phantom-date purge:
// the old LLM extractor invented dates off the pub's homepage; this parser
// only ever reads a date the venue's own event page states (JSON-LD startDate
// or a dated occurrence slug) and fails closed otherwise.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventSlugFromUrl,
  extractEventDetailLinks,
  extractJsonLdEvents,
  humanizeEventSlug,
  isoToLocalParts,
  parseDatedSlug,
  parseWixEventPage,
} from "../lib/wix-events.js";

const BASE = "https://www.murphysirishpubca.com/";

const ldPage = (ld: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>x</body></html>`;

// ---------- link extraction ----------

test("extracts, absolutizes, and slug-dedupes event-details links", () => {
  const html = `
    <a href="/event-details/kyle-cox-2">Kyle Cox</a>
    <a href="https://www.murphysirishpubca.com/event-details/blue-monday-band-5?utm=x">Blue Monday</a>
    <a href="https://www.goirishinmurphys.com/event-details/kyle-cox-2">same event, alt domain</a>
    plain text https://www.murphysirishpubca.com/event-details/open-mic-night-2026-08-12-18-00 too
    <a href="/about">not an event</a>`;
  const links = extractEventDetailLinks(html, BASE);
  assert.deepEqual(links, [
    "https://www.murphysirishpubca.com/event-details/kyle-cox-2",
    "https://www.murphysirishpubca.com/event-details/blue-monday-band-5",
    "https://www.murphysirishpubca.com/event-details/open-mic-night-2026-08-12-18-00",
  ]);
});

test("eventSlugFromUrl ignores non-event URLs and strips query/hash", () => {
  assert.equal(eventSlugFromUrl(`${BASE}event-details/jamie-byous-1#tickets`), "jamie-byous-1");
  assert.equal(eventSlugFromUrl(`${BASE}about`), null);
});

// ---------- dated slugs ----------

test("parseDatedSlug reads real occurrence slugs and refuses to guess", () => {
  // The pub's own recurring-event permalinks carry date + 24h time.
  assert.deepEqual(parseDatedSlug("open-mic-night-2026-08-05-18-00"), {
    date: "2026-08-05",
    time: "18:00",
  });
  // A bare slug (one-off event) states no date — null, never an invention.
  assert.equal(parseDatedSlug("kyle-cox-2"), null);
  // A calendar-impossible date is noise, not a date.
  assert.equal(parseDatedSlug("thing-2026-02-30-18-00"), null);
  // Garbage time parts degrade to date-only rather than a fake clock.
  assert.deepEqual(parseDatedSlug("thing-2026-08-05-99-99"), { date: "2026-08-05", time: null });
});

// ---------- ISO → venue-local ----------

test("isoToLocalParts takes the literal reading when an offset is stated", () => {
  // Wix serializes venue-local with the venue offset: literal part IS local.
  assert.deepEqual(isoToLocalParts("2026-08-13T18:00:00-07:00"), {
    date: "2026-08-13",
    time: "18:00",
  });
  assert.deepEqual(isoToLocalParts("2026-08-13T18:00"), { date: "2026-08-13", time: "18:00" });
  assert.deepEqual(isoToLocalParts("2026-08-13"), { date: "2026-08-13", time: null });
});

test("isoToLocalParts converts Z (UTC) to Pacific, crossing midnight, in both DST phases", () => {
  // 2 AM UTC = 7 PM PDT the previous evening (summer).
  assert.deepEqual(isoToLocalParts("2026-08-14T02:00:00.000Z"), {
    date: "2026-08-13",
    time: "19:00",
  });
  // 3 AM UTC = 7 PM PST the previous evening (winter).
  assert.deepEqual(isoToLocalParts("2026-12-05T03:00:00Z"), {
    date: "2026-12-04",
    time: "19:00",
  });
});

test("isoToLocalParts refuses malformed input", () => {
  assert.equal(isoToLocalParts("August 13, 2026"), null);
  assert.equal(isoToLocalParts("2026-13-40T18:00:00Z"), null);
});

// ---------- JSON-LD extraction ----------

test("extractJsonLdEvents finds Event objects in plain, array, @graph, and subtype forms", () => {
  const html = [
    ldPage({ "@type": "Event", name: "Kyle Cox", startDate: "2026-08-13T18:00:00-07:00" }),
    ldPage([{ "@type": "MusicEvent", name: "Blue Monday Band", startDate: "2026-08-14T19:00:00-07:00" }]),
    ldPage({ "@graph": [{ "@type": ["Event", "Thing"], name: "Jamie Byous", startDate: "2026-08-15T19:00:00-07:00" }] }),
    `<script type="application/ld+json">{not json`, // malformed — skipped, not fatal
    ldPage({ "@type": "Organization", name: "Not An Event" }),
  ].join("\n");
  assert.deepEqual(
    extractJsonLdEvents(html).map((e) => e.name),
    ["Kyle Cox", "Blue Monday Band", "Jamie Byous"]
  );
});

// ---------- whole-page composition ----------

test("parseWixEventPage: JSON-LD is authoritative; same-day end kept, cross-day end dropped", () => {
  const html = ldPage({
    "@type": "Event",
    name: "Kyle Cox",
    startDate: "2026-08-13T18:00:00-07:00",
    endDate: "2026-08-13T21:00:00-07:00",
    description: "Nashville songwriter.",
    image: [{ url: "https://static.wixstatic.com/kyle.jpg" }],
  });
  const parsed = parseWixEventPage(html, `${BASE}event-details/kyle-cox-2`);
  assert.deepEqual(parsed, {
    slug: "kyle-cox-2",
    name: "Kyle Cox",
    date: "2026-08-13",
    startTime: "18:00",
    endTime: "21:00",
    description: "Nashville songwriter.",
    imageUrl: "https://static.wixstatic.com/kyle.jpg",
    dateSource: "jsonld",
    dateConflict: false,
  });

  const overnight = ldPage({
    "@type": "Event",
    name: "Late Show",
    startDate: "2026-08-13T21:00:00-07:00",
    endDate: "2026-08-14T01:00:00-07:00",
  });
  assert.equal(parseWixEventPage(overnight, `${BASE}event-details/late-show`)?.endTime, null);
});

test("parseWixEventPage: dated slug is the fallback, and a conflict flags but JSON-LD wins", () => {
  // No JSON-LD at all — the dated slug carries the occurrence.
  const bare = "<html><body>widget soup</body></html>";
  const fromSlug = parseWixEventPage(bare, `${BASE}event-details/open-mic-night-2026-08-12-18-00`);
  assert.deepEqual(
    { date: fromSlug?.date, startTime: fromSlug?.startTime, dateSource: fromSlug?.dateSource },
    { date: "2026-08-12", startTime: "18:00", dateSource: "slug" }
  );

  // JSON-LD and slug disagree (a rescheduled occurrence keeps its old slug):
  // JSON-LD wins, conflict is flagged for the log.
  const moved = ldPage({ "@type": "Event", name: "Open Mic Night", startDate: "2026-08-19T18:00:00-07:00" });
  const parsed = parseWixEventPage(moved, `${BASE}event-details/open-mic-night-2026-08-12-18-00`);
  assert.equal(parsed?.date, "2026-08-19");
  assert.equal(parsed?.dateConflict, true);
});

test("parseWixEventPage fails closed: no stated date anywhere → null", () => {
  const noDate = ldPage({ "@type": "Event", name: "Kyle Cox" });
  assert.equal(parseWixEventPage(noDate, `${BASE}event-details/kyle-cox-2`), null);
  assert.equal(parseWixEventPage("<html></html>", `${BASE}event-details/kyle-cox-2`), null);
});

// ---------- slug humanizing ----------

test("humanizeEventSlug strips dated suffixes and Wix dedup counters", () => {
  assert.equal(humanizeEventSlug("open-mic-night-2026-08-05-18-00"), "Open Mic Night");
  assert.equal(humanizeEventSlug("kyle-cox-2"), "Kyle Cox");
  assert.equal(humanizeEventSlug("blue-monday-band-5"), "Blue Monday Band");
});
