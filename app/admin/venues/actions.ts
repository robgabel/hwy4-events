"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/admin/db";
import { failRedirect, field, flashRedirect, requireField } from "@/lib/admin/flash";

const ADMIN_PATH = "/admin/venues";

// Save (or clear, if the textarea is emptied) a venue's local-voice blurb. The
// blurb renders on every event detail page at that venue, so revalidate "/" too.
// Detail pages read the venue at request time, so the edit shows on next load.
export async function saveBlurb(formData: FormData) {
  const venueKey = requireField(formData, "venue_key", ADMIN_PATH, "venue");
  const blurb = field(formData, "blurb");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_venues")
    .update({
      blurb: blurb || null,
      // Stamp only when there's text, so a blank row reads as "never written".
      blurb_generated_at: blurb ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("venue_key", venueKey);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  revalidatePath("/");
  flashRedirect(ADMIN_PATH, blurb ? `Saved blurb for ${venueKey}.` : `Cleared blurb for ${venueKey}.`);
}

// Explicit clear (the textarea Save also clears on empty; this is the one-click
// path with a confirm, for pulling a wrong blurb fast).
export async function clearBlurb(formData: FormData) {
  const venueKey = requireField(formData, "venue_key", ADMIN_PATH, "venue");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_venues")
    .update({ blurb: null, blurb_generated_at: null, updated_at: new Date().toISOString() })
    .eq("venue_key", venueKey);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  revalidatePath("/");
  flashRedirect(ADMIN_PATH, `Cleared blurb for ${venueKey}.`);
}
