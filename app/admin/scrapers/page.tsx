import { getAdminClientOrNull } from "@/lib/admin/db";
import { readFlash, type SearchParams } from "@/lib/admin/flash";
import { Banner, adminBtn, INK, MUTED, SUBTLE, BORDER, CARD_BG, SUBTLE_BG, DANGER } from "@/components/admin/ui";
import { PulseTabs } from "@/components/admin/PulseTabs";
import {
  rollupBySource,
  runStatus,
  currentlyErroring,
  formatDuration,
  type ScrapeRunRow,
} from "@/lib/scraper-health";
import type { Digest, DigestItem } from "@/lib/agent/types";
import { runScraperHealthMemo } from "./actions";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 14;
const RECENT_RUNS_SHOWN = 10;

type MemoRun = {
  ran_at: string;
  status: string;
  model: string | null;
  digest: Digest | null;
  error: string | null;
};

async function loadData() {
  const supabase = getAdminClientOrNull();
  if (!supabase) return { runs: [] as ScrapeRunRow[], memo: null as MemoRun | null };

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [runsRes, memoRes] = await Promise.all([
    supabase
      .from("scrape_runs")
      .select(
        "id, started_at, completed_at, duration_ms, sources_attempted, sources_errored, total_inserted, total_updated, source_results"
      )
      .gte("started_at", since)
      .order("started_at", { ascending: false }),
    supabase
      .from("agent_runs")
      .select("ran_at, status, model, digest, error")
      .eq("run_type", "scraper_health")
      .order("ran_at", { ascending: false })
      .limit(1),
  ]);

  return {
    runs: (runsRes.data ?? []) as ScrapeRunRow[],
    memo: (memoRes.data?.[0] as MemoRun | undefined) ?? null,
  };
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

const statusColor: Record<string, string> = {
  clean: "#2f6e3f",
  errors: DANGER,
  "no-data": SUBTLE,
};

const statusLabel: Record<string, string> = {
  clean: "Clean",
  errors: "Errors",
  "no-data": "No data",
};

export default async function ScrapersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { error, flash } = readFlash(params);
  const { runs, memo } = await loadData();

  const rollups = rollupBySource(runs);
  const broken = currentlyErroring(rollups);
  const totals = runs.reduce(
    (acc, r) => ({
      inserted: acc.inserted + r.total_inserted,
      updated: acc.updated + r.total_updated,
    }),
    { inserted: 0, updated: 0 }
  );
  const cleanRuns = runs.filter((r) => runStatus(r) === "clean").length;

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <PulseTabs
        active="scrapers"
        right={
          <form action={runScraperHealthMemo}>
            <button type="submit" style={{ ...adminBtn.secondary, fontSize: 14, padding: "6px 14px" }}>
              Run now
            </button>
          </form>
        }
      />

      {error && <Banner tone="error">{error}</Banner>}
      {flash && <Banner tone="ok">{flash}</Banner>}

      <h1 style={{ color: INK, fontSize: 26, margin: "0 0 4px" }}>Scrapers</h1>
      <p style={{ color: MUTED, fontSize: 16, margin: "0 0 24px", lineHeight: 1.5 }}>
        Pipeline health for the daily event scrape: which sources ran, what they added, and
        what&rsquo;s currently broken. Data comes from every {" "}
        <code>scripts/scrape.ts</code> run over the last {WINDOW_DAYS} days.
      </p>

      {runs.length === 0 ? (
        <Banner tone="error">
          No scrape_runs recorded in the last {WINDOW_DAYS} days. Either the daily GitHub Action
          hasn&rsquo;t run since this table was added, or it&rsquo;s failing before it can write a
          summary.
        </Banner>
      ) : (
        <>
          <VitalsStrip
            runsInWindow={runs.length}
            cleanRuns={cleanRuns}
            totalInserted={totals.inserted}
            totalUpdated={totals.updated}
            brokenCount={broken.length}
          />

          {broken.length > 0 && (
            <>
              <SectionHeader>Broken right now</SectionHeader>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                {broken.map((b) => (
                  <div
                    key={b.key}
                    style={{
                      background: "#fdecea",
                      border: "1px solid #f5b7b1",
                      borderRadius: 10,
                      padding: "12px 16px",
                    }}
                  >
                    <p style={{ margin: "0 0 2px", fontWeight: 700, color: DANGER, fontSize: 15 }}>{b.key}</p>
                    <p style={{ margin: 0, color: "#7a2b23", fontSize: 14 }}>
                      {b.lastError ?? "Failed with no error message recorded."}
                      {b.lastErrorAt ? ` (since ${fmtWhen(b.lastErrorAt)})` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          <SectionHeader>Recent runs</SectionHeader>
          <RunsTable runs={runs.slice(0, RECENT_RUNS_SHOWN)} />

          <SectionHeader>By source ({WINDOW_DAYS}d)</SectionHeader>
          <SourceTable rollups={rollups} />
        </>
      )}

      <SectionHeader>Weekly read</SectionHeader>
      <MemoBlock memo={memo} />
    </div>
  );
}

function VitalsStrip({
  runsInWindow,
  cleanRuns,
  totalInserted,
  totalUpdated,
  brokenCount,
}: {
  runsInWindow: number;
  cleanRuns: number;
  totalInserted: number;
  totalUpdated: number;
  brokenCount: number;
}) {
  const stats: { label: string; value: string; sub?: string }[] = [
    { label: "Runs (14d)", value: String(runsInWindow), sub: `${cleanRuns} clean` },
    { label: "New events (14d)", value: String(totalInserted) },
    { label: "Updated (14d)", value: String(totalUpdated) },
    { label: "Broken sources", value: String(brokenCount), sub: brokenCount > 0 ? "needs a fix" : "none" },
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
        <div key={s.label} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px" }}>
          <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: SUBTLE, fontWeight: 600, margin: "0 0 4px" }}>
            {s.label}
          </p>
          <p style={{ color: INK, fontSize: 24, fontWeight: 700, margin: 0 }}>{s.value}</p>
          {s.sub && <p style={{ color: SUBTLE, fontSize: 12, margin: "2px 0 0" }}>{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function RunsTable({ runs }: { runs: ScrapeRunRow[] }) {
  return (
    <div style={{ overflowX: "auto", marginBottom: 24 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            {["When", "Status", "Duration", "Sources", "Inserted", "Updated"].map((h) => (
              <th key={h} style={{ ...thStyle }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const status = runStatus(r);
            return (
              <tr key={r.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                <td style={tdStyle}>{fmtWhen(r.started_at)}</td>
                <td style={{ ...tdStyle, color: statusColor[status], fontWeight: 600 }}>{statusLabel[status]}</td>
                <td style={tdStyle}>{formatDuration(r.duration_ms)}</td>
                <td style={tdStyle}>
                  {r.sources_attempted}
                  {r.sources_errored > 0 && <span style={{ color: DANGER }}> ({r.sources_errored} err)</span>}
                </td>
                <td style={tdStyle}>{r.total_inserted}</td>
                <td style={tdStyle}>{r.total_updated}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceTable({ rollups }: { rollups: ReturnType<typeof rollupBySource> }) {
  if (rollups.length === 0) {
    return <p style={{ color: MUTED, fontSize: 15, marginBottom: 24 }}>No source data in this window.</p>;
  }
  return (
    <div style={{ overflowX: "auto", marginBottom: 24 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            {["Source", "Runs seen", "Errors", "Inserted", "Updated", "Last error"].map((h) => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rollups.map((r) => (
            <tr key={r.key} style={{ borderBottom: `1px solid ${BORDER}` }}>
              <td style={{ ...tdStyle, fontWeight: 600, color: INK }}>{r.key}</td>
              <td style={tdStyle}>{r.runsSeen}</td>
              <td style={{ ...tdStyle, color: r.errorRuns > 0 ? DANGER : MUTED }}>{r.errorRuns}</td>
              <td style={tdStyle}>{r.totalInserted}</td>
              <td style={tdStyle}>{r.totalUpdated}</td>
              <td style={{ ...tdStyle, color: SUBTLE, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.lastError ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemoBlock({ memo }: { memo: MemoRun | null }) {
  if (!memo) {
    return (
      <div style={{ background: SUBTLE_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, textAlign: "center" }}>
        <p style={{ color: INK, fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>No memo yet.</p>
        <p style={{ color: MUTED, fontSize: 15, margin: 0 }}>
          Runs weekly on Monday, or use Run now (top right) to generate one.
        </p>
      </div>
    );
  }

  const digest = memo.digest;
  return (
    <>
      <p style={{ color: SUBTLE, fontSize: 14, margin: "0 0 12px" }}>
        Generated {fmtWhen(memo.ran_at)}
        {memo.model ? ` · ${memo.model}` : ""}
      </p>

      {memo.status === "error" && (
        <Banner tone="error">{memo.error ?? "The last memo run failed with no error recorded."}</Banner>
      )}

      {digest && (
        <>
          <div style={{ background: "#FDF8F3", border: `1px solid ${BORDER}`, borderLeft: `4px solid ${INK}`, borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
            <p style={{ margin: 0, color: "#2d3a22", fontSize: 16, lineHeight: 1.6 }}>{digest.summary}</p>
          </div>

          {digest.needs_you.length > 0 && (
            <MemoItems title="Needs you" items={digest.needs_you} accent={DANGER} />
          )}
          {digest.fyi.length > 0 && <MemoItems title="Good to know" items={digest.fyi} accent={BORDER} />}
          {digest.watching.length > 0 && <MemoItems title="Worth watching" items={digest.watching} accent="#5a8fa8" />}
        </>
      )}
    </>
  );
}

function MemoItems({ title, items, accent }: { title: string; items: DigestItem[]; accent: string }) {
  return (
    <>
      <h3 style={{ color: INK, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", margin: "16px 0 8px" }}>
        {title}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
        {items.map((item, i) => (
          <article key={i} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${accent}`, borderRadius: 10, padding: 14 }}>
            <h4 style={{ color: INK, fontSize: 15, margin: "0 0 4px", fontWeight: 600 }}>{item.title}</h4>
            <p style={{ color: "#3a3a3a", fontSize: 14, lineHeight: 1.5, margin: 0 }}>{item.detail}</p>
            {item.why && <p style={{ color: SUBTLE, fontSize: 13, margin: "6px 0 0", fontStyle: "italic" }}>{item.why}</p>}
          </article>
        ))}
      </div>
    </>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: INK, fontSize: 15, textTransform: "uppercase", letterSpacing: "0.06em", margin: "24px 0 12px" }}>
      {children}
    </h2>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  color: SUBTLE,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  color: "#3a3a3a",
  whiteSpace: "nowrap",
};
