"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/admin/db";
import { failRedirect, flashRedirect, field, requireField } from "@/lib/admin/flash";
import {
  MOVABLE_STATUSES,
  TASK_PRIORITIES,
  TASK_TYPES,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from "@/lib/tasks";

const ADMIN_PATH = "/admin/roadmap";

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

// Create a ticket by hand. Defaults to backlog (manual work is already "approved" —
// only agent-filed rows land in the proposed triage lane).
export async function createTask(formData: FormData) {
  const title = requireField(formData, "title", ADMIN_PATH, "title");
  const supabase = getAdminClient();
  const type = oneOf<TaskType>(field(formData, "type"), TASK_TYPES, "feature");
  const priority = oneOf<TaskPriority>(field(formData, "priority"), TASK_PRIORITIES, "p2");
  const body = field(formData, "body") || null;

  const { data, error } = await supabase
    .from("hwy4_tasks")
    .insert({ title, body, type, priority, status: "backlog", source: "manual", created_by: "rob" })
    .select("ref")
    .single();
  if (error) failRedirect(ADMIN_PATH, error.message);

  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, `Created ${data?.ref ?? "ticket"}: ${title}`);
}

// Move a card to another column. `done` stamps done_at; leaving done clears it.
export async function moveTask(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "task id");
  const status = oneOf<TaskStatus>(field(formData, "status"), MOVABLE_STATUSES, "backlog");
  const supabase = getAdminClient();

  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  patch.done_at = status === "done" ? new Date().toISOString() : null;

  const { error } = await supabase.from("hwy4_tasks").update(patch).eq("id", id);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, `Moved to ${status}.`);
}

// Change a card's priority (the board's ordering lever until DnD/rank ships).
export async function setPriority(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "task id");
  const priority = oneOf<TaskPriority>(field(formData, "priority"), TASK_PRIORITIES, "p2");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_tasks")
    .update({ priority, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, `Priority set to ${priority}.`);
}

// Edit a ticket's title/body (the spec Claude Code reads).
export async function editTask(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "task id");
  const title = requireField(formData, "title", ADMIN_PATH, "title");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_tasks")
    .update({ title, body: field(formData, "body") || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, "Saved.");
}

// Promote an agent-filed proposal out of triage into the working backlog — the
// human approval gate (mirrors approving an agent_actions proposal). Optional note.
export async function promoteTask(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "task id");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_tasks")
    .update({
      status: "backlog",
      decided_note: field(formData, "decided_note") || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "proposed");
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, "Promoted to backlog.");
}

// Dismiss a ticket (agent proposal or otherwise) → won't do, with an optional note.
export async function dismissTask(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "task id");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_tasks")
    .update({
      status: "wont_do",
      decided_note: field(formData, "decided_note") || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, "Dismissed.");
}
