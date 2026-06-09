import { getAdminClientOrNull } from "@/lib/admin/db";
import { readFlash, type SearchParams } from "@/lib/admin/flash";
import {
  QueueShell,
  CardList,
  QueueCard,
  EmptyCard,
  CardHeader,
  INK,
  MUTED,
  ACCENT,
  adminBtn,
  adminInput,
} from "@/components/admin/ui";
import type { AgentActionRow } from "@/lib/agent/policy";
import { approveAction, rejectAction, revertExecuted, scanForActions } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // scanForActions / approveAction touch the DB + executor

async function loadActions(): Promise<AgentActionRow[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase
    .from("agent_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(60);
  return (data as AgentActionRow[] | null) ?? [];
}

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  proposed: { label: "proposed", bg: "#fff7ed", fg: "#92400e" },
  approved: { label: "approved", bg: "#eef2ff", fg: "#3730a3" },
  executed: { label: "executed", bg: "#eaf7ea", fg: "#2d5016" },
  rejected: { label: "rejected", bg: "#f3f4f6", fg: "#4b5563" },
  reverted: { label: "reverted", bg: "#f3f4f6", fg: "#4b5563" },
  failed: { label: "failed", bg: "#fdecea", fg: "#922b21" },
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { error, flash } = readFlash(await searchParams);
  const all = await loadActions();
  const proposed = all.filter((a) => a.status === "proposed");
  const recent = all.filter((a) => a.status !== "proposed").slice(0, 15);

  return (
    <QueueShell
      title="Action queue"
      intro={
        <>
          What the agent proposes; what you dispose. Stage 1 of the cockpit: the agent stages
          low-stakes, reversible, internal actions and a human approves each one. Nothing here
          auto-runs. Today: <strong>create_org_row</strong>, draining the link-gap worklist.
        </>
      }
      error={error}
      flash={flash}
    >
      <form action={scanForActions} style={{ margin: "0 0 24px" }}>
        <button type="submit" style={adminBtn.secondary}>
          Scan for link gaps
        </button>
        <span style={{ color: MUTED, fontSize: 14, marginLeft: 10 }}>
          Re-checks the audit worklist and stages any new single-operator venues that need a durable link.
        </span>
      </form>

      <SectionHeader>
        Proposed{" "}
        <span style={{ color: MUTED, fontWeight: 400 }}>
          ({proposed.length})
        </span>
      </SectionHeader>
      {proposed.length === 0 ? (
        <EmptyCard
          heading="Nothing proposed."
          sub={<>Run a scan, or wait for the weekly proposer cron to stage link-gap actions.</>}
        />
      ) : (
        <CardList>
          {proposed.map((a) => (
            <ProposedCard key={a.id} action={a} />
          ))}
        </CardList>
      )}

      {recent.length > 0 && (
        <>
          <SectionHeader>Recently decided</SectionHeader>
          <CardList>
            {recent.map((a) => (
              <DecidedRow key={a.id} action={a} />
            ))}
          </CardList>
        </>
      )}
    </QueueShell>
  );
}

function Badges({ action }: { action: AgentActionRow }) {
  const pill = (text: string, bg: string, fg: string) => (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: fg,
        background: bg,
        border: `1px solid ${fg}22`,
        padding: "2px 8px",
        borderRadius: 6,
      }}
    >
      {text}
    </span>
  );
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
      {pill(action.type, "#eef2e9", "#2d5016")}
      {pill(`blast: ${action.blast_radius}`, "#f3f4f6", "#4b5563")}
      {pill(action.reversible ? "reversible" : "irreversible", "#f3f4f6", "#4b5563")}
      {pill(action.outward_facing ? "outward" : "internal", "#f3f4f6", "#4b5563")}
    </div>
  );
}

function ProposedCard({ action }: { action: AgentActionRow }) {
  const p = action.payload as {
    slug?: string;
    display_name?: string;
    canonical_url?: string;
    match_patterns?: string[];
    town?: string;
  };

  return (
    <QueueCard>
      <Badges action={action} />
      <CardHeader title={action.title ?? action.type} meta={action.rationale ?? undefined} />

      {action.type === "create_org_row" ? (
        <form action={approveAction}>
          <input type="hidden" name="id" value={action.id} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <Field label="Slug" name="slug" defaultValue={p.slug ?? ""} />
            <Field label="Display name" name="display_name" defaultValue={p.display_name ?? ""} />
            <Field
              label="Canonical events URL (required)"
              name="canonical_url"
              defaultValue={p.canonical_url ?? ""}
              placeholder="https://organizer.com/events"
              required
              highlight
            />
            <Field label="Town" name="town" defaultValue={p.town ?? ""} />
            <Field
              label="Match patterns (comma-separated)"
              name="match_patterns"
              defaultValue={(p.match_patterns ?? []).join(", ")}
            />
          </div>
          <p style={{ color: MUTED, fontSize: 13, lineHeight: 1.5, margin: "0 0 12px" }}>
            Find the organizer&rsquo;s own events page and paste it above; the rest is pre-filled. Approving
            inserts the <code>hwy4_orgs</code> row, upgrading every matching event to a durable link.
            Reversible (deletes the row).
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" style={adminBtn.primary}>
              Approve &amp; create
            </button>
            <input
              name="decided_note"
              placeholder="Note (optional)"
              style={{ ...adminInput, flex: 1, minWidth: 160 }}
            />
            <button type="submit" formAction={rejectAction} formNoValidate style={adminBtn.danger}>
              Reject
            </button>
          </div>
        </form>
      ) : (
        // Generic fallback for other action types (none staged by the proposer yet).
        <form action={approveAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="id" value={action.id} />
          <pre style={{ flex: 1, minWidth: 240, fontSize: 12, color: "#555", background: "#faf9f6", padding: 10, borderRadius: 8, overflow: "auto", margin: 0 }}>
            {JSON.stringify(action.payload, null, 2)}
          </pre>
          <button type="submit" style={adminBtn.primary}>
            Approve
          </button>
          <button type="submit" formAction={rejectAction} formNoValidate style={adminBtn.danger}>
            Reject
          </button>
        </form>
      )}
    </QueueCard>
  );
}

function DecidedRow({ action }: { action: AgentActionRow }) {
  const s = STATUS[action.status] ?? STATUS.rejected;
  const when = action.executed_at ?? action.reverted_at ?? action.decided_at ?? action.created_at;
  return (
    <article
      style={{
        background: "#fff",
        border: "1px solid #e8e4de",
        borderRadius: 12,
        padding: "12px 16px",
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: s.fg,
          background: s.bg,
          border: `1px solid ${s.fg}22`,
          padding: "2px 8px",
          borderRadius: 6,
        }}
      >
        {s.label}
      </span>
      <span style={{ color: INK, fontSize: 15, fontWeight: 600, flex: 1, minWidth: 200 }}>
        {action.title ?? action.type}
      </span>
      {action.target_table && (
        <span style={{ color: MUTED, fontSize: 13 }}>
          {action.target_table}
          {action.target_id ? ` · ${action.target_id.slice(0, 8)}` : ""}
        </span>
      )}
      <span style={{ color: "#aaa", fontSize: 13 }}>{fmtWhen(when)}</span>
      {action.error && <span style={{ color: "#922b21", fontSize: 13 }}>{action.error}</span>}
      {action.status === "executed" && action.reversible && (
        <form action={revertExecuted} style={{ margin: 0 }}>
          <input type="hidden" name="id" value={action.id} />
          <button type="submit" style={{ ...adminBtn.secondary, padding: "6px 12px", fontSize: 14 }}>
            Revert
          </button>
        </form>
      )}
    </article>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  highlight,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
  required?: boolean;
  highlight?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: highlight ? ACCENT : "#888",
        }}
      >
        {label}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        style={{
          ...adminInput,
          borderColor: highlight ? ACCENT : "#d9d4cc",
        }}
      />
    </label>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        color: INK,
        fontSize: 15,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        margin: "24px 0 12px",
      }}
    >
      {children}
    </h2>
  );
}
