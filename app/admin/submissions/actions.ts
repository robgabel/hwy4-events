"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { generateDedupKey } from "@/lib/event-identity";
import { EVENTS_CACHE_TAG } from "@/lib/events-data";
import { TOWNS, CATEGORY_LABELS, type EventCategory } from "@/lib/types";
import { SITE_URL } from "@/lib/constants";
import { townSlug } from "@/lib/slugs";

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

  // A new row must enter the cached upcoming-events list, so bust the tag (not
  // just the path) plus the homepage and the town page.
  revalidateTag(EVENTS_CACHE_TAG, "max");
  revalidatePath("/");
  revalidatePath(`/towns/${townSlug(town)}`);
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?flash=${encodeURIComponent(`Published "${name}".`)}`);
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
  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?flash=${encodeURIComponent("Dismissed.")}`);
}
