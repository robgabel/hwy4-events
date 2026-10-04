import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { SITE_URL } from "@/lib/constants";
import { REGION_OPS } from "@/lib/region-ops";
import { TEMPORAL_CONFIG, pacificToday } from "@/lib/date-windows";
import { LIVE_MUSIC_PATH } from "@/lib/live-music";
import { getPublishedTownSlugs } from "@/app/towns/town-content";
import {
  collectIndexNowUrls,
  resolveIndexNowKey,
  submitIndexNow,
  type IndexNowEventRow,
} from "@/lib/indexnow";

export const maxDuration = 30;

// Daily IndexNow push (HWY-62). Runs at 16:00 UTC: after the morning scrapes
// and the 15:30 reconcile, so a duplicate merged away today is never
// submitted. Submits events created in the last 24h plus the hub pages they
// change. Best-effort: a failed submission is logged and reported, never
// retried here (tomorrow's run covers only tomorrow's events, by design;
// Bing still finds missed pages through the sitemap). CRON_SECRET-gated.
const WINDOW_HOURS = 24;

export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const key = resolveIndexNowKey(process.env.INDEXNOW_KEY, REGION_OPS.seo.indexNowKey);
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();

  const { data, error } = await getSupabase()
    .from("hwy4_events")
    .select("name, date, town")
    .gte("created_at", since)
    .gte("date", pacificToday().iso)
    .eq("visibility", "public")
    .neq("status", "cancelled")
    // Routine rows 404 on the detail page (lib/events.ts); never submit them.
    .neq("is_routine", true)
    .limit(5000);
  if (error) {
    console.error("[indexnow] event query failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as IndexNowEventRow[];
  const urls = collectIndexNowUrls(rows, SITE_URL, {
    hubPaths: ["/", ...Object.values(TEMPORAL_CONFIG).map((c) => c.path), LIVE_MUSIC_PATH],
    publishedTownSlugs: new Set(getPublishedTownSlugs()),
  });
  const result = await submitIndexNow(urls, { siteUrl: SITE_URL, key });

  return NextResponse.json({ ...result, new_events: rows.length, urls: urls.length });
}
