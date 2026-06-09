import { getAdminClientOrNull } from "@/lib/admin/db";
import { QueueShell } from "@/components/admin/ui";
import { ConfirmSubmit } from "@/components/admin/ConfirmSubmit";
import {
  addExperiment,
  concludeExperiment,
  reopenExperiment,
  deleteExperiment,
} from "./actions";

export const dynamic = "force-dynamic";

type Experiment = {
  id: string;
  name: string;
  hypothesis: string | null;
  metric: string | null;
  status: string;
  baseline: string | null;
  result: string | null;
  started_on: string;
  concluded_on: string | null;
};

async function loadExperiments(): Promise<Experiment[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase
    .from("growth_experiments")
    .select("id, name, hypothesis, metric, status, baseline, result, started_on, concluded_on")
    .order("started_on", { ascending: false });
  const rows = (data ?? []) as Experiment[];
  // Running first, then most recent.
  return rows.sort((a, b) => {
    const ar = a.status === "running" ? 0 : 1;
    const br = b.status === "running" ? 0 : 1;
    if (ar !== br) return ar - br;
    return b.started_on.localeCompare(a.started_on);
  });
}

const STATUS_COLOR: Record<string, string> = {
  running: "#2563eb",
  won: "#16a34a",
  lost: "#dc2626",
  inconclusive: "#a16207",
  abandoned: "#6b7280",
};

export default async function ExperimentsPage() {
  const experiments = await loadExperiments();
  const running = experiments.filter((e) => e.status === "running");

  return (
    <QueueShell
      title="Experiments"
      intro={
        <>
          The growth agent&rsquo;s memory. Log a deliberate growth change with a hypothesis and the
          metric to watch; the weekly memo reads the running ones and reports an early read on each.
          Conclude them when you have a verdict. {running.length} running.
        </>
      }
    >
      {/* Log a new experiment */}
      <section style={cardStyle}>
        <h2 style={{ color: "#2d5016", fontSize: 17, margin: "0 0 12px" }}>Log a new experiment</h2>
        <form action={addExperiment} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Field label="Name (what changed)" name="name" placeholder="e.g. Newsletter signup on event detail pages" required />
          <Field label="Hypothesis (what you expect to move and why)" name="hypothesis" textarea placeholder="Adding the signup box to high-intent event pages lifts net adds because readers there already care." />
          <Field label="Metric to watch" name="metric" placeholder="Newsletter net adds per week" />
          <Field label="Baseline (where it sits today)" name="baseline" placeholder="~0-2 net/week" />
          <div>
            <button type="submit" style={primaryBtn}>Log experiment</button>
          </div>
        </form>
      </section>

      {experiments.length === 0 ? (
        <Empty />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }}>
          {experiments.map((e) => (
            <ExperimentCard key={e.id} e={e} />
          ))}
        </div>
      )}
    </QueueShell>
  );
}

function ExperimentCard({ e }: { e: Experiment }) {
  const isRunning = e.status === "running";
  const color = STATUS_COLOR[e.status] ?? "#6b7280";
  return (
    <article style={{ ...cardStyle, borderLeft: `4px solid ${color}`, marginBottom: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <h3 style={{ color: "#2d5016", fontSize: 18, margin: 0, fontWeight: 600 }}>{e.name}</h3>
        <span
          style={{
            flexShrink: 0,
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#fff",
            background: color,
            padding: "3px 9px",
            borderRadius: 8,
          }}
        >
          {e.status}
        </span>
      </div>

      <p style={{ color: "#999", fontSize: 13, margin: "4px 0 12px" }}>
        Started {e.started_on}
        {e.concluded_on ? ` · concluded ${e.concluded_on}` : ""}
      </p>

      {e.hypothesis && <Line label="Hypothesis" value={e.hypothesis} />}
      {e.metric && <Line label="Metric" value={e.metric} />}
      {e.baseline && <Line label="Baseline" value={e.baseline} />}
      {e.result && <Line label="Result" value={e.result} accent />}

      {isRunning ? (
        <form action={concludeExperiment} style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <input type="hidden" name="id" value={e.id} />
          <label style={{ ...labelStyle }}>Conclude</label>
          <textarea
            name="result"
            rows={2}
            placeholder="What happened? e.g. net adds went from ~1/wk to ~7/wk over two weeks."
            style={textareaStyle}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select name="status" defaultValue="won" style={selectStyle}>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="inconclusive">Inconclusive</option>
              <option value="abandoned">Abandoned</option>
            </select>
            <button type="submit" style={primaryBtn}>Conclude</button>
          </div>
        </form>
      ) : (
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <form action={reopenExperiment}>
            <input type="hidden" name="id" value={e.id} />
            <button type="submit" style={secondaryBtn}>Reopen</button>
          </form>
          <form action={deleteExperiment}>
            <input type="hidden" name="id" value={e.id} />
            <ConfirmSubmit message={`Delete experiment "${e.name}"? This cannot be undone.`} style={dangerBtn}>
              Delete
            </ConfirmSubmit>
          </form>
        </div>
      )}
    </article>
  );
}

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <p style={{ margin: "0 0 6px", fontSize: 15, lineHeight: 1.5, color: accent ? "#15803d" : "#3a3a3a" }}>
      <span style={{ ...labelStyle, marginRight: 6 }}>{label}:</span>
      {value}
    </p>
  );
}

function Field({
  label,
  name,
  placeholder,
  textarea,
  required,
}: {
  label: string;
  name: string;
  placeholder?: string;
  textarea?: boolean;
  required?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      {textarea ? (
        <textarea name={name} rows={2} placeholder={placeholder} style={textareaStyle} />
      ) : (
        <input name={name} placeholder={placeholder} required={required} style={inputStyle} />
      )}
    </label>
  );
}

function Empty() {
  return (
    <section style={{ ...cardStyle, textAlign: "center", marginTop: 20 }}>
      <p style={{ color: "#666", fontSize: 16, margin: 0 }}>
        No experiments logged yet. Log your first one above so the growth memo has something to
        measure.
      </p>
    </section>
  );
}

const cardStyle = {
  background: "#fff",
  border: "1px solid #e8e4de",
  borderRadius: 12,
  padding: 20,
  marginBottom: 12,
};
const labelStyle = {
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "#8a7b66",
  fontWeight: 600,
};
const inputStyle = {
  fontFamily: "inherit",
  fontSize: 15,
  padding: "8px 10px",
  border: "1px solid #d8d2c8",
  borderRadius: 8,
  background: "#fff",
  color: "#2d3a22",
};
const textareaStyle = { ...inputStyle, resize: "vertical" as const, width: "100%", boxSizing: "border-box" as const };
const selectStyle = { ...inputStyle, cursor: "pointer" };
const primaryBtn = {
  cursor: "pointer",
  background: "#2d5016",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 14,
  fontWeight: 600,
};
const secondaryBtn = {
  cursor: "pointer",
  background: "#fff",
  color: "#2d5016",
  border: "1px solid #2d5016",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 14,
  fontWeight: 600,
};
const dangerBtn = {
  cursor: "pointer",
  background: "#fff",
  color: "#b91c1c",
  border: "1px solid #e7c3c3",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 14,
  fontWeight: 600,
};
