import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getAnalyticsSnapshot, utcDayRange } from "@/lib/cloudflare-analytics";

export const maxDuration = 30;

/**
 * Daily snapshot of Cloudflare Web Analytics (RUM) into Supabase `analytics_daily`.
 *
 * Cloudflare's free Web Analytics retention is limited (~6 months); this builds an
 * unbounded local history and powers the admin Growth view + AEO referral tracking.
 * Runs once daily via vercel.json cron, capturing the previous full UTC day.
 * Idempotent: upserts on `date`. Gated by CRON_SECRET. See PRD-cloudflare-analytics.md.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }

  // Previous full UTC day. Allow ?date=YYYY-MM-DD to backfill a specific day.
  const { searchParams } = new URL(request.url);
  const override = searchParams.get("date");
  const day =
    override && /^\d{4}-\d{2}-\d{2}$/.test(override)
      ? override
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    const snapshot = await getAnalyticsSnapshot(utcDayRange(day));

    const supabase = createClient(supabaseUrl, serviceKey);
    const { error } = await supabase.from("analytics_daily").upsert(
      {
        date: day,
        pageviews: snapshot.totals.pageviews,
        visits: snapshot.totals.visits,
        top_pages: snapshot.topPages,
        referrers: snapshot.referrers,
        countries: snapshot.countries,
        devices: snapshot.devices,
        browsers: snapshot.browsers,
        ai_referrals: snapshot.aiReferrals,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "date" }
    );

    if (error) {
      console.error("[snapshot-analytics] upsert failed:", error);
      return NextResponse.json(
        { error: "Upsert failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      date: day,
      totals: snapshot.totals,
      ai_referrals: snapshot.aiReferrals,
    });
  } catch (err) {
    console.error("[snapshot-analytics] failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
