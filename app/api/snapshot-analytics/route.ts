import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  buildAnalyticsDailyRow,
  getAnalyticsSnapshot,
  utcDayRange,
} from "@/lib/cloudflare-analytics";

export const maxDuration = 30;

/**
 * Daily snapshot of Cloudflare Web Analytics (RUM) into Supabase `analytics_daily`.
 *
 * Cloudflare keeps unsampled RUM only ~7 days and its GraphQL adaptive API serves
 * only ~3 weeks of history (the dashboard's 6-month view is sampled aggregate, not
 * what the API returns); this builds an unbounded, full-fidelity local history and
 * powers the admin Growth view + AEO referral tracking.
 * Runs once daily via vercel.json cron, capturing the previous full UTC day.
 * Idempotent: upserts on `date`. A capped/mismatched RUM day is still written
 * (so the gap is visible) with rejected=true and null totals — never stored as
 * a 10,000-visit spike. Gated by CRON_SECRET. See PRD-cloudflare-analytics.md.
 */
export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

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
    const row = buildAnalyticsDailyRow(day, snapshot);
    if (row.rejected) {
      console.warn(
        `[snapshot-analytics] rejected ${day}: ${row.reject_reason} (cf pageviews=${snapshot.totals.pageviews} visits=${snapshot.totals.visits}; totals stored as null)`
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { error } = await supabase.from("analytics_daily").upsert(
      {
        ...row,
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
      rejected: row.rejected,
      reject_reason: row.reject_reason,
      totals: row.rejected
        ? { pageviews: null, visits: null }
        : snapshot.totals,
      ai_referrals: snapshot.aiReferrals,
    });
  } catch (err) {
    console.error("[snapshot-analytics] failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
