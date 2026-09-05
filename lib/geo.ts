// Visitor-vs-local classification for Gate 0 (BUSINESS-PLAN.md §15).
//
// Signal source: Vercel's edge geo headers (x-vercel-ip-*), read server-side in
// /api/track. The client never sends a location. This is DIRECTIONAL, not exact.
// Four classes:
//   local   — the IP lat/lng is inside the region's bounding box, or the IP city
//             is one of the region's localIpCities (both in regions/<slug>/core.ts)
//   hub     — an in-state IP city in the region's hubIpCities: a regional ISP
//             hub. Rural ISPs route many residents through one (verified
//             2026-09-04: a Comcast connection in Arnold resolves to Lodi), so a
//             hub-city IP is a mix of hub-routed locals and genuine regional
//             visitors that nothing in the IP can split. It is counted apart
//             from both rather than being called either.
//   visitor — any other located request
//   unknown — no geo at all (e.g. local dev)
// The hub check runs BEFORE the box: a request geolocated to a hub city carries
// the hub's coordinates, so a box hit there (Sonora sits inside the Calaveras
// box) is the hub's location, not the reader's. Locals are still undercounted
// (a hub-routed resident cannot be told apart from a hub visitor); read the
// trend, never quote it as exact. Locked by scripts/test/geo.test.ts.

import { REGION } from "./region";

export type VisitorClass = "local" | "hub" | "visitor" | "unknown";

/** Every class, in read-out order. Consumers that tally by class iterate this
 *  so a new class can never be silently dropped from a breakdown. */
export const VISITOR_CLASSES: readonly VisitorClass[] = ["local", "hub", "visitor", "unknown"];

export interface RequestGeo {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

// The region's towns + immediate neighbors (lowercased), matched against the
// IP city when present. Data lives in regions/<slug>/core.ts.
const CORRIDOR_CITIES = new Set(REGION.geo.localIpCities);

// Regional ISP hub cities (lowercased). Optional in the region config.
const HUB_CITIES = new Set(REGION.geo.hubIpCities ?? []);

// Generous bounding box around the region. Data lives in regions/<slug>/core.ts.
const BOX = REGION.geo.visitorBox;

export function classifyVisitor(geo: RequestGeo): VisitorClass {
  const { country, region, city, latitude, longitude } = geo;

  const inState =
    !!country &&
    country.toUpperCase() === REGION.countryCode &&
    !!region &&
    region.toUpperCase() === REGION.stateCode;
  const c = (city ?? "").toLowerCase().trim();

  // Hub first: the coordinates on a hub-city IP are the hub's, not the reader's.
  if (inState && c && HUB_CITIES.has(c)) return "hub";

  const inBox =
    latitude != null &&
    longitude != null &&
    latitude >= BOX.latMin &&
    latitude <= BOX.latMax &&
    longitude >= BOX.lngMin &&
    longitude <= BOX.lngMax;
  if (inBox) return "local";

  if (inState && c && CORRIDOR_CITIES.has(c)) return "local";

  if (country) return "visitor";
  return "unknown";
}

// Parse Vercel's edge geo headers off a Request. Vercel sets these on every
// request; city is URL-encoded. Returns nulls when absent (e.g. local dev).
export function geoFromHeaders(h: Headers): RequestGeo {
  const num = (v: string | null) => {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const dec = (v: string | null) => {
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  return {
    country: h.get("x-vercel-ip-country"),
    region: h.get("x-vercel-ip-country-region"),
    city: dec(h.get("x-vercel-ip-city")),
    latitude: num(h.get("x-vercel-ip-latitude")),
    longitude: num(h.get("x-vercel-ip-longitude")),
  };
}
