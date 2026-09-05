// Locks the four-way visitor classifier (lib/geo.ts) against the live region
// config: local / hub / visitor / unknown. Added 2026-09-04 after the Gate 0
// read-out was found to label a Calaveras County town (Valley Springs, 299
// sessions since June) "visitor", and to call Rob's own Arnold connection
// (which Comcast geolocates to Lodi) a visitor too. A regional ISP hub city is
// neither local nor visitor and nothing in the IP splits it, so it gets its own
// class instead of a guess. Run: `cd scripts && npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyVisitor, VISITOR_CLASSES, type RequestGeo } from "../../lib/geo.js";
import { REGION } from "../../lib/region.js";

const ca = (
  city: string | null,
  latitude: number | null = null,
  longitude: number | null = null
): RequestGeo => ({ country: "US", region: "CA", city, latitude, longitude });

test("Arnold, inside the box, is local", () => {
  assert.equal(classifyVisitor(ca("Arnold", 38.2144, -120.351)), "local");
});

test("a corridor city name is local even with no coordinates", () => {
  assert.equal(classifyVisitor(ca("Arnold")), "local");
  assert.equal(classifyVisitor(ca("Murphys")), "local");
});

test("Valley Springs (Calaveras County, just west of the box) is local", () => {
  // 38.19, -120.83 sits outside visitorBox.lngMin (-120.75): the city list is
  // what makes it local, which is exactly the 299-session miss this fixes.
  const box = REGION.geo.visitorBox;
  assert.ok(-120.83 < box.lngMin, "test premise: Valley Springs is outside the box");
  assert.equal(classifyVisitor(ca("Valley Springs", 38.19, -120.83)), "local");
  assert.equal(classifyVisitor(ca("Valley Springs")), "local");
});

test("Lodi is a regional ISP hub, not a visitor and not a local", () => {
  // Verified 2026-09-04: a Comcast connection physically in Arnold resolves here.
  assert.equal(classifyVisitor(ca("Lodi", 38.13, -121.27)), "hub");
  assert.equal(classifyVisitor(ca("Sacramento")), "hub");
  assert.equal(classifyVisitor(ca("Stockton")), "hub");
});

test("a hub city inside the box is still a hub (hub beats the box)", () => {
  // Sonora's coordinates fall inside the Calaveras box, but a request geolocated
  // to Sonora carries the hub's coordinates, not the reader's.
  const box = REGION.geo.visitorBox;
  assert.ok(37.98 > box.latMin && -120.38 > box.lngMin, "test premise: Sonora is inside the box");
  assert.equal(classifyVisitor(ca("Sonora", 37.98, -120.38)), "hub");
});

test("San Jose is a visitor", () => {
  assert.equal(classifyVisitor(ca("San Jose", 37.34, -121.89)), "visitor");
});

test("hub and local city names only count in the region's own state + country", () => {
  assert.equal(classifyVisitor({ country: "US", region: "NV", city: "Lodi", latitude: null, longitude: null }), "visitor");
  assert.equal(classifyVisitor({ country: "GB", region: "ENG", city: "Stockton", latitude: null, longitude: null }), "visitor");
  assert.equal(classifyVisitor({ country: "US", region: "OR", city: "Arnold", latitude: null, longitude: null }), "visitor");
});

test("city matching is case- and whitespace-insensitive", () => {
  assert.equal(classifyVisitor(ca("  VALLEY SPRINGS ")), "local");
  assert.equal(classifyVisitor(ca("LODI")), "hub");
});

test("no geo at all is unknown; a country alone is a visitor", () => {
  assert.equal(classifyVisitor({ country: null, region: null, city: null, latitude: null, longitude: null }), "unknown");
  assert.equal(classifyVisitor({ country: "US", region: null, city: null, latitude: null, longitude: null }), "visitor");
});

test("VISITOR_CLASSES enumerates every class exactly once", () => {
  assert.deepEqual([...VISITOR_CLASSES], ["local", "hub", "visitor", "unknown"]);
});
