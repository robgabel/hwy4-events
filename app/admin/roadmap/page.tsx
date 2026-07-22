import { getAdminClientOrNull } from "@/lib/admin/db";
import { readFlash, type SearchParams } from "@/lib/admin/flash";
import {
  QueueShell,
  EmptyCard,
  INK,
  MUTED,
  SUBTLE,
  ACCENT,
  BORDER,
  CARD_BG,
  adminBtn,
  adminInput,
} from "@/components/admin/ui";
import {
  BOARD_COLUMNS,
  MOVABLE_STATUSES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_TYPES,
  TYPE_LABEL,
  priorityRank,
  type TaskRow,
  type TaskStatus,
} from "@/lib/tasks";
import { createTask, moveTask, setPriority, editTask, promoteTask, dismissTask } from "./actions";

export const dynamic = "force-dynamic";

const DONE_LIMIT = 12; // Done column shows only the most recent — it's an archive, not a worklist.

async function loadTasks(): Promise<TaskRow[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase
    .from("hwy4_tasks")
    .select("*")
    .neq("status", "wont_do")
    .order("created_at", { ascending: false })
    .limit(300);
  return (data as TaskRow[] | null) ?? [];
}

// Column ordering: priority (p0 first), then newest. The board's ordering lever
// until DnD/rank ships (PRD §10).
function forColumn(tasks: TaskRow[], status: TaskStatus): TaskRow[] {
  const rows = tasks
    .filter((t) => t.status === status)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.created_at.localeCompare(a.created_at));
  return status === "done" ? rows.slice(0, DONE_LIMIT) : rows;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const PRIORITY_COLOR: Record<string, string> = { p0: "#922b21", p1: "#b45309", p2: "#4b5563", p3: "#8A7B66" };

// Owner-bucket chips: red = broken right now, pine = makes the site better,
// gray = internal upkeep. Keyed loosely (string) because rows written before the
// 2026-07-22 type migration deploy may still carry legacy values.
const TYPE_CHIP: Record<string, { color: string; bg: string }> = {
  bug: { color: "#922b21", bg: "#fdecea" },
  improvement: { color: "#1B3A2D", bg: "#eef2e9" },
  chore: { color: "#4b5563", bg: "#f3f4f6" },
};

export default async function RoadmapPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { error, flash } = readFlash(await searchParams);
  const tasks = await loadTasks();

  return (
    <QueueShell
      title="Roadmap"
      intro={
        <>
          The build board. File tickets here — you, the cockpit agents, a QA agent, or a Claude Code
          session — then hand an approved one to Claude Code with <code>/build-ticket HWY-N</code>. It
          implements, opens a <strong>draft PR</strong>, and moves the card to <em>In review</em>; you
          merge. Agent-filed tickets land in <strong>Proposed</strong> until you promote them.
        </>
      }
      error={error}
      flash={flash}
    >
      {/* Expand/collapse for ticket cards, no client JS: the <summary> shows the
          clamped preview when closed and hides it when open (the full formatted
          body renders instead). Scoped by the .tkb class. */}
      <style>{`
        details.tkb summary { list-style: none; }
        details.tkb summary::-webkit-details-marker { display: none; }
        details.tkb .tkb-close { display: none; }
        details.tkb[open] .tkb-close { display: inline; }
        details.tkb[open] .tkb-open { display: none; }
        details.tkb[open] .tkb-preview { display: none; }
      `}</style>
      <NewTicket />

      {tasks.length === 0 ? (
        <EmptyCard
          heading="No tickets yet."
          sub="Add one above, or a cockpit agent / Claude Code session will file the first."
        />
      ) : (
        <div
          style={{
            display: "flex",
            gap: 14,
            overflowX: "auto",
            paddingBottom: 12,
            // let columns scroll horizontally on narrow screens rather than squeeze
            WebkitOverflowScrolling: "touch",
          }}
        >
          {BOARD_COLUMNS.map((status) => (
            <Column key={status} status={status} tasks={forColumn(tasks, status)} />
          ))}
        </div>
      )}
    </QueueShell>
  );
}

function NewTicket() {
  return (
    <details style={{ marginBottom: 20 }}>
      <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 600, color: INK }}>
        + New ticket
      </summary>
      <form
        action={createTask}
        style={{
          marginTop: 12,
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <input
          name="title"
          placeholder="Title — plain English, the outcome a person sees (no jargon or file paths)"
          required
          style={adminInput}
        />
        <textarea
          name="body"
          placeholder={
            "First line: one plain sentence on why this matters (it's the card preview).\n" +
            "Bug: **What's happening:** / **What should happen:** / **How to see it:** / **Notes for the builder:**\n" +
            "Improvement or chore: **Problem:** / **What we'll build:** / **Done when:** / **Not doing:** / **Notes for the builder:**"
          }
          rows={6}
          style={{ ...adminInput, resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
            Type
            <select name="type" defaultValue="improvement" style={{ ...adminInput, width: "auto" }}>
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
            Priority
            <select name="priority" defaultValue="p2" style={{ ...adminInput, width: "auto" }}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" style={adminBtn.primary}>
            Add to backlog
          </button>
        </div>
      </form>
    </details>
  );
}

function Column({ status, tasks }: { status: TaskStatus; tasks: TaskRow[] }) {
  const accent = status === "proposed" ? ACCENT : status === "done" ? "#1B3A2D" : INK;
  return (
    <section style={{ flex: "0 0 260px", minWidth: 260, maxWidth: 260 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 4px 10px",
          borderBottom: `2px solid ${accent}`,
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: INK }}>
          {STATUS_LABEL[status]}
        </span>
        <span style={{ fontSize: 13, color: SUBTLE }}>{tasks.length}</span>
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tasks.length === 0 ? (
          <p style={{ color: SUBTLE, fontSize: 13, padding: "4px 2px", margin: 0 }}>—</p>
        ) : (
          tasks.map((t) => <Card key={t.id} task={t} />)
        )}
      </div>
    </section>
  );
}

function Chip({ children, color = "#4b5563", bg = "#f3f4f6" }: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color,
        background: bg,
        border: `1px solid ${color}22`,
        borderRadius: 5,
        padding: "1px 6px",
      }}
    >
      {children}
    </span>
  );
}

function Card({ task }: { task: TaskRow }) {
  const isProposed = task.status === "proposed";
  const typeChip = TYPE_CHIP[task.type] ?? TYPE_CHIP.chore;
  return (
    <article
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${PRIORITY_COLOR[task.priority] ?? MUTED}`,
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: MUTED, fontFamily: "ui-monospace, monospace" }}>
          {task.ref}
        </span>
        <Chip color={PRIORITY_COLOR[task.priority] ?? "#4b5563"}>{task.priority}</Chip>
        <Chip color={typeChip.color} bg={typeChip.bg}>{TYPE_LABEL[task.type] ?? task.type}</Chip>
      </div>

      <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: INK, lineHeight: 1.35 }}>{task.title}</p>

      {task.body && <ExpandableBody body={task.body} />}

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: SUBTLE, marginBottom: 8, flexWrap: "wrap" }}>
        {task.source !== "manual" && <span>via {task.source.replace(/_/g, " ")}</span>}
        <span>{ago(task.created_at)}</span>
        {task.pr_url && (
          <a href={task.pr_url} target="_blank" rel="noopener noreferrer" style={{ color: "#2d5a3d", fontWeight: 600 }}>
            PR{task.pr_number ? ` #${task.pr_number}` : ""} ↗
          </a>
        )}
      </div>

      {isProposed && task.ai_rationale?.rationale ? (
        <p style={{ margin: "0 0 8px", fontSize: 12, color: MUTED, fontStyle: "italic", lineHeight: 1.4 }}>
          {String(task.ai_rationale.rationale)}
        </p>
      ) : null}

      {/* Controls */}
      {isProposed ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <form action={promoteTask} style={{ margin: 0 }}>
            <input type="hidden" name="id" value={task.id} />
            <button type="submit" style={{ ...adminBtn.primary, padding: "6px 12px", fontSize: 13 }}>
              Promote
            </button>
          </form>
          <form action={dismissTask} style={{ margin: 0 }}>
            <input type="hidden" name="id" value={task.id} />
            <button type="submit" style={{ ...adminBtn.danger, padding: "6px 12px", fontSize: 13 }}>
              Dismiss
            </button>
          </form>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <form action={moveTask} style={{ display: "flex", gap: 4, margin: 0 }}>
            <input type="hidden" name="id" value={task.id} />
            <select name="status" defaultValue={task.status} style={{ ...adminInput, fontSize: 13, padding: "5px 6px", flex: 1 }}>
              {MOVABLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <button type="submit" style={{ ...adminBtn.secondary, padding: "5px 10px", fontSize: 13 }}>
              Move
            </button>
          </form>
          <form action={setPriority} style={{ display: "flex", gap: 4, margin: 0 }}>
            <input type="hidden" name="id" value={task.id} />
            <select name="priority" defaultValue={task.priority} style={{ ...adminInput, fontSize: 13, padding: "5px 6px", flex: 1 }}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
            <button type="submit" style={{ ...adminBtn.secondary, padding: "5px 10px", fontSize: 13 }}>
              Set
            </button>
          </form>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, color: SUBTLE }}>Edit</summary>
            <form action={editTask} style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <input type="hidden" name="id" value={task.id} />
              <input name="title" defaultValue={task.title} required style={{ ...adminInput, fontSize: 13 }} />
              <textarea
                name="body"
                defaultValue={task.body ?? ""}
                rows={3}
                style={{ ...adminInput, fontSize: 13, resize: "vertical", fontFamily: "inherit" }}
              />
              <button type="submit" style={{ ...adminBtn.secondary, padding: "5px 10px", fontSize: 13, alignSelf: "flex-start" }}>
                Save
              </button>
            </form>
          </details>
        </div>
      )}
    </article>
  );
}

// --- Ticket body: clamped preview that expands to the full formatted spec ----

// The whole preview is the click target (<details>, zero client JS). Closed: the
// first ~3 lines, markdown marks stripped, plus an "Open full ticket" hint.
// Open: the preview hides (the .tkb style block in RoadmapPage) and the complete
// body renders with its template sections formatted.
function ExpandableBody({ body }: { body: string }) {
  const plain = body.replace(/\*\*/g, "").replace(/^#+\s+/gm, "");
  return (
    <details className="tkb" style={{ marginBottom: 8 }}>
      <summary style={{ cursor: "pointer" }}>
        <p
          className="tkb-preview"
          style={{
            margin: "0 0 2px",
            fontSize: 13,
            lineHeight: 1.4,
            color: MUTED,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
          }}
        >
          {plain}
        </p>
        <span className="tkb-open" style={{ fontSize: 12, fontWeight: 600, color: ACCENT }}>
          Open full ticket ▾
        </span>
        <span className="tkb-close" style={{ fontSize: 12, fontWeight: 600, color: SUBTLE }}>
          Close ▴
        </span>
      </summary>
      <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>
        <TicketBody body={body} />
      </div>
    </details>
  );
}

// Markdown-lite renderer for ticket bodies (CLAUDE.md "Roadmap tickets"): inline
// **bold** (the template's section labels), "- " bullets, "## " headings (legacy
// bodies), blank lines as separators. Each text line is its own paragraph, which
// preserves the template's one-section-per-line shape. No markdown dependency.
function boldSpans(text: string, keyBase: string): React.ReactNode[] {
  return text
    .split(/\*\*([^*]+)\*\*/g)
    .map((part, i) =>
      i % 2 === 1 ? (
        <strong key={`${keyBase}-${i}`} style={{ color: INK }}>
          {part}
        </strong>
      ) : (
        part
      )
    );
}

function TicketBody({ body }: { body: string }) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const key = `ul-${blocks.length}`;
    blocks.push(
      <ul key={key} style={{ margin: "0 0 6px", paddingLeft: 18 }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: MUTED, marginBottom: 2 }}>
            {boldSpans(b, `${key}-${i}`)}
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (line === "") {
      flushBullets();
      return;
    }
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ""));
      return;
    }
    flushBullets();
    if (/^#+\s/.test(line)) {
      blocks.push(
        <p key={`h-${idx}`} style={{ margin: "6px 0 4px", fontSize: 13, lineHeight: 1.5, color: INK, fontWeight: 700 }}>
          {line.replace(/^#+\s+/, "")}
        </p>
      );
    } else {
      blocks.push(
        <p key={`t-${idx}`} style={{ margin: "0 0 6px", fontSize: 13, lineHeight: 1.5, color: MUTED }}>
          {boldSpans(line, `t-${idx}`)}
        </p>
      );
    }
  });
  flushBullets();

  return <div>{blocks}</div>;
}
