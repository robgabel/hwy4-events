// Roadmap board — shared shapes (PRD-roadmap-board.md). The one definition of a
// task row + its enums, imported by /admin/roadmap (page + actions) and any future
// agent proposer / API. Kept dependency-free so it's safe to import anywhere.

export type TaskStatus =
  | "proposed" // agent-filed, awaiting human promotion (the approval gate)
  | "backlog"
  | "ready" // approved for dev — Claude Code may pick it up
  | "in_progress"
  | "in_review" // a draft PR is open
  | "done"
  | "wont_do";

export type TaskType = "feature" | "bug" | "qa" | "growth" | "chore";
export type TaskPriority = "p0" | "p1" | "p2" | "p3";
export type TaskSource =
  | "chief_of_staff"
  | "growth_memo"
  | "qa_agent"
  | "manual"
  | "cowork"
  | "claude_code";

export type TaskRow = {
  id: string;
  ref: string;
  title: string;
  body: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  rank: number | null;
  source: TaskSource;
  created_by: string | null;
  ai_rationale: Record<string, unknown> | null;
  pr_url: string | null;
  pr_number: number | null;
  branch: string | null;
  before_snapshot: Record<string, unknown> | null;
  linked_event_id: string | null;
  linked_submission_id: string | null;
  linked_run_id: string | null;
  decided_note: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
};

// Board column order (left → right). `proposed` is the triage lane for agent-filed
// tickets; `wont_do` is closed and shown collapsed, not as a column.
export const BOARD_COLUMNS: TaskStatus[] = [
  "proposed",
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "done",
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  proposed: "Proposed",
  backlog: "Backlog",
  ready: "Ready for dev",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  wont_do: "Won't do",
};

export const TYPE_LABEL: Record<TaskType, string> = {
  feature: "Feature",
  bug: "Bug",
  qa: "QA",
  growth: "Growth",
  chore: "Chore",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  p0: "P0 · now",
  p1: "P1 · high",
  p2: "P2 · normal",
  p3: "P3 · someday",
};

export const TASK_TYPES: TaskType[] = ["feature", "bug", "qa", "growth", "chore"];
export const TASK_PRIORITIES: TaskPriority[] = ["p0", "p1", "p2", "p3"];
// Statuses a human can move a card into from the board (a real move, not agent-only).
export const MOVABLE_STATUSES: TaskStatus[] = [
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "done",
  "wont_do",
];

// Priority sort key (p0 first). Board orders each column by priority, then recency.
export function priorityRank(p: TaskPriority): number {
  return TASK_PRIORITIES.indexOf(p);
}
