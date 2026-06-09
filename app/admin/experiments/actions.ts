"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

// Server actions for /admin/experiments (PRD-growth-agent.md, Phase 3). Lets Rob
// log and conclude growth experiments without raw SQL; the growth memo reads
// these rows as ground truth. Mirrors the admin/verification/actions.ts pattern
// (service client behind Basic Auth via middleware.ts).

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials missing");
  return createClient(url, key);
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

export async function addExperiment(formData: FormData) {
  const name = str(formData.get("name"));
  if (!name) return;
  const supabase = serviceClient();
  await supabase.from("growth_experiments").insert({
    name,
    hypothesis: str(formData.get("hypothesis")) || null,
    metric: str(formData.get("metric")) || null,
    baseline: str(formData.get("baseline")) || null,
    status: "running",
  });
  revalidatePath("/admin/experiments");
}

const CONCLUDE = new Set(["won", "lost", "inconclusive", "abandoned"]);

export async function concludeExperiment(formData: FormData) {
  const id = str(formData.get("id"));
  const status = str(formData.get("status"));
  if (!id || !CONCLUDE.has(status)) return;
  const supabase = serviceClient();
  await supabase
    .from("growth_experiments")
    .update({
      status,
      result: str(formData.get("result")) || null,
      concluded_on: new Date().toISOString().split("T")[0],
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath("/admin/experiments");
}

export async function reopenExperiment(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = serviceClient();
  await supabase
    .from("growth_experiments")
    .update({ status: "running", concluded_on: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/experiments");
}

export async function deleteExperiment(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = serviceClient();
  await supabase.from("growth_experiments").delete().eq("id", id);
  revalidatePath("/admin/experiments");
}
