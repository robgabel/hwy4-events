// Locks the sitemap crawl-budget logic: horizon cap, recurring-series collapse,
// curated-pick exception, honest lastmod, and XML rendering. Pure functions, no
// DB. Run: cd scripts && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectSitemapEvents,
  eventToSitemapUrl,
  renderUrlset,
  renderSitemapIndex,
  type SitemapEventRow,
} from "../../lib/sitemap.js";

const TODAY = "2026-06-03";

function row(p: Partial<SitemapEventRow> & { name: string; date: string }): SitemapEventRow {
  return {
    id: `${p.name}-${p.date}`,
    town: "Murphys",
    updated_at: "2026-06-01T12:00:00+00:00",
    robs_pick: false,
    ...p,
  };
}

test("drops past events", () => {
  const out = selectSitemapEvents(
    [row({ name: "Yesterday Show", date: "2026-06-02" }), row({ name: "Today Show", date: "2026-06-03" })],
    { todayISO: TODAY }
  );
  assert.deepEqual(out.map((e) => e.name), ["Today Show"]);
});

test("drops events past the horizon", () => {
  const out = selectSitemapEvents(
    [
      row({ name: "Soon", date: "2026-06-10" }),
      row({ name: "Far Future", date: "2027-06-10" }),
    ],
    { todayISO: TODAY, horizonDays: 120 }
  );
  assert.deepEqual(out.map((e) => e.name), ["Soon"]);
});

test("keeps a curated robs_pick even beyond the horizon", () => {
  const out = selectSitemapEvents(
    [row({ name: "Marquee Festival", date: "2027-07-04", robs_pick: true })],
    { todayISO: TODAY, horizonDays: 120 }
  );
  assert.deepEqual(out.map((e) => e.name), ["Marquee Festival"]);
});

test("collapses a recurring series to the soonest N instances", () => {
  const dates = ["2026-06-05", "2026-06-12", "2026-06-19", "2026-06-26", "2026-07-03"];
  const out = selectSitemapEvents(
    dates.map((date) => row({ name: "Live Music Upstairs", date })),
    { todayISO: TODAY, maxPerSeries: 2 }
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => e.date), ["2026-06-05", "2026-06-12"]); // soonest two
});

test("does NOT collapse two different titles in the same town", () => {
  const out = selectSitemapEvents(
    [
      row({ name: "Open Mic", date: "2026-06-10", town: "Murphys" }),
      row({ name: "Trivia Night", date: "2026-06-10", town: "Murphys" }),
    ],
    { todayISO: TODAY, maxPerSeries: 1 }
  );
  assert.equal(out.length, 2);
});

test("same title in two different towns are separate series", () => {
  const out = selectSitemapEvents(
    [
      row({ name: "Farmers Market", date: "2026-06-06", town: "Murphys" }),
      row({ name: "Farmers Market", date: "2026-06-07", town: "Angels Camp" }),
      row({ name: "Farmers Market", date: "2026-06-13", town: "Murphys" }),
    ],
    { todayISO: TODAY, maxPerSeries: 1 }
  );
  // One kept per (title, town): Murphys soonest + Angels Camp soonest.
  assert.equal(out.length, 2);
  const keys = out.map((e) => `${e.town}:${e.date}`).sort();
  assert.deepEqual(keys, ["Angels Camp:2026-06-07", "Murphys:2026-06-06"]);
});

test("output is sorted soonest-first", () => {
  const out = selectSitemapEvents(
    [
      row({ name: "C", date: "2026-08-01" }),
      row({ name: "A", date: "2026-06-15" }),
      row({ name: "B", date: "2026-07-01" }),
    ],
    { todayISO: TODAY }
  );
  assert.deepEqual(out.map((e) => e.date), ["2026-06-15", "2026-07-01", "2026-08-01"]);
});

test("eventToSitemapUrl builds the slug URL with date-only lastmod", () => {
  const u = eventToSitemapUrl(
    row({ name: "Live Music Upstairs", date: "2026-06-05", town: "Murphys", updated_at: "2026-06-01T12:34:56+00:00" })
  );
  assert.ok(u.loc.endsWith("/events/live-music-upstairs-2026-06-05-murphys"), u.loc);
  assert.equal(u.lastmod, "2026-06-01");
  assert.equal(u.changefreq, "weekly");
});

test("eventToSitemapUrl omits lastmod when updated_at is null", () => {
  const u = eventToSitemapUrl(row({ name: "No Stamp", date: "2026-06-05", updated_at: null }));
  assert.equal(u.lastmod, undefined);
});

test("renderUrlset emits valid XML and escapes ampersands", () => {
  const xml = renderUrlset([
    { loc: "https://hwy4events.com/events/jack-jill", lastmod: "2026-06-01", changefreq: "weekly", priority: 0.7 },
    { loc: "https://hwy4events.com/q?a=1&b=2" },
  ]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>https:\/\/hwy4events\.com\/q\?a=1&amp;b=2<\/loc>/);
  assert.match(xml, /<priority>0\.7<\/priority>/);
  assert.ok(!xml.includes("a=1&b=2"), "raw ampersand must be escaped");
});

test("renderSitemapIndex lists child sitemaps", () => {
  const xml = renderSitemapIndex([
    { loc: "https://hwy4events.com/sitemap-core.xml" },
    { loc: "https://hwy4events.com/sitemap-events.xml" },
  ]);
  assert.match(xml, /<sitemapindex /);
  assert.match(xml, /<loc>https:\/\/hwy4events\.com\/sitemap-core\.xml<\/loc>/);
  assert.match(xml, /<loc>https:\/\/hwy4events\.com\/sitemap-events\.xml<\/loc>/);
});
