import { getAdminClientOrNull } from "@/lib/admin/db";
import type { Digest, DigestItem, Vitals } from "@/lib/agent/types";
import { SubmissionsRail } from "./SubmissionsRail";
import { VerificationRail } from "./VerificationRail";

// The daily chief-of-staff digest, rendered as the "Today" tab of /admin/briefings.
// Loads its own run so the tab only fetches when it's the one being viewed.

type AgentRun = {
  ran_at: string;
  status: string;
  model: string | null;
  digest: Digest | null;
  context_in: { vitals?: Vitals } | null;
  error: string | null;
};

async function loadLatestRun(): Promise<AgentRun | null> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return null;
  const { data } = await supabase
    .from("agent_runs")
    .select("ran_at, status, model, digest, context_in, error")
    .eq("run_type", "chief_of_staff")
    .order("ran_at", { ascending: false })
    .limit(1);
  return (data?.[0] as AgentRun | undefined) ?? null;
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

export async function TodayBriefing() {
  const run = await loadLatestRun();
  const digest = run?.digest ?? null;
  const vitals = run?.context_in?.vitals ?? null;

  return (
    <>
      <h1 style={{ color: "#1B3A2D", fontSize: 26, margin: "0 0 4px" }}>Today</h1>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 24px", lineHeight: 1.5 }}>
        Your nightly digest. The chief of staff reads the audit, the verification queue, new
        submissions, and search trends, then flags what needs a human. Clear-cut submissions you
        can act on right here; the agent advises, you decide.
      </p>

      {/* Act-from-the-briefing rails: pending submissions (with the agent's verdict)
          and flagged dates, actionable in place. The narrative digest is the read surface. */}
      <SubmissionsRail />
      <VerificationRail />

      {!run && <EmptyState />}

      {run && run.status === "error" && (
        <Banner tone="error" title="The last run failed.">
          {run.error ?? "No error recorded."} The digest below is from the most recent run; check
          back after tonight&rsquo;s run.
        </Banner>
      )}

      {run && (
        <>
          <p style={{ color: "#999", fontSize: 14, margin: "0 0 16px" }}>
            Generated {fmtWhen(run.ran_at)}
            {run.model ? ` · ${run.model}` : ""} ·{" "}
            <span style={pillStyle}>read-only · Stage 0</span>
          </p>

          {vitals && <VitalsStrip vitals={vitals} />}

          {digest && (
            <>
              <section style={summaryCardStyle}>
                <p style={{ margin: 0, color: "#2d3a22", fontSize: 18, lineHeight: 1.6 }}>
                  {digest.summary}
                </p>
              </section>

              <SectionHeader>What needs you</SectionHeader>
              {digest.needs_you.length === 0 ? (
                <Banner tone="ok" title="Nothing needs you today.">
                  The automation handled the night. Enjoy the quiet.
                </Banner>
              ) : (
                <CardList>
                  {digest.needs_you.map((item, i) => (
                    <ItemCard key={i} item={item} variant="needs" />
                  ))}
                </CardList>
              )}

              {digest.fyi.length > 0 && (
                <>
                  <SectionHeader>Good to know</SectionHeader>
                  <CardList>
                    {digest.fyi.map((item, i) => (
                      <ItemCard key={i} item={item} variant="fyi" />
                    ))}
                  </CardList>
                </>
              )}

              {digest.watching.length > 0 && (
                <>
                  <SectionHeader>Worth watching</SectionHeader>
                  <CardList>
                    {digest.watching.map((item, i) => (
                      <ItemCard key={i} item={item} variant="watching" />
                    ))}
                  </CardList>
                </>
              )}
            </>
          )}

          <p style={{ color: "#aaa", fontSize: 14, margin: "28px 0 0", lineHeight: 1.5 }}>
            The narrative above is read-only. Acting happens in the submissions rail: dismiss the
            clear passes in place; publish and merge stay a reviewed click. Nothing auto-runs.
          </p>
        </>
      )}
    </>
  );
}

function VitalsStrip({ vitals }: { vitals: Vitals }) {
  const stats: { label: string; value: number | string }[] = [
    { label: "Upcoming (14d)", value: vitals.upcoming_events_14d },
    { label: "Needs verification", value: vitals.needs_verification },
    { label: "Pending submissions", value: vitals.pending_submissions },
    { label: "Auto-merges (24h)", value: vitals.merges_24h },
  ];
  // Runs persisted before 2026-07-05 lack the field; skip the tile for those.
  if (vitals.picks_runway_days !== undefined) {
    stats.push({
      label: "Picks runway",
      value: vitals.picks_runway_days === null ? "empty" : `${vitals.picks_runway_days}d`,
    });
  }
  // Runs persisted before 2026-07-11 lack the field; null = no audit summary.
  if (vitals.audit_backlog !== undefined) {
    stats.push({
      label: "Data backlog",
      value: vitals.audit_backlog === null ? "no audit" : vitals.audit_backlog,
    });
  }
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
        <div
          key={s.label}
          style={{ background: "#fff", border: "1px solid #E7E0D5", borderRadius: 10, padding: "12px 14px" }}
        >
          <p style={{ ...labelStyle, margin: "0 0 4px" }}>{s.label}</p>
          <p style={{ color: "#1B3A2D", fontSize: 24, fontWeight: 700, margin: 0 }}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function ItemCard({ item, variant }: { item: DigestItem; variant: "needs" | "fyi" | "watching" }) {
  const accent = variant === "needs" ? "#C4922A" : variant === "watching" ? "#5a8fa8" : "#E7E0D5";
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
      {item.why && (
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fde4c8",
            borderRadius: 8,
            padding: "8px 12px",
            marginTop: 12,
          }}
        >
          <p style={{ ...labelStyle, color: "#9a3412", margin: "0 0 2px" }}>Why it matters</p>
          <p style={{ color: "#3a3a3a", fontSize: 15, lineHeight: 1.5, margin: 0 }}>{item.why}</p>
        </div>
      )}
      {item.link && (
        <a href={item.link} style={linkBtnStyle}>
          Open {item.link} →
        </a>
      )}
    </article>
  );
}

function EmptyState() {
  return (
    <section style={{ background: "#fff", border: "1px solid #E7E0D5", borderRadius: 12, padding: 32, textAlign: "center" }}>
      <p style={{ color: "#1B3A2D", fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>No digest yet.</p>
      <p style={{ color: "#666", fontSize: 16, margin: 0, lineHeight: 1.5 }}>
        The chief of staff runs nightly, after the evening audit. Check back in the morning, or use
        Run now (top right) to generate one.
      </p>
    </section>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        color: "#1B3A2D",
        fontSize: 15,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        margin: "28px 0 12px",
      }}
    >
      {children}
    </h2>
  );
}

function CardList({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>;
}

function Banner({ tone, title, children }: { tone: "ok" | "error"; title: string; children: React.ReactNode }) {
  const styles =
    tone === "ok"
      ? { background: "#eaf7ea", border: "1px solid #b7e0b7", color: "#1B3A2D" }
      : { background: "#fdecea", border: "1px solid #f5b7b1", color: "#922b21" };
  return (
    <section style={{ ...styles, borderRadius: 12, padding: "14px 18px" }}>
      <p style={{ margin: "0 0 2px", fontSize: 17, fontWeight: 600 }}>{title}</p>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, opacity: 0.9 }}>{children}</p>
    </section>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#888",
};

const pillStyle: React.CSSProperties = {
  display: "inline-block",
  background: "#eef2e9",
  color: "#1B3A2D",
  fontSize: 13,
  fontWeight: 600,
  padding: "1px 8px",
  borderRadius: 10,
};

const summaryCardStyle: React.CSSProperties = {
  background: "#FDF8F3",
  border: "1px solid #E7E0D5",
  borderLeft: "4px solid #1B3A2D",
  borderRadius: 12,
  padding: "16px 18px",
  marginBottom: 4,
};

const linkBtnStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: 12,
  padding: "7px 12px",
  background: "#FDF8F3",
  color: "#1B3A2D",
  border: "1px solid #1B3A2D",
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 500,
  textDecoration: "none",
};
