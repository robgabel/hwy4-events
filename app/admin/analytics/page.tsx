import { createClient } from "@supabase/supabase-js";
import type { CountRow } from "@/lib/cloudflare-analytics";

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
  browsers: CountRow[];
  ai_referrals: Record<string, number>;
  synced_at: string;
};

const WINDOW_DAYS = 30;
const TREND_DAYS = 14;

async function loadDaily(): Promise<DailyRow[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from("analytics_daily")
    .select("date, pageviews, visits, top_pages, referrers, countries, devices, browsers, ai_referrals, synced_at")
    .order("date", { ascending: false })
    .limit(WINDOW_DAYS);
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  const supabase = createClient(supabaseUrl, serviceKey);

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

type Gate0 = {
  views: { local: number; visitor: number; unknown: number; total: number };
  views7: { local: number; visitor: number; unknown: number; total: number };
  outboundTotal: number;
  outboundByType: { type: string; count: number }[];
  topEvents: { name: string; clicks: number }[];
  hasData: boolean;
};

// Gate 0 (BUSINESS-PLAN.md §15): visitor-vs-local pageviews + business-referral
// outbound clicks from site_events (written by /api/track). Service role, human
// signal only (is_bot = false). The two things Cloudflare RUM can't answer.
async function loadGate0(): Promise<Gate0> {
  const empty: Gate0 = {
    views: { local: 0, visitor: 0, unknown: 0, total: 0 },
    views7: { local: 0, visitor: 0, unknown: 0, total: 0 },
    outboundTotal: 0,
    outboundByType: [],
    topEvents: [],
    hasData: false,
  };
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return empty;
  const supabase = createClient(supabaseUrl, serviceKey);

  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: viewsData } = await supabase
    .from("site_events")
    .select("visitor_class, created_at")
    .eq("kind", "view")
    .eq("is_bot", false)
    .gte("created_at", since30);
  const { data: clicksData } = await supabase
    .from("site_events")
    .select("click_type, event_id, created_at")
    .eq("kind", "outbound")
    .eq("is_bot", false)
    .gte("created_at", since30);

  const vrows =
    (viewsData as { visitor_class: string; created_at: string }[] | null) ?? [];
  const crows =
    (clicksData as
      | { click_type: string | null; event_id: string | null; created_at: string }[]
      | null) ?? [];

  const tally = (rows: { visitor_class: string }[]) => {
    const t = { local: 0, visitor: 0, unknown: 0, total: 0 };
    for (const r of rows) {
      if (r.visitor_class === "local") t.local++;
      else if (r.visitor_class === "visitor") t.visitor++;
      else t.unknown++;
      t.total++;
    }
    return t;
  };

  const typeCounts = new Map<string, number>();
  const eventCounts = new Map<string, number>();
  for (const r of crows) {
    if (r.click_type)
      typeCounts.set(r.click_type, (typeCounts.get(r.click_type) ?? 0) + 1);
    if (r.event_id)
      eventCounts.set(r.event_id, (eventCounts.get(r.event_id) ?? 0) + 1);
  }
  const outboundByType = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const topIds = [...eventCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id);
  const nameById = new Map<string, string>();
  if (topIds.length) {
    const { data: evs } = await supabase
      .from("hwy4_events")
      .select("id, name")
      .in("id", topIds);
    for (const e of (evs as { id: string; name: string }[] | null) ?? [])
      nameById.set(e.id, e.name);
  }
  const topEvents = topIds.map((id) => ({
    name: nameById.get(id) ?? "(event)",
    clicks: eventCounts.get(id) ?? 0,
  }));

  return {
    views: tally(vrows),
    views7: tally(vrows.filter((r) => r.created_at >= since7)),
    outboundTotal: crows.length,
    outboundByType,
    topEvents,
    hasData: vrows.length > 0 || crows.length > 0,
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
  field: "top_pages" | "referrers" | "countries" | "devices" | "browsers",
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

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function GrowthPage() {
  const rows = await loadDaily();
  const newsletterClicks = await loadNewsletterClicks();
  const gate0 = await loadGate0();
  const nlMax = newsletterClicks ? Math.max(1, ...newsletterClicks.perEvent.map((e) => e.clicks)) : 1;
  const hasData = rows.some((r) => r.pageviews > 0);

  const last7 = sumLast(rows, 7);
  const last30 = sumLast(rows, WINDOW_DAYS);
  const topPages = aggregate(rows, "top_pages", 12);
  const referrers = aggregate(rows, "referrers", 12);
  const countries = aggregate(rows, "countries", 6);
  const devices = aggregate(rows, "devices", 5);
  const ai = aggregateAi(rows).sort((a, b) => b.visits - a.visits);
  const aiTotal = ai.reduce((a, r) => a + r.visits, 0);
  const lastSynced = rows.map((r) => r.synced_at).filter(Boolean).sort().at(-1);

  const trend = rows.slice(0, TREND_DAYS).reverse(); // chronological
  const trendMax = Math.max(1, ...trend.map((r) => r.pageviews));

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <h1 style={{ color: "#2d5016", fontSize: 26, margin: "0 0 4px" }}>Growth</h1>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 24px", lineHeight: 1.5 }}>
        Traffic from Cloudflare Web Analytics, snapshotted nightly into the site&rsquo;s own
        history. Privacy-first and cookieless, so the numbers run a touch lower than ad-tech
        analytics, but they&rsquo;re honest.
      </p>

      <Gate0Section data={gate0} />

      {!hasData ? (
        <section style={emptyCardStyle}>
          <p style={{ color: "#2d5016", fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
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
              { label: "Pageviews · 7d", value: last7.pageviews },
              { label: "Visits · 7d", value: last7.visits },
              { label: "Pageviews · 30d", value: last30.pageviews },
              { label: "Visits · 30d", value: last30.visits },
            ]}
          />

          <SectionHeader>Daily pageviews · last {TREND_DAYS} days</SectionHeader>
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
              {trend.map((r) => (
                <div
                  key={r.date}
                  title={`${fmtDay(r.date)}: ${nf(r.pageviews)} pageviews, ${nf(r.visits)} visits`}
                  style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}
                >
                  <div
                    style={{
                      height: `${Math.round((r.pageviews / trendMax) * 100)}%`,
                      minHeight: r.pageviews > 0 ? 3 : 0,
                      background: "#2d5016",
                      borderRadius: "3px 3px 0 0",
                      opacity: r.pageviews > 0 ? 1 : 0.15,
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

          <SectionHeader>Answer-engine referrals · 30d</SectionHeader>
          <section style={cardStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
              {ai.map((e) => (
                <div key={e.key} style={{ textAlign: "center", padding: "8px 4px" }}>
                  <p style={{ color: e.visits > 0 ? "#2d5016" : "#bbb", fontSize: 24, fontWeight: 700, margin: "0 0 2px" }}>
                    {nf(e.visits)}
                  </p>
                  <p style={{ ...labelStyle, margin: 0 }}>{e.label}</p>
                </div>
              ))}
            </div>
            <p style={{ color: "#999", fontSize: 14, lineHeight: 1.5, margin: "12px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 10 }}>
              {aiTotal > 0
                ? `${nf(aiTotal)} visits referred from answer engines in the last 30 days. `
                : "No answer-engine referrals captured yet. "}
              This is a lower bound: Google AI Overviews show up as <code>google.com</code> and many
              AI clickthroughs arrive with no referrer. Pair it with the monthly prompt audit in
              AEO-SEO-MEASUREMENT.md.
            </p>
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginTop: 4 }}>
            <RankedList title="Top pages · 30d" rows={topPages} kind="page" />
            <RankedList title="Top referrers · 30d" rows={referrers} kind="referrer" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginTop: 16 }}>
            <RankedList title="Countries · 30d" rows={countries} kind="plain" />
            <RankedList title="Devices · 30d" rows={devices} kind="plain" />
          </div>

          <p style={{ color: "#aaa", fontSize: 14, margin: "28px 0 0", lineHeight: 1.5 }}>
            Source: Cloudflare Web Analytics (RUM){lastSynced ? ` · snapshot updated ${new Date(lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.
            Search-engine performance (Google/Bing) is tracked separately by the cockpit&rsquo;s SEO
            collector and surfaces in the nightly digest on <a href="/admin/today" style={{ color: "#2d5016" }}>Today</a>.
          </p>
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
                    <span style={{ color: "#2d5016", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{nf(e.clicks)}</span>
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
    <div style={{ background: "#fff", border: "1px solid #e8e4de", borderRadius: 10, padding: "12px 14px" }}>
      <p style={{ ...labelStyle, margin: "0 0 4px" }}>{label}</p>
      <p style={{ color: "#2d5016", fontSize: 24, fontWeight: 700, margin: 0 }}>{value}</p>
      {sub && <p style={{ color: "#999", fontSize: 12, margin: "2px 0 0" }}>{sub}</p>}
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
  const known30 = v.local + v.visitor;
  const known7 = v7.local + v7.visitor;
  const clickMax = Math.max(1, ...data.topEvents.map((e) => e.clicks));
  return (
    <>
      <SectionHeader>Visitor vs local · 30d</SectionHeader>
      <section style={cardStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <Stat label="Visitor share · 30d" value={`${pct(v.visitor, known30)}%`} sub={`${nf(v.visitor)} of ${nf(known30)} located`} />
          <Stat label="Visitor share · 7d" value={`${pct(v7.visitor, known7)}%`} sub={`${nf(v7.visitor)} of ${nf(known7)} located`} />
          <Stat label="Local views · 30d" value={nf(v.local)} />
          <Stat label="Unknown geo · 30d" value={nf(v.unknown)} />
        </div>
        <p style={{ color: "#999", fontSize: 13, lineHeight: 1.5, margin: "12px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 10 }}>
          Directional. Location is coarse IP geolocation (Vercel edge), which often places corridor
          residents in a regional hub, so locals are undercounted. Read the trend, not the absolute.
          Bots that don&rsquo;t run JS never appear here.
        </p>
      </section>

      <SectionHeader>Business referrals · 30d</SectionHeader>
      <section style={cardStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: data.topEvents.length ? 16 : 0 }}>
          <Stat label="Outbound clicks · 30d" value={nf(data.outboundTotal)} />
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
                    <span style={{ color: "#2d5016", fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{nf(e.clicks)}</span>
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
    </>
  );
}

function StatStrip({ stats }: { stats: Array<{ label: string; value: number }> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 4 }}>
      {stats.map((s) => (
        <div key={s.label} style={{ background: "#fff", border: "1px solid #e8e4de", borderRadius: 10, padding: "12px 14px" }}>
          <p style={{ ...labelStyle, margin: "0 0 4px" }}>{s.label}</p>
          <p style={{ color: "#2d5016", fontSize: 24, fontWeight: 700, margin: 0 }}>{nf(s.value)}</p>
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
                  <span style={{ color: "#2d5016", fontSize: 15, fontWeight: 600, flexShrink: 0 }}>
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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: "#2d5016", fontSize: 15, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", margin: "28px 0 12px" }}>
      {children}
    </h2>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e8e4de",
  borderRadius: 12,
  padding: 18,
};

const emptyCardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e8e4de",
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
