"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

const ADMIN_PATH = "/admin/verification";

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase credentials");
  return createClient(supabaseUrl, serviceKey);
}

function requireId(formData: FormData): string {
  const id = (formData.get("id") as string | null)?.trim();
  if (!id) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent("Missing event id.")}`);
  }
  return id as string;
}

async function applyAction(
  id: string,
  patch: Record<string, unknown>,
  flash: string
) {
  const supabase = getServiceClient();
  const { error } = await supabase.from("hwy4_events").update(patch).eq("id", id);
  if (error) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(ADMIN_PATH);
  revalidatePath("/");
  redirect(`${ADMIN_PATH}?flash=${encodeURIComponent(flash)}`);
}

// Confirm: admin checked manually, the date IS correct. Mark verified so it
// stops appearing in the queue.
export async function confirmEvent(formData: FormData) {
  const id = requireId(formData);
  await applyAction(
    id,
    {
      verification_status: "verified",
      verification_reason: "Manually confirmed by admin.",
      verification_checked_at: new Date().toISOString(),
    },
    "Confirmed."
  );
}

// Dismiss: admin doesn't want to act on this flag (false positive, or doesn't
// care). Stops the verifier from re-checking it.
export async function dismissEvent(formData: FormData) {
  const id = requireId(formData);
  await applyAction(
    id,
    {
      verification_status: "dismissed",
      verification_reason: "Dismissed by admin.",
      verification_checked_at: new Date().toISOString(),
    },
    "Dismissed."
  );
}

// Hide: pull the event off the public site without deleting (visibility=private).
// Leaves the verification flag in place so it stays out of the queue too.
export async function hideEvent(formData: FormData) {
  const id = requireId(formData);
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
  const id = requireId(formData);
  const supabase = getServiceClient();
  const { error } = await supabase.from("hwy4_events").delete().eq("id", id);
  if (error) {
    redirect(`${ADMIN_PATH}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(ADMIN_PATH);
  revalidatePath("/");
  redirect(`${ADMIN_PATH}?flash=${encodeURIComponent("Event deleted.")}`);
}
