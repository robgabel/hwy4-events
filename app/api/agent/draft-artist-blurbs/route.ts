import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { draftMissingArtistBlurbs } from "@/lib/agent/draft-artist-blurbs";

// Daily self-healing artist/band-blurb drafter. Web-researches each upcoming
// live-music act named in an event's `artists` field and stages a pending draft
// (blurb_draft) for human review at /admin/artists. Advisory only: never writes the
// live `blurb`/`genre`/`links`. Sibling to /api/agent/draft-venue-addresses.
//
// `?limit=N` caps the batch (default 6 — each act is a ~15s web_search call, so the
// default stays well inside maxDuration). Idempotent + self-limiting: once every
// upcoming act has a draft or a tried-marker, it's a no-op.

export const maxDuration = 300;

export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 6;

  try {
    const result = await draftMissingArtistBlurbs({ limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[draft-artist-blurbs] failed:", err);
    return NextResponse.json({ error: "Artist blurb drafting failed" }, { status: 500 });
  }
}
