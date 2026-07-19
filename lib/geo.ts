// Visitor-vs-local classification for Gate 0 (BUSINESS-PLAN.md §15).
//
// Signal source: Vercel's edge geo headers (x-vercel-ip-*), read server-side in
// /api/track. The client never sends a location. This is DIRECTIONAL, not exact:
// rural ISPs often geolocate corridor residents to a regional hub (Sonora,
// Stockton, Sacramento, Modesto), so some locals read as "visitor". We classify
// "local" generously (a bounding box around the Hwy 4 corridor OR a corridor
// city name) and treat anything else with a known country as "visitor". No geo
// at all (e.g. local dev) -> "unknown". Good for the trend; never quoted as exact.

import { REGION } from "./region";

export type VisitorClass = "local" | "visitor" | "unknown";

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

// Generous bounding box around the region. Data lives in regions/<slug>/core.ts.
const BOX = REGION.geo.visitorBox;

export function classifyVisitor(geo: RequestGeo): VisitorClass {
  const { country, region, city, latitude, longitude } = geo;

  const inBox =
    latitude != null &&
    longitude != null &&
    latitude >= BOX.latMin &&
    latitude <= BOX.latMax &&
    longitude >= BOX.lngMin &&
    longitude <= BOX.lngMax;
  if (inBox) return "local";

  if (
    country &&
    country.toUpperCase() === REGION.countryCode &&
    region &&
    region.toUpperCase() === REGION.stateCode
  ) {
    const c = (city ?? "").toLowerCase().trim();
    if (c && CORRIDOR_CITIES.has(c)) return "local";
  }

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
