import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { fetchGscCuts } from "@/lib/agent/gsc";

// Agent Cockpit Stage 0 collector. Pulls Search Console performance in three
// dimension cuts (date / query / page) and writes them to seo_snapshots:
//   - the by-DATE trend spine is UPSERTED on (source, data_date) so daily runs
//     re-pull the trailing window and self-correct as GSC revises recent days;
//   - the by-QUERY / by-PAGE top lists are point-in-time INSERTS, read later at
//     their newest captured_at.
// Dormant (and a clean no-op) until GOOGLE_SEARCH_CONSOLE_SA_JSON is configured.
// `?history=NNN` seeds the by-date spine over a longer window (one-time backfill).
// See PRD-agent-cockpit.md.

export const maxDuration = 60;

export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }

  const historyDays = clampHistory(new URL(request.url).searchParams.get("history"));

  try {
    const cuts = await fetchGscCuts(28, historyDays);
    if (cuts === null) {
      return NextResponse.json({
        ok: true,
        skipped:
          "GOOGLE_SEARCH_CONSOLE_SA_JSON not set — SEO collection is dormant until configured.",
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const capturedAt = new Date().toISOString();

    // by-date: upsert the trend spine (one row per calendar date, self-correcting).
    const dateRows = cuts.byDate.map((r) => ({
      captured_at: capturedAt,
      source: "gsc",
      dimension: "date",
      data_date: r.date,
      query: null,
      page: null,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));
    if (dateRows.length > 0) {
      const { error } = await supabase
        .from("seo_snapshots")
        .upsert(dateRows, { onConflict: "source,data_date", ignoreDuplicates: false });
      if (error) throw error;
    }

    // by-query + by-page: point-in-time snapshots (plain inserts).
    const snapRows = [
      ...cuts.byQuery.map((r) => ({
        captured_at: capturedAt,
        source: "gsc",
        dimension: "query",
        data_date: null,
        query: r.query,
        page: null,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      })),
      ...cuts.byPage.map((r) => ({
        captured_at: capturedAt,
        source: "gsc",
        dimension: "page",
        data_date: null,
        query: null,
        page: r.page,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      })),
    ];
    if (snapRows.length > 0) {
      const { error } = await supabase.from("seo_snapshots").insert(snapRows);
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      source: "gsc",
      window: { start: cuts.startDate, end: cuts.endDate },
      captured_at: capturedAt,
      rows: { date: dateRows.length, query: cuts.byQuery.length, page: cuts.byPage.length },
    });
  } catch (err) {
    console.error("[collect-seo] failed:", err);
    return NextResponse.json({ error: "SEO collection failed" }, { status: 500 });
  }
}

// Backfill knob: how many days of by-date history to pull. Default 28 (daily run).
// Capped at 480 (~16 months, GSC's retention) so a stray param can't over-fetch.
function clampHistory(raw: string | null): number {
  if (!raw) return 28;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 28;
  return Math.min(Math.max(n, 28), 480);
}
