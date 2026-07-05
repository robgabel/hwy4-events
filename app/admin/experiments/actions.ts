"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/admin/db";
import { field } from "@/lib/admin/flash";

// Server actions for /admin/experiments (PRD-growth-agent.md, Phase 3). Lets Rob
// log and conclude growth experiments without raw SQL; the growth memo reads
// these rows as ground truth. Service client runs behind Basic Auth (middleware.ts).

const ADMIN_PATH = "/admin/experiments";

export async function addExperiment(formData: FormData) {
  const name = field(formData, "name");
  if (!name) return;
  const supabase = getAdminClient();
  await supabase.from("growth_experiments").insert({
    name,
    hypothesis: field(formData, "hypothesis") || null,
    metric: field(formData, "metric") || null,
    baseline: field(formData, "baseline") || null,
    status: "running",
  });
  revalidatePath(ADMIN_PATH);
}

const CONCLUDE = new Set(["won", "lost", "inconclusive", "abandoned"]);

export async function concludeExperiment(formData: FormData) {
  const id = field(formData, "id");
  const status = field(formData, "status");
  if (!id || !CONCLUDE.has(status)) return;
  const supabase = getAdminClient();
  await supabase
    .from("growth_experiments")
    .update({
      status,
      result: field(formData, "result") || null,
      concluded_on: new Date().toISOString().split("T")[0],
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath(ADMIN_PATH);
}

export async function reopenExperiment(formData: FormData) {
  const id = field(formData, "id");
  if (!id) return;
  const supabase = getAdminClient();
  await supabase
    .from("growth_experiments")
    .update({ status: "running", concluded_on: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath(ADMIN_PATH);
}

export async function deleteExperiment(formData: FormData) {
  const id = field(formData, "id");
  if (!id) return;
  const supabase = getAdminClient();
  await supabase.from("growth_experiments").delete().eq("id", id);
  revalidatePath(ADMIN_PATH);
}

// ── Growth lessons (HWY-5): the agent's durable memory. Auto-captured from
// concluded experiments; a human can also add one or archive a wrong one. ──

export async function addLesson(formData: FormData) {
  const lesson = field(formData, "lesson");
  if (!lesson) return;
  const supabase = getAdminClient();
  await supabase.from("growth_lessons").insert({ lesson, source: "manual", status: "active" });
  revalidatePath(ADMIN_PATH);
}

export async function archiveLesson(formData: FormData) {
  const id = field(formData, "id");
  if (!id) return;
  const supabase = getAdminClient();
  await supabase
    .from("growth_lessons")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath(ADMIN_PATH);
}
