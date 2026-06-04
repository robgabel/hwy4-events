"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { isSameEvent, type EventIdentity } from "@/lib/event-identity";
import { EVENTS_CACHE_TAG } from "@/lib/events-data";
import { generateEventSlug } from "@/lib/slugs";

const ADMIN_PATH = "/admin/posters";

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

type EventRow = {
  id: string;
  name: string;
  date: string;
  town: string;
  venue_name: string | null;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  artists: string[] | null;
};

const EVENT_IDENTITY_COLUMNS =
  "id, name, date, town, venue_name, start_time, end_time, description, artists";

// The series identity for cross-date matching. The same weekly event has many
// rows (one per date); `isSameEvent` deliberately returns false when two dates
// differ (it's the same-date dedup rule). Omitting `date` here lets it compare
// the series instead: same town + time slot + a strong signal (identical title,
// overlapping artists, ...) is "the same recurring event" across every date.
function seriesIdentity(e: EventRow): EventIdentity {
  return {
    name: e.name,
    town: e.town,
    venue_name: e.venue_name,
    start_time: e.start_time,
    end_time: e.end_time,
    description: e.description,
    artists: e.artists,
  };
}

// Approve a poster swap: set hwy4_events.image_url on EVERY upcoming row of the
// event (a weekly event has many), pinning it with poster_locked=true so no
// re-scrape can overwrite the organizer's art. The poster system then renders it
// untouched (posterKind → "supplied"). Outward, editorial action: always a human
// click, never the agent (PRD-event-poster-loop.md §10).
export async function approvePosterSubmission(formData: FormData) {
  const id = requireId(formData);
  const note = field(formData, "review_note") || null;
  const supabase = getServiceClient();

  const { data: submission, error: subErr } = await supabase
    .from("poster_submissions")
    .select("id, event_id, event_slug, image_url, status")
    .eq("id", id)
    .single();
  if (subErr || !submission) fail("Could not load that submission.");
  if (!submission.image_url) fail("This submission has no uploaded image.");
  if (!submission.event_id) {
    fail("The original event no longer exists, so there's nothing to swap. Dismiss it instead.");
  }

  // Anchor: the exact event the organizer submitted from.
  const { data: anchorData, error: anchorErr } = await supabase
    .from("hwy4_events")
    .select(EVENT_IDENTITY_COLUMNS)
    .eq("id", submission.event_id)
    .single();
  if (anchorErr || !anchorData) {
    fail("The original event no longer exists, so there's nothing to swap. Dismiss it instead.");
  }
  const anchor = anchorData as unknown as EventRow;

  // Candidate rows for the series match: upcoming, same town, not cancelled.
  const today = new Date().toISOString().split("T")[0];
  const { data: candidates } = await supabase
    .from("hwy4_events")
    .select(EVENT_IDENTITY_COLUMNS)
    .eq("town", anchor.town)
    .gte("date", today)
    .neq("status", "cancelled");

  const anchorIdentity = seriesIdentity(anchor);
  const matched = new Map<string, EventRow>();
  matched.set(anchor.id, anchor); // always the submitted row, even if it's today/past
  for (const c of (candidates as EventRow[] | null) ?? []) {
    if (c.id === anchor.id) continue;
    if (isSameEvent(anchorIdentity, seriesIdentity(c))) matched.set(c.id, c);
  }

  const ids = [...matched.keys()];
  const { error: updErr } = await supabase
    .from("hwy4_events")
    .update({ image_url: submission.image_url, poster_locked: true })
    .in("id", ids);
  if (updErr) fail(`Failed to apply the poster: ${updErr.message}`);

  const { error: markErr } = await supabase
    .from("poster_submissions")
    .update({ status: "approved", reviewed_at: new Date().toISOString(), review_note: note })
    .eq("id", id);
  if (markErr) {
    fail(`Poster applied, but failed to mark the submission approved: ${markErr.message}`);
  }

  // A swapped image must show on the public pages: bust the shared events cache
  // (lists) and each affected event detail path.
  revalidateTag(EVENTS_CACHE_TAG, "max");
  revalidatePath("/");
  for (const e of matched.values()) {
    revalidatePath(`/events/${generateEventSlug(e.name, e.date, e.town)}`);
  }
  revalidatePath(ADMIN_PATH);

  const n = ids.length;
  redirect(
    `${ADMIN_PATH}?flash=${encodeURIComponent(
      `Poster applied to ${n} ${n === 1 ? "date" : "dates"} of "${anchor.name}".`
    )}`
  );
}

// Decline a poster swap. No event changes; the uploaded file is removed so the
// bucket doesn't accrete rejected images.
export async function rejectPosterSubmission(formData: FormData) {
  const id = requireId(formData);
  const note = field(formData, "review_note") || null;
  const supabase = getServiceClient();

  const { data: submission } = await supabase
    .from("poster_submissions")
    .select("image_url")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("poster_submissions")
    .update({ status: "rejected", reviewed_at: new Date().toISOString(), review_note: note })
    .eq("id", id);
  if (error) fail(error.message);

  // Best-effort cleanup of the orphaned upload (path is everything after the
  // public bucket prefix in the stored URL).
  const url = submission?.image_url ?? "";
  const marker = "/object/public/event-posters/";
  const at = url.indexOf(marker);
  if (at !== -1) {
    const objectPath = decodeURIComponent(url.slice(at + marker.length));
    if (objectPath) await supabase.storage.from("event-posters").remove([objectPath]);
  }

  revalidatePath(ADMIN_PATH);
  redirect(`${ADMIN_PATH}?flash=${encodeURIComponent("Dismissed.")}`);
}
