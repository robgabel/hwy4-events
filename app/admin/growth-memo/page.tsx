import { createClient } from "@supabase/supabase-js";
import type { DigestItem, GrowthDigest, GrowthVitals } from "@/lib/agent/types";
import GrowthDraftBlock from "@/components/GrowthDraft";

export const dynamic = "force-dynamic";

type GrowthRun = {
  ran_at: string;
  status: string;
  model: string | null;
  digest: GrowthDigest | null;
  context_in: { vitals?: GrowthVitals } | null;
  error: string | null;
};

async function loadLatestMemo(): Promise<GrowthRun | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from("agent_runs")
    .select("ran_at, status, model, digest, context_in, error")
    .eq("run_type", "growth_memo")
    .order("ran_at", { ascending: false })
    .limit(1);
  return (data?.[0] as GrowthRun | undefined) ?? null;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const labelStyle = {
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "#8a7b66",
  fontWeight: 600,
};

export default async function GrowthMemoPage() {
  const run = await loadLatestMemo();
  const digest = run?.digest ?? null;
  const vitals = run?.context_in?.vitals ?? null;

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <h1 style={{ color: "#2d5016", fontSize: 26, margin: "0 0 4px" }}>Growth memo</h1>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 24px", lineHeight: 1.5 }}>
        Your weekly head-of-growth read. It tracks the North Star (returning locals + the
        newsletter), names the one move worth making this week, and drafts it. It proposes and
        writes copy, it sends nothing.
      </p>

      {!run && <EmptyState />}

      {run && run.status === "error" && (
        <Banner tone="error" title="The last memo failed.">
          {run.error ?? "No error recorded."} The memo below, if any, is from the prior run.
        </Banner>
      )}

      {run && (
        <>
          <p style={{ color: "#999", fontSize: 14, margin: "0 0 16px" }}>
            Generated {fmtWhen(run.ran_at)}
            {run.model ? ` · ${run.model}` : ""} ·{" "}
            <span style={pillStyle}>read-only · weekly · drafts only</span>
          </p>

          {vitals && <VitalsStrip vitals={vitals} />}

          {digest && (
            <>
              {digest.summary && (
                <section style={summaryCardStyle}>
                  <p style={{ margin: 0, color: "#2d3a22", fontSize: 18, lineHeight: 1.6 }}>
                    {digest.summary}
                  </p>
                </section>
              )}

              {/* North Star */}
              {(digest.north_star.headline || digest.north_star.detail) && (
                <section
                  style={{
                    background: "#1b3a2d",
                    borderRadius: 14,
                    padding: 22,
                    marginBottom: 22,
                  }}
                >
                  <p style={{ ...labelStyle, color: "#9db89a", margin: "0 0 8px" }}>North Star</p>
                  <p style={{ margin: "0 0 6px", color: "#fff", fontSize: 21, fontWeight: 700, lineHeight: 1.35 }}>
                    {digest.north_star.headline}
                  </p>
                  {digest.north_star.detail && (
                    <p style={{ margin: 0, color: "#cfe0c8", fontSize: 16, lineHeight: 1.55 }}>
                      {digest.north_star.detail}
                    </p>
                  )}
                </section>
              )}

              {/* Move of the week */}
              <SectionHeader>Move of the week</SectionHeader>
              {digest.move_of_the_week ? (
                <article
                  style={{
                    background: "#fff",
                    border: "1px solid #e8e4de",
                    borderLeft: "4px solid #2d5016",
                    borderRadius: 12,
                    padding: 20,
                    marginBottom: 22,
                  }}
                >
                  <h3 style={{ color: "#2d5016", fontSize: 20, margin: "0 0 8px", fontWeight: 700 }}>
                    {digest.move_of_the_week.title}
                  </h3>
                  <p style={{ color: "#3a3a3a", fontSize: 16, lineHeight: 1.6, margin: 0 }}>
                    {digest.move_of_the_week.detail}
                  </p>
                  {digest.move_of_the_week.why && (
                    <div
                      style={{
                        background: "#f0f6ec",
                        border: "1px solid #d8e4d0",
                        borderRadius: 8,
                        padding: "8px 12px",
                        marginTop: 12,
                      }}
                    >
                      <p style={{ ...labelStyle, color: "#2d5016", margin: "0 0 2px" }}>
                        Why this, why now
                      </p>
                      <p style={{ color: "#3a3a3a", fontSize: 15, lineHeight: 1.5, margin: 0 }}>
                        {digest.move_of_the_week.why}
                      </p>
                    </div>
                  )}
                  {digest.move_of_the_week.draft && (
                    <GrowthDraftBlock draft={digest.move_of_the_week.draft} />
                  )}
                </article>
              ) : (
                <Banner tone="ok" title="No clear move this week.">
                  A quiet week. Nothing with enough leverage to chase. Hold the line.
                </Banner>
              )}

              {digest.experiments.length > 0 && (
                <>
                  <SectionHeader>Experiments in flight</SectionHeader>
                  <CardList>
                    {digest.experiments.map((item, i) => (
                      <ItemCard key={i} item={item} accent="#5a8fa8" />
                    ))}
                  </CardList>
                </>
              )}

              {digest.watching.length > 0 && (
                <>
                  <SectionHeader>Worth watching</SectionHeader>
                  <CardList>
                    {digest.watching.map((item, i) => (
                      <ItemCard key={i} item={item} accent="#c4922a" />
                    ))}
                  </CardList>
                </>
              )}

              {digest.ops.length > 0 && (
                <>
                  <SectionHeader>Ops footer</SectionHeader>
                  <CardList>
                    {digest.ops.map((item, i) => (
                      <ItemCard key={i} item={item} accent="#e8e4de" />
                    ))}
                  </CardList>
                </>
              )}
            </>
          )}

          <p style={{ color: "#aaa", fontSize: 14, margin: "28px 0 0", lineHeight: 1.5 }}>
            Read-only preview. The growth agent drafts; you send. Numbers are directional (low
            traffic, session-based, no persistent visitor id).
          </p>
        </>
      )}
    </div>
  );
}

function pct(n: number | null): string {
  return n == null ? "n/a" : `${Math.round(n * 100)}%`;
}

function VitalsStrip({ vitals }: { vitals: GrowthVitals }) {
  const delta = vitals.local_sessions_7d - vitals.local_sessions_prev_7d;
  const deltaStr = delta === 0 ? "flat" : delta > 0 ? `+${delta}` : `${delta}`;
  const stats: { label: string; value: string; sub?: string }[] = [
    { label: "Newsletter (active)", value: String(vitals.newsletter_active), sub: `net ${vitals.newsletter_net_7d >= 0 ? "+" : ""}${vitals.newsletter_net_7d} / 7d` },
    { label: "Confirm rate (30d)", value: pct(vitals.newsletter_confirm_rate_30d), sub: "opt-in leak" },
    { label: "Local sessions (7d)", value: String(vitals.local_sessions_7d), sub: `${deltaStr} vs prior · WRR proxy` },
    { label: "Business referrals (7d)", value: String(vitals.business_referrals_7d) },
    { label: "Pageviews (7d)", value: String(vitals.pageviews_7d) },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 10,
        marginBottom: 20,
      }}
    >
      {stats.map((s) => (
        <div key={s.label} style={{ background: "#fff", border: "1px solid #e8e4de", borderRadius: 10, padding: "12px 14px" }}>
          <p style={{ ...labelStyle, margin: "0 0 4px" }}>{s.label}</p>
          <p style={{ color: "#2d5016", fontSize: 24, fontWeight: 700, margin: 0 }}>{s.value}</p>
          {s.sub && <p style={{ color: "#8a7b66", fontSize: 12, margin: "2px 0 0" }}>{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function ItemCard({ item, accent }: { item: DigestItem; accent: string }) {
  return (
    <article
      style={{
        background: "#fff",
        border: "1px solid #e8e4de",
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        padding: 18,
      }}
    >
      <h3 style={{ color: "#2d5016", fontSize: 18, margin: "0 0 6px", fontWeight: 600 }}>
        {item.title}
      </h3>
      <p style={{ color: "#3a3a3a", fontSize: 16, lineHeight: 1.55, margin: 0 }}>{item.detail}</p>
    </article>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: "#2d5016", fontSize: 15, textTransform: "uppercase", letterSpacing: "0.06em", margin: "24px 0 12px" }}>
      {children}
    </h2>
  );
}

function CardList({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>;
}

function Banner({ tone, title, children }: { tone: "ok" | "error"; title: string; children: React.ReactNode }) {
  const bg = tone === "error" ? "#fef2f2" : "#f0f6ec";
  const border = tone === "error" ? "#fecaca" : "#d8e4d0";
  const color = tone === "error" ? "#991b1b" : "#2d5016";
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: 18, marginBottom: 12 }}>
      <p style={{ color, fontSize: 17, fontWeight: 600, margin: "0 0 4px" }}>{title}</p>
      <p style={{ color: "#3a3a3a", fontSize: 15, lineHeight: 1.5, margin: 0 }}>{children}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <section style={{ background: "#fff", border: "1px solid #e8e4de", borderRadius: 12, padding: 32, textAlign: "center" }}>
      <p style={{ color: "#2d5016", fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>No memo yet.</p>
      <p style={{ color: "#666", fontSize: 16, margin: 0, lineHeight: 1.5 }}>
        The growth memo runs weekly on Friday morning. Check back then, or trigger a run by hand to
        see one now.
      </p>
    </section>
  );
}

const pillStyle = {
  display: "inline-block",
  background: "#eef4e9",
  color: "#2d5016",
  fontSize: 12,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 6,
};

const summaryCardStyle = {
  background: "#fff",
  border: "1px solid #e8e4de",
  borderRadius: 12,
  padding: 20,
  marginBottom: 22,
};
