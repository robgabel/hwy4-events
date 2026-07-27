// Regression lock for the Shopify ticket-product reader
// (scripts/lib/shopify-events.ts), which replaced the generic Firecrawl + LLM
// runner for Brice Station after that produced two data defects in two days:
// a row dated 2026-07-26 for the July 25 Wolf Jett show (a duplicate
// advertising a concert that had already happened) and a mis-set start time.
//
// EVERY title below is copied verbatim from bricestation.com's live
// products.json on 2026-07-26. The venue hand-types them, so the shape wobbles
// four different ways — that irregularity is exactly what the model tripped on,
// and exactly what this parser has to absorb.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseShopifyEventTitle,
  productImage,
  productPrice,
} from "../lib/shopify-events.js";

test("parses every title shape live on the store today", () => {
  // Plain hyphen separator, "@" before the time.
  assert.deepEqual(parseShopifyEventTitle("Wolf Jett - July 25, 2026 @ 7pm"), {
    name: "Wolf Jett",
    date: "2026-07-25",
    startTime: "19:00",
  });

  // Doubled whitespace around the "@".
  assert.deepEqual(
    parseShopifyEventTitle("Broken Compass Bluegrass - August 1, 2026  @  7pm"),
    { name: "Broken Compass Bluegrass", date: "2026-08-01", startTime: "19:00" }
  );

  // EN DASH separator, and an "&" inside the act name.
  assert.deepEqual(
    parseShopifyEventTitle("Grover Anderson & the Lampoliers – August 8, 2026 @ 7pm"),
    { name: "Grover Anderson & the Lampoliers", date: "2026-08-08", startTime: "19:00" }
  );

  // The time is introduced by a DASH, not "@" — and the name has an apostrophe.
  assert.deepEqual(
    parseShopifyEventTitle("Poor Man's Whiskey - September 5, 2026 - 7pm"),
    { name: "Poor Man's Whiskey", date: "2026-09-05", startTime: "19:00" }
  );

  // Trailing editorial note after the time must not leak into any field.
  // This is the show whose real 6pm start we got wrong before.
  assert.deepEqual(
    parseShopifyEventTitle("Greg Sutton and Friends – September 19, 2026 @ 6pm ~ Earlier Time!"),
    { name: "Greg Sutton and Friends", date: "2026-09-19", startTime: "18:00" }
  );
});

test("an act name containing a dash still parses", () => {
  // The name is non-greedy, so the regex must backtrack to the separator that
  // is actually followed by a month rather than splitting on the first dash.
  assert.deepEqual(parseShopifyEventTitle("Jay-Z - July 4, 2026 @ 8pm"), {
    name: "Jay-Z",
    date: "2026-07-04",
    startTime: "20:00",
  });
  assert.deepEqual(parseShopifyEventTitle("Blue-Eyed Soul Revue – May 3, 2026 @ 2pm"), {
    name: "Blue-Eyed Soul Revue",
    date: "2026-05-03",
    startTime: "14:00",
  });
});

test("a title with a date but no time yields a null start, never a guess", () => {
  assert.deepEqual(parseShopifyEventTitle("Harvest Party - October 10, 2026"), {
    name: "Harvest Party",
    date: "2026-10-10",
    startTime: null,
  });
});

test("returns null for products that are not dated events", () => {
  // Merch, gift cards and season passes share the collection; dropping them is
  // correct, and inventing a date for them would be much worse.
  for (const t of [
    "Gift Card",
    "Brice Station Logo Hat",
    "2026 Season Pass",
    "Wine Club Membership",
    "",
    null,
    undefined,
  ]) {
    assert.equal(parseShopifyEventTitle(t), null, `should not parse: ${String(t)}`);
  }
});

test("rejects a calendar-impossible date rather than rolling it over", () => {
  assert.equal(parseShopifyEventTitle("Some Band - February 31, 2026 @ 7pm"), null);
});

test("price takes the lowest real variant and degrades to null", () => {
  assert.equal(
    productPrice({ id: 1, title: "t", handle: "h", variants: [{ price: "25.00" }] }),
    "$25.00"
  );
  assert.equal(
    productPrice({ id: 1, title: "t", handle: "h", variants: [{ price: "35.00" }, { price: "20.00" }] }),
    "$20.00"
  );
  // A free/zero-priced variant is not a price signal we want to assert.
  assert.equal(productPrice({ id: 1, title: "t", handle: "h", variants: [{ price: "0.00" }] }), null);
  assert.equal(productPrice({ id: 1, title: "t", handle: "h" }), null);
});

test("image picks the first by position", () => {
  assert.equal(
    productImage({
      id: 1, title: "t", handle: "h",
      images: [
        { src: "https://cdn/b.jpg", position: 2 },
        { src: "https://cdn/a.jpg", position: 1 },
      ],
    }),
    "https://cdn/a.jpg"
  );
  assert.equal(productImage({ id: 1, title: "t", handle: "h", images: [] }), null);
});
