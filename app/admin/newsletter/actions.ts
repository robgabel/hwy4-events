"use server";

import { revalidatePath } from "next/cache";
import {
  getServiceClient,
  getUpcomingEvents,
  getRecentBriefings,
  generateNewsletter,
  NEWSLETTER_MODEL,
} from "@/lib/newsletter";
import { failRedirect, flashRedirect, field, requireField } from "@/lib/admin/flash";

const ADMIN_PATH = "/admin/newsletter";

function done(flash: string): never {
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, flash);
}

// Save hand-edits to the subject/body. Leaves the status as-is (a pending draft
// stays queued to auto-send; a vetoed draft stays held) and marks it edited so
// Wednesday's prepare cron won't clobber the changes.
export async function saveDraft(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "draft id");
  const subject = field(formData, "subject");
  const content = field(formData, "content");
  if (!subject) failRedirect(ADMIN_PATH, "Subject is required.");
  if (!content) failRedirect(ADMIN_PATH, "Body is required.");

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
  if (error) failRedirect(ADMIN_PATH, error.message);
  done("Saved.");
}

// Veto: hold this draft so Thursday's send skips it.
export async function vetoDraft(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "draft id");
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
  if (error) failRedirect(ADMIN_PATH, error.message);
  done("Vetoed — this will NOT send Thursday.");
}

// Un-veto: put it back in the queue so it auto-sends Thursday.
export async function unvetoDraft(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "draft id");
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
  if (error) failRedirect(ADMIN_PATH, error.message);
  done("Re-queued — it will auto-send Thursday unless vetoed again.");
}

// Regenerate: re-run the LLM for the same target Thursday, discarding edits and
// returning the draft to the pending (will-auto-send) state.
export async function regenerateDraft(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "draft id");
  const supabase = getServiceClient();

  const { data: draft, error: loadErr } = await supabase
    .from("newsletter_drafts")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) failRedirect(ADMIN_PATH, loadErr.message);
  if (!draft) failRedirect(ADMIN_PATH, "Draft not found.");
  if (draft.status === "sent") failRedirect(ADMIN_PATH, "That draft has already been sent.");

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
    if (error) failRedirect(ADMIN_PATH, error.message);
  } catch (err) {
    // redirect() throws a control-flow signal; let it propagate, only map real errors.
    if (err && typeof err === "object" && "digest" in err) throw err;
    failRedirect(ADMIN_PATH, err instanceof Error ? err.message : "Regeneration failed.");
  }
  done("Regenerated a fresh draft. It will auto-send Thursday unless vetoed.");
}
