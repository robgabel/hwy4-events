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

// Save hand-edits to the subject/body. Leaves the status as-is (a pending draft
// stays queued to auto-send; a vetoed draft stays held) and marks it edited so
// Wednesday's prepare cron won't clobber the changes.
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "sent");
  if (error) fail(error.message);
  done("Saved.");
}

// Veto: hold this draft so Thursday's send skips it.
export async function vetoDraft(formData: FormData) {
  const id = requireId(formData);
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("newsletter_drafts")
    .update({
      status: "vetoed",
      vetoed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "sent");
  if (error) fail(error.message);
  done("Vetoed — this will NOT send Thursday.");
}

// Un-veto: put it back in the queue so it auto-sends Thursday.
export async function unvetoDraft(formData: FormData) {
  const id = requireId(formData);
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("newsletter_drafts")
    .update({
      status: "pending",
      vetoed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "sent");
  if (error) fail(error.message);
  done("Re-queued — it will auto-send Thursday unless vetoed again.");
}

// Regenerate: re-run the LLM for the same target Thursday, discarding edits and
// returning the draft to the pending (will-auto-send) state.
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
        vetoed_at: null,
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
  done("Regenerated a fresh draft. It will auto-send Thursday unless vetoed.");
}
