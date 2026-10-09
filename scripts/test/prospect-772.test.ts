// Prospect 772's own Square calendar (scripts/lib/prospect-772.ts).
//
// GoCalaveras titles these nights "Live Music @ Prospect 772" and leaves
// artists empty. The winery's product name carries the band, and the event
// product carries 5–9pm plus the ticket price. The public title must keep
// "Live Music" so generateEventSlug still resolves the Oct 5 hand retitle.
//
// Fixture JSON is a slim copy of the live CMS page + products response
// fetched 2026-10-06. This file must not hit the network.
//
// dedup.ts throws at import unless the service-role env is set. Dummy values
// plus a dynamic import, same as null-guard.test.ts. No request is made.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSameEvent, generateDedupKey } from "../../lib/event-identity.js";
import { generateEventSlug } from "../../lib/slugs.js";
import { pickFallbackEvent } from "../../lib/events.js";
import { classifyEventCategory } from "../../lib/categorize.js";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";
import {
  PROSPECT_CALENDAR_TITLE,
  actFromProspectTitle,
  featuredEventIds,
  mapProspectProduct,
  squareEventPermalink,
  squareEventPrice,
  squareEventWhen,
  squareProductsUrl,
  titleMonthDay,
  type ProspectShow,
} from "../lib/prospect-772.js";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/prospect-772-products.json"), "utf8")
) as {
  page: unknown;
  products: Record<string, unknown>[];
};

const breakawayProduct = fixture.products[0];
const boomerProduct = fixture.products[1];

function show(product: unknown): ProspectShow {
  const mapped = mapProspectProduct(product);
  assert.ok(mapped, "expected a mapped show");
  return mapped;
}

async function loadDedup() {
  return import("../lib/dedup.js");
}

test("featuredEventIds walks the CMS page and keeps document order", () => {
  assert.deepEqual(featuredEventIds(fixture.page), [
    "KYCQYYPGYOSINOW7PHDI46CJ",
    "IEDPMOLSJEESMJZNUHDE2YIH",
  ]);
  assert.deepEqual(
    featuredEventIds({
      a: { featuredEventIds: ["A", "B"] },
      b: { featuredEventIds: ["B", "C", "  "] },
    }),
    ["A", "B", "C"]
  );
  assert.deepEqual(featuredEventIds({}), []);
});

test("squareProductsUrl asks only for the featured event products", () => {
  const url = squareProductsUrl(["KYCQYYPGYOSINOW7PHDI46CJ", "IEDPMOLSJEESMJZNUHDE2YIH"]);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("product_types[]"), "event");
  assert.deepEqual(parsed.searchParams.getAll("ids[]"), [
    "KYCQYYPGYOSINOW7PHDI46CJ",
    "IEDPMOLSJEESMJZNUHDE2YIH",
  ]);
});

test("actFromProspectTitle reads the band between the date and the series suffix", () => {
  assert.equal(
    actFromProspectTitle("October 10th - Breakaway - Prospect 772 Concert Series"),
    "Breakaway"
  );
  assert.equal(
    actFromProspectTitle("October 24th – Boomer – Prospect 772 Concert Series"),
    "Boomer"
  );
  // A dash inside the act stays. The series suffix is the last separator.
  assert.equal(
    actFromProspectTitle("July 4th - Jay-Z - Prospect 772 Concert Series"),
    "Jay-Z"
  );
  assert.equal(
    actFromProspectTitle("May 2nd - Foo & The Bars - Prospect 772 Winery"),
    "Foo & The Bars"
  );
  assert.deepEqual(titleMonthDay("October 10th - Breakaway - Prospect 772 Concert Series"), {
    month: 10,
    day: 10,
  });
});

test("actFromProspectTitle refuses a title that does not name a band", () => {
  assert.equal(actFromProspectTitle("Breakaway at Prospect 772"), null);
  assert.equal(
    actFromProspectTitle("October 10th - TBD - Prospect 772 Concert Series"),
    null
  );
  assert.equal(
    actFromProspectTitle("October 10th - Live Music - Prospect 772 Concert Series"),
    null
  );
  assert.equal(
    actFromProspectTitle("October 10th - Prospect 772 - Prospect 772 Concert Series"),
    null
  );
  assert.equal(actFromProspectTitle(null), null);
});

test("the live Breakaway product becomes a titled 5–9pm $12.77 row", () => {
  const mapped = show(breakawayProduct);
  assert.equal(mapped.act, "Breakaway");
  assert.equal(mapped.name, "Breakaway Live Music @ Prospect 772");
  assert.equal(mapped.date, "2026-10-10");
  assert.equal(mapped.startTime, "17:00");
  assert.equal(mapped.endTime, "21:00");
  assert.equal(mapped.price, "$12.77");
  assert.equal(
    mapped.eventUrl,
    "https://www.prospect772.com/product/october-10th-breakaway-prospect-772-concert-series/KYCQYYPGYOSINOW7PHDI46CJ"
  );
  assert.equal(mapped.sourceEventId, "KYCQYYPGYOSINOW7PHDI46CJ");
  assert.match(mapped.imageUrl ?? "", /^https:\/\//);
  assert.match(mapped.description ?? "", /\$12\.77 online/);
  assert.match(mapped.description ?? "", /\$15 at the door/);
  assert.doesNotMatch(mapped.description ?? "", /<[^>]+>/);
  assert.equal(
    classifyEventCategory(`${mapped.name} live music concert`, mapped.description),
    "live_music"
  );
  assert.equal(
    generateEventSlug(mapped.name, mapped.date, "Angels Camp"),
    "breakaway-live-music-prospect-772-2026-10-10-angels-camp"
  );
});

test("the live Boomer product becomes a titled 5–9pm $17.72 row", () => {
  const mapped = show(boomerProduct);
  assert.equal(mapped.name, "Boomer Live Music @ Prospect 772");
  assert.equal(mapped.date, "2026-10-24");
  assert.equal(mapped.startTime, "17:00");
  assert.equal(mapped.endTime, "21:00");
  assert.equal(mapped.price, "$17.72");
  assert.match(mapped.eventUrl ?? "", /october-24th-boomer/);
  assert.equal(mapped.imageUrl, null);
});

test("price, clock, and permalink fail closed", () => {
  assert.equal(
    squareEventPrice({ low: 10, high: 15, low_formatted: "$10.00", high_formatted: "$15.00" }),
    "$10.00-$15.00"
  );
  assert.equal(squareEventPrice({ low: 12.77, high: 12.77, low_formatted: "$12.77" }), "$12.77");
  assert.equal(squareEventPrice({}), null);

  assert.equal(
    squareEventWhen({
      start_date: "2026-10-10",
      end_date: "2026-10-10",
      start_time: "5:00 PM",
      end_time: "9:00 PM",
      has_no_end_time: "1",
    })?.endTime,
    null
  );
  assert.deepEqual(squareEventWhen({ start_date: "2026-10-10", start_time: "5pm" }), {
    date: "2026-10-10",
    startTime: "17:00",
    endTime: null,
  });
  assert.equal(squareEventWhen({ start_date: "2026-10-10", end_time: "9:00 PM" }), null);
  assert.equal(
    squareEventWhen({
      start_date: "2026-10-10",
      end_date: "2026-10-11",
      start_time: "5:00 PM",
      end_time: "9:00 PM",
    }),
    null
  );
  assert.equal(
    squareEventWhen({ start_date: "2026-02-31", start_time: "5:00 PM", end_time: "9:00 PM" }),
    null
  );

  assert.equal(
    squareEventPermalink({
      site_link: "/product/october-10th-breakaway/KYCQYYPGYOSINOW7PHDI46CJ",
    }),
    "https://www.prospect772.com/product/october-10th-breakaway/KYCQYYPGYOSINOW7PHDI46CJ"
  );
  assert.equal(squareEventPermalink({ absolute_site_link: "http://www.prospect772.com/product/x" }), null);
});

test("mapProspectProduct skips a product that is not this night's visible event", () => {
  const shifted = structuredClone(breakawayProduct);
  (shifted.product_type_details as { start_date: string }).start_date = "2026-11-10";
  (shifted.product_type_details as { end_date: string }).end_date = "2026-11-10";
  assert.equal(mapProspectProduct(shifted), null);

  const hidden = structuredClone(breakawayProduct);
  hidden.visibility = "hidden";
  assert.equal(mapProspectProduct(hidden), null);

  const wine = structuredClone(breakawayProduct);
  wine.product_type = "physical";
  assert.equal(mapProspectProduct(wine), null);
});

test("a titled show is the same event as the GoCalaveras generic and the hand retitles", () => {
  const mapped = show(breakawayProduct);
  const generic = {
    name: "Live Music @ Prospect 772",
    date: "2026-10-10",
    town: "Angels Camp",
    venue_name: "Prospect 772 Winery",
    venue_key: "prospect-772",
    start_time: "17:00:00",
    end_time: null,
    artists: null,
    description: null,
  };
  const titled = {
    name: mapped.name,
    date: mapped.date,
    town: "Angels Camp",
    venue_name: "Prospect 772 Winery",
    venue_key: "prospect-772",
    start_time: mapped.startTime,
    end_time: mapped.endTime,
    artists: [mapped.act],
  };
  assert.equal(isSameEvent(titled, generic), true);
  assert.equal(isSameEvent(generic, titled), true);
  // Exact keys miss: Square id is not the EventON id, and the titled name
  // hashes to a different dedup_key than the generic calendar title.
  assert.notEqual(mapped.sourceEventId, "192510");
  assert.notEqual(
    generateDedupKey(mapped.name, mapped.date, "Angels Camp"),
    generateDedupKey(generic.name, generic.date, "Angels Camp")
  );

  const handBreakaway = {
    ...titled,
    name: "Breakaway Live Music @ Prospect 772",
    artists: ["Breakaway"],
    end_time: "21:00",
  };
  assert.equal(isSameEvent(titled, handBreakaway), true);

  const boomer = show(boomerProduct);
  const handBoomer = {
    name: "Boomer Live Music @Prospect 772 Winery",
    date: "2026-10-24",
    town: "Angels Camp",
    venue_name: "Prospect 772 Winery",
    venue_key: "prospect-772",
    start_time: "17:00:00",
    end_time: "21:00:00",
    artists: ["Boomer"],
  };
  assert.equal(
    isSameEvent(
      {
        name: boomer.name,
        date: boomer.date,
        town: "Angels Camp",
        venue_name: "Prospect 772 Winery",
        venue_key: "prospect-772",
        start_time: boomer.startTime,
        end_time: boomer.endTime,
        artists: [boomer.act],
      },
      handBoomer
    ),
    true
  );

  assert.equal(isSameEvent(titled, { ...generic, date: "2026-10-24" }), false);

  // Series-default clock: one generic title may drift up to 90 minutes.
  assert.equal(isSameEvent(titled, { ...generic, start_time: "18:00" }), true);
  assert.equal(isSameEvent(titled, { ...generic, start_time: "19:00" }), false);
});

test("the strong-match write puts the band, 9pm, and ticket on the generic row and a later generic pass cannot take them back", async () => {
  const { buildStrongMatchUpdate, generateDedupKey: keyOf } = await loadDedup();
  const mapped = show(breakawayProduct);
  const now = "2026-10-06T15:00:00.000Z";
  const existing = {
    id: "9cfb2c05-920f-4e6b-9fdc-0c1e72aecf68",
    name: "Live Music @ Prospect 772",
    date: "2026-10-10",
    town: "Angels Camp",
    venue_name: "Prospect 772 Winery",
    venue_key: "prospect-772",
    description: null,
    start_time: "17:00:00",
    end_time: null,
    price: null,
    event_url: "https://www.gocalaveras.com/events/live-music-prospect-772-4/",
    address: "772 Appaloosa Rd, Angels Camp, CA 95222",
    image_url: null,
    category: "live_music",
    artists: null,
    source_event_id: "192510",
    series_umbrella: false,
  };
  const incoming = {
    name: mapped.name,
    description: mapped.description,
    date: mapped.date,
    start_time: mapped.startTime,
    end_time: mapped.endTime,
    venue_name: "Prospect 772 Winery",
    town: "Angels Camp",
    address: null,
    category: "live_music",
    price: mapped.price,
    artists: [mapped.act],
    event_url: mapped.eventUrl,
    image_url: mapped.imageUrl,
    source_event_id: mapped.sourceEventId,
  };
  const dedupKey = keyOf(mapped.name, mapped.date, "Angels Camp");
  const merged = buildStrongMatchUpdate(existing as never, incoming as never, dedupKey, now) as Record<
    string,
    unknown
  >;
  assert.equal(merged.name, "Breakaway Live Music @ Prospect 772");
  assert.equal(merged.end_time, "21:00");
  assert.equal(merged.price, "$12.77");
  assert.equal(merged.event_url, mapped.eventUrl);
  assert.equal(merged.source_event_id, mapped.sourceEventId);
  assert.deepEqual(merged.artists, ["Breakaway"]);

  const stored = {
    ...existing,
    name: merged.name as string,
    end_time: "21:00",
    price: "$12.77",
    event_url: mapped.eventUrl,
    artists: ["Breakaway"],
    source_event_id: mapped.sourceEventId,
  };
  const laterGeneric = {
    ...incoming,
    name: PROSPECT_CALENDAR_TITLE,
    description: null,
    end_time: null,
    price: null,
    artists: null,
    event_url: existing.event_url,
    image_url: null,
    source_event_id: "192510",
  };
  const kept = buildStrongMatchUpdate(
    stored as never,
    laterGeneric as never,
    keyOf(PROSPECT_CALENDAR_TITLE, mapped.date, "Angels Camp"),
    now
  ) as Record<string, unknown>;
  assert.equal(kept.name, "Breakaway Live Music @ Prospect 772");
  assert.equal(kept.end_time, "21:00");
  assert.equal(kept.event_url, mapped.eventUrl);
  assert.equal(kept.price, "$12.77");
  assert.equal("source_event_id" in kept, false);
});

test("Boomer's hand-retitled slug 301s to the spaced title", () => {
  const stale = generateEventSlug(
    "Boomer Live Music @Prospect 772 Winery",
    "2026-10-24",
    "Angels Camp"
  );
  const boomer = {
    name: "Boomer Live Music @ Prospect 772",
    date: "2026-10-24",
    town: "Angels Camp",
    venue_name: "Prospect 772 Winery",
    artists: ["Boomer"],
  };
  assert.notEqual(generateEventSlug(boomer.name, boomer.date, boomer.town), stale);
  assert.equal(pickFallbackEvent([boomer], stale), boomer);
});

test("Prospect 772 is not blocklisted, and it writes after GoCalaveras", () => {
  const row = {
    name: "Breakaway Live Music @ Prospect 772",
    venue_name: "Prospect 772 Winery",
  };
  assert.equal(isManuallyManagedEvent(row), false);
  assert.equal(isManuallyManagedEvent(row, "gocalaveras"), false);

  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../scrape.ts"), "utf8");
  const block = src.slice(src.indexOf("const SPECIAL_SCRAPERS"), src.indexOf("const SCRAPERS"));
  const keys = [...block.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
  assert.equal(keys.at(-1), "stevenot");
  assert.equal(keys.at(-2), "prospect-772");
  assert.ok(keys.indexOf("gocalaveras") < keys.indexOf("prospect-772"));
});
