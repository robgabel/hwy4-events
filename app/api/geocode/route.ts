import { NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geocode";

// Server-side proxy for browser geocoding (Nominatim sends no CORS header, so
// the client can't call it directly). Used by the interactive map on tap.
// Cached at the edge for a week — addresses are stable.
export const revalidate = 604800;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q");
  if (!q) {
    return NextResponse.json({ error: "missing q" }, { status: 400 });
  }

  const coords = await geocodeAddress(q);
  return NextResponse.json(coords, {
    headers: {
      "Cache-Control": "public, max-age=604800, s-maxage=604800, immutable",
    },
  });
}
