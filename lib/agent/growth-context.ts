import type { SupabaseClient } from "@supabase/supabase-js";
import type { GrowthContext, GrowthVitals } from "./types";

// Gathers the growth signal pack handed to the Head-of-Growth reasoner
// (PRD-growth-agent.md). Every number here is real and queried; the model may
// ONLY summarize what's in here. Grounded in the live schemas: site_events
// (Gate 0), newsletter_subscribers / _drafts / _clicks, analytics_daily,
// seo_snapshots, hwy4_orgs, share_hits, poster_submissions, event_submissions.

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

type Row = Record<string, unknown>;
const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

/** Distinct session_ids in a row set, plus how many had 2+ views (engaged). */
function sessionStats(views: Row[]): { distinct: number; engaged: number } {
  const counts = new Map<string, number>();
  for (const v of views) {
    const s = String(v.session_id ?? "");
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let engaged = 0;
  for (const c of counts.values()) if (c >= 2) engaged++;
  return { distinct: counts.size, engaged };
}

export async function gatherGrowthContext(
  supabase: SupabaseClient
): Promise<GrowthContext> {
  const today = new Date().toISOString().split("T")[0];
  const d7 = iso(7 * DAY);
  const d14 = iso(14 * DAY);
  const d30 = iso(30 * DAY);

  const [
    active,
    newConf7,
    newConfPrev7,
    unsub7,
    pendingUnconf,
    created30,
    confirmed30,
    lastSend,
    views14,
    outbound30,
    analytics,
    seoLatest,
    durableOrgs,
    shareHits7,
    posterPending,
    pendingSubs,
    needsVerif,
    growthExperiments,
  ] = await Promise.all([
    supabase.from("newsletter_subscribers").select("id", { count: "exact", head: true }).eq("confirmed", true).is("unsubscribed_at", null),
    supabase.from("newsletter_subscribers").select("id", { count: "exact", head: true }).gte("confirmed_at", d7),
    supabase.from("newsletter_subscribers").select("id", { count: "exact", head: true }).gte("confirmed_at", d14).lt("confirmed_at", d7),
    supabase.from("newsletter_subscribers").select("id", { count: "exact", head: true }).gte("unsubscribed_at", d7),
    supabase.from("newsletter_subscribers").select("id", { count: "exact", head: true }).eq("confirmed", false).is("unsubscribed_at", null).gte("created_at", d30),
    supabase.from("newsletter_subscribers").select("id", { count: "exact", head: true }).gte("created_at", d30),
    supabase.from("newsletter_subscribers").select("id", { count: "exact", head: true }).gte("created_at", d30).eq("confirmed", true),
    supabase.from("newsletter_drafts").select("id, target_send_date, sent_at, sent_count").eq("status", "sent").order("sent_at", { ascending: false }).limit(1),
    // Pull 14d of local + visitor views to derive weekly session proxies.
    supabase.from("site_events").select("session_id, visitor_class, created_at").eq("kind", "view").eq("is_bot", false).gte("created_at", d14).limit(20000),
    // 30d of outbound business clicks (the referral signal).
    supabase.from("site_events").select("click_type, visitor_class, event_id, created_at").eq("kind", "outbound").eq("is_bot", false).gte("created_at", d30).limit(20000),
    supabase.from("analytics_daily").select("date, pageviews, top_pages, ai_referrals").order("date", { ascending: false }).limit(14),
    supabase.from("seo_snapshots").select("captured_at").order("captured_at", { ascending: false }).limit(1),
    supabase.from("hwy4_orgs").select("id", { count: "exact", head: true }).not("canonical_url", "is", null),
    supabase.from("share_hits").select("src").gte("created_at", d7).limit(20000),
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

  // ── newsletter last-send clicks ─────────────────────────────────────────
  const sendRow = rows(lastSend)[0];
  let sendClicks = 0;
  let topEvents: { slug: string; clicks: number }[] = [];
  if (sendRow?.id) {
    const { data: clickRows } = await supabase
      .from("newsletter_clicks")
      .select("slug")
      .eq("campaign_id", String(sendRow.id))
      .eq("is_bot", false)
      .limit(20000);
    const cr = (clickRows ?? []) as Row[];
    sendClicks = cr.length;
    const bySlug = new Map<string, number>();
    for (const c of cr) {
      const s = String(c.slug ?? "");
      if (s) bySlug.set(s, (bySlug.get(s) ?? 0) + 1);
    }
    topEvents = [...bySlug.entries()]
      .map(([slug, clicks]) => ({ slug, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 5);
  }

  // ── audience proxies from views ─────────────────────────────────────────
  const viewRows = rows(views14);
  const local7 = viewRows.filter((v) => v.visitor_class === "local" && String(v.created_at) >= d7);
  const localPrev7 = viewRows.filter((v) => v.visitor_class === "local" && String(v.created_at) < d7);
  const visitor7 = viewRows.filter((v) => v.visitor_class === "visitor" && String(v.created_at) >= d7);
  const localStats7 = sessionStats(local7);
  const localStatsPrev7 = sessionStats(localPrev7);
  const visitorStats7 = sessionStats(visitor7);

  // ── referrals ───────────────────────────────────────────────────────────
  const outRows = rows(outbound30);
  const out7 = outRows.filter((o) => String(o.created_at) >= d7);
  const byType: Record<string, number> = {};
  let visitorClicks = 0;
  const byEvent = new Map<string, number>();
  for (const o of outRows) {
    const t = String(o.click_type ?? "other");
    byType[t] = (byType[t] ?? 0) + 1;
    if (o.visitor_class === "visitor") visitorClicks++;
    const e = o.event_id ? String(o.event_id) : "";
    if (e) byEvent.set(e, (byEvent.get(e) ?? 0) + 1);
  }
  const topReferralEvents = [...byEvent.entries()]
    .map(([event_id, clicks]) => ({ event_id, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);

  // ── traffic (analytics_daily, newest first) ─────────────────────────────
  const aRows = rows(analytics);
  const pv7 = aRows.slice(0, 7).reduce((s, r) => s + num(r.pageviews), 0);
  const pvPrev7 = aRows.slice(7, 14).reduce((s, r) => s + num(r.pageviews), 0);
  const latestA = aRows[0];
  const topPages = Array.isArray(latestA?.top_pages)
    ? (latestA!.top_pages as Row[]).slice(0, 8).map((p) => ({ key: String(p.key ?? ""), pageviews: num(p.pageviews) }))
    : [];
  const aiReferrals = (latestA?.ai_referrals && typeof latestA.ai_referrals === "object"
    ? (latestA.ai_referrals as Record<string, number>)
    : {});

  // ── seo (latest capture) ────────────────────────────────────────────────
  let seoCaptured: string | null = null;
  let seoTop: GrowthContext["seo"]["top"] = [];
  const latestCap = (rows(seoLatest)[0]?.captured_at as string | undefined) ?? null;
  if (latestCap) {
    seoCaptured = latestCap;
    const { data: seoRows } = await supabase
      .from("seo_snapshots")
      .select("query, clicks, impressions, position")
      .eq("captured_at", latestCap)
      .order("impressions", { ascending: false })
      .limit(10);
    seoTop = ((seoRows ?? []) as Row[]).map((r) => ({
      query: String(r.query ?? ""),
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      position: num(r.position),
    }));
  }

  // ── network virality ────────────────────────────────────────────────────
  const shareBySrc: Record<string, number> = {};
  for (const s of rows(shareHits7)) {
    const k = String(s.src ?? "other");
    shareBySrc[k] = (shareBySrc[k] ?? 0) + 1;
  }

  const created30Count = created30.count ?? 0;
  const confirmRate = created30Count > 0 ? (confirmed30.count ?? 0) / created30Count : null;
  const newConfirmed7 = newConf7.count ?? 0;
  const unsubCount7 = unsub7.count ?? 0;

  const vitals: GrowthVitals = {
    newsletter_active: active.count ?? 0,
    newsletter_net_7d: newConfirmed7 - unsubCount7,
    newsletter_confirm_rate_30d: confirmRate,
    local_sessions_7d: localStats7.distinct,
    local_sessions_prev_7d: localStatsPrev7.distinct,
    business_referrals_7d: out7.length,
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
    newsletter: {
      active: active.count ?? 0,
      new_confirmed_7d: newConfirmed7,
      new_confirmed_prev_7d: newConfPrev7.count ?? 0,
      unsub_7d: unsubCount7,
      pending_unconfirmed: pendingUnconf.count ?? 0,
      confirm_rate_30d: confirmRate,
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
      total_7d: out7.length,
      total_30d: outRows.length,
      by_type: byType,
      visitor_share_30d: outRows.length > 0 ? visitorClicks / outRows.length : null,
      top_events: topReferralEvents,
    },
    traffic: {
      pageviews_7d: pv7,
      pageviews_prev_7d: pvPrev7,
      top_pages: topPages,
      ai_referrals: aiReferrals,
    },
    seo: { captured_at: seoCaptured, top: seoTop },
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
