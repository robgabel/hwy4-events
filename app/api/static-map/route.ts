import { NextRequest, NextResponse } from "next/server";
import { renderStaticMap } from "@/lib/static-map";

export const runtime = "nodejs"; // sharp needs the Node runtime

/**
 * Static map image for a coordinate, stitched from CARTO Voyager tiles.
 * The image is a pure function of (lat, lng, zoom) — so it's cached immutably
 * and never needs busting. The event detail page points this at the geocoded
 * venue; misses fall back to the town centroid upstream.
 *
 *   GET /api/static-map?lat=38.13&lng=-120.46&z=15
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  const zoom = Math.min(18, Math.max(10, Math.round(Number(sp.get("z")) || 15)));

  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
  }

  const webp = await renderStaticMap({ lat, lng, zoom });
  if (!webp) {
    return NextResponse.json({ error: "Tile fetch failed" }, { status: 502 });
  }

  return new NextResponse(new Uint8Array(webp), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      // Immutable: same coordinate always yields the same image.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
