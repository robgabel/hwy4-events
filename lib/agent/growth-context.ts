import type { SupabaseClient } from "@supabase/supabase-js";
import type { GrowthContext, GrowthVitals } from "./types";
import { getNewsletterStats } from "@/lib/newsletter-stats";
import { getSeoOverview } from "@/lib/seo-data";
import { getActiveLessons, getPriorMoves } from "@/lib/agent/growth-lessons";

// Gathers the growth signal pack handed to the Head-of-Growth reasoner
// (PRD-growth-agent.md). Every number here is real and queried; the model may
// ONLY summarize what's in here. Grounded in the live schemas: site_events
// (Gate 0), newsletter_subscribers / _drafts / _clicks, analytics_daily,
// seo_snapshots, hwy4_orgs, share_hits, poster_submissions, event_submissions.
//
// Aggregation rule: every site_events / share_hits / newsletter_clicks signal
// is aggregated by a SQL RPC (growth_*_stats), NOT by tallying a raw rowset in
// JS. A PostgREST rowset is capped at ~1,000, so the old "select rows then
// count" path silently undercounted every session/referral/share/click metric
// once a window held >1,000 rows (the North Star proxy froze first). The RPCs
// aggregate server-side and return a single jsonb each, immune to the cap and
// exact at any volume. See migration 20260621b_growth_signal_rpcs.sql.

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

type Row = Record<string, unknown>;
const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const asObj = (v: unknown) => (v ?? {}) as Record<string, unknown>;

/** A {distinct, engaged} session block as returned by growth_session_stats. */
type SessionStat = { distinct: number; engaged: number };
const sessionStat = (v: unknown): SessionStat => {
  const o = asObj(v);
  return { distinct: num(o.distinct), engaged: num(o.engaged) };
};
/** Coerce a jsonb src->count object into a plain Record<string, number>. */
const numMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(asObj(v))) out[k] = num(val);
  return out;
};

export async function gatherGrowthContext(
  supabase: SupabaseClient
): Promise<GrowthContext> {
  const today = new Date().toISOString().split("T")[0];
  const d7 = iso(7 * DAY);
  const d14 = iso(14 * DAY);
  const d30 = iso(30 * DAY);

  const [
    nlStats,
    lastSend,
    sessionAgg,
    outboundAgg,
    analytics,
    durableOrgs,
    shareAgg,
    posterPending,
    pendingSubs,
    needsVerif,
    growthExperiments,
  ] = await Promise.all([
    // Newsletter trend + composition, single source of truth (lib/newsletter-stats).
    getNewsletterStats(supabase, 60),
    supabase.from("newsletter_drafts").select("id, target_send_date, sent_at, sent_count").eq("status", "sent").order("sent_at", { ascending: false }).limit(1),
    // 14d of view sessions -> weekly local/visitor session proxies (DB-aggregated).
    supabase.rpc("growth_session_stats", { p_d7: d7, p_d14: d14 }),
    // 30d of outbound business clicks, the referral signal (DB-aggregated).
    supabase.rpc("growth_outbound_stats", { p_d7: d7, p_d30: d30 }),
    supabase.from("analytics_daily").select("date, pageviews, top_pages, ai_referrals").order("date", { ascending: false }).limit(14),
    supabase.from("hwy4_orgs").select("id", { count: "exact", head: true }).not("canonical_url", "is", null),
    // 7d of share hits by src (DB-aggregated).
    supabase.rpc("growth_share_stats", { p_d7: d7 }),
    supabase.from("poster_submissions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("event_submissions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("hwy4_events").select("id", { count: "exact", head: true }).eq("verification_status", "needs_verification"),
    // Logged experiments: all running ones, plus any concluded in the last 30d
    // (so a just-decided test still gets one last mention). The memo reads these
    // as ground truth instead of inventing experiments.
    supabase
      .from("growth_experiments")
      .select("name, hypothesis, metric, status, baseline, result, started_on, concluded_on")
      .or(`status.eq.running,concluded_on.gte.${d30.split("T")[0]}`)
      .order("started_on", { ascending: false })
      .limit(20),
  ]);

  // ── newsletter last-send clicks (DB-aggregated; see growth_newsletter_click_stats) ─
  const sendRow = rows(lastSend)[0];
  let sendClicks = 0;
  let topEvents: { slug: string; clicks: number }[] = [];
  if (sendRow?.id) {
    const { data: ncRaw } = await supabase.rpc("growth_newsletter_click_stats", {
      p_campaign_id: String(sendRow.id),
    });
    const nc = asObj(ncRaw);
    sendClicks = num(nc.total);
    topEvents = (Array.isArray(nc.topSlugs) ? nc.topSlugs : []).map((s) => {
      const o = asObj(s);
      return { slug: String(o.slug ?? ""), clicks: num(o.clicks) };
    });
  }

  // ── audience proxies from view sessions (see growth_session_stats) ────────
  const sess = asObj(sessionAgg.data);
  const localStats7 = sessionStat(sess.local7);
  const localStatsPrev7 = sessionStat(sess.localPrev7);
  const visitorStats7 = sessionStat(sess.visitor7);
  const sessionsBySrc7d = numMap(sess.sessionsBySrc7d);

  // ── referrals (see growth_outbound_stats) ─────────────────────────────────
  const out = asObj(outboundAgg.data);
  const out7Count = num(out.total7);
  const out30Count = num(out.total30);
  const visitorClicks = num(out.visitorClicks30);
  const byType = numMap(out.byType);
  const referralsBySrc30d = numMap(out.bySrc);
  const topReferralEvents = (Array.isArray(out.topEvents) ? out.topEvents : []).map((e) => {
    const o = asObj(e);
    return { event_id: String(o.event_id ?? ""), clicks: num(o.count) };
  });

  // ── traffic (analytics_daily, newest first) ─────────────────────────────
  const aRows = rows(analytics);
  const pv7 = aRows.slice(0, 7).reduce((s, r) => s + num(r.pageviews), 0);
  const pvPrev7 = aRows.slice(7, 14).reduce((s, r) => s + num(r.pageviews), 0);
  const latestA = aRows[0];
  const topPages = Array.isArray(latestA?.top_pages)
    ? (latestA!.top_pages as Row[]).slice(0, 8).map((p) => ({ key: String(p.key ?? ""), pageviews: num(p.pageviews) }))
    : [];
  // Sum ai_referrals across the whole fetched window (14d), not just the
  // latest day. Answer-engine referrals arrive ~1 visit every few days, so any
  // single day's row is almost always all zeros — which made this block read 0
  // while channels.sessions_by_src_7d showed real ref:chatgpt.com sessions
  // (HWY-4). Summing keeps the two views in directional agreement.
  const aiReferrals: Record<string, number> = {};
  for (const r of aRows) {
    if (r.ai_referrals && typeof r.ai_referrals === "object") {
      for (const [k, v] of Object.entries(r.ai_referrals as Record<string, unknown>)) {
        aiReferrals[k] = (aiReferrals[k] ?? 0) + num(v);
      }
    }
  }

  // ── seo (Search Console overview: totals, MoM, top queries, striking) ─────
  // The full analysis (trend spine + latest query snapshot) lives in lib/seo-data;
  // the memo cares about the direction (MoM) and the highest-leverage work
  // (striking distance), not the raw daily series.
  const seoOverview = await getSeoOverview(supabase, { topN: 10, strikeLimit: 8 });

  // ── memory (HWY-5): durable lessons + the agent's own recent moves ────────
  const [lessons, priorMoves] = await Promise.all([
    getActiveLessons(supabase, 20),
    getPriorMoves(supabase, 4),
  ]);

  // ── network virality (see growth_share_stats) ─────────────────────────────
  const shareBySrc = numMap(shareAgg.data);

  const vitals: GrowthVitals = {
    newsletter_active: nlStats.total_active,
    newsletter_net_7d: nlStats.net_7d,
    newsletter_confirm_rate_30d: nlStats.confirm_rate_30d,
    local_sessions_7d: localStats7.distinct,
    local_sessions_prev_7d: localStatsPrev7.distinct,
    business_referrals_7d: out7Count,
    pageviews_7d: pv7,
  };

  const experiments = rows(growthExperiments).map((e) => ({
    name: String(e.name ?? ""),
    hypothesis: (e.hypothesis as string | null) ?? null,
    metric: (e.metric as string | null) ?? null,
    status: String(e.status ?? "running"),
    baseline: (e.baseline as string | null) ?? null,
    result: (e.result as string | null) ?? null,
    started_on: String(e.started_on ?? ""),
    concluded_on: (e.concluded_on as string | null) ?? null,
  }));

  return {
    date: today,
    vitals,
    experiments,
    lessons,
    prior_moves: priorMoves,
    newsletter: {
      active: nlStats.total_active,
      net_7d: nlStats.net_7d,
      net_30d: nlStats.net_30d,
      pending_unconfirmed: nlStats.pending_unconfirmed,
      confirm_rate_30d: nlStats.confirm_rate_30d,
      by_class: nlStats.by_class,
      by_source: nlStats.by_source,
      // Trim the 60d series to the last 30 for the prompt; keep it compact.
      daily: nlStats.days.slice(-30).map((d) => ({
        date: d.date,
        signups: d.signups,
        net: d.net,
        cumulative_active: d.cumulative_active,
      })),
      last_send: {
        date: (sendRow?.target_send_date as string | null) ?? (sendRow?.sent_at as string | null) ?? null,
        sent_count: (sendRow?.sent_count as number | null) ?? null,
        clicks: sendClicks,
        top_events: topEvents,
      },
    },
    audience: {
      local_sessions_7d: localStats7.distinct,
      local_sessions_prev_7d: localStatsPrev7.distinct,
      visitor_sessions_7d: visitorStats7.distinct,
      engaged_local_sessions_7d: localStats7.engaged,
    },
    referrals: {
      total_7d: out7Count,
      total_30d: out30Count,
      by_type: byType,
      visitor_share_30d: out30Count > 0 ? visitorClicks / out30Count : null,
      top_events: topReferralEvents,
    },
    channels: {
      sessions_by_src_7d: sessionsBySrc7d,
      referrals_by_src_30d: referralsBySrc30d,
    },
    traffic: {
      pageviews_7d: pv7,
      pageviews_prev_7d: pvPrev7,
      top_pages: topPages,
      ai_referrals: aiReferrals,
    },
    seo: {
      captured_at: seoOverview.capturedAt,
      window: seoOverview.window,
      totals: seoOverview.hasData
        ? {
            clicks: seoOverview.totals.clicks,
            impressions: seoOverview.totals.impressions,
            ctr: seoOverview.totals.ctr,
            avg_position: seoOverview.totals.avgPosition,
          }
        : null,
      mom: seoOverview.mom
        ? {
            clicks_delta_pct: seoOverview.mom.clicksDeltaPct,
            impressions_delta_pct: seoOverview.mom.impressionsDeltaPct,
            position_delta: seoOverview.mom.positionDelta,
          }
        : null,
      top: seoOverview.topQueries.map((q) => ({
        query: q.query,
        clicks: q.clicks,
        impressions: q.impressions,
        position: q.position,
      })),
      striking: seoOverview.striking.map((q) => ({
        query: q.query,
        clicks: q.clicks,
        impressions: q.impressions,
        position: q.position,
        potential: q.potential,
      })),
    },
    network: {
      durable_orgs: durableOrgs.count ?? 0,
      share_hits_7d: shareBySrc,
      poster_pending: posterPending.count ?? 0,
    },
    ops: {
      pending_submissions: pendingSubs.count ?? 0,
      needs_verification: needsVerif.count ?? 0,
    },
  };
}
