import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { fetchGscRows } from "@/lib/agent/gsc";

// Agent Cockpit Stage 0 collector. Pulls the trailing-28-day Search Console
// query+page rows and writes one capture to seo_snapshots. Dormant (and a clean
// no-op) until GOOGLE_SEARCH_CONSOLE_SA_JSON is configured. See PRD-agent-cockpit.md.

export const maxDuration = 60;

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

  try {
    const rows = await fetchGscRows(28);
    if (rows === null) {
      return NextResponse.json({
        ok: true,
        skipped:
          "GOOGLE_SEARCH_CONSOLE_SA_JSON not set — SEO collection is dormant until configured.",
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const capturedAt = new Date().toISOString();
    const payload = rows.map((r) => ({
      captured_at: capturedAt,
      source: "gsc",
      query: r.query,
      page: r.page,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));

    if (payload.length > 0) {
      const { error } = await supabase.from("seo_snapshots").insert(payload);
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      source: "gsc",
      rows: payload.length,
      captured_at: capturedAt,
    });
  } catch (err) {
    console.error("[collect-seo] failed:", err);
    return NextResponse.json({ error: "SEO collection failed" }, { status: 500 });
  }
}
