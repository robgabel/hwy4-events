"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getServiceClient,
  getUpcomingEvents,
  getRecentBriefings,
  generateNewsletter,
  NEWSLETTER_MODEL,
} from "@/lib/newsletter";

const ADMIN_PATH = "/admin/newsletter";

function requireId(formData: FormData): string {
  const id = (formData.get("id") as string | null)?.trim();
  if (!id) redirect(`${ADMIN_PATH}?error=${encodeURIComponent("Missing draft id.")}`);
  return id as string;
}

function fail(message: string): never {
  redirect(`${ADMIN_PATH}?error=${encodeURIComponent(message)}`);
}

function done(flash: string): never {
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?flash=${encodeURIComponent(flash)}`);
}

// Save hand-edits to the subject/body. Marks the draft edited so the Wednesday
// prepare cron won't clobber it. Editing an approved draft drops it back to
// pending — a changed body must be re-approved before it can ship.
export async function saveDraft(formData: FormData) {
  const id = requireId(formData);
  const subject = (formData.get("subject") as string | null)?.trim() ?? "";
  const content = (formData.get("content") as string | null)?.trim() ?? "";
  if (!subject) fail("Subject is required.");
  if (!content) fail("Body is required.");

  const supabase = getServiceClient();
  const { error } = await supabase
    .from("newsletter_drafts")
    .update({
      subject,
      content,
      edited: true,
      status: "pending",
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "sent");
  if (error) fail(error.message);
  done("Saved. Re-approve to send.");
}

// Approve: lock the draft for Thursday's send.
export async function approveDraft(formData: FormData) {
  const id = requireId(formData);
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("newsletter_drafts")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "sent");
  if (error) fail(error.message);
  done("Approved — this will ship Thursday.");
}

// Unapprove: pull it back to pending so it won't send.
export async function unapproveDraft(formData: FormData) {
  const id = requireId(formData);
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("newsletter_drafts")
    .update({
      status: "pending",
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "sent");
  if (error) fail(error.message);
  done("Moved back to pending. It will not send until re-approved.");
}

// Regenerate: re-run the LLM for the same target Thursday, discarding edits and
// resetting to pending.
export async function regenerateDraft(formData: FormData) {
  const id = requireId(formData);
  const supabase = getServiceClient();

  const { data: draft, error: loadErr } = await supabase
    .from("newsletter_drafts")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) fail(loadErr.message);
  if (!draft) fail("Draft not found.");
  if (draft.status === "sent") fail("That draft has already been sent.");

  try {
    const [events, recentBriefings] = await Promise.all([
      getUpcomingEvents(),
      getRecentBriefings(),
    ]);
    const content = await generateNewsletter(events, recentBriefings);
    const { error } = await supabase
      .from("newsletter_drafts")
      .update({
        content,
        status: "pending",
        approved_at: null,
        edited: false,
        model: NEWSLETTER_MODEL,
        event_count: events.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) fail(error.message);
  } catch (err) {
    fail(err instanceof Error ? err.message : "Regeneration failed.");
  }
  done("Regenerated a fresh draft. Review + approve.");
}
