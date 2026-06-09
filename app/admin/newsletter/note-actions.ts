"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/admin/db";
import { failRedirect, flashRedirect, field } from "@/lib/admin/flash";

// "From Rob" note scheduling, folded into /admin/newsletter (was its own page).
const ADMIN_PATH = "/admin/newsletter";

function parseFields(formData: FormData): {
  body: string;
  starts_at: string;
  ends_at: string;
  error?: string;
} {
  const body = field(formData, "body");
  const starts_at = field(formData, "starts_at");
  const ends_at = field(formData, "ends_at");

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

function noteId(formData: FormData): number {
  const raw = formData.get("id");
  const id = raw ? Number(raw) : NaN;
  if (!Number.isFinite(id)) failRedirect(ADMIN_PATH, "Missing note id.");
  return id;
}

export async function addNote(formData: FormData) {
  const parsed = parseFields(formData);
  if (parsed.error) failRedirect(ADMIN_PATH, parsed.error);
  const supabase = getAdminClient();
  const { error } = await supabase.from("newsletter_notes").insert({
    body: parsed.body,
    starts_at: parsed.starts_at,
    ends_at: parsed.ends_at,
  });
  if (error) failRedirect(ADMIN_PATH, errorFromPg(error));
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, "Note added.");
}

export async function updateNote(formData: FormData) {
  const id = noteId(formData);
  const parsed = parseFields(formData);
  if (parsed.error) failRedirect(ADMIN_PATH, parsed.error);
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("newsletter_notes")
    .update({
      body: parsed.body,
      starts_at: parsed.starts_at,
      ends_at: parsed.ends_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) failRedirect(ADMIN_PATH, errorFromPg(error));
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, "Note updated.");
}

export async function deleteNote(formData: FormData) {
  const id = noteId(formData);
  const supabase = getAdminClient();
  const { error } = await supabase.from("newsletter_notes").delete().eq("id", id);
  if (error) failRedirect(ADMIN_PATH, errorFromPg(error));
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, "Note deleted.");
}
