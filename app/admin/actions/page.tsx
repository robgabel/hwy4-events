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
import type { AgentActionRow, AgentPolicyRow } from "@/lib/agent/policy";
import {
  approveAction,
  rejectAction,
  revertExecuted,
  scanForActions,
  setPolicy,
  researchAction,
  researchVenueAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // scanForActions web-researches each new proposal

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

async function loadPolicy(): Promise<AgentPolicyRow[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase
    .from("agent_policy")
    .select("action_type, auto_execute, min_clean_weeks, notes")
    .order("action_type");
  return (data as AgentPolicyRow[] | null) ?? [];
}

// Canary stat per action type: how often a human approved it, over how long. The
// graduation bar is ~100% approval for min_clean_weeks. reverted = approved then
// undone — a regret signal, surfaced separately.
function policyStats(actions: AgentActionRow[], type: string) {
  const decided = actions.filter((a) => a.type === type && a.decided_at);
  const executed = decided.filter((a) => a.status === "executed").length;
  const reverted = decided.filter((a) => a.status === "reverted").length;
  const rejected = decided.filter((a) => a.status === "rejected").length;
  const approved = executed + reverted;
  const n = approved + rejected;
  const rate = n > 0 ? approved / n : null;
  const dates = decided.map((a) => a.decided_at as string).sort();
  const weeks =
    dates.length >= 2
      ? Math.round(((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / (7 * 86400000)) * 10) / 10
      : 0;
  return { executed, reverted, rejected, n, rate, weeks };
}

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  proposed: { label: "proposed", bg: "#fff7ed", fg: "#92400e" },
  approved: { label: "approved", bg: "#eef2ff", fg: "#3730a3" },
  executed: { label: "executed", bg: "#eaf7ea", fg: "#1B3A2D" },
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
  const policies = await loadPolicy();
  const proposed = all.filter((a) => a.status === "proposed");
  const recent = all.filter((a) => a.status !== "proposed").slice(0, 15);

  return (
    <QueueShell
      title="Action queue"
      intro={
        <>
          What the agent proposes; what you dispose. Stage 1 of the cockpit: the agent stages
          low-stakes, reversible, internal actions and a human approves each one. Nothing here
          auto-runs. Today: <strong>create_org_row</strong> (link-gap worklist) and{" "}
          <strong>create_venue_row</strong> (unregistered venues with upcoming events).
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

      {policies.length > 0 && <PolicyPanel policies={policies} actions={all} />}
    </QueueShell>
  );
}

function PolicyPanel({
  policies,
  actions,
}: {
  policies: AgentPolicyRow[];
  actions: AgentActionRow[];
}) {
  return (
    <>
      <SectionHeader>
        Autonomy policy <span style={{ color: MUTED, fontWeight: 400 }}>· Stage 2</span>
      </SectionHeader>
      <p style={{ color: MUTED, fontSize: 14, lineHeight: 1.5, margin: "0 0 12px" }}>
        Graduate a type to autonomous only after its approval rate holds ~100% for{" "}
        <code>min_clean_weeks</code>. Even then, only low-blast, reversible, internal,{" "}
        <em>ready</em> proposals auto-run (create_org_row needs a high-confidence researched URL).
        Outward-facing types can never graduate.
      </p>
      <CardList>
        {policies.map((pol) => {
          const st = policyStats(actions, pol.action_type);
          const ratePct = st.rate == null ? "—" : `${Math.round(st.rate * 100)}%`;
          const atBar = st.rate === 1 && st.weeks >= pol.min_clean_weeks && st.n > 0;
          return (
            <article
              style={{
                background: "#fff",
                border: "1px solid #E7E0D5",
                borderLeft: `4px solid ${pol.auto_execute ? "#1B3A2D" : "#d9d4cc"}`,
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                gap: 14,
                alignItems: "center",
                flexWrap: "wrap",
              }}
              key={pol.action_type}
            >
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: INK, fontSize: 16, fontWeight: 600 }}>{pol.action_type}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: pol.auto_execute ? "#1B3A2D" : "#4b5563",
                      background: pol.auto_execute ? "#eaf7ea" : "#f3f4f6",
                      border: `1px solid ${pol.auto_execute ? "#b7e0b7" : "#d8dce2"}`,
                      padding: "2px 8px",
                      borderRadius: 6,
                    }}
                  >
                    {pol.auto_execute ? "autonomous" : "human-approved"}
                  </span>
                </div>
                <p style={{ color: MUTED, fontSize: 13, margin: "4px 0 0" }}>
                  Approval {ratePct} ({st.n} decided{st.reverted ? `, ${st.reverted} reverted` : ""}) ·{" "}
                  {st.weeks} wk of data · bar: 100% for {pol.min_clean_weeks} wk
                  {atBar ? " · ✓ at bar" : ""}
                </p>
              </div>
              <form action={setPolicy} style={{ margin: 0 }}>
                <input type="hidden" name="action_type" value={pol.action_type} />
                <input type="hidden" name="auto_execute" value={pol.auto_execute ? "false" : "true"} />
                <button
                  type="submit"
                  style={pol.auto_execute ? { ...adminBtn.secondary, padding: "8px 14px" } : { ...adminBtn.primary, padding: "8px 14px", fontSize: 15 }}
                >
                  {pol.auto_execute ? "Pause autonomy" : "Graduate to autonomous"}
                </button>
              </form>
            </article>
          );
        })}
      </CardList>
    </>
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
      {pill(action.type, "#eef2e9", "#1B3A2D")}
      {pill(`blast: ${action.blast_radius}`, "#f3f4f6", "#4b5563")}
      {pill(action.reversible ? "reversible" : "irreversible", "#f3f4f6", "#4b5563")}
      {pill(action.outward_facing ? "outward" : "internal", "#f3f4f6", "#4b5563")}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ProposedCard({ action }: { action: AgentActionRow }) {
  return (
    <QueueCard>
      <Badges action={action} />
      <CardHeader title={action.title ?? action.type} meta={action.rationale ?? undefined} />
      {action.type === "create_org_row" ? (
        <OrgProposedBody action={action} />
      ) : action.type === "create_venue_row" ? (
        <VenueProposedBody action={action} />
      ) : (
        <GenericProposedBody action={action} />
      )}
    </QueueCard>
  );
}

type Research = { confidence?: string; sources?: { title: string; url: string }[]; notes?: string };

// Shared research affordance: a "Research X" button + the agent's confidence and
// source links. Reused by the org (canonical URL) and venue (address) proposals.
function ResearchRow({
  id,
  research,
  researchFn,
  label,
  emptyHint,
}: {
  id: string;
  research: Research | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  researchFn: (formData: FormData) => any;
  label: string;
  emptyHint: string;
}) {
  const confColor =
    research?.confidence === "high" ? "#1B3A2D" : research?.confidence === "medium" ? "#92400e" : "#922b21";
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "-4px 0 12px" }}>
      <form action={researchFn} style={{ margin: 0 }}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" style={{ ...adminBtn.secondary, padding: "6px 12px", fontSize: 14 }}>
          🔍 {research ? `Re-research ${label}` : `Research ${label}`}
        </button>
      </form>
      {research ? (
        <span style={{ fontSize: 13, color: MUTED }}>
          Agent research: <strong style={{ color: confColor }}>{research.confidence ?? "low"}</strong> confidence
          {research.sources && research.sources.length > 0 && (
            <>
              {" · "}
              {research.sources.slice(0, 3).map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#2d5a3d", marginRight: 8 }}
                >
                  {hostOf(s.url)} ↗
                </a>
              ))}
            </>
          )}
        </span>
      ) : (
        <span style={{ fontSize: 13, color: MUTED }}>{emptyHint}</span>
      )}
    </div>
  );
}

function OrgProposedBody({ action }: { action: AgentActionRow }) {
  const p = action.payload as {
    slug?: string;
    display_name?: string;
    canonical_url?: string;
    match_patterns?: string[];
    town?: string;
    research?: Research;
  };
  return (
    <>
      <ResearchRow
        id={action.id}
        research={p.research}
        researchFn={researchAction}
        label="URL"
        emptyHint="No URL yet — click Research (~20s), or paste the organizer’s events page below."
      />
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
          Find the organizer’s own events page and paste it above; the rest is pre-filled. Approving
          inserts the <code>hwy4_orgs</code> row, upgrading every matching event to a durable link.
          Reversible (deletes the row).
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" style={adminBtn.primary}>
            Approve &amp; create
          </button>
          <input name="decided_note" placeholder="Note (optional)" style={{ ...adminInput, flex: 1, minWidth: 160 }} />
          <button type="submit" formAction={rejectAction} formNoValidate style={adminBtn.danger}>
            Reject
          </button>
        </div>
      </form>
    </>
  );
}

// Build the scripts/lib/venues.ts KNOWN_VENUES entry to paste + commit. Reflects
// the saved proposal payload; if you edit slug/aliases in the form, mirror them here.
function venuesTsSnippet(p: {
  venue_key?: string;
  canonical?: string;
  town?: string;
  address?: string;
  aliases?: string[];
}): string {
  const aliasLines = (p.aliases ?? []).map((a) => `      ${JSON.stringify(a)},`).join("\n");
  const addressLine = p.address ? `\n    address: ${JSON.stringify(p.address)},` : "";
  return `  ${JSON.stringify(p.venue_key ?? "")}: {
    canonical: ${JSON.stringify(p.canonical ?? "")},
    aliases: [
${aliasLines}
    ],
    town: ${JSON.stringify(p.town ?? "")},${addressLine}
  },`;
}

function VenueProposedBody({ action }: { action: AgentActionRow }) {
  const p = action.payload as {
    venue_key?: string;
    canonical?: string;
    town?: string;
    address?: string;
    aliases?: string[];
    event_count?: number;
    research?: Research;
  };
  return (
    <>
      <ResearchRow
        id={action.id}
        research={p.research}
        researchFn={researchVenueAction}
        label="address"
        emptyHint="No address yet — click Research (~20s), or paste the venue’s street address below."
      />
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
          <Field label="Venue key (slug)" name="venue_key" defaultValue={p.venue_key ?? ""} />
          <Field label="Canonical (display) name" name="canonical" defaultValue={p.canonical ?? ""} />
          <Field label="Town" name="town" defaultValue={p.town ?? ""} />
          <Field
            label="Street address (Tier A — verify)"
            name="address"
            defaultValue={p.address ?? ""}
            placeholder="1154 Pennsylvania Gulch Rd, Murphys, CA 95247"
            highlight
          />
          <Field label="Aliases (comma-separated)" name="aliases" defaultValue={(p.aliases ?? []).join(", ")} />
        </div>
        <p style={{ color: MUTED, fontSize: 13, lineHeight: 1.5, margin: "0 0 12px" }}>
          Verify the address (a wrong one drops the map pin in the wrong place). Approving inserts the{" "}
          <code>hwy4_venues</code> row, so its event pages gain a venue section and the weekly Places sync
          fills the Google facts. Reversible (deletes the row). <strong>To link the venue’s events durably</strong>,
          paste the snippet below into <code>scripts/lib/venues.ts</code> and commit — the matcher is
          registry-driven, so until then the events stay unkeyed.
        </p>
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: INK }}>
            Registry snippet for scripts/lib/venues.ts
          </summary>
          <pre
            style={{
              fontSize: 12,
              color: "#333",
              background: "#FDF8F3",
              border: "1px solid #E7E0D5",
              padding: 12,
              borderRadius: 8,
              overflow: "auto",
              margin: "8px 0 0",
              lineHeight: 1.5,
            }}
          >
            {venuesTsSnippet(p)}
          </pre>
        </details>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" style={adminBtn.primary}>
            Approve &amp; create
          </button>
          <input name="decided_note" placeholder="Note (optional)" style={{ ...adminInput, flex: 1, minWidth: 160 }} />
          <button type="submit" formAction={rejectAction} formNoValidate style={adminBtn.danger}>
            Reject
          </button>
        </div>
      </form>
    </>
  );
}

// Generic fallback for other action types (e.g. flag_spam_submission).
function GenericProposedBody({ action }: { action: AgentActionRow }) {
  return (
    <form action={approveAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="id" value={action.id} />
      <pre style={{ flex: 1, minWidth: 240, fontSize: 12, color: "#555", background: "#FDF8F3", padding: 10, borderRadius: 8, overflow: "auto", margin: 0 }}>
        {JSON.stringify(action.payload, null, 2)}
      </pre>
      <button type="submit" style={adminBtn.primary}>
        Approve
      </button>
      <button type="submit" formAction={rejectAction} formNoValidate style={adminBtn.danger}>
        Reject
      </button>
    </form>
  );
}

function DecidedRow({ action }: { action: AgentActionRow }) {
  const s = STATUS[action.status] ?? STATUS.rejected;
  const when = action.executed_at ?? action.reverted_at ?? action.decided_at ?? action.created_at;
  return (
    <article
      style={{
        background: "#fff",
        border: "1px solid #E7E0D5",
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
