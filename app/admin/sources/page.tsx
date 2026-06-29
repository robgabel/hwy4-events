import { getAdminClientOrNull } from "@/lib/admin/db";
import {
  computeScrapeHealth,
  MANUAL_SOURCES,
  type SourceHealth,
  type SourceState,
} from "@/lib/scrape-health";
import { PulseTabs } from "@/components/admin/PulseTabs";
import { INK, MUTED, SUBTLE, BORDER, CARD_BG, SUBTLE_BG, Banner } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

// Source health: the live read-only status of every automated event scraper.
// Deterministic counterpart to the agent reasoners (which narrate it) and the
// /api/check-events Slack alarm (which pages on it). Read-only — it reports, a
// human fixes the source. See lib/scrape-health.ts.

const STATE_META: Record<SourceState, { label: string; bg: string; fg: string }> = {
  ok: { label: "OK", bg: "#eaf3ea", fg: "#1B3A2D" },
  stale: { label: "Stale", bg: "#fbeccd", fg: "#8a5a00" },
  failing: { label: "Failing", bg: "#fdecea", fg: "#922b21" },
  empty: { label: "No events", bg: SUBTLE_BG, fg: MUTED },
  never_ran: { label: "No data", bg: SUBTLE_BG, fg: MUTED },
};

function fmtAgo(days: number | null): string {
  if (days === null) return "never produced an event";
  if (days < 1) return "produced today";
  if (days < 2) return "produced ~1 day ago";
  return `produced ${Math.round(days)} days ago`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "no run recorded yet";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SourcesPage() {
  const supabase = getAdminClientOrNull();
  const report = supabase ? await computeScrapeHealth(supabase) : null;

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <PulseTabs active="sources" sourcesBadge={report?.degraded_count} />

      <h1 style={{ color: INK, fontSize: 26, margin: "0 0 4px" }}>Source health</h1>
      <p style={{ color: MUTED, fontSize: 16, margin: "0 0 20px", lineHeight: 1.5 }}>
        Live status of every automated event scraper. A source goes{" "}
        <strong>Stale</strong> when it stops producing past its cadence (daily or weekly), and{" "}
        <strong>Failing</strong> when its last run hard-errored. This is read-only: when something is
        down, fix the source (or the GitHub scrape run), then it clears itself on the next run.
      </p>

      {!supabase && (
        <Banner tone="error">
          Supabase credentials are not configured, so source health can&rsquo;t be read.
        </Banner>
      )}

      {report && (
        <>
          {report.degraded_count === 0 ? (
            <Banner tone="ok">
              All {report.ok_count} automated sources are healthy. Nothing is stale or failing.
            </Banner>
          ) : (
            <Banner tone="error">
              {report.degraded_count} of {report.sources.length} automated sources need attention.{" "}
              {report.ok_count} healthy.
            </Banner>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            {report.sources
              .slice()
              .sort(sortWorstFirst)
              .map((s) => (
                <SourceRow key={s.org_slug} s={s} />
              ))}
          </div>

          <ManualFooter />

          <p style={{ color: SUBTLE, fontSize: 13, margin: "20px 0 0", lineHeight: 1.5 }}>
            Generated {fmtWhen(report.generated_at)}. Liveness is derived from each source&rsquo;s
            most recent event write; run status comes from scrape_runs telemetry. The same report
            drives the daily /api/check-events Slack alarm and the agent briefings.
          </p>
        </>
      )}
    </div>
  );
}

// Degraded first (failing above stale), worst staleness first, then the rest.
function sortWorstFirst(a: SourceHealth, b: SourceHealth): number {
  const rank: Record<SourceState, number> = { failing: 0, stale: 1, empty: 2, never_ran: 3, ok: 4 };
  if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
  return (b.days_since_success ?? -1) - (a.days_since_success ?? -1);
}

function SourceRow({ s }: { s: SourceHealth }) {
  const meta = STATE_META[s.state];
  const accent = s.state === "failing" ? "#922b21" : s.state === "stale" ? "#C4922A" : BORDER;
  return (
    <article
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        padding: "14px 18px",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          marginTop: 2,
          padding: "2px 10px",
          borderRadius: 20,
          background: meta.bg,
          color: meta.fg,
          fontSize: 13,
          fontWeight: 700,
          minWidth: 72,
          textAlign: "center",
        }}
      >
        {meta.label}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: "0 0 2px", color: INK, fontSize: 17, fontWeight: 600 }}>
          {s.label}{" "}
          <span style={{ color: SUBTLE, fontWeight: 400, fontSize: 14 }}>
            {s.org_slug} · {s.cadence} · {s.writer === "github-scrape" ? "GitHub scrape" : "Vercel cron"}
          </span>
        </p>
        <p style={{ margin: 0, color: MUTED, fontSize: 15, lineHeight: 1.5 }}>
          {fmtAgo(s.days_since_success)} · {s.future_events} upcoming event
          {s.future_events === 1 ? "" : "s"}
          {s.last_run_status && ` · last run: ${s.last_run_status}`}
        </p>
        {s.state === "failing" && s.last_error && (
          <p
            style={{
              margin: "8px 0 0",
              padding: "6px 10px",
              background: "#fdecea",
              border: "1px solid #f5b7b1",
              borderRadius: 8,
              color: "#922b21",
              fontSize: 13,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              wordBreak: "break-word",
            }}
          >
            {s.last_error.slice(0, 300)}
          </p>
        )}
        {s.note && (
          <p style={{ margin: "6px 0 0", color: SUBTLE, fontSize: 13, lineHeight: 1.4 }}>{s.note}</p>
        )}
      </div>
    </article>
  );
}

function ManualFooter() {
  const entries = Object.entries(MANUAL_SOURCES);
  if (entries.length === 0) return null;
  return (
    <section
      style={{
        marginTop: 24,
        padding: "14px 18px",
        background: SUBTLE_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
      }}
    >
      <p
        style={{
          margin: "0 0 8px",
          color: SUBTLE,
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        Manually curated · not health-checked
      </p>
      <p style={{ margin: "0 0 10px", color: MUTED, fontSize: 14, lineHeight: 1.5 }}>
        These venues publish in a form the scrapers can&rsquo;t read, so their rows are owned by hand
        (seed scripts / community submissions) and are intentionally static. They&rsquo;re excluded
        from the alarms above on purpose.
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, color: MUTED, fontSize: 14, lineHeight: 1.7 }}>
        {entries.map(([slug, reason]) => (
          <li key={slug}>
            <span style={{ color: INK, fontWeight: 600 }}>{slug}</span> — {reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
