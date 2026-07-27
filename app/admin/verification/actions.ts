"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/admin/db";
import { isSameEvent, type EventIdentity } from "@/lib/event-identity";
import { failRedirect, flashRedirect, requireField, safeReturnTo } from "@/lib/admin/flash";

const ADMIN_PATH = "/admin/verification";

// `returnTo` lets the briefings verification rail confirm/dismiss in place and
// stay on /admin/briefings; the verification page omits it and falls back here.
async function applyAction(
  id: string,
  patch: Record<string, unknown>,
  flash: string,
  returnTo: string = ADMIN_PATH
) {
  const supabase = getAdminClient();
  const { error } = await supabase.from("hwy4_events").update(patch).eq("id", id);
  if (error) failRedirect(returnTo, error.message);
  revalidatePath(ADMIN_PATH);
  if (returnTo !== ADMIN_PATH) revalidatePath(returnTo);
  revalidatePath("/");
  flashRedirect(returnTo, flash);
}

// Confirm: admin checked manually, the date IS correct. Mark verified so it
// stops appearing in the queue.
export async function confirmEvent(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "event id");
  await applyAction(
    id,
    {
      verification_status: "verified",
      verification_reason: "Manually confirmed by admin.",
      verification_checked_at: new Date().toISOString(),
    },
    "Confirmed.",
    safeReturnTo(formData, ADMIN_PATH)
  );
}

// Dismiss: admin doesn't want to act on this flag (false positive, or doesn't
// care). Stops the verifier from re-checking it.
export async function dismissEvent(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "event id");
  await applyAction(
    id,
    {
      verification_status: "dismissed",
      verification_reason: "Dismissed by admin.",
      verification_checked_at: new Date().toISOString(),
    },
    "Dismissed.",
    safeReturnTo(formData, ADMIN_PATH)
  );
}

// Hide: pull the event off the public site without deleting (visibility=private).
// Leaves the verification flag in place so it stays out of the queue too.
export async function hideEvent(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "event id");
  await applyAction(
    id,
    {
      visibility: "private",
      verification_status: "dismissed",
      verification_reason: "Hidden by admin.",
      verification_checked_at: new Date().toISOString(),
    },
    "Event hidden."
  );
}

// Delete: hard delete. Use when the event is plainly wrong and not worth keeping.
export async function deleteEvent(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "event id");
  const supabase = getAdminClient();
  const { error } = await supabase.from("hwy4_events").delete().eq("id", id);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  revalidatePath("/");
  flashRedirect(ADMIN_PATH, "Event deleted.");
}

// Use organizer's time: /api/verify-events found the organizer's canonical page
// stating a different start than we show, and staged it on the row. This writes
// it AND sets times_locked, so the aggregator that gave us the stale value can't
// restore it on the next nightly scrape (see migration 20260725_add_times_locked).
//
// The times come from the row's verification_suggested_* columns rather than the
// form, so an operator can only ever apply what the verifier actually read off
// the page — the same "machine proposes, human applies" contract as the venue
// blurb/address draft queues.
export async function applyOrganizerTime(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "event id");
  const returnTo = safeReturnTo(formData, ADMIN_PATH);
  const supabase = getAdminClient();

  const { data: row, error: readErr } = await supabase
    .from("hwy4_events")
    .select("verification_suggested_start, verification_suggested_end")
    .eq("id", id)
    .maybeSingle();
  if (readErr) failRedirect(returnTo, readErr.message);
  if (!row?.verification_suggested_start) {
    failRedirect(returnTo, "No organizer time was recorded for this event.");
  }

  await applyAction(
    id,
    {
      start_time: row!.verification_suggested_start,
      end_time: row!.verification_suggested_end ?? null,
      times_locked: true,
      verification_status: "verified",
      verification_reason: "Time applied from the organizer's page and locked.",
      verification_checked_at: new Date().toISOString(),
    },
    "Organizer's time applied and locked.",
    returnTo
  );
}

// ---------------------------------------------------------------------------
// Series-wide dismissal.
//
// A venue's events page routinely omits its recurring programs. Murphys Wine &
// Beer Garden lists Wine-Down Wednesdays, Wine Blending Night and its concert
// series, but not its weekly trivia — so the verifier correctly reports "not on
// the canonical page" for trivia, and would keep reporting it: 23 rows across
// two source names, each surfacing separately as it rolls into the 14-day
// window. Dismissing them one at a time is how a review queue gets abandoned.
//
// This dismisses the whole series in one click, mirroring how
// /admin/posters approve applies to every upcoming row of a recurring event.
// `isSameEvent` deliberately returns false across different dates (it is the
// same-date dedup rule), so `seriesIdentity` omits the date to compare the
// series instead: same town + time slot + a strong signal (identical title,
// overlapping artists, …) is "the same recurring event" on every date.
// ---------------------------------------------------------------------------

const SERIES_IDENTITY_COLUMNS =
  "id, name, date, town, venue_name, start_time, end_time, description, artists";

type SeriesRow = {
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

function seriesIdentity(e: SeriesRow): EventIdentity {
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

export async function dismissEventSeries(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "event id");
  const returnTo = safeReturnTo(formData, ADMIN_PATH);
  const supabase = getAdminClient();

  const { data: target, error: readErr } = await supabase
    .from("hwy4_events")
    .select(SERIES_IDENTITY_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (readErr) failRedirect(returnTo, readErr.message);
  if (!target) failRedirect(returnTo, "Event not found.");

  const today = new Date().toISOString().slice(0, 10);
  const { data: candidates, error: candErr } = await supabase
    .from("hwy4_events")
    .select(SERIES_IDENTITY_COLUMNS)
    .gte("date", today)
    .eq("town", (target as SeriesRow).town)
    .in("verification_status", ["unchecked", "needs_verification"]);
  if (candErr) failRedirect(returnTo, candErr.message);

  const identity = seriesIdentity(target as SeriesRow);
  const ids = ((candidates ?? []) as SeriesRow[])
    .filter((c) => c.id === id || isSameEvent(identity, seriesIdentity(c)))
    .map((c) => c.id);

  const { error: updErr } = await supabase
    .from("hwy4_events")
    .update({
      verification_status: "dismissed",
      verification_reason:
        "Series dismissed by admin (the organizer's page does not list this recurring program).",
      verification_checked_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (updErr) failRedirect(returnTo, updErr.message);

  revalidatePath(ADMIN_PATH);
  if (returnTo !== ADMIN_PATH) revalidatePath(returnTo);
  revalidatePath("/");
  flashRedirect(
    returnTo,
    `Dismissed ${ids.length} occurrence${ids.length === 1 ? "" : "s"} of this series.`
  );
}
