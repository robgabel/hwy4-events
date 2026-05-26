"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

const ADMIN_PATH = "/admin/newsletter-note";

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase credentials");
  return createClient(supabaseUrl, serviceKey);
}

function parseFields(formData: FormData): {
  body: string;
  starts_at: string;
  ends_at: string;
  error?: string;
} {
  const body = (formData.get("body") as string | null)?.trim() ?? "";
  const starts_at = (formData.get("starts_at") as string | null)?.trim() ?? "";
  const ends_at = (formData.get("ends_at") as string | null)?.trim() ?? "";

  if (!body) return { body, starts_at, ends_at, error: "Note body is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(starts_at) || !/^\d{4}-\d{2}-\d{2}$/.test(ends_at)) {
    return { body, starts_at, ends_at, error: "Both start and end dates are required (YYYY-MM-DD)." };
  }
  if (starts_at > ends_at) {
    return { body, starts_at, ends_at, error: "Start date must be on or before end date." };
  }
  return { body, starts_at, ends_at };
}

function errorFromPg(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/newsletter_notes_no_overlap|exclusion constraint/i.test(msg)) {
    return "That date window overlaps an existing note. Adjust the dates or delete the conflicting note.";
  }
  if (/newsletter_notes_window_valid|check constraint/i.test(msg)) {
    return "Start date must be on or before end date.";
  }
  return msg;
}

export async function addNote(formData: FormData) {
  const parsed = parseFields(formData);
  if (parsed.error) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent(parsed.error)}`);
  }
  const supabase = getServiceClient();
  const { error } = await supabase.from("newsletter_notes").insert({
    body: parsed.body,
    starts_at: parsed.starts_at,
    ends_at: parsed.ends_at,
  });
  if (error) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent(errorFromPg(error))}`);
  }
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?added=1`);
}

export async function updateNote(formData: FormData) {
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : NaN;
  if (!Number.isFinite(id)) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent("Missing note id.")}`);
  }
  const parsed = parseFields(formData);
  if (parsed.error) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent(parsed.error)}`);
  }
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("newsletter_notes")
    .update({
      body: parsed.body,
      starts_at: parsed.starts_at,
      ends_at: parsed.ends_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent(errorFromPg(error))}`);
  }
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?updated=1`);
}

export async function deleteNote(formData: FormData) {
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : NaN;
  if (!Number.isFinite(id)) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent("Missing note id.")}`);
  }
  const supabase = getServiceClient();
  const { error } = await supabase.from("newsletter_notes").delete().eq("id", id);
  if (error) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent(errorFromPg(error))}`);
  }
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?deleted=1`);
}
