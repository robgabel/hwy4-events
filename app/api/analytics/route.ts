import { NextResponse } from "next/server";
import { getAnalyticsSnapshot, lastNDays } from "@/lib/cloudflare-analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Ad-hoc read of Cloudflare Web Analytics (RUM) for a trailing window.
 *
 *   GET /api/analytics?days=7   (default 7, clamped 1..92)
 *
 * Gated by CRON_SECRET (Authorization: Bearer ...), like the other internal
 * routes. The public site never calls this; the admin Growth view reads the
 * persisted analytics_daily table instead. See PRD-cloudflare-analytics.md.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requested = parseInt(searchParams.get("days") || "7", 10);
  const days = Math.min(Math.max(Number.isFinite(requested) ? requested : 7, 1), 92);

  try {
    const snapshot = await getAnalyticsSnapshot(lastNDays(days));
    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("[analytics] query failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
