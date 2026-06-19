import { getAdminClientOrNull } from "@/lib/admin/db";
import type { DigestItem, GrowthDigest, GrowthVitals } from "@/lib/agent/types";
import GrowthDraftBlock from "@/components/GrowthDraft";

// The weekly head-of-growth memo, rendered as the "Growth memo" tab of
// /admin/briefings. Loads its own run so it only fetches when viewed.

type GrowthRun = {
  ran_at: string;
  status: string;
  model: string | null;
  digest: GrowthDigest | null;
  context_in: { vitals?: GrowthVitals } | null;
  error: string | null;
};

async function loadLatestMemo(): Promise<GrowthRun | null> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return null;
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

export async function GrowthBriefing() {
  const run = await loadLatestMemo();
  const digest = run?.digest ?? null;
  const vitals = run?.context_in?.vitals ?? null;

  return (
    <>
      <h1 style={{ color: "#1B3A2D", fontSize: 26, margin: "0 0 4px" }}>Growth memo</h1>
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

          {run.status === "degraded" && (
            <>
              <Banner tone="error" title="This run could not be parsed.">
                The agent ran but returned output we could not turn into a memo (usually the
                JSON ran past the token limit before it closed). Nothing was sent. Use Run now
                to retry. The raw output is below.
              </Banner>
              {run.error && <pre style={preStyle}>{run.error}</pre>}
            </>
          )}

          {digest && (
            <>
              {/* Move of the week — the hero. Lead with the action, not the prose. */}
              <SectionHeader>This week&apos;s move</SectionHeader>
              {digest.move_of_the_week ? (
                <article
                  style={{
                    background: "#fff",
                    border: "1px solid #E7E0D5",
                    borderLeft: "4px solid #1B3A2D",
                    borderRadius: 12,
                    padding: 22,
                    marginBottom: 22,
                  }}
                >
                  <h3 style={{ color: "#1B3A2D", fontSize: 22, margin: "0 0 8px", fontWeight: 700, lineHeight: 1.3 }}>
                    {digest.move_of_the_week.title}
                  </h3>
                  <p style={{ color: "#3a3a3a", fontSize: 16, lineHeight: 1.6, margin: 0 }}>
                    {digest.move_of_the_week.detail}
                  </p>
                  {/* The draft is the Do; it sits directly under the move, above the rationale. */}
                  {digest.move_of_the_week.draft && (
                    <GrowthDraftBlock draft={digest.move_of_the_week.draft} />
                  )}
                  {digest.move_of_the_week.why && (
                    <p
                      style={{
                        color: "#6b7d70",
                        fontSize: 14,
                        lineHeight: 1.5,
                        margin: "12px 0 0",
                        fontStyle: "italic",
                      }}
                    >
                      Why now: {digest.move_of_the_week.why}
                    </p>
                  )}
                </article>
              ) : (
                <Banner tone="ok" title="No clear move this week.">
                  A quiet week. Nothing with enough leverage to chase. Hold the line.
                </Banner>
              )}

              {/* North Star — the one-line read, detail inlined */}
              {(digest.north_star.headline || digest.north_star.detail) && (
                <section style={{ background: "#1b3a2d", borderRadius: 14, padding: "16px 20px", marginBottom: 22 }}>
                  <p style={{ ...labelStyle, color: "#9db89a", margin: "0 0 6px" }}>North Star</p>
                  <p style={{ margin: 0, color: "#fff", fontSize: 18, fontWeight: 600, lineHeight: 1.45 }}>
                    {digest.north_star.headline}
                    {digest.north_star.detail && (
                      <span style={{ color: "#cfe0c8", fontWeight: 400 }}> {digest.north_star.detail}</span>
                    )}
                  </p>
                </section>
              )}

              {/* Summary — demoted to a short note, only when it adds something */}
              {digest.summary && (
                <p style={{ color: "#6b7d70", fontSize: 15, lineHeight: 1.6, margin: "0 0 22px" }}>
                  {digest.summary}
                </p>
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
                      <ItemCard key={i} item={item} accent="#E7E0D5" />
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
    </>
  );
}

function pct(n: number | null): string {
  return n == null ? "n/a" : `${Math.round(n * 100)}%`;
}

function VitalsStrip({ vitals }: { vitals: GrowthVitals }) {
  const delta = vitals.local_sessions_7d - vitals.local_sessions_prev_7d;
  const deltaStr = delta === 0 ? "flat" : delta > 0 ? `+${delta}` : `${delta}`;
  const stats: { label: string; value: string; sub?: string }[] = [
    {
      label: "Newsletter (active)",
      value: String(vitals.newsletter_active),
      sub: `net ${vitals.newsletter_net_7d >= 0 ? "+" : ""}${vitals.newsletter_net_7d} / 7d`,
    },
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
        <div key={s.label} style={{ background: "#fff", border: "1px solid #E7E0D5", borderRadius: 10, padding: "12px 14px" }}>
          <p style={{ ...labelStyle, margin: "0 0 4px" }}>{s.label}</p>
          <p style={{ color: "#1B3A2D", fontSize: 24, fontWeight: 700, margin: 0 }}>{s.value}</p>
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
        border: "1px solid #E7E0D5",
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        padding: 18,
      }}
    >
      <h3 style={{ color: "#1B3A2D", fontSize: 18, margin: "0 0 6px", fontWeight: 600 }}>{item.title}</h3>
      <p style={{ color: "#3a3a3a", fontSize: 16, lineHeight: 1.55, margin: 0 }}>{item.detail}</p>
    </article>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: "#1B3A2D", fontSize: 15, textTransform: "uppercase", letterSpacing: "0.06em", margin: "24px 0 12px" }}>
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
  const color = tone === "error" ? "#991b1b" : "#1B3A2D";
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: 18, marginBottom: 12 }}>
      <p style={{ color, fontSize: 17, fontWeight: 600, margin: "0 0 4px" }}>{title}</p>
      <p style={{ color: "#3a3a3a", fontSize: 15, lineHeight: 1.5, margin: 0 }}>{children}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <section style={{ background: "#fff", border: "1px solid #E7E0D5", borderRadius: 12, padding: 32, textAlign: "center" }}>
      <p style={{ color: "#1B3A2D", fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>No memo yet.</p>
      <p style={{ color: "#666", fontSize: 16, margin: 0, lineHeight: 1.5 }}>
        The growth memo runs weekly on Friday morning. Check back then, or use Run now (top right)
        to generate one.
      </p>
    </section>
  );
}

const pillStyle = {
  display: "inline-block",
  background: "#eef4e9",
  color: "#1B3A2D",
  fontSize: 12,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 6,
};

// Raw model output for a degraded run. Dark + monospace so it reads as an
// unmistakable debug dump, never mistaken for the memo's own prose.
const preStyle = {
  background: "#1e1e1e",
  color: "#d4d4d4",
  fontSize: 12.5,
  lineHeight: 1.5,
  padding: 16,
  borderRadius: 10,
  margin: "0 0 22px",
  maxHeight: 420,
  overflow: "auto" as const,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
};
