"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/admin/db";
import { failRedirect, flashRedirect, field, requireField } from "@/lib/admin/flash";

const ADMIN_PATH = "/admin/feedback";

// Mark a note as handled. Phase 1 corrections are applied to the event by hand
// (edit it the usual way); this just clears the item from the queue. Nothing
// public changes here, so there's no cache to bust.
export async function resolveFeedback(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "feedback id");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("event_feedback")
    .update({
      status: "approved",
      applied: "note",
      reviewed_at: new Date().toISOString(),
      review_note: field(formData, "review_note") || null,
    })
    .eq("id", id);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, "Marked resolved.");
}

// Decline a note (spam, duplicate, or not actionable). No event changes.
export async function dismissFeedback(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "feedback id");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("event_feedback")
    .update({
      status: "dismissed",
      reviewed_at: new Date().toISOString(),
      review_note: field(formData, "review_note") || null,
    })
    .eq("id", id);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, "Dismissed.");
}
