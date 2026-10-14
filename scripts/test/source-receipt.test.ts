// The Source line on every event page (#400). Separate from the Visit button:
// resolveEventLink may send Visit to a venue homepage, and this receipt still
// links the dated listing we scraped.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveSourceReceipt,
  sourceReceiptSentence,
  type SourceReceiptInput,
} from "../../lib/source-receipt.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const WATERING_HOLE =
  "https://www.gocalaveras.com/events/thursday-summer-concert-series-the-watering-hole-23/";

function row(p: Partial<SourceReceiptInput>): SourceReceiptInput {
  return {
    source_url: "https://www.gocalaveras.com/events/",
    source_name: "GoCalaveras.com",
    community_sourced: false,
    last_scraped_at: "2026-10-14T15:00:00Z",
    ...p,
  };
}

test("aggregator: Watering Hole Oct 22 links the dated GoCalaveras listing", () => {
  const r = resolveSourceReceipt(
    row({
      event_url: WATERING_HOLE,
      source_name: "GoCalaveras.com",
      last_scraped_at: "2026-10-13T18:04:00Z",
    })
  );
  assert.equal(r.kind, "aggregator");
  assert.equal(r.href, WATERING_HOLE);
  assert.equal(r.label, "GoCalaveras");
  assert.equal(r.seenOn, "October 13, 2026");
  assert.equal(sourceReceiptSentence(r), "Source: GoCalaveras (seen October 13, 2026)");
  assert.notEqual(r.href, "https://murphyswateringhole.com/");
});

test("durable: a dated Visit Murphys page is the receipt", () => {
  const href = "https://visitmurphys.com/event/music-on-the-rooftop/2026-10-22/";
  const r = resolveSourceReceipt(row({ event_url: href, source_name: "Visit Murphys" }));
  assert.equal(r.kind, "durable");
  assert.equal(r.href, href);
  assert.equal(r.label, "Visit Murphys");
  assert.equal(r.seenOn, "October 14, 2026");
});

test("facebook: the event permalink is the receipt, including on a community row", () => {
  const href = "https://www.facebook.com/events/1801994517316530/";
  const r = resolveSourceReceipt(
    row({
      event_url: href,
      community_sourced: true,
      source_url: "https://hwy4events.com/submit",
      source_name: "Community Submission",
    })
  );
  assert.equal(r.kind, "facebook");
  assert.equal(r.href, href);
  assert.equal(r.label, "Facebook");
});

test("flyer: a community poster image is the receipt when there is no event URL", () => {
  const href =
    "https://uzediwokyshjbsymevtp.supabase.co/storage/v1/object/public/event-posters/prime-rib.jpg";
  const r = resolveSourceReceipt(
    row({
      event_url: null,
      image_url: href,
      community_sourced: true,
      source_url: "https://hwy4events.com/submit",
      source_name: "Community Submission",
      last_scraped_at: "2026-10-08T19:49:25.454Z",
    })
  );
  assert.equal(r.kind, "flyer");
  assert.equal(r.href, href);
  assert.equal(r.label, "submitted flyer");
  assert.equal(sourceReceiptSentence(r), "Source: submitted flyer (seen October 8, 2026)");
});

test("a calendar PDF links the file under the source name", () => {
  const href =
    "https://img1.wsimg.com/blobby/go/6342668b-0500-4ff8-8ef0-0363a71f22d7/OCTOBER%20Calendar%202026.pdf";
  const photo = "https://example.com/lodge-photo.jpg";
  const r = resolveSourceReceipt(
    row({
      event_url: null,
      image_url: photo,
      org_slug: "moose-lodge",
      source_name: "moose-lodge-calendar",
      source_url: href,
    })
  );
  assert.equal(r.kind, "durable");
  assert.equal(r.href, href);
  assert.equal(r.label, "Moose Lodge");
  assert.notEqual(r.href, photo);
});

test("community: no URL and no flyer is an honest text receipt", () => {
  const r = resolveSourceReceipt(
    row({
      event_url: null,
      image_url: null,
      community_sourced: true,
      source_name: "Community Submission",
      source_url: "https://hwy4events.com/submit",
      last_scraped_at: "2026-06-03T22:36:51.735Z",
    })
  );
  assert.equal(r.kind, "community");
  assert.equal(r.href, null);
  assert.equal(r.label, "Submitted by community");
  assert.equal(
    sourceReceiptSentence(r),
    "Source: Submitted by community (seen June 3, 2026)"
  );
});

test("a calendar page is the receipt when the row has no per-event URL", () => {
  const r = resolveSourceReceipt(
    row({
      event_url: null,
      image_url: null,
      org_slug: "bvac",
      source_name: "Bear Valley Adventure Co.",
      source_url: "https://www.bvadventures.com/events",
    })
  );
  assert.equal(r.kind, "durable");
  assert.equal(r.href, "https://www.bvadventures.com/events");
  assert.equal(r.label, "Bear Valley Adventure Co.");
});

test("an external source page beats a stored photo", () => {
  const image =
    "https://static.wixstatic.com/media/8885f1_f870c2d2f1fa4f3c9208621e9b0594e5~mv2.jpg";
  const r = resolveSourceReceipt(
    row({
      event_url: null,
      image_url: image,
      source_url: "https://www.murphysirishpubca.com/",
      source_name: "Murphys Irish Pub",
    })
  );
  assert.equal(r.kind, "durable");
  assert.equal(r.href, "https://www.murphysirishpubca.com/");
  assert.equal(r.label, "Murphys Irish Pub");
});

test("a scraped photo with no external source links the image under the source name", () => {
  const image = "https://example.com/band.jpg";
  const r = resolveSourceReceipt(
    row({
      event_url: null,
      image_url: image,
      source_url: "https://hwy4events.com/submit",
      source_name: "Murphys Irish Pub",
      community_sourced: false,
    })
  );
  assert.equal(r.kind, "durable");
  assert.equal(r.href, image);
  assert.equal(r.label, "Murphys Irish Pub");
});

test("javascript: and this site's submit form never become the receipt link", () => {
  const js = resolveSourceReceipt(
    row({
      event_url: "javascript://evil.com/%0aalert(1)",
      image_url: null,
      community_sourced: true,
      source_url: "https://hwy4events.com/submit",
      source_name: "Community Submission",
    })
  );
  assert.equal(js.href, null);
  assert.equal(js.kind, "community");

  const data = resolveSourceReceipt(
    row({
      event_url: null,
      image_url: "data:text/html,<script>alert(1)</script>",
      community_sourced: true,
      source_url: "https://www.hwy4events.com/submit",
      source_name: "Community Submission",
    })
  );
  assert.equal(data.href, null);
});

test("seen date uses the region timezone, not UTC", () => {
  // 05:00 UTC is still the previous evening in Pacific.
  const r = resolveSourceReceipt(
    row({
      event_url: WATERING_HOLE,
      last_scraped_at: "2026-10-14T05:00:00Z",
    })
  );
  assert.equal(r.seenOn, "October 13, 2026");
});

test("a missing scrape time omits the seen clause", () => {
  const r = resolveSourceReceipt(
    row({
      event_url: null,
      source_url: "https://ebbettspassmoose.com/",
      source_name: "Ebbetts Pass Moose Lodge Newsletter",
      last_scraped_at: null,
    })
  );
  assert.equal(r.href, "https://ebbettspassmoose.com/");
  assert.equal(r.label, "Ebbetts Pass Moose Lodge Newsletter");
  assert.equal(r.seenOn, null);
  assert.equal(sourceReceiptSentence(r), "Source: Ebbetts Pass Moose Lodge Newsletter");
});

test("both event layouts render the source receipt", () => {
  const page = readFileSync(join(ROOT, "app/events/[slug]/page.tsx"), "utf8");
  const parade = readFileSync(join(ROOT, "components/PatrioticEventDetail.tsx"), "utf8");
  const columns = readFileSync(join(ROOT, "lib/events.ts"), "utf8");
  assert.match(page, /<SourceReceipt event=\{event\}/);
  assert.match(parade, /<SourceReceipt event=\{event\}/);
  assert.match(columns, /last_scraped_at/);
});
