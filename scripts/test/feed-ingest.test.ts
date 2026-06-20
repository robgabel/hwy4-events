import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapLocalistResponse,
  mapTribeResponse,
  enrichEventFromJsonLd,
  parseICalFeed,
  parseRssFeed,
  type FeedSource,
} from "../lib/feed-ingest.js";

const localistSource: FeedSource = {
  slug: "uo-calendar",
  name: "University of Oregon Calendar",
  format: "localist",
  endpoint: "https://calendar.uoregon.edu/api/2/events",
  sourceUrl: "https://calendar.uoregon.edu/",
  defaultVenue: "University of Oregon",
  defaultTown: "Eugene",
  defaultAddress: "1585 E 13th Ave, Eugene, OR 97403",
  defaultCategory: "fine_arts",
};

const tribeSource: FeedSource = {
  slug: "wow-hall",
  name: "WOW Hall",
  format: "tribe",
  endpoint: "https://wowhall.org/wp-json/tribe/events/v1/events",
  sourceUrl: "https://wowhall.org/events/",
  defaultVenue: "WOW Hall",
  defaultTown: "Eugene",
  defaultAddress: "291 W 8th Ave, Eugene, OR 97401",
  defaultCategory: "live_music",
};

const icalSource: FeedSource = {
  slug: "city-eugene-ical",
  name: "City of Eugene",
  format: "ical",
  endpoint:
    "https://www.eugene-or.gov/common/modules/iCalendar/iCalendar.aspx?feed=calendar&catID=14",
  sourceUrl: "https://www.eugene-or.gov/calendar.aspx?CID=14",
  defaultVenue: "City of Eugene",
  defaultTown: "Eugene",
  defaultCategory: "civic",
};

const rssSource: FeedSource = {
  slug: "eugene-symphony-rss",
  name: "Eugene Symphony",
  format: "rss",
  endpoint: "https://www.eugenesymphony.org/events?format=rss",
  sourceUrl: "https://www.eugenesymphony.org/events/",
  defaultVenue: "Eugene Symphony",
  defaultTown: "Eugene",
  defaultCategory: "fine_arts",
};

const tlcSource: FeedSource = {
  slug: "travel-lane-county-rss",
  name: "Eugene, Cascades & Coast",
  format: "rss",
  endpoint: "https://www.eugenecascadescoast.org/event/rss/",
  sourceUrl: "https://www.eugenecascadescoast.org/events/",
  defaultVenue: "Eugene, Cascades & Coast",
  defaultTown: "Eugene",
  defaultCategory: "other",
  usePubDateAsEventDate: true,
};

const laneCountyFarmersMarketSource: FeedSource = {
  slug: "lane-county-farmers-market",
  name: "Lane County Farmers Market",
  format: "tribe",
  endpoint: "https://www.lanecountyfarmersmarket.org/wp-json/tribe/events/v1/events",
  sourceUrl: "https://www.lanecountyfarmersmarket.org/events/",
  defaultVenue: "Lane County Farmers Market",
  defaultTown: "Downtown Eugene",
  defaultAddress: "85 E 8th Ave, Eugene, OR 97401",
  defaultCategory: "civic",
  defaultPrice: "Free",
};

const saturdayMarketSource: FeedSource = {
  slug: "eugene-saturday-market",
  name: "Eugene Saturday Market",
  format: "ical",
  endpoint:
    "https://calendar.google.com/calendar/ical/eugenesaturdaymarket%40gmail.com/public/basic.ics",
  sourceUrl: "https://eugenesaturdaymarket.org/market-calendar/",
  defaultVenue: "Eugene Saturday Market",
  defaultTown: "Downtown Eugene",
  defaultAddress: "126 E 8th Ave, Eugene, OR 97401",
  defaultCategory: "civic",
  defaultPrice: "Free",
  includeTitlePatterns: ["\\b(Saturday Market|Holiday Market)\\b"],
  excludeTitlePatterns: [
    "\\b(Committee|Meeting|Governance|Board|Annual|Debrief|Candidate|Budget)\\b",
  ],
};

const goDucksSource: FeedSource = {
  slug: "goducks",
  name: "Oregon Ducks Athletics",
  format: "ical",
  endpoint: "https://goducks.com/calendar.ashx/calendar.ics",
  sourceUrl: "https://goducks.com/calendar",
  defaultVenue: "University of Oregon Athletics",
  defaultTown: "University / Campus",
  defaultAddress: "1585 E 13th Ave, Eugene, OR 97403",
  defaultCategory: "other",
  titleTransform: "goducks",
  includeLocationPatterns: [
    "\\bEugene\\b.*\\b(Hayward Field|Matthew Knight Arena|PK Park|Autzen Stadium)\\b",
    "\\b(Hayward Field|Matthew Knight Arena|PK Park|Autzen Stadium)\\b.*\\bEugene\\b",
  ],
};

const librarySource: FeedSource = {
  slug: "eugene-library-libcal",
  name: "Eugene Public Library",
  format: "ical",
  endpoint: "https://eugene.libcal.com/ical_subscribe.php?iid=1152&cid=15065",
  sourceUrl: "https://www.eugene-or.gov/1005/Events",
  defaultVenue: "Eugene Public Library",
  defaultTown: "Eugene",
  defaultCategory: "civic",
};

function fixture(path: string): string {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
}

test("maps Localist event instances into ExtractedEvent rows", () => {
  const data = JSON.parse(fixture("localist-uoregon.json"));
  const [event] = mapLocalistResponse(data, localistSource);

  assert.equal(event.name, "Gateway to Himalayan Art");
  assert.equal(event.date, "2026-06-18");
  assert.equal(event.start_time, null);
  assert.equal(event.venue_name, "Jordan Schnitzer Museum of Art (JSMA)");
  assert.equal(event.town, "Eugene");
  assert.equal(event.address, "1430 Johnson Lane, Eugene, OR 97403");
  assert.equal(event.category, "fine_arts");
  assert.equal(event.price, "$5 for adults, $3 for seniors, free for youth");
  assert.equal(event.event_url, "https://calendar.uoregon.edu/event/gateway-to-himalayan-art");
  assert.equal(event.image_url, "https://localist-images.azureedge.net/photos/example.jpg");
  assert.equal(event.source_event_id, "uo-calendar:52649726812859");
});

test("maps Tribe JSON into ExtractedEvent rows", () => {
  const data = JSON.parse(fixture("tribe-wowhall.json"));
  const [event] = mapTribeResponse(data, tribeSource);

  assert.equal(event.name, "Dance Empowered with Cynthia Valentine");
  assert.equal(event.date, "2026-06-17");
  assert.equal(event.start_time, "17:30");
  assert.equal(event.end_time, "18:30");
  assert.equal(event.venue_name, "WOW Hall");
  assert.equal(event.town, "Eugene");
  assert.equal(event.address, "291 West 8th Avenue, Eugene, OR, 97401");
  assert.equal(event.price, "$10 - $100");
  assert.equal(event.event_url, "https://wowhall.org/event/dance-empowered-with-cynthia-valentine-3/2026-06-17/");
  assert.equal(event.image_url, "https://wowhall.org/wp-content/uploads/example.png");
  assert.equal(event.source_event_id, "wow-hall:10007214");
});

test("parses CivicPlus iCalendar events and prefers event detail URLs from description", () => {
  const [event] = parseICalFeed(fixture("civicplus-city.ics"), icalSource);

  assert.equal(event.name, "Communities of Color & Allies Network Third Thursday Event");
  assert.equal(event.date, "2027-04-15");
  assert.equal(event.start_time, "17:00");
  assert.equal(event.end_time, "19:00");
  assert.equal(event.venue_name, "Farmers Market Pavilion");
  assert.equal(event.town, "Eugene");
  assert.equal(event.address, "85 E 8th Ave Eugene OR 97401");
  assert.equal(event.category, "civic");
  assert.equal(event.event_url, "https://www.eugene-or.gov/calendar.aspx?EID=33710");
  assert.equal(event.source_event_id, "city-eugene-ical:33710");
});

test("parses RSS event rows only when an event date is discoverable", () => {
  const [event] = parseRssFeed(fixture("squarespace-symphony-rss.xml"), rssSource);

  assert.equal(event.name, "Willamalane Children's Celebration");
  assert.equal(event.date, "2026-06-27");
  assert.equal(event.start_time, null);
  assert.equal(event.venue_name, "Eugene Symphony");
  assert.equal(event.town, "Springfield");
  assert.equal(event.category, "kids");
  assert.equal(event.price, "Free");
  assert.equal(
    event.event_url,
    "https://www.eugenesymphony.org/events/instrument-petting-zoo-childrens-celebration-6-27-2026"
  );
  assert.equal(
    event.image_url,
    "https://images.squarespace-cdn.com/content/example/IPZ_1080x1080_6-27.png"
  );
  assert.equal(event.source_event_id, "eugene-symphony-rss:symphony-children-2026");
});

test("uses Simpleview RSS pubDate as the current event occurrence date when configured", () => {
  const [event] = parseRssFeed(fixture("simpleview-tlc-rss.xml"), tlcSource);

  assert.equal(event.name, "Amazon Farmers Market");
  assert.equal(event.date, "2026-06-18");
  assert.equal(event.venue_name, "Eugene, Cascades & Coast");
  assert.equal(event.town, "Eugene");
  assert.equal(event.category, "civic");
  assert.equal(event.event_url, "https://www.eugenecascadescoast.org/event/amazon-farmers-market/54640/");
  assert.equal(
    event.image_url,
    "https://assets.simpleviewinc.com/simpleview/image/upload/c_fill,h_100,q_75,w_150/v1/crm/lanecounty/amazon-farmers-market.jpg"
  );
});

test("enriches RSS events from detail-page Event JSON-LD", () => {
  const [event] = parseRssFeed(fixture("simpleview-tlc-rss.xml"), tlcSource);
  const enriched = enrichEventFromJsonLd(
    event,
    `<script type="application/ld+json">{
      "@context":"http://schema.org",
      "@type":"Event",
      "name":"Amazon Farmers Market",
      "image":"https://assets.simpleviewinc.com/simpleview/image/upload/c_fill,h_396,q_75,w_704/v1/crm/lanecounty/amazon-farmers-market.jpg",
      "location":{
        "@type":"Place",
        "name":"Amazon Community Center",
        "address":{
          "@type":"PostalAddress",
          "streetAddress":"2700 Hilyard St",
          "addressLocality":"Eugene",
          "addressRegion":"OR",
          "postalCode":"97405"
        }
      }
    }</script>`
  );

  assert.equal(enriched.venue_name, "Amazon Community Center");
  assert.equal(enriched.town, "Eugene");
  assert.equal(enriched.address, "2700 Hilyard St, Eugene, OR, 97405");
});

test("maps Lane County Farmers Market Tribe events and decodes entities", () => {
  const data = JSON.parse(fixture("tribe-lcfm.json"));
  const [event] = mapTribeResponse(data, laneCountyFarmersMarketSource);

  assert.equal(event.name, "Skate & Shop at the Tuesday Farmers Market");
  assert.equal(event.date, "2026-06-23");
  assert.equal(event.start_time, "09:00");
  assert.equal(event.end_time, "14:00");
  assert.equal(event.venue_name, "Farmers Market Pavilion and Plaza");
  assert.equal(event.price, "Free");
  assert.equal(
    event.event_url,
    "https://www.lanecountyfarmersmarket.org/event/skate-shop-at-the-tuesday-market/2026-06-23/"
  );
  assert.equal(event.source_event_id, "lane-county-farmers-market:10000455");
});

test("filters Eugene Saturday Market iCal to public market dates", () => {
  const events = parseICalFeed(fixture("saturday-market.ics"), saturdayMarketSource);

  assert.deepEqual(events.map((event) => event.name), [
    "Saturday Market",
    "Holiday Market",
  ]);
  assert.equal(events[0].date, "2026-06-20");
  assert.equal(events[0].start_time, "10:00");
  assert.equal(events[0].price, "Free");
  assert.equal(events[1].date, "2026-11-28");
  assert.equal(events[1].start_time, null);
});

test("filters GoDucks iCal to Eugene venues and cleans titles", () => {
  const events = parseICalFeed(fixture("goducks.ics"), goDucksSource);

  assert.deepEqual(events.map((event) => event.name), [
    "Oregon Women's Volleyball: Utah - Exhibition",
    "Oregon Track and Field: NCAA Championships",
  ]);
  assert.equal(events[0].date, "2026-08-21");
  assert.equal(events[0].start_time, "11:00");
  assert.equal(events[0].end_time, "14:00");
  assert.equal(events[0].venue_name, "Eugene, OR, Matthew Knight Arena");
  assert.equal(
    events[0].event_url,
    "https://admin.goducks.com/calendar.aspx?game_id=24478&sport_id=21"
  );
});

test("parses LibCal iCalendar rows with Pacific time and library venue aliases", () => {
  const events = parseICalFeed(fixture("libcal-library.ics"), librarySource);

  assert.equal(events.length, 2);
  assert.equal(events[0].name, "Teen Team");
  assert.equal(events[0].date, "2026-07-07");
  assert.equal(events[0].start_time, "16:30");
  assert.equal(events[0].category, "kids");
  assert.equal(events[0].event_url, "https://eugene.libcal.com/event/16862425");

  assert.equal(events[1].name, "Adults: Paint Citrus Fruits with Watercolors");
  assert.equal(events[1].date, "2026-07-07");
  assert.equal(events[1].start_time, "17:00");
  assert.equal(events[1].venue_name, "Sheldon Branch");
  assert.equal(events[1].category, "fine_arts");
  // Venue-registry upgrade (Sheldon Branch -> Sheldon Branch Library) is not
  // asserted here: that depends on the local venue registry, which is the
  // corridor's, not Eugene's. The generic iCal parsing above is what this covers.
});
