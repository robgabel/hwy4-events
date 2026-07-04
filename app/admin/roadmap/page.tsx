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
        <input name="title" placeholder="Title (required)" required style={adminInput} />
        <textarea
          name="body"
          placeholder="Spec / details (markdown) — this is what Claude Code reads when it builds the ticket."
          rows={4}
          style={{ ...adminInput, resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
            Type
            <select name="type" defaultValue="feature" style={{ ...adminInput, width: "auto" }}>
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
        <Chip color="#1B3A2D" bg="#eef2e9">{TYPE_LABEL[task.type]}</Chip>
      </div>

      <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: INK, lineHeight: 1.35 }}>{task.title}</p>

      {task.body && (
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 13,
            lineHeight: 1.4,
            color: MUTED,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
          }}
        >
          {task.body}
        </p>
      )}

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
