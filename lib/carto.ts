/**
 * CARTO basemap tiles — the key handling both maps share.
 *
 * CARTO now requires an API key for its raster basemaps, and an unauthenticated
 * request is not an error: it returns HTTP 200 with a perfectly valid PNG that
 * happens to carry an "API KEY REQUIRED / carto.com/basemaps/apikey" watermark
 * baked into the pixels. So nothing downstream can detect it — `res.ok` passes
 * and the static-map stitcher composites the watermark straight into the image
 * it then caches immutably. The key being set is the only guard, which is why a
 * missing one logs loudly (see `warnIfKeyless` in lib/static-map.ts) instead of
 * degrading quietly.
 *
 * The key is public by design: the on-tap Leaflet map requests tiles from the
 * browser, so it ships in the client bundle no matter where we read it. Restrict
 * it by domain in the CARTO dashboard; do not treat it as a secret.
 *
 * Free key (no approval queue): https://carto.com/basemaps/apikey
 */
export const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim() || "";

/**
 * Bump whenever the rendered map image changes (tile source, key, styling).
 *
 * `/api/static-map` caches immutably — the image is a pure function of
 * lat/lng/zoom, so it never needed busting until the tiles themselves changed
 * underneath us. A version in the URL is the only way to retire images already
 * sitting in browser and CDN caches, the watermarked ones included.
 */
export const BASEMAP_VERSION = 2;

/** Raster Voyager tile URL, keyed when we have a key. Leaflet templates pass through. */
export function withCartoKey(url: string, key: string = CARTO_API_KEY): string {
  const trimmed = key.trim();
  if (!trimmed) return url;
  return `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(trimmed)}`;
}
