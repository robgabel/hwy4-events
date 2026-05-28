/**
 * Pre-generate one static map thumbnail per Hwy 4 town.
 *
 * The event detail page only ever shows a town-centered map at zoom 13
 * (there are 9 towns), so a live slippy map per page view is wasteful.
 * This stitches CARTO Voyager raster tiles (the same basemap the on-tap
 * interactive map uses) into a single retina image per town.
 *
 * Usage:
 *   npm run generate-town-maps        (from scripts/)
 *
 * Output: public/maps/<town-slug>.webp  (1200x600, displayed at 600x300)
 * Re-run only when a town's coordinates change.
 */

import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CORRIDOR_TOWNS } from "../lib/towns";
import { townSlug } from "../lib/slugs";

const ZOOM = 13;
const TILE = 512; // CARTO @2x tiles are 512px (retina)
const OUT_W = 1200; // displayed at 600px CSS width
const OUT_H = 600; // displayed at 300px CSS height
const OUT_DIR = join(__dirname, "..", "public", "maps");

function lngToWorldPx(lng: number): number {
  const n = Math.pow(2, ZOOM);
  return ((lng + 180) / 360) * n * TILE;
}

function latToWorldPx(lat: number): number {
  const n = Math.pow(2, ZOOM);
  const latRad = (lat * Math.PI) / 180;
  const y = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2;
  return y * n * TILE;
}

async function fetchTile(z: number, x: number, y: number): Promise<Buffer> {
  const url = `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}@2x.png`;
  const res = await fetch(url, {
    headers: { "User-Agent": "hwy4events-map-generator/1.0 (+https://hwy4events.com)" },
  });
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateForTown(name: string, lat: number, lng: number): Promise<void> {
  const centerX = lngToWorldPx(lng);
  const centerY = latToWorldPx(lat);
  const left = centerX - OUT_W / 2;
  const top = centerY - OUT_H / 2;

  const minTileX = Math.floor(left / TILE);
  const maxTileX = Math.floor((left + OUT_W - 1) / TILE);
  const minTileY = Math.floor(top / TILE);
  const maxTileY = Math.floor((top + OUT_H - 1) / TILE);

  const composites: sharp.OverlayOptions[] = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const buf = await fetchTile(ZOOM, tx, ty);
      composites.push({
        input: buf,
        left: Math.round(tx * TILE - left),
        top: Math.round(ty * TILE - top),
      });
    }
  }

  const out = await sharp({
    create: { width: OUT_W, height: OUT_H, channels: 4, background: "#e8e4dd" },
  })
    .composite(composites)
    .webp({ quality: 80 })
    .toBuffer();

  const file = join(OUT_DIR, `${townSlug(name)}.webp`);
  await writeFile(file, out);
  console.log(`✓ ${name} -> public/maps/${townSlug(name)}.webp (${composites.length} tiles, ${(out.length / 1024).toFixed(0)}kb)`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const t of CORRIDOR_TOWNS) {
    await generateForTown(t.name, t.lat, t.lng);
  }
  console.log(`\nDone. ${CORRIDOR_TOWNS.length} town maps written to public/maps/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
