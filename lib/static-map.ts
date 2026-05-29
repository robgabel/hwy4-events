import "server-only";
import sharp from "sharp";

/**
 * Stitch a static map image centered on a coordinate, from CARTO Voyager raster
 * tiles — the same basemap the on-tap interactive map (EventMap) uses.
 *
 * Replaces the pre-baked per-town webp files: instead of 9 committed assets we
 * render any coordinate on demand, behind an immutable cache (the image is a
 * pure function of lat/lng/zoom). The event detail page centers this on the
 * geocoded venue so the static thumbnail pins the venue, not the town centroid.
 */

const TILE = 512; // CARTO @2x tiles are 512px (retina)

function lngToWorldPx(lng: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  return ((lng + 180) / 360) * n * TILE;
}

function latToWorldPx(lat: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  const latRad = (lat * Math.PI) / 180;
  const y = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2;
  return y * n * TILE;
}

async function fetchTile(z: number, x: number, y: number): Promise<Buffer | null> {
  const url = `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}@2x.png`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "hwy4events.com (events map; contact: hello@hwy4events.com)" },
      // CARTO tiles are static; let Next cache them across renders.
      next: { revalidate: 60 * 60 * 24 * 30 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Render a centered static map as a webp buffer. Returns null if no tiles could
 * be fetched (caller can fall back). The world is tiled in @2x px; an out width
 * of 1200 displays crisply at 600 CSS px.
 */
export async function renderStaticMap(opts: {
  lat: number;
  lng: number;
  zoom: number;
  width?: number;
  height?: number;
}): Promise<Buffer | null> {
  const { lat, lng, zoom } = opts;
  const OUT_W = opts.width ?? 1200;
  const OUT_H = opts.height ?? 600;

  const centerX = lngToWorldPx(lng, zoom);
  const centerY = latToWorldPx(lat, zoom);
  const left = centerX - OUT_W / 2;
  const top = centerY - OUT_H / 2;

  const minTileX = Math.floor(left / TILE);
  const maxTileX = Math.floor((left + OUT_W - 1) / TILE);
  const minTileY = Math.floor(top / TILE);
  const maxTileY = Math.floor((top + OUT_H - 1) / TILE);

  const tiles = await Promise.all(
    (() => {
      const reqs: Promise<{ buf: Buffer | null; tx: number; ty: number }>[] = [];
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        for (let ty = minTileY; ty <= maxTileY; ty++) {
          reqs.push(fetchTile(zoom, tx, ty).then((buf) => ({ buf, tx, ty })));
        }
      }
      return reqs;
    })()
  );

  const composites = tiles
    .filter((t): t is { buf: Buffer; tx: number; ty: number } => t.buf !== null)
    .map((t) => ({
      input: t.buf,
      left: Math.round(t.tx * TILE - left),
      top: Math.round(t.ty * TILE - top),
    }));

  if (composites.length === 0) return null;

  return sharp({
    create: { width: OUT_W, height: OUT_H, channels: 4, background: "#e8e4dd" },
  })
    .composite(composites)
    .webp({ quality: 80 })
    .toBuffer();
}
