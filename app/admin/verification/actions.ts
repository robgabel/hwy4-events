"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/admin/db";
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
