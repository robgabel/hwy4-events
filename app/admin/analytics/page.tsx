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
      <h1 style={{ color: "#2d5016", fontSize: 24, margin: "0 0 4px" }}>Growth</h1>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 24px", lineHeight: 1.5 }}>
        Traffic from Cloudflare Web Analytics, snapshotted nightly into the site&rsquo;s own
        history. Privacy-first and cookieless, so the numbers run a touch lower than ad-tech
        analytics, but they&rsquo;re honest.
      </p>

      {!hasData ? (
        <section style={emptyCardStyle}>
          <p style={{ color: "#2d5016", fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>
            No traffic data yet.
          </p>
          <p style={{ color: "#666", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
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
                  <p style={{ color: e.visits > 0 ? "#2d5016" : "#bbb", fontSize: 22, fontWeight: 700, margin: "0 0 2px" }}>
                    {nf(e.visits)}
                  </p>
                  <p style={{ ...labelStyle, margin: 0 }}>{e.label}</p>
                </div>
              ))}
            </div>
            <p style={{ color: "#999", fontSize: 12, lineHeight: 1.5, margin: "12px 0 0", borderTop: "1px solid #f0ede8", paddingTop: 10 }}>
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

          <p style={{ color: "#aaa", fontSize: 12, margin: "28px 0 0", lineHeight: 1.5 }}>
            Source: Cloudflare Web Analytics (RUM){lastSynced ? ` · snapshot updated ${new Date(lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.
            Search-engine performance (Google/Bing) is tracked separately by the cockpit&rsquo;s SEO
            collector and surfaces in the nightly digest on <a href="/admin/today" style={{ color: "#2d5016" }}>Today</a>.
          </p>
        </>
      )}
    </div>
  );
}

// --- presentational ------------------------------------------------------

function StatStrip({ stats }: { stats: Array<{ label: string; value: number }> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 4 }}>
      {stats.map((s) => (
        <div key={s.label} style={{ background: "#fff", border: "1px solid #e8e4de", borderRadius: 10, padding: "12px 14px" }}>
          <p style={{ ...labelStyle, margin: "0 0 4px" }}>{s.label}</p>
          <p style={{ color: "#2d5016", fontSize: 22, fontWeight: 700, margin: 0 }}>{nf(s.value)}</p>
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
        <p style={{ color: "#aaa", fontSize: 13, margin: 0 }}>No data.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {rows.map((r) => {
            const display =
              kind === "referrer" ? r.key || "(direct)" : kind === "page" ? r.key || "/" : r.key || "—";
            return (
              <div key={r.key || "_"}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <span style={{ color: "#2d3a22", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {display}
                  </span>
                  <span style={{ color: "#2d5016", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
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
    <h2 style={{ color: "#2d5016", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", margin: "28px 0 12px" }}>
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
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#888",
};

const axisStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#aaa",
};
