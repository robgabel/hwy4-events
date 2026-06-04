"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

const ADMIN_PATH = "/admin/feedback";

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase credentials");
  return createClient(supabaseUrl, serviceKey);
}

function fail(message: string): never {
  redirect(`${ADMIN_PATH}?error=${encodeURIComponent(message)}`);
}

function field(formData: FormData, name: string): string {
  return ((formData.get(name) as string | null) ?? "").trim();
}

function requireId(formData: FormData): string {
  const id = field(formData, "id");
  if (!id) fail("Missing feedback id.");
  return id;
}

// Mark a note as handled. Phase 1 corrections are applied to the event by hand
// (edit it the usual way); this just clears the item from the queue. Nothing
// public changes here, so there's no cache to bust.
export async function resolveFeedback(formData: FormData) {
  const id = requireId(formData);
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("event_feedback")
    .update({
      status: "approved",
      applied: "note",
      reviewed_at: new Date().toISOString(),
      review_note: field(formData, "review_note") || null,
    })
    .eq("id", id);
  if (error) fail(error.message);
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?flash=${encodeURIComponent("Marked resolved.")}`);
}

// Decline a note (spam, duplicate, or not actionable). No event changes.
export async function dismissFeedback(formData: FormData) {
  const id = requireId(formData);
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("event_feedback")
    .update({
      status: "dismissed",
      reviewed_at: new Date().toISOString(),
      review_note: field(formData, "review_note") || null,
    })
    .eq("id", id);
  if (error) fail(error.message);
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?flash=${encodeURIComponent("Dismissed.")}`);
}
