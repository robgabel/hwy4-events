import Link from "next/link";
import { getAdminClientOrNull } from "@/lib/admin/db";
import type { SearchParams } from "@/lib/admin/flash";
import {
  RANGE_OPTIONS,
  bucketLabel,
  bucketSeries,
  bucketSizeFor,
  parseRange,
  type Bucket,
  type RangeOption,
} from "@/lib/analytics-range";
import type { CountRow } from "@/lib/cloudflare-analytics";
import { getNewsletterStats, type NewsletterStats } from "@/lib/newsletter-stats";
import { getSeoOverview, type SeoOverview } from "@/lib/seo-data";

export const dynamic = "force-dynamic";

// The Growth tab of the admin cockpit: the persisted Cloudflare Web Analytics
// (RUM) history from analytics_daily, written daily by /api/snapshot-analytics.
// Reads the table only (no live Cloudflare calls), so it stays fast and works
// even if the API is down. See PRD-cloudflare-analytics.md.

type DailyRow = {
  date: string;
  pageviews: number;
  visits: number;
  top_pages: CountRow[];
  referrers: CountRow[];
  countries: CountRow[];
  devices: CountRow[];
  ai_referrals: Record<string, number>;
  synced_at: string;
};

// The window is reader-selected (?range=, lib/analytics-range.ts) so months of
// banked history are actually reachable; 30d stays the default view.
const SHORT_WINDOW_DAYS = 7; // the "recent" comparison stat, capped by the range
// Bars in a trend chart before it collapses to weekly buckets.
const MAX_TREND_BARS = 30;

async function loadDaily(days: number): Promise<DailyRow[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase
    .from("analytics_daily")
    .select("date, pageviews, visits, top_pages, referrers, countries, devices, ai_referrals, synced_at")
    .order("date", { ascending: false })
    .limit(days);
  return (data as DailyRow[] | null) ?? [];
}

type NewsletterClicks = {
  campaignDate: string;
  sentCount: number;
  total: number;
  perEvent: { name: string; clicks: number }[];
};

// Per-event clicks for the most recent SENT newsletter, from newsletter_clicks
// (written by the /r/n redirect). Bot-filtered. See PRD-newsletter-click-tracking.md.
async function loadNewsletterClicks(): Promise<NewsletterClicks | null> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return null;

  const { data: draft } = await supabase
    .from("newsletter_drafts")
    .select("id, target_send_date, sent_count")
    .eq("status", "sent")
    .order("target_send_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!draft) return null;

  const { data: clicks } = await supabase
    .from("newsletter_clicks")
    .select("event_id, slug")
    .eq("campaign_id", draft.id)
    .eq("is_bot", false);
  const rows = (clicks as { event_id: string | null; slug: string | null }[] | null) ?? [];

  const counts = new Map<string, { slug: string | null; clicks: number }>();
  for (const r of rows) {
    const key = r.event_id ?? r.slug ?? "unknown";
    const cur = counts.get(key) ?? { slug: r.slug, clicks: 0 };
    cur.clicks++;
    counts.set(key, cur);
  }

  const idKeys = [...counts.keys()].filter((k) => /^[0-9a-f-]{36}$/i.test(k));
  const nameById = new Map<string, string>();
  if (idKeys.length) {
    const { data: evs } = await supabase.from("hwy4_events").select("id, name").in("id", idKeys);
    for (const e of (evs as { id: string; name: string }[] | null) ?? []) nameById.set(e.id, e.name);
  }

  const perEvent = [...counts.entries()]
    .map(([key, v]) => ({ name: nameById.get(key) ?? v.slug ?? "(unknown event)", clicks: v.clicks }))
    .sort((a, b) => b.clicks - a.clicks);

  return {
    campaignDate: draft.target_send_date as string,
    sentCount: (draft.sent_count as number) ?? 0,
    total: rows.length,
    perEvent,
  };
}

// One class tally. "hub" = a regional ISP hub city (lib/geo.ts): hub-routed
// locals + genuine regional visitors, unsplittable, so it is shown on its own
// and sits outside every local/visitor share ratio.
type ClassTally = { local: number; hub: number; visitor: number; unknown: number; total: number };
const zeroTally = (): ClassTally => ({ local: 0, hub: 0, visitor: 0, unknown: 0, total: 0 });
// Coerce an RPC tally; a missing key (the RPC predates a class) reads as 0, never NaN.
const asTally = (t: Partial<ClassTally> | null | undefined): ClassTally => ({
  local: t?.local ?? 0,
  hub: t?.hub ?? 0,
  visitor: t?.visitor ?? 0,
  unknown: t?.unknown ?? 0,
  total: t?.total ?? 0,
});

type Gate0 = {
  views: ClassTally;
  views7: ClassTally;
  outboundTotal: number;
  outboundByType: { type: string; count: number }[];
  topEvents: { name: string; clicks: number }[];
  bySrc: { src: string; count: number }[];
  windowDays: number; // lesser of the selected range or days since tracking began
  windowDays7: number; // lesser of SHORT_WINDOW_DAYS or windowDays
  windowStart: string | null; // ISO of the first event, only when the range outran the history
  requestedDays: number; // the range that was asked for (may exceed the history)
  hasData: boolean;
};

// Gate 0 (BUSINESS-PLAN.md §15): visitor-vs-local pageviews + business-referral
// outbound clicks from site_events (written by /api/track). Service role, human
// signal only (is_bot = false). The two things Cloudflare RUM can't answer.
async function loadGate0(days: number): Promise<Gate0> {
  const empty: Gate0 = {
    views: zeroTally(),
    views7: zeroTally(),
    outboundTotal: 0,
    outboundByType: [],
    topEvents: [],
    bySrc: [],
    windowDays: days,
    windowDays7: Math.min(SHORT_WINDOW_DAYS, days),
    windowStart: null,
    requestedDays: days,
    hasData: false,
  };
  const supabase = getAdminClientOrNull();
  if (!supabase) return empty;

  // Window = the LESSER OF the selected range or the time since first-party
  // visitor tracking began (site_events started 2026-06-08). Anchoring the floor
  // to the earliest row keeps the label honest (a 12mo pick over 79 days of data
  // says "79d", not a fictional 365) and self-corrects as history accrues — no
  // hard-coded launch date to rot.
  const { data: firstRow } = await supabase
    .from("site_events")
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const now = Date.now();
  const fullWindowMs = days * 86400000;
  const firstSeen = firstRow?.created_at
    ? new Date(firstRow.created_at as string).getTime()
    : now - fullWindowMs;
  const sinceMs = Math.max(now - fullWindowMs, firstSeen);
  const windowDays = Math.max(1, Math.ceil((now - sinceMs) / 86400000));
  const windowDays7 = Math.min(SHORT_WINDOW_DAYS, windowDays);
  const since = new Date(sinceMs).toISOString();
  const since7 = new Date(now - windowDays7 * 86400000).toISOString();

  // Aggregate in the DB, not in JS. A PostgREST rowset is capped at ~1,000, so the
  // old "SELECT rows then tally" path silently froze every total at 1,000 once a
  // window held >1,000 views (and the 7d slice, filtered from the truncated set,
  // was undercounted worse). gate0_stats returns a single jsonb value — immune to
  // the row cap and exact at any volume. See migration 20260621_gate0_stats_rpc.sql.
  const { data: statsRaw } = await supabase.rpc("gate0_stats", {
    p_since: since,
    p_since7: since7,
  });
  const stats = (statsRaw ?? {}) as {
    views?: Partial<ClassTally>;
    views7?: Partial<ClassTally>;
    bySrc?: { src: string; count: number }[];
    outboundTotal?: number;
    outboundByType?: { type: string; count: number }[];
    topEvents?: { event_id: string; count: number }[];
  };

  const views = asTally(stats.views);
  const views7 = asTally(stats.views7);
  const outboundTotal = stats.outboundTotal ?? 0;
  const outboundByType = (stats.outboundByType ?? []).filter((t) => t.type);
  const bySrc = stats.bySrc ?? [];

  // Resolve names for the (≤8) top events the RPC ranked.
  const topRaw = stats.topEvents ?? [];
  const topIds = topRaw.map((e) => e.event_id);
  const nameById = new Map<string, string>();
  if (topIds.length) {
    const { data: evs } = await supabase
      .from("hwy4_events")
      .select("id, name")
      .in("id", topIds);
    for (const e of (evs as { id: string; name: string }[] | null) ?? [])
      nameById.set(e.id, e.name);
  }
  const topEvents = topRaw.map((e) => ({
    name: nameById.get(e.event_id) ?? "(event)",
    clicks: e.count,
  }));

  return {
    views,
    views7,
    outboundTotal,
    outboundByType,
    topEvents,
    bySrc,
    windowDays,
    windowDays7,
    windowStart: windowDays < days ? new Date(firstSeen).toISOString() : null,
    requestedDays: days,
    hasData: views.total > 0 || outboundTotal > 0,
  };
}

// --- aggregation (rows are newest-first) ---------------------------------

function sumLast(rows: DailyRow[], n: number) {
  const slice = rows.slice(0, n);
  return {
    pageviews: slice.reduce((a, r) => a + (r.pageviews || 0), 0),
    visits: slice.reduce((a, r) => a + (r.visits || 0), 0),
  };
}

function aggregate(
  rows: DailyRow[],
  field: "top_pages" | "referrers" | "countries" | "devices",
  topN: number
): CountRow[] {
  const map = new Map<string, { pageviews: number; visits: number }>();
  for (const r of rows) {
    for (const item of r[field] ?? []) {
      const cur = map.get(item.key) ?? { pageviews: 0, visits: 0 };
      cur.pageviews += item.pageviews || 0;
      cur.visits += item.visits || 0;
      map.set(item.key, cur);
    }
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.visits - a.visits || b.pageviews - a.pageviews)
    .slice(0, topN);
}

const AI_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  copilot: "Copilot",
  claude: "Claude",
};

function aggregateAi(rows: DailyRow[]): Array<{ key: string; label: string; visits: number }> {
  const out: Record<string, number> = { chatgpt: 0, perplexity: 0, gemini: 0, copilot: 0, claude: 0 };
  for (const r of rows) for (const k of Object.keys(out)) out[k] += r.ai_referrals?.[k] ?? 0;
  return Object.entries(out).map(([key, visits]) => ({ key, label: AI_LABELS[key] ?? key, visits }));
}

const nf = (n: number) => n.toLocaleString("en-US");

// Honest window label: says what the data actually covers, not what was clicked.
// A 12mo pick over 89 days of snapshots reads "89d", never a fictional "365d".
function windowLabel(requested: number, actual: number): string {
  return `${Math.min(requested, Math.max(actual, 0))}d`;
}

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Compact "6/11" for per-bar x-axis labels (stays legible where the full month
// name wouldn't fit under 14 columns).
function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

async function loadNewsletterStats(days: number): Promise<NewsletterStats | null> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return null;
  return getNewsletterStats(supabase, Math.max(60, days));
}

// "Signups vs Visitors" series (PRD-growth-agent.md, Path A). Cloudflare stores
// only UTC daily rollups and can't be re-bucketed, so we re-bucket the newsletter
// series to UTC to match — exact day-for-day alignment, no migration. Each day
// pairs that UTC day's confirmed signups with that UTC day's Cloudflare visits.
type SvvDay = { date: string; visits: number; signups: number };

async function loadSignupsVsVisitors(rows: DailyRow[], days: number): Promise<SvvDay[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const stats = await getNewsletterStats(supabase, days, "UTC");
  const visitsByDate = new Map(rows.map((r) => [r.date, r.visits]));
  return stats.days.map((d) => ({
    date: d.date,
    signups: d.signups,
    visits: visitsByDate.get(d.date) ?? 0,
  }));
}

// Google Search Console overview (lib/seo-data.ts), written daily by
// /api/agent/collect-seo. Null-safe: dormant until the collector has run.
async function loadSeo(): Promise<SeoOverview | null> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return null;
  return getSeoOverview(supabase);
}

export default async function GrowthPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const range = parseRange((await searchParams).range);
  const days = range.days;

  const rows = await loadDaily(days);
  const newsletterClicks = await loadNewsletterClicks();
  const newsletter = await loadNewsletterStats(days);
  const gate0 = await loadGate0(days);
  const svv = await loadSignupsVsVisitors(rows, days);
  const seo = await loadSeo();
  const nlMax = newsletterClicks ? Math.max(1, ...newsletterClicks.perEvent.map((e) => e.clicks)) : 1;
  const hasData = rows.some((r) => r.pageviews > 0);

  // Traffic history is shallower than a long range asks for (the Cloudflare
  // snapshot began 2026-05-28), so every heading below says how many days it
  // ACTUALLY covers rather than the range that was clicked.
  const trafficDays = rows.length;
  const trafficLabel = windowLabel(days, trafficDays);
  const shortDays = Math.min(SHORT_WINDOW_DAYS, Math.max(1, trafficDays));

  const lastShort = sumLast(rows, shortDays);
  const lastFull = sumLast(rows, trafficDays);
  const topPages = aggregate(rows, "top_pages", 12);
  const referrers = aggregate(rows, "referrers", 12);
  const countries = aggregate(rows, "countries", 6);
  const devices = aggregate(rows, "devices", 5);
  const ai = aggregateAi(rows).sort((a, b) => b.visits - a.visits);
  const aiTotal = ai.reduce((a, r) => a + r.visits, 0);
  const lastSynced = rows.map((r) => r.synced_at).filter(Boolean).sort().at(-1);

  const trend = bucketSeries([...rows].reverse(), bucketSizeFor(trafficDays, MAX_TREND_BARS));

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <h1 style={{ color: "#1B3A2D", fontSize: 26, margin: "0 0 4px" }}>Growth</h1>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 8px", lineHeight: 1.5 }}>
        North Star first: who&rsquo;s showing up (local vs visitor) and whether they act (business
        referrals, signups). Newsletter and raw traffic follow.
      </p>
      <RangePicker active={range} />

      {/* North Star — the flywheel metrics (BUSINESS-PLAN): who shows up, whether they act. */}
      <GroupHeader title="North Star" sub="Who shows up, and whether they act. The flywheel." />
      <Gate0Section data={gate0} />
      <SignupsVsVisitorsPanel days={svv} gate0={gate0} label={trafficLabel} />

      {/* Newsletter — the owned retention channel. */}
      {newsletter && newsletter.total_active > 0 && (
        <>
          <GroupHeader title="Newsletter" sub="The owned retention channel." />
          <NewsletterSignupsPanel stats={newsletter} days={days} />
        </>
      )}

      {newsletterClicks && newsletterClicks.perEvent.length > 0 && (
        <>
          <SectionHeader>Newsletter clicks · {fmtDay(newsletterClicks.campaignDate)} send</SectionHeader>
          <section style={cardStyle}>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {newsletterClicks.perEvent.map((e, i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <span style={{ color: "#2d3a22", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.name}
                    </span>
                    <span style={{ color: "#1B3A2D", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{nf(e.clicks)}</span>
                  </div>
                  <div style={{ height: 4, background: "#f0ede8", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((e.clicks / nlMax) * 100)}%`, background: "#9bb87a", borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
            <p style={{ color: "#999", fontSize: 12, lineHeight: 1.5, margin: "12px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 10 }}>
              {nf(newsletterClicks.total)} event-link click{newsletterClicks.total === 1 ? "" : "s"}
              {newsletterClicks.sentCount > 0
                ? ` across ${nf(newsletterClicks.sentCount)} recipients (~${Math.round(
                    (newsletterClicks.total / newsletterClicks.sentCount) * 100
                  )}% clicked an event)`
                : ""}
              . Bot-filtered and directional — email scanners pre-click links, so read it as a relative
              ranking, not a precise count.
            </p>
          </section>
        </>
      )}

      {/* Search — the visitor-acquisition channel (BUSINESS-PLAN: Miguel). */}
      <GroupHeader
        title="Search (Google)"
        sub="What people search to find us, from Search Console — the visitor-acquisition channel. Data lags ~2 days."
      />
      <SearchConsoleSection seo={seo} days={days} />

      {/* Traffic detail — demoted below the metrics that matter. */}
      <GroupHeader
        title="Traffic detail"
        sub="Cloudflare Web Analytics, snapshotted nightly into the site's own history. Privacy-first and cookieless, so a touch lower than ad-tech analytics, but honest."
      />
      {!hasData ? (
        <section style={emptyCardStyle}>
          <p style={{ color: "#1B3A2D", fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            No traffic data yet.
          </p>
          <p style={{ color: "#666", fontSize: 16, margin: 0, lineHeight: 1.5 }}>
            The nightly snapshot runs at 09:00 UTC. Once it has run, daily traffic shows up here.
          </p>
        </section>
      ) : (
        <>
          <StatStrip
            stats={[
              { label: `Pageviews · ${shortDays}d`, value: lastShort.pageviews },
              { label: `Visits · ${shortDays}d`, value: lastShort.visits },
              { label: `Pageviews · ${trafficLabel}`, value: lastFull.pageviews },
              { label: `Visits · ${trafficLabel}`, value: lastFull.visits },
            ]}
          />

          <SectionHeader>
            Visitors {trend[0]?.count > 1 ? "per week" : "per day"} · last {trafficLabel}
          </SectionHeader>
          <DailyTrafficChart buckets={trend} />

          <SectionHeader>Answer-engine referrals · {trafficLabel}</SectionHeader>
          <section style={cardStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
              {ai.map((e) => (
                <div key={e.key} style={{ textAlign: "center", padding: "8px 4px" }}>
                  <p style={{ color: e.visits > 0 ? "#1B3A2D" : "#bbb", fontSize: 24, fontWeight: 700, margin: "0 0 2px" }}>
                    {nf(e.visits)}
                  </p>
                  <p style={{ ...labelStyle, margin: 0 }}>{e.label}</p>
                </div>
              ))}
            </div>
            <p style={{ color: "#999", fontSize: 14, lineHeight: 1.5, margin: "12px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 10 }}>
              {aiTotal > 0
                ? `${nf(aiTotal)} visits referred from answer engines in the last ${trafficLabel.replace("d", " days")}. `
                : "No answer-engine referrals captured yet. "}
              This is a lower bound: Google AI Overviews show up as <code>google.com</code> and many
              AI clickthroughs arrive with no referrer. Pair it with the monthly prompt audit in
              AEO-SEO-MEASUREMENT.md.
            </p>
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginTop: 4 }}>
            <RankedList title={`Top pages · ${trafficLabel}`} rows={topPages} kind="page" />
            <RankedList title={`Top referrers · ${trafficLabel}`} rows={referrers} kind="referrer" />
          </div>

          <SectionHeader>Audience · {trafficLabel}</SectionHeader>
          <p style={{ color: "#aaa", fontSize: 13, margin: "0 0 12px", lineHeight: 1.5 }}>
            Low-signal for a single-corridor site — kept for completeness, not a metric to steer by.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16 }}>
            <RankedList title={`Countries · ${trafficLabel}`} rows={countries} kind="plain" />
            <RankedList title={`Devices · ${trafficLabel}`} rows={devices} kind="plain" />
          </div>

          <p style={{ color: "#aaa", fontSize: 14, margin: "28px 0 0", lineHeight: 1.5 }}>
            Source: Cloudflare Web Analytics (RUM){lastSynced ? ` · snapshot updated ${new Date(lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.
            Google search performance is in the <strong>Search (Google)</strong> section above.
          </p>
        </>
      )}

    </div>
  );
}

// --- presentational ------------------------------------------------------

const CLICK_LABELS: Record<string, string> = {
  more_info: "“More info” CTA",
  directions: "Get Directions",
  venue_website: "Venue website",
  venue_phone: "Venue phone",
  venue_maps: "Venue rating / Maps",
};

const pct = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E7E0D5", borderRadius: 10, padding: "12px 14px" }}>
      <p style={{ ...labelStyle, margin: "0 0 4px" }}>{label}</p>
      <p style={{ color: "#1B3A2D", fontSize: 24, fontWeight: 700, margin: 0 }}>{value}</p>
      {sub && <p style={{ color: "#999", fontSize: 12, margin: "2px 0 0" }}>{sub}</p>}
    </div>
  );
}

// Traffic bars: visitors (Cloudflare "visits" ≈ unique sessions) as the hero,
// with the count printed above each so the numbers are readable without a
// tooltip. Pageviews ride along as a pale ghost bar behind, scaled to the same
// max so the ghost always caps the visits bar. HTML (not SVG) so the value
// labels stay a fixed pixel size and don't shrink to nothing on a phone.
//
// Takes BUCKETS, not raw days: a 6-month range is 182 days, which as 182 bars
// is an unreadable smear, so lib/analytics-range.ts collapses long ranges into
// whole weeks. A bucket of one day renders exactly as the old per-day chart did.
function DailyTrafficChart({ buckets }: { buckets: Bucket<DailyRow>[] }) {
  if (buckets.length === 0) return null;
  const totals = buckets.map((b) => ({
    key: b.start,
    label: bucketLabel(b, shortDay),
    span: b.start === b.end ? fmtDay(b.start) : `${fmtDay(b.start)} – ${fmtDay(b.end)}`,
    days: b.count,
    visits: b.rows.reduce((a, r) => a + (r.visits || 0), 0),
    pageviews: b.rows.reduce((a, r) => a + (r.pageviews || 0), 0),
  }));
  const weekly = buckets[0].count > 1;
  const max = Math.max(1, ...totals.map((t) => Math.max(t.pageviews, t.visits)));
  const peak = Math.max(0, ...totals.map((t) => t.visits));
  // Above ~20 columns the per-bar numbers collide; drop them and let the
  // tooltip carry the exact counts rather than printing an illegible row.
  const showValues = totals.length <= 20;
  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", gap: 18, marginBottom: 14, fontSize: 13, color: "#666", flexWrap: "wrap" }}>
        <span>
          <span style={{ display: "inline-block", width: 11, height: 11, background: "#1B3A2D", borderRadius: 2, marginRight: 6, verticalAlign: "middle" }} />
          Visitors (visits)
        </span>
        <span>
          <span style={{ display: "inline-block", width: 11, height: 11, background: "#e7dcc2", borderRadius: 2, marginRight: 6, verticalAlign: "middle" }} />
          Pageviews
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "stretch", gap: "1.6%", height: 156 }}>
        {totals.map((t) => {
          const vh = Math.round((t.visits / max) * 100);
          const ph = Math.round((t.pageviews / max) * 100);
          return (
            <div
              key={t.key}
              title={`${t.span}: ${nf(t.visits)} visitors · ${nf(t.pageviews)} pageviews${t.days > 1 ? ` (${t.days} days)` : ""}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}
            >
              {showValues && (
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1B3A2D", lineHeight: 1, marginBottom: 4 }}>{nf(t.visits)}</span>
              )}
              <div style={{ position: "relative", width: "100%", flex: 1, minHeight: 0 }}>
                <div style={{ position: "absolute", bottom: 0, left: "15%", width: "70%", height: `${ph}%`, background: "#e7dcc2", borderRadius: "3px 3px 0 0" }} />
                <div style={{ position: "absolute", bottom: 0, left: "15%", width: "70%", height: `${vh}%`, minHeight: t.visits > 0 ? 3 : 0, background: "#1B3A2D", borderRadius: "3px 3px 0 0" }} />
              </div>
              <span style={{ fontSize: 10, color: "#aaa", lineHeight: 1, marginTop: 5, whiteSpace: "nowrap" }}>{t.label}</span>
            </div>
          );
        })}
      </div>
      <p style={{ color: "#999", fontSize: 13, lineHeight: 1.5, margin: "14px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 10 }}>
        Each bar is {weekly ? <>one <strong>week</strong> of</> : <>one <strong>day</strong> of</>}{" "}
        <strong>visitors</strong> (Cloudflare visits, roughly unique sessions); the pale bar behind is{" "}
        <strong>pageviews</strong>. Peak {weekly ? "week" : "day"}: {nf(peak)} visitors. Hover a bar for
        both counts{weekly ? " and the dates it spans" : ""}.
        {weekly ? " The oldest bar may be a part-week." : ""}
      </p>
    </section>
  );
}

// Local / Hub / Visitor / Unknown breakout: a stacked share bar plus labeled,
// counted rows. One component so the site-visitor split (Gate 0) and the
// newsletter-list split read identically. "Visitor" means remote
// (out-of-corridor) traffic; "Regional hub" is an ISP hub city that mixes
// hub-routed locals with real visitors and can't be called either.
const HUB_COLOR = "#8a9a5b";
function VisitorBreakdown({ local, hub, visitor, unknown }: { local: number; hub: number; visitor: number; unknown: number }) {
  const total = Math.max(1, local + hub + visitor + unknown);
  const segs = [
    { key: "local", label: "Local", value: local, color: "#1B3A2D" },
    { key: "hub", label: "Regional hub (unsplittable)", value: hub, color: HUB_COLOR },
    { key: "visitor", label: "Visitor (remote)", value: visitor, color: "#5a8fa8" },
    { key: "unknown", label: "Unknown", value: unknown, color: "#c9c2b6" },
  ];
  return (
    <div>
      <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", marginBottom: 12, background: "#f0ede8" }}>
        {segs.map((s) =>
          s.value > 0 ? (
            <div key={s.key} title={`${s.label}: ${nf(s.value)}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
          ) : null
        )}
      </div>
      {segs.map((s) => (
        <div key={s.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, color: "#2d3a22", marginBottom: 6 }}>
          <span>
            <span style={{ display: "inline-block", width: 10, height: 10, background: s.color, borderRadius: 2, marginRight: 8 }} />
            {s.label}
          </span>
          <span style={{ fontWeight: 600 }}>
            {nf(s.value)} · {Math.round((s.value / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function Gate0Section({ data }: { data: Gate0 }) {
  if (!data.hasData) {
    return (
      <>
        <SectionHeader>Visitor vs local · business referrals</SectionHeader>
        <section style={cardStyle}>
          <p style={{ color: "#666", fontSize: 15, margin: 0, lineHeight: 1.5 }}>
            Gate 0 instrumentation is live. Once visitors start landing and tapping through to
            businesses, the visitor-vs-local split and business-referral clicks show up here.
          </p>
        </section>
      </>
    );
  }
  const v = data.views;
  const v7 = data.views7;
  // "Callable" = local + visitor. Hub-city sessions are located but can't be
  // called either (lib/geo.ts), so they sit outside every share ratio.
  const callable30 = v.local + v.visitor;
  const callable7 = v7.local + v7.visitor;
  const located30 = callable30 + v.hub;
  const clickMax = Math.max(1, ...data.topEvents.map((e) => e.clicks));
  const srcMax = Math.max(1, ...data.bySrc.map((s) => s.count));
  const { windowDays, windowDays7, requestedDays } = data;
  const startStr = data.windowStart
    ? new Date(data.windowStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  return (
    <>
      <SectionHeader>Visitor vs local · {windowDays}d</SectionHeader>
      <section style={cardStyle}>
        <VisitorBreakdown local={v.local} hub={v.hub} visitor={v.visitor} unknown={v.unknown} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 16 }}>
          <Stat label={`Located views · ${windowDays}d`} value={nf(located30)} sub={`${nf(v.local)} local · ${nf(v.hub)} hub · ${nf(v.visitor)} remote`} />
          <Stat label={`Visitor share · ${windowDays7}d`} value={`${pct(v7.visitor, callable7)}%`} sub={`${nf(v7.visitor)} of ${nf(callable7)} callable · hub excluded`} />
          <Stat label={`Regional hub · ${windowDays}d`} value={nf(v.hub)} sub="can't be called either" />
          <Stat label={`Total views · ${windowDays}d`} value={nf(v.total)} sub={`incl. ${nf(v.unknown)} unknown geo`} />
        </div>
        <p style={{ color: "#999", fontSize: 13, lineHeight: 1.5, margin: "12px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 10 }}>
          {startStr ? (
            <>
              <strong>Full history so far:</strong> first-party visitor tracking began {startStr} (
              {windowDays} {windowDays === 1 ? "day" : "days"} ago), so this is the whole window, not
              the full {requestedDays} days the range asks for.{" "}
            </>
          ) : null}
          Directional. Location is coarse IP geolocation (Vercel edge). Rural ISPs route many
          residents through a regional hub city, and a hub IP is a mix of hub-routed locals and
          genuine regional visitors that nothing in the IP can split, so those sessions are counted
          as <strong>Regional hub</strong>, apart from both, and sit outside every share ratio.
          Locals are still undercounted (a hub-routed resident is invisible as a local). Read the
          trend, not the absolute. Bots that don&rsquo;t run JS never appear here.
        </p>
      </section>

      <SectionHeader>Business referrals · {windowDays}d</SectionHeader>
      <section style={cardStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: data.topEvents.length ? 16 : 0 }}>
          <Stat label={`Outbound clicks · ${windowDays}d`} value={nf(data.outboundTotal)} />
          {data.outboundByType.map((t) => (
            <Stat key={t.type} label={CLICK_LABELS[t.type] ?? t.type} value={nf(t.count)} />
          ))}
        </div>
        {data.topEvents.length > 0 && (
          <>
            <p style={{ ...labelStyle, margin: "4px 0 10px" }}>Top events by business clicks</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {data.topEvents.map((e, i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <span style={{ color: "#2d3a22", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                    <span style={{ color: "#1B3A2D", fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{nf(e.clicks)}</span>
                  </div>
                  <div style={{ height: 4, background: "#f0ede8", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((e.clicks / clickMax) * 100)}%`, background: "#9bb87a", borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <p style={{ color: "#999", fontSize: 13, lineHeight: 1.5, margin: "12px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 10 }}>
          Clicks from an event page toward a business: the &ldquo;More info&rdquo; link, Get Directions, and a
          venue&rsquo;s website/phone. The closest proxy we have for &ldquo;Hwy4Events sent someone toward local
          spend&rdquo; (the economic flywheel). Directional, not exact attribution.
        </p>
      </section>

      {data.bySrc.length > 0 && (
        <>
          <SectionHeader>Arrival channels · {windowDays}d</SectionHeader>
          <section style={cardStyle}>
            <p style={{ ...labelStyle, margin: "0 0 10px" }}>Page views by first-touch channel</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {data.bySrc.map((s) => (
                <div key={s.src}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <span style={{ color: "#2d3a22", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.src}</span>
                    <span style={{ color: "#1B3A2D", fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{nf(s.count)}</span>
                  </div>
                  <div style={{ height: 4, background: "#f0ede8", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((s.count / srcMax) * 100)}%`, background: "#9bb87a", borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
            <p style={{ color: "#999", fontSize: 13, lineHeight: 1.5, margin: "12px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 10 }}>
              How sessions first arrived: <code>qr</code> / <code>share</code> / <code>host</code> / <code>newsletter</code> come from the <code>?src</code> tag, <code>ref:*</code> is an external referrer, <code>direct</code> is untagged. First-touch per session.
            </p>
          </section>
        </>
      )}
    </>
  );
}

function SignupsVsVisitorsPanel({
  days,
  gate0,
  label,
}: {
  days: SvvDay[];
  gate0: Gate0;
  label: string;
}) {
  const totalVisits = days.reduce((a, d) => a + d.visits, 0);
  const totalSignups = days.reduce((a, d) => a + d.signups, 0);
  // Needs visits to correlate against; the standalone signups panel covers the
  // signups-only case.
  if (days.length === 0 || totalVisits === 0) return null;

  const W = 720;
  const H = 140;
  const padX = 6;
  const padTop = 10;
  const padBot = 4;
  const plotH = H - padTop - padBot;
  const n = days.length;
  const step = (W - padX * 2) / n;
  const barW = Math.max(1.5, step * 0.6);
  const maxV = Math.max(1, ...days.map((d) => d.visits));
  const maxS = Math.max(1, ...days.map((d) => d.signups));
  const cx = (i: number) => padX + step * (i + 0.5);

  const signupLine = days
    .map((d, i) => `${cx(i).toFixed(1)},${(padTop + plotH - (d.signups / maxS) * plotH).toFixed(1)}`)
    .join(" ");

  const conv = totalSignups / totalVisits;

  // 7-day rolling visit->signup rate (the conversion line).
  const rolling = days.map((_, i) => {
    let s = 0;
    let v = 0;
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      s += days[j].signups;
      v += days[j].visits;
    }
    return v > 0 ? s / v : 0;
  });
  const maxRoll = Math.max(0.0001, ...rolling);
  const RH = 54;
  const rPad = 6;
  const rPlotH = RH - rPad * 2;
  const rollLine = rolling
    .map((r, i) => `${cx(i).toFixed(1)},${(rPad + rPlotH - (r / maxRoll) * rPlotH).toFixed(1)}`)
    .join(" ");
  const latestRoll = rolling[rolling.length - 1] ?? 0;

  const vw = gate0.views;
  // Local share is taken over the callable sessions (local + visitor); hub-city
  // sessions can't be called either, so they are shown but never in the ratio.
  const callable = vw.local + vw.visitor;
  const splitTotal = Math.max(1, vw.local + vw.hub + vw.visitor + vw.unknown);
  const split = [
    { key: "local", label: "Local", value: vw.local, color: "#1B3A2D" },
    { key: "hub", label: "Regional hub", value: vw.hub, color: HUB_COLOR },
    { key: "visitor", label: "Visitor", value: vw.visitor, color: "#5a8fa8" },
    { key: "unknown", label: "Unknown", value: vw.unknown, color: "#c9c2b6" },
  ];

  const convStr = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 2 : 1)}%`;

  return (
    <>
      <SectionHeader>Signups vs visitors · {label} (UTC-aligned)</SectionHeader>
      <section style={cardStyle}>
        <div style={{ display: "flex", gap: 18, marginBottom: 12, fontSize: 13, color: "#666", flexWrap: "wrap" }}>
          <span>
            <span style={{ display: "inline-block", width: 11, height: 11, background: "#d4e2c8", borderRadius: 2, marginRight: 6, verticalAlign: "middle" }} />
            Visits (Cloudflare)
          </span>
          <span>
            <span style={{ display: "inline-block", width: 15, height: 3, background: "#1B3A2D", borderRadius: 2, marginRight: 6, verticalAlign: "middle" }} />
            Confirmed signups
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Daily visits and confirmed signups, UTC-aligned">
          {days.map((d, i) => {
            const h = (d.visits / maxV) * plotH;
            return (
              <rect
                key={d.date}
                x={(cx(i) - barW / 2).toFixed(1)}
                y={(padTop + plotH - h).toFixed(1)}
                width={barW.toFixed(1)}
                height={Math.max(0, h).toFixed(1)}
                fill="#d4e2c8"
                rx="1"
              >
                <title>{`${fmtDay(d.date)} (UTC): ${nf(d.visits)} visits · ${d.signups} signup${d.signups === 1 ? "" : "s"}`}</title>
              </rect>
            );
          })}
          <polyline points={signupLine} fill="none" stroke="#1B3A2D" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <span style={axisStyle}>{fmtDay(days[0].date)} (UTC)</span>
          <span style={axisStyle}>{fmtDay(days[n - 1].date)}</span>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 4 }}>
        <Stat label={`Visits · ${label} (UTC)`} value={nf(totalVisits)} />
        <Stat label={`Signups · ${label} (UTC)`} value={nf(totalSignups)} />
        <Stat label={`Visit→signup · ${label}`} value={convStr(conv)} sub={`${nf(totalSignups)} ÷ ${nf(totalVisits)}`} />
        <Stat label="Local share of visits" value={callable ? `${pct(vw.local, callable)}%` : "—"} sub={`${gate0.windowDays}d · of callable, hub excluded · directional`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
        <section style={cardStyle}>
          <p style={{ ...labelStyle, margin: "0 0 8px" }}>
            7-day rolling visit→signup rate · latest {convStr(latestRoll)}
          </p>
          <svg viewBox={`0 0 ${W} ${RH}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Seven-day rolling conversion rate">
            <polyline points={rollLine} fill="none" stroke="#c4922a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </section>

        <section style={cardStyle}>
          <p style={{ ...labelStyle, margin: "0 0 10px" }}>Of those visits · who · {gate0.windowDays}d (directional)</p>
          <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
            {split.map((s) => (
              <div key={s.key} title={`${s.label}: ${nf(s.value)}`} style={{ width: `${(s.value / splitTotal) * 100}%`, background: s.color }} />
            ))}
          </div>
          {split.map((s) => (
            <div key={s.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#2d3a22", marginBottom: 3 }}>
              <span>
                <span style={{ display: "inline-block", width: 9, height: 9, background: s.color, borderRadius: 2, marginRight: 6 }} />
                {s.label}
              </span>
              <span style={{ fontWeight: 600 }}>
                {nf(s.value)} · {Math.round((s.value / splitTotal) * 100)}%
              </span>
            </div>
          ))}
        </section>
      </div>

      <p style={{ color: "#999", fontSize: 13, lineHeight: 1.5, margin: "12px 0 0" }}>
        Both series bucketed by <strong>UTC day</strong> so they line up exactly (Cloudflare stores
        only UTC rollups and can&rsquo;t be re-bucketed). Visits are the Cloudflare denominator
        (mature, months of history); the local/visitor split is the first-party beacon
        (<code>site_events</code>) and is the <strong>directional</strong> cut only, not the absolute
        total yet. The two sources aren&rsquo;t calibrated against each other until
        <code>site_events</code> banks a clean week or two. Day-boundary alignment is directional, not
        exact same-day attribution.
      </p>
    </>
  );
}

function NewsletterSignupsPanel({ stats, days }: { stats: NewsletterStats; days: number }) {
  const trend = stats.days.slice(-Math.max(45, days)); // chronological (oldest -> newest)
  const trendMax = Math.max(1, ...trend.map((d) => d.signups));
  const comp = stats.by_class;
  const sources = Object.entries(stats.by_source)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const srcMax = Math.max(1, ...sources.map((s) => s.count));

  return (
    <>
      <SectionHeader>Newsletter signups</SectionHeader>
      <StatStrip
        stats={[
          { label: "Subscribers", value: stats.total_active },
          { label: "Net · 7d", value: stats.net_7d },
          { label: "Net · 30d", value: stats.net_30d },
          { label: "Confirm % · 30d", value: Math.round((stats.confirm_rate_30d ?? 0) * 100) },
        ]}
      />

      <section style={cardStyle}>
        <p style={{ ...labelStyle, margin: "0 0 8px" }}>Confirmed signups · last {trend.length} days</p>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
          {trend.map((d) => (
            <div
              key={d.date}
              title={`${fmtDay(d.date)}: ${d.signups} signup${d.signups === 1 ? "" : "s"} (total ${d.cumulative_active})`}
              style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}
            >
              <div
                style={{
                  height: `${Math.round((d.signups / trendMax) * 100)}%`,
                  minHeight: d.signups > 0 ? 3 : 0,
                  background: "#9bb87a",
                  borderRadius: "3px 3px 0 0",
                  opacity: d.signups > 0 ? 1 : 0.15,
                }}
              />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <span style={axisStyle}>{trend.length ? fmtDay(trend[0].date) : ""}</span>
          <span style={axisStyle}>{trend.length ? fmtDay(trend[trend.length - 1].date) : ""}</span>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
        <section style={cardStyle}>
          <p style={{ ...labelStyle, margin: "0 0 10px" }}>Who the list is</p>
          <VisitorBreakdown local={comp.local} hub={comp.hub} visitor={comp.visitor} unknown={comp.unknown} />
          <p style={{ color: "#999", fontSize: 12, lineHeight: 1.5, margin: "10px 0 0" }}>
            Classified at signup from coarse IP geo. Directional: a visitor signing up from inside a
            rental reads as local, and a signup routed through a regional ISP hub city reads as
            hub, which can&rsquo;t be called either.
          </p>
        </section>

        <section style={cardStyle}>
          <p style={{ ...labelStyle, margin: "0 0 10px" }}>Where signups come from</p>
          {sources.length === 0 ? (
            <p style={{ color: "#999", fontSize: 13 }}>No source tags yet.</p>
          ) : (
            sources.map((s) => (
              <div key={s.key} style={{ marginBottom: 7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#2d3a22" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.key}</span>
                  <span style={{ fontWeight: 600 }}>{nf(s.count)}</span>
                </div>
                <div style={{ height: 4, background: "#f0ede8", borderRadius: 2, marginTop: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round((s.count / srcMax) * 100)}%`, background: "#9bb87a" }} />
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </>
  );
}

function StatStrip({ stats }: { stats: Array<{ label: string; value: number }> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 4 }}>
      {stats.map((s) => (
        <div key={s.label} style={{ background: "#fff", border: "1px solid #E7E0D5", borderRadius: 10, padding: "12px 14px" }}>
          <p style={{ ...labelStyle, margin: "0 0 4px" }}>{s.label}</p>
          <p style={{ color: "#1B3A2D", fontSize: 24, fontWeight: 700, margin: 0 }}>{nf(s.value)}</p>
        </div>
      ))}
    </div>
  );
}

function RankedList({ title, rows, kind }: { title: string; rows: CountRow[]; kind: "page" | "referrer" | "plain" }) {
  const max = Math.max(1, ...rows.map((r) => r.visits));
  return (
    <section style={cardStyle}>
      <p style={{ ...labelStyle, margin: "0 0 12px" }}>{title}</p>
      {rows.length === 0 ? (
        <p style={{ color: "#aaa", fontSize: 15, margin: 0 }}>No data.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {rows.map((r) => {
            const display =
              kind === "referrer" ? r.key || "(direct)" : kind === "page" ? r.key || "/" : r.key || "—";
            return (
              <div key={r.key || "_"}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <span style={{ color: "#2d3a22", fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {display}
                  </span>
                  <span style={{ color: "#1B3A2D", fontSize: 15, fontWeight: 600, flexShrink: 0 }}>
                    {nf(r.visits)}
                  </span>
                </div>
                <div style={{ height: 4, background: "#f0ede8", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round((r.visits / max) * 100)}%`, background: "#9bb87a", borderRadius: 2 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Google Search Console — top-of-funnel demand. Ordered by what steers action:
// the striking-distance opportunities first (the highest-leverage SEO work),
// then queries, pages, and the clicks trend. Data via lib/seo-data.ts.
function SearchConsoleSection({ seo, days }: { seo: SeoOverview | null; days: number }) {
  if (!seo || !seo.hasData) {
    return (
      <section style={emptyCardStyle}>
        <p style={{ color: "#1B3A2D", fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
          No Search Console data yet.
        </p>
        <p style={{ color: "#666", fontSize: 16, margin: 0, lineHeight: 1.5 }}>
          The collector runs daily at 11:00 UTC once <code>GOOGLE_SEARCH_CONSOLE_SA_JSON</code> is
          set in Vercel. Data appears here within a day of the first run.
        </p>
      </section>
    );
  }

  const { totals, mom, striking, topQueries, topPages, trend } = seo;
  const pctSub = (d: number | null) =>
    d === null ? undefined : `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}% vs prior 28d`;
  const posSub = (d: number | null) =>
    d === null ? undefined : d <= 0 ? `▲ ${Math.abs(d)} better vs prior` : `▼ ${d} worse vs prior`;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <Stat label="Clicks · 28d" value={nf(totals.clicks)} sub={mom ? pctSub(mom.clicksDeltaPct) : undefined} />
        <Stat label="Impressions · 28d" value={nf(totals.impressions)} sub={mom ? pctSub(mom.impressionsDeltaPct) : undefined} />
        <Stat label="Avg CTR" value={`${(totals.ctr * 100).toFixed(1)}%`} />
        <Stat label="Avg position" value={totals.avgPosition ? totals.avgPosition.toFixed(1) : "—"} sub={mom ? posSub(mom.positionDelta) : undefined} />
      </div>

      <SectionHeader>Striking distance · biggest SEO upside</SectionHeader>
      {striking.length === 0 ? (
        <section style={cardStyle}>
          <p style={{ color: "#888", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            No page-1/2 fringe queries with real impressions yet. As the site earns rankings,
            queries sitting at position 4–20 show up here — the ones a small content tweak converts.
          </p>
        </section>
      ) : (
        <section style={cardStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {striking.map((q, i) => {
              const max = Math.max(1, ...striking.map((s) => s.potential));
              return (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <span style={{ color: "#2d3a22", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {q.query}
                    </span>
                    <span style={{ color: "#888", fontSize: 12, flexShrink: 0, whiteSpace: "nowrap" }}>
                      pos {q.position.toFixed(1)} · {nf(q.impressions)} impr · {nf(q.clicks)} clicks
                    </span>
                  </div>
                  <div style={{ height: 5, background: "#f0ede8", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((q.potential / max) * 100)}%`, background: "#c98a3a", borderRadius: 2 }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ color: "#999", fontSize: 13, lineHeight: 1.5, margin: "12px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 10 }}>
            Queries ranking on the back of page 1 or top of page 2 with real impressions. The bar is
            un-captured impressions — the clicks a rank nudge would unlock. Highest bar = write/improve
            that page first.
          </p>
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginTop: 20 }}>
        <SeoRankTable title="Top queries · 28d" rows={topQueries.map((q) => ({ label: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position }))} />
        <SeoRankTable title="Top pages · 28d" rows={topPages.map((p) => ({ label: p.page, clicks: p.clicks, impressions: p.impressions, position: p.position }))} />
      </div>

      {trend.length > 1 &&
        (() => {
          const points = trend.slice(-days);
          const buckets = bucketSeries(points, bucketSizeFor(points.length, MAX_TREND_BARS));
          const per = buckets[0]?.count > 1 ? "week" : "day";
          return (
            <>
              <SectionHeader>
                Clicks per {per}
                {points.length ? ` · ${shortDay(points[0].date)}–${shortDay(points[points.length - 1].date)}` : ""}
              </SectionHeader>
              <SeoTrendChart buckets={buckets} />
            </>
          );
        })()}
    </>
  );
}

function SeoRankTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; clicks: number; impressions: number; position: number }[];
}) {
  return (
    <section style={cardStyle}>
      <h3 style={{ ...labelStyle, margin: "0 0 12px", fontSize: 13 }}>{title}</h3>
      {rows.length === 0 ? (
        <p style={{ color: "#aaa", fontSize: 14, margin: 0 }}>No data yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <span style={{ color: "#2d3a22", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.label || "—"}
              </span>
              <span style={{ color: "#888", fontSize: 12, flexShrink: 0, whiteSpace: "nowrap" }}>
                <strong style={{ color: "#1B3A2D" }}>{nf(r.clicks)}</strong> · {nf(r.impressions)} impr · pos {r.position.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Clicks bars with an impressions ghost behind, mirroring DailyTrafficChart's
// HTML-bar + bucketing approach so labels stay legible on mobile and a long
// range collapses to weeks instead of a 365-column smear.
function SeoTrendChart({ buckets }: { buckets: Bucket<{ date: string; clicks: number; impressions: number }>[] }) {
  if (buckets.length === 0) return null;
  const points = buckets.map((b) => ({
    key: b.start,
    label: bucketLabel(b, shortDay),
    span: b.start === b.end ? fmtDay(b.start) : `${fmtDay(b.start)} – ${fmtDay(b.end)}`,
    clicks: b.rows.reduce((a, r) => a + r.clicks, 0),
    impressions: b.rows.reduce((a, r) => a + r.impressions, 0),
  }));
  const weekly = buckets[0].count > 1;
  const maxClicks = Math.max(1, ...points.map((p) => p.clicks));
  const maxImpr = Math.max(1, ...points.map((p) => p.impressions));
  const showValues = points.length <= 20;
  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 130 }}>
        {points.map((p) => (
          <div key={p.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            {showValues && (
              <span style={{ fontSize: 11, color: "#1B3A2D", fontWeight: 600, marginBottom: 2 }}>{p.clicks || ""}</span>
            )}
            <div
              title={`${p.span}: ${nf(p.clicks)} clicks · ${nf(p.impressions)} impressions`}
              style={{ width: "100%", position: "relative", display: "flex", justifyContent: "center", alignItems: "flex-end", height: "100%" }}
            >
              <div style={{ position: "absolute", bottom: 0, width: "100%", height: `${Math.round((p.impressions / maxImpr) * 100)}%`, background: "#eef0e6", borderRadius: 3 }} />
              <div style={{ position: "relative", width: "62%", height: `${Math.round((p.clicks / maxClicks) * 100)}%`, background: "#9bb87a", borderRadius: 3, minHeight: p.clicks > 0 ? 2 : 0 }} />
            </div>
            <span style={{ ...axisStyle, marginTop: 4, whiteSpace: "nowrap" }}>{p.label}</span>
          </div>
        ))}
      </div>
      <p style={{ color: "#999", fontSize: 12, margin: "10px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 8 }}>
        Green bar = clicks{weekly ? " per week" : ""}; pale ghost = impressions (scaled independently).
        Google finalizes each day ~2 days late.{weekly ? " The oldest bar may be a part-week." : ""}
      </p>
    </section>
  );
}

// Server-rendered segmented control — plain links, no client JS, so the page
// stays a server component and a chosen range is shareable/bookmarkable.
function RangePicker({ active }: { active: RangeOption }) {
  return (
    <div
      role="group"
      aria-label="Date range"
      style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", margin: "0 0 6px" }}
    >
      <span style={{ ...labelStyle, marginRight: 6 }}>Range</span>
      {RANGE_OPTIONS.map((o) => {
        const on = o.key === active.key;
        return (
          <Link
            key={o.key}
            href={`/admin/analytics?range=${o.key}`}
            aria-current={on ? "true" : undefined}
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              border: `1px solid ${on ? "#1B3A2D" : "#E7E0D5"}`,
              background: on ? "#1B3A2D" : "#fff",
              color: on ? "#fff" : "#2d3a22",
              fontSize: 13,
              fontWeight: on ? 700 : 500,
              textDecoration: "none",
            }}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: "#1B3A2D", fontSize: 15, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", margin: "28px 0 12px" }}>
      {children}
    </h2>
  );
}

// Group divider — one level above SectionHeader. Establishes the page's priority
// spine: North Star → Newsletter → Traffic detail.
function GroupHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ margin: "34px 0 16px", paddingBottom: 8, borderBottom: "2px solid #1B3A2D" }}>
      <h2 style={{ color: "#1B3A2D", fontSize: 19, fontWeight: 700, margin: 0 }}>{title}</h2>
      {sub && <p style={{ color: "#888", fontSize: 13, margin: "3px 0 0", lineHeight: 1.4 }}>{sub}</p>}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E7E0D5",
  borderRadius: 12,
  padding: 18,
};

const emptyCardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E7E0D5",
  borderRadius: 12,
  padding: 32,
  textAlign: "center",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#888",
};

const axisStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#aaa",
};
