// Regression lock for CARTO basemap key handling (lib/carto.ts).
//
// A keyless CARTO tile request returns HTTP 200 with a valid PNG carrying an
// "API KEY REQUIRED" watermark, so no runtime check can catch a dropped key —
// the watermark just ships and gets cached immutably. These asserts are the
// only place the key's presence in the URL is actually verified.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { withCartoKey, BASEMAP_VERSION } from "../../lib/carto.js";

const RASTER = "https://a.basemaps.cartocdn.com/rastertiles/voyager/12/677/1583@2x.png";
const LEAFLET = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

test("appends the key as a query param", () => {
  assert.equal(withCartoKey(RASTER, "abc123"), `${RASTER}?key=abc123`);
});

test("leaves Leaflet's {z}/{x}/{y} placeholders intact", () => {
  // Leaflet substitutes into the raw string, so the template must survive.
  const out = withCartoKey(LEAFLET, "abc123");
  assert.ok(out.startsWith(LEAFLET), out);
  assert.ok(out.includes("{s}") && out.includes("{z}") && out.includes("{r}"), out);
  assert.equal(out, `${LEAFLET}?key=abc123`);
});

test("uses & when the URL already carries a query string", () => {
  assert.equal(withCartoKey(`${RASTER}?foo=1`, "abc"), `${RASTER}?foo=1&key=abc`);
});

test("returns the URL untouched when no key is configured", () => {
  // Degrades to watermarked tiles rather than to a broken URL: a map with a
  // watermark still shows the venue, and the missing key is logged loudly.
  assert.equal(withCartoKey(RASTER, ""), RASTER);
  assert.equal(withCartoKey(RASTER, "   "), RASTER);
});

test("url-encodes the key", () => {
  assert.equal(withCartoKey(RASTER, "a b&c"), `${RASTER}?key=a%20b%26c`);
});

test("the basemap version is a positive integer (it busts the immutable cache)", () => {
  assert.ok(Number.isInteger(BASEMAP_VERSION) && BASEMAP_VERSION > 0);
});
