"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { generateDedupKey, isSameEvent, type EventIdentity } from "@/lib/event-identity";
import { matchVenueRow, type VenueRegistryRow } from "@/lib/venue-match";
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
import { getAdminClient } from "@/lib/admin/db";
import { failRedirect, flashRedirect, field, requireField, safeReturnTo } from "@/lib/admin/flash";

const ADMIN_PATH = "/admin/submissions";
const CATEGORIES = Object.keys(CATEGORY_LABELS) as EventCategory[];

function requireId(formData: FormData): string {
  return requireField(formData, "id", ADMIN_PATH, "submission id");
}

// Draft a reply to the submitter and store it on the row (the CRM loop). Returns
// false (does not throw) when there is no email on file, when the agent flags the
// submission as spam (skipSpam), or on a generation error caught upstream — so the
// underlying publish/dismiss action is never blocked by the email step. The human
// sends the draft from their own Gmail via the compose deep-link in the UI.
async function draftAndStoreReply(
  supabase: ReturnType<typeof getAdminClient>,
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
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("event_submissions")
    .select("submitter_email")
    .eq("id", id)
    .maybeSingle();
  if (!data) failRedirect(ADMIN_PATH, "Submission not found.");
  if (!(data as { submitter_email: string | null }).submitter_email) {
    failRedirect(ADMIN_PATH, "No email on file for this submitter, so there is no one to write to.");
  }
  let ok = false;
  try {
    ok = await draftAndStoreReply(supabase, id, "questions");
  } catch (err) {
    failRedirect(ADMIN_PATH, `Could not draft a reply: ${err instanceof Error ? err.message : String(err)}`);
  }
  revalidatePath(ADMIN_PATH);
  if (!ok) failRedirect(ADMIN_PATH, "Could not draft a reply.");
  flashRedirect(ADMIN_PATH, "Drafted a question for the submitter.");
}

// Draft (or re-draft) a reply for an ALREADY-decided submission, reachable any
// time from the "Recently reviewed" list. Outcome follows the decision: approved
// -> "your event is live", rejected -> a gracious decline. This is the durable
// path to email a submitter after the one-shot post-action banner is gone.
export async function draftReplyForReviewed(formData: FormData) {
  const id = requireId(formData);
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("event_submissions")
    .select("status, review_note, published_event_id, merged_into_event_id, submitter_email")
    .eq("id", id)
    .maybeSingle();
  if (!data) failRedirect(ADMIN_PATH, "Submission not found.");
  const row = data as {
    status: string;
    review_note: string | null;
    published_event_id: string | null;
    merged_into_event_id: string | null;
    submitter_email: string | null;
  };
  if (!row.submitter_email) {
    failRedirect(ADMIN_PATH, "No email on file for this submitter, so there is no one to write to.");
  }

  const outcome: ReplyOutcome = row.status === "rejected" ? "declined" : "approved";
  const ctx: { eventUrl?: string; reason?: string } = {};
  const eventId = row.published_event_id ?? row.merged_into_event_id;
  if (outcome === "approved" && eventId) {
    const { data: ev } = await supabase
      .from("hwy4_events")
      .select("name, date, town")
      .eq("id", eventId)
      .maybeSingle();
    const e = ev as { name: string; date: string; town: string } | null;
    if (e) ctx.eventUrl = `${SITE_URL}/events/${generateEventSlug(e.name, e.date, e.town)}`;
  }
  if (outcome === "declined" && row.review_note) ctx.reason = row.review_note;

  let ok = false;
  try {
    ok = await draftAndStoreReply(supabase, id, outcome, ctx);
  } catch (err) {
    failRedirect(ADMIN_PATH, `Could not draft a reply: ${err instanceof Error ? err.message : String(err)}`);
  }
  revalidatePath(ADMIN_PATH);
  if (!ok) failRedirect(ADMIN_PATH, "Could not draft a reply.");
  flashRedirect(ADMIN_PATH, "Drafted a reply.", { replied: id });
}

// Resolve the reviewer-entered venue against the registry projection in
// `hwy4_venues`, so a published community row carries the same `venue_key` +
// address a scraped row would. Best-effort by design: a read failure resolves to
// null and the publish proceeds unstamped rather than being blocked on it.
async function resolveRegistryVenue(
  supabase: ReturnType<typeof getAdminClient>,
  venueName: string
): Promise<VenueRegistryRow | null> {
  if (!venueName || venueName.toUpperCase() === "TBA") return null;
  const { data, error } = await supabase
    .from("hwy4_venues")
    .select("venue_key, canonical, town, address");
  if (error || !data) return null;
  return matchVenueRow(venueName, data as VenueRegistryRow[]);
}

// The resident event this submission would duplicate, or null.
//
// This is the gate the 2026-07-28 Doc Nancy duplicate walked straight past: the
// publish path raw-inserted the form fields, so the ONLY duplicate check between
// a reviewer's click and the live site was the `dedup_key` unique index, which
// hashes name+date+town and therefore only catches a byte-identical re-listing.
// Every richer layer (read-time collapse, the write-time cross-source merge, the
// nightly reconcile) sits on paths a community publish never touches. Running the
// SHARED `isSameEvent` here puts the community path behind the same definition as
// every scraper. Same date only, since the matcher vetoes a date mismatch anyway.
async function findResidentDuplicate(
  supabase: ReturnType<typeof getAdminClient>,
  candidate: EventIdentity & { date: string }
): Promise<{ id: string; name: string; date: string; town: string } | null> {
  const { data, error } = await supabase
    .from("hwy4_events")
    .select(
      "id, name, date, town, venue_name, address, start_time, end_time, description, artists, venue_key, series_umbrella"
    )
    .eq("date", candidate.date)
    .neq("status", "cancelled");
  if (error || !data) return null;
  const rows = data as (EventIdentity & { id: string; date: string; town: string })[];
  return rows.find((r) => isSameEvent(candidate, r)) ?? null;
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

  if (!name) failRedirect(ADMIN_PATH, "Event name is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) failRedirect(ADMIN_PATH, "Date must be YYYY-MM-DD.");
  if (!(TOWNS as readonly string[]).includes(town)) failRedirect(ADMIN_PATH, `Unknown town: ${town}`);
  if (!CATEGORIES.includes(category)) failRedirect(ADMIN_PATH, `Unknown category: ${category}`);

  const supabase = getAdminClient();

  // A flyer the submitter attached (uploaded to event-posters at submit time).
  // When present, pin it as the event's poster so the poster system shows their
  // art untouched and a re-scrape can't overwrite it (mirrors the organizer
  // poster-swap: image_url + poster_locked).
  const imageUrl = field(formData, "image_url");

  const venueName = field(formData, "venue_name") || "TBA";
  const startTime = field(formData, "start_time") || null;
  const endTime = field(formData, "end_time") || null;
  const description = field(formData, "description") || null;

  // Stamp the registry venue the scrapers would have resolved, so the row can
  // carry a durable venue identity (and light up the venue section + map).
  const registryVenue = await resolveRegistryVenue(supabase, venueName);

  // Refuse a publish the shared matcher reads as an event we already list. The
  // reviewer can override, because the matcher is a heuristic and the human is
  // the authority; what must not happen is publishing a duplicate *silently*.
  if (field(formData, "override_duplicate") !== "1") {
    const dupe = await findResidentDuplicate(supabase, {
      name,
      date,
      town,
      venue_name: venueName,
      address: registryVenue?.address ?? null,
      start_time: startTime,
      end_time: endTime,
      description,
      artists: null,
      venue_key: registryVenue?.venue_key ?? null,
    });
    if (dupe) {
      failRedirect(
        ADMIN_PATH,
        `"${dupe.name}" (${dupe.date}, ${dupe.town}) is already listed and reads as this same event. Merge into it instead, or tick "Publish anyway" if it really is separate.`
      );
    }
  }

  const row = {
    name,
    date,
    start_time: startTime,
    end_time: endTime,
    venue_name: venueName,
    ...(registryVenue
      ? { venue_key: registryVenue.venue_key, address: registryVenue.address }
      : {}),
    town,
    description,
    category,
    event_url: field(formData, "event_url") || null,
    ...(imageUrl ? { image_url: imageUrl, poster_locked: true } : {}),
    status: "confirmed",
    visibility: "public",
    community_sourced: true,
    source_name: "Community Submission",
    source_url: `${SITE_URL}/submit`,
    cost_tier: "unknown",
    // Publishing IS the verification: a human reviewed this submission before
    // clicking Publish, so the event never shows the "Worth a call first"
    // disclosure (lib/confidence.ts). Seed-owned community rows (e.g. the Arnold
    // Library storytime) don't pass through here and keep their own status.
    verification_status: "verified",
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
      failRedirect(
        ADMIN_PATH,
        "An event with this name, date, and town already exists. It may already be published or scraped."
      );
    }
    failRedirect(ADMIN_PATH, insertErr.message);
  }
  if (!inserted) failRedirect(ADMIN_PATH, "Publish failed: the event insert returned no row.");

  const { error: updErr } = await supabase
    .from("event_submissions")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      published_event_id: inserted.id,
    })
    .eq("id", id);

  if (updErr) {
    failRedirect(ADMIN_PATH, `Event published, but failed to mark the submission approved: ${updErr.message}`);
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
  flashRedirect(ADMIN_PATH, `Published "${name}".`, replied ? { replied: id } : undefined);
}

// Re-run the agent triage for one submission on demand (the "Re-analyze" button).
// Forces a fresh verdict even if one already exists. Runs the web search + model
// inline, so it can take ~20s; the page reloads with the new opinion.
export async function reanalyzeSubmission(formData: FormData) {
  const id = requireId(formData);
  const result = await triageSubmissionById(id, { force: true });
  revalidatePath(ADMIN_PATH);
  if (!result.ok && result.error) {
    failRedirect(ADMIN_PATH, `Analysis failed: ${result.error}`);
  }
  flashRedirect(ADMIN_PATH, "Re-analyzed.");
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
  if (!eventId) failRedirect(ADMIN_PATH, "Missing target event id for merge.");

  const supabase = getAdminClient();

  const { data: subRow } = await supabase
    .from("event_submissions")
    .select(
      "event_name, start_time, venue_name, description, category, event_url, ai_analysis"
    )
    .eq("id", id)
    .maybeSingle();
  if (!subRow) failRedirect(ADMIN_PATH, "Submission not found.");
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
  if (evErr) failRedirect(ADMIN_PATH, evErr.message);
  if (!eventRow) failRedirect(ADMIN_PATH, "Target event no longer exists; cannot merge.");
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
    if (upd) failRedirect(ADMIN_PATH, `Merge failed updating the event: ${upd.message}`);
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
  if (subUpd) failRedirect(ADMIN_PATH, `Event updated, but failed to close the submission: ${subUpd.message}`);

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
  flashRedirect(ADMIN_PATH, note, replied ? { replied: id } : undefined);
}

// Decline a submission (spam, duplicate, or not a fit). No event is created.
// Reversible (a status flip, the row + data stay intact). `returnTo` lets the
// briefings action rail dismiss in place and stay on /admin/briefings; the
// submissions page omits it and falls back here.
export async function dismissSubmission(formData: FormData) {
  const id = requireId(formData);
  const returnTo = safeReturnTo(formData, ADMIN_PATH);
  const note = field(formData, "review_note") || null;
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("event_submissions")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .eq("id", id);
  if (error) failRedirect(returnTo, error.message);

  // Draft a gracious decline ONLY when a reason was given (the owner's signal to
  // respond) and the agent did not flag it as spam. Best-effort. The rail dismisses
  // with no note, so no email is drafted — a pure, reversible status flip.
  let replied = false;
  if (note) {
    try {
      replied = await draftAndStoreReply(supabase, id, "declined", { reason: note }, { skipSpam: true });
    } catch (err) {
      console.error("[dismissSubmission] reply draft failed:", err);
    }
  }

  revalidatePath(ADMIN_PATH);
  if (returnTo !== ADMIN_PATH) revalidatePath(returnTo);
  flashRedirect(returnTo, "Dismissed.", replied ? { replied: id } : undefined);
}
