import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { draftMissingVenueAddresses } from "@/lib/agent/draft-venue-addresses";

// Daily self-healing venue ADDRESS drafter. Web-researches the street address for
// any hwy4_venues row missing one and stages it as a pending draft (address_draft)
// for human review at /admin/venues. Advisory only: never writes the live `address`
// column. Sibling to the weekly blurb drafter (.github/workflows/draft-blurbs.yml).
//
// `?limit=N` caps the batch (default 6 — each venue is a ~15s web_search call, so
// the default stays well inside maxDuration). Idempotent + self-limiting: once every
// venue has an address or a tried-marker, it's a no-op.

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
    const result = await draftMissingVenueAddresses({ limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[draft-venue-addresses] failed:", err);
    return NextResponse.json({ error: "Address drafting failed" }, { status: 500 });
  }
}
