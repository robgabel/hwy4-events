/**
 * Server-side geocoding via OpenStreetMap Nominatim (free, keyless).
 *
 * Used by the event detail page to place the interactive map pin on the actual
 * venue rather than the town centroid. Results are cached by Next's data cache
 * (revalidate weekly), so each address is geocoded at most ~once per week —
 * well within Nominatim's usage policy. Returns null on miss/error; callers
 * fall back to the town centroid.
 *
 * Must run server-side only (Nominatim blocks browser-origin requests and we
 * don't want to leak the contact User-Agent to clients).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export async function geocodeAddress(query: string): Promise<LatLng | null> {
  const q = query.trim();
  if (!q) return null;

  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q,
      format: "json",
      limit: "1",
      countrycodes: "us",
    }).toString();

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "hwy4events.com (events map; contact: hello@hwy4events.com)",
        "Accept-Language": "en",
      },
      // Cache the geocode result for a week across renders/requests. Tagged so
      // a venue/address backfill can bust it on demand (revalidateTag) rather
      // than waiting out the week — otherwise a corrected address keeps pinning
      // the old coordinates until the cache expires.
      next: { revalidate: 60 * 60 * 24 * 7, tags: ["geocode"] },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    const hit = data[0];
    if (!hit) return null;

    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}
