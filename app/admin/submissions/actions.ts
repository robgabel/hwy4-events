"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { generateDedupKey } from "@/lib/event-identity";
import { EVENTS_CACHE_TAG } from "@/lib/events-data";
import { TOWNS, CATEGORY_LABELS, type EventCategory } from "@/lib/types";
import { SITE_URL } from "@/lib/constants";
import { townSlug, generateEventSlug } from "@/lib/slugs";
import {
  triageSubmissionById,
  type TriageAnalysis,
  type TriageSuggestedFields,
} from "@/lib/agent/submission-triage";
import {
  generateReply,
  type ReplyOutcome,
  type SubmissionForReply,
} from "@/lib/agent/submission-reply";

const ADMIN_PATH = "/admin/submissions";
const CATEGORIES = Object.keys(CATEGORY_LABELS) as EventCategory[];

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
  if (!id) fail("Missing submission id.");
  return id;
}

// Draft a reply to the submitter and store it on the row (the CRM loop). Returns
// false (does not throw) when there is no email on file, when the agent flags the
// submission as spam (skipSpam), or on a generation error caught upstream — so the
// underlying publish/dismiss action is never blocked by the email step. The human
// sends the draft from their own Gmail via the compose deep-link in the UI.
async function draftAndStoreReply(
  supabase: ReturnType<typeof getServiceClient>,
  submissionId: string,
  outcome: ReplyOutcome,
  ctx: { eventUrl?: string; reason?: string } = {},
  opts: { skipSpam?: boolean } = {}
): Promise<boolean> {
  const { data } = await supabase
    .from("event_submissions")
    .select(
      "event_name, event_date, start_time, venue_name, town, description, event_url, submitter_name, submitter_email, ai_analysis"
    )
    .eq("id", submissionId)
    .maybeSingle();
  if (!data) return false;
  const sub = data as SubmissionForReply & { ai_analysis: TriageAnalysis | null };
  if (!sub.submitter_email) return false;
  if (opts.skipSpam && (sub.ai_analysis?.flags ?? []).includes("possible_spam")) return false;

  const reply = await generateReply(sub, sub.ai_analysis ?? null, outcome, ctx);
  const { error } = await supabase
    .from("event_submissions")
    .update({ ai_reply: reply })
    .eq("id", submissionId);
  return !error;
}

// "Draft a question for the submitter" button on a pending card. Asks the agent to
// write a follow-up targeting the exact gaps it found, then stores it for review.
export async function draftQuestionReply(formData: FormData) {
  const id = requireId(formData);
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("event_submissions")
    .select("submitter_email")
    .eq("id", id)
    .maybeSingle();
  if (!data) fail("Submission not found.");
  if (!(data as { submitter_email: string | null }).submitter_email) {
    fail("No email on file for this submitter, so there is no one to write to.");
  }
  let ok = false;
  try {
    ok = await draftAndStoreReply(supabase, id, "questions");
  } catch (err) {
    fail(`Could not draft a reply: ${err instanceof Error ? err.message : String(err)}`);
  }
  revalidatePath(ADMIN_PATH);
  if (!ok) fail("Could not draft a reply.");
  redirect(`${ADMIN_PATH}?flash=${encodeURIComponent("Drafted a question for the submitter.")}`);
}

// Publish a community submission as a public, community-sourced event. The human
// has reviewed and completed the fields in the form (venue/category are often
// blank on submission) before this runs. Outward, editorial action: always a
// human click, never the agent (see PRD-admin-submissions.md / PRD-agent-cockpit.md).
export async function publishSubmission(formData: FormData) {
  const id = requireId(formData);

  const name = field(formData, "name");
  const date = field(formData, "date");
  const town = field(formData, "town");
  const category = field(formData, "category") as EventCategory;

  if (!name) fail("Event name is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Date must be YYYY-MM-DD.");
  if (!(TOWNS as readonly string[]).includes(town)) fail(`Unknown town: ${town}`);
  if (!CATEGORIES.includes(category)) fail(`Unknown category: ${category}`);

  const supabase = getServiceClient();

  const row = {
    name,
    date,
    start_time: field(formData, "start_time") || null,
    end_time: field(formData, "end_time") || null,
    venue_name: field(formData, "venue_name") || "TBA",
    town,
    description: field(formData, "description") || null,
    category,
    event_url: field(formData, "event_url") || null,
    status: "confirmed",
    visibility: "public",
    community_sourced: true,
    source_name: "Community Submission",
    source_url: `${SITE_URL}/submit`,
    cost_tier: "unknown",
    verification_status: "unchecked",
    is_weekly: false,
    dedup_key: generateDedupKey(name, date, town),
    last_scraped_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("hwy4_events")
    .insert(row)
    .select("id")
    .single();

  if (insertErr) {
    // 23505 = unique_violation on dedup_key: the event already exists (published
    // earlier or scraped). Surface it plainly; do NOT mark the submission approved.
    if (insertErr.code === "23505") {
      fail(
        "An event with this name, date, and town already exists. It may already be published or scraped."
      );
    }
    fail(insertErr.message);
  }
  if (!inserted) fail("Publish failed: the event insert returned no row.");

  const { error: updErr } = await supabase
    .from("event_submissions")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      published_event_id: inserted.id,
    })
    .eq("id", id);

  if (updErr) {
    fail(`Event published, but failed to mark the submission approved: ${updErr.message}`);
  }

  // Draft a "your event is live" reply for the submitter (best-effort; never block
  // the publish on it).
  let replied = false;
  try {
    replied = await draftAndStoreReply(supabase, id, "approved", {
      eventUrl: `${SITE_URL}/events/${generateEventSlug(name, date, town)}`,
    });
  } catch (err) {
    console.error("[publishSubmission] reply draft failed:", err);
  }

  // A new row must enter the cached upcoming-events list, so bust the tag (not
  // just the path) plus the homepage and the town page.
  revalidateTag(EVENTS_CACHE_TAG, "max");
  revalidatePath("/");
  revalidatePath(`/towns/${townSlug(town)}`);
  revalidatePath(ADMIN_PATH);
  const q = new URLSearchParams({ flash: `Published "${name}".` });
  if (replied) q.set("replied", id);
  redirect(`${ADMIN_PATH}?${q.toString()}`);
}

// Re-run the agent triage for one submission on demand (the "Re-analyze" button).
// Forces a fresh verdict even if one already exists. Runs the web search + model
// inline, so it can take ~20s; the page reloads with the new opinion.
export async function reanalyzeSubmission(formData: FormData) {
  const id = requireId(formData);
  const result = await triageSubmissionById(id, { force: true });
  revalidatePath(ADMIN_PATH);
  if (!result.ok && result.error) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent(`Analysis failed: ${result.error}`)}`);
  }
  redirect(`${ADMIN_PATH}?flash=${encodeURIComponent("Re-analyzed.")}`);
}

function isBlank(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  return s === "" || s.toUpperCase() === "TBA";
}

// Merge a submission's new info into an existing event (the "duplicate_needs_update"
// path). Fills ONLY blank fields on the target row from the submission and the
// agent's researched suggestions, respects the *_locked flags, and snapshots the
// target's prior state to event_submissions.merge_snapshot so the merge is fully
// reversible. Identity fields (name/date/town/dedup_key) are never touched.
export async function mergeSubmission(formData: FormData) {
  const id = requireId(formData);
  const eventId = field(formData, "event_id");
  if (!eventId) fail("Missing target event id for merge.");

  const supabase = getServiceClient();

  const { data: subRow } = await supabase
    .from("event_submissions")
    .select(
      "event_name, start_time, venue_name, description, category, event_url, ai_analysis"
    )
    .eq("id", id)
    .maybeSingle();
  if (!subRow) fail("Submission not found.");
  const sub = subRow as {
    event_name: string;
    start_time: string | null;
    venue_name: string | null;
    description: string | null;
    category: string | null;
    event_url: string | null;
    ai_analysis: TriageAnalysis | null;
  };
  const suggested: TriageSuggestedFields = sub.ai_analysis?.suggested ?? {};

  const { data: eventRow, error: evErr } = await supabase
    .from("hwy4_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) fail(evErr.message);
  if (!eventRow) fail("Target event no longer exists; cannot merge.");
  const ev = eventRow as Record<string, unknown>;

  const updates: Record<string, unknown> = {};

  // Description (respect description_locked).
  if (!ev.description_locked && isBlank(ev.description)) {
    const v = sub.description?.trim() || suggested.description?.trim();
    if (v) updates.description = v;
  }
  // Times.
  if (isBlank(ev.start_time)) {
    const v = sub.start_time?.trim() || suggested.start_time?.trim();
    if (v) updates.start_time = v;
  }
  if (isBlank(ev.end_time) && suggested.end_time?.trim()) {
    updates.end_time = suggested.end_time.trim();
  }
  // Venue.
  if (isBlank(ev.venue_name)) {
    const v = sub.venue_name?.trim() || suggested.venue_name?.trim();
    if (v) updates.venue_name = v;
  }
  // Official link.
  if (isBlank(ev.event_url)) {
    const v = sub.event_url?.trim() || suggested.event_url?.trim();
    if (v) updates.event_url = v;
  }
  // Category: only upgrade a generic "other" to something specific.
  if (ev.category === "other") {
    const v = suggested.category && suggested.category !== "other" ? suggested.category : null;
    if (v) updates.category = v;
  }
  // Price (respect price_locked); only fill when currently unknown.
  if (!ev.price_locked && ev.cost_tier === "unknown" && suggested.cost_tier) {
    updates.cost_tier = suggested.cost_tier;
    if (suggested.price?.trim()) updates.price = suggested.price.trim();
  }

  const filled = Object.keys(updates);

  if (filled.length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error: upd } = await supabase.from("hwy4_events").update(updates).eq("id", eventId);
    if (upd) fail(`Merge failed updating the event: ${upd.message}`);
  }

  const note =
    filled.length > 0
      ? `Merged submission; filled: ${filled.join(", ")}.`
      : "Merged submission; the existing event already had every field (nothing to fill).";

  const { error: subUpd } = await supabase
    .from("event_submissions")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      published_event_id: eventId,
      merged_into_event_id: eventId,
      // Pre-merge row, for reversibility (restore by writing this back over eventId).
      merge_snapshot: filled.length > 0 ? ev : null,
      review_note: note,
    })
    .eq("id", id);
  if (subUpd) fail(`Event updated, but failed to close the submission: ${subUpd.message}`);

  // Thank the submitter; their details are now on the (existing) listing.
  let replied = false;
  try {
    const eventUrl =
      typeof ev.name === "string" && typeof ev.date === "string" && typeof ev.town === "string"
        ? `${SITE_URL}/events/${generateEventSlug(ev.name, ev.date, ev.town)}`
        : undefined;
    replied = await draftAndStoreReply(supabase, id, "approved", { eventUrl });
  } catch (err) {
    console.error("[mergeSubmission] reply draft failed:", err);
  }

  if (filled.length > 0) {
    revalidateTag(EVENTS_CACHE_TAG, "max");
    revalidatePath("/");
    if (typeof ev.town === "string") revalidatePath(`/towns/${townSlug(ev.town)}`);
  }
  revalidatePath(ADMIN_PATH);
  const q = new URLSearchParams({ flash: note });
  if (replied) q.set("replied", id);
  redirect(`${ADMIN_PATH}?${q.toString()}`);
}

// Decline a submission (spam, duplicate, or not a fit). No event is created.
export async function dismissSubmission(formData: FormData) {
  const id = requireId(formData);
  const note = field(formData, "review_note") || null;
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("event_submissions")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .eq("id", id);
  if (error) fail(error.message);

  // Draft a gracious decline ONLY when a reason was given (the owner's signal to
  // respond) and the agent did not flag it as spam. Best-effort.
  let replied = false;
  if (note) {
    try {
      replied = await draftAndStoreReply(supabase, id, "declined", { reason: note }, { skipSpam: true });
    } catch (err) {
      console.error("[dismissSubmission] reply draft failed:", err);
    }
  }

  revalidatePath(ADMIN_PATH);
  const q = new URLSearchParams({ flash: "Dismissed." });
  if (replied) q.set("replied", id);
  redirect(`${ADMIN_PATH}?${q.toString()}`);
}
