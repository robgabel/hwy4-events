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
      // Publishing (or explicitly clearing) the blurb consumes any pending AI
      // draft — a human Save is the one and only path that resolves a draft.
      blurb_draft: null,
      blurb_draft_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("venue_key", venueKey);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  revalidatePath("/");
  flashRedirect(ADMIN_PATH, blurb ? `Saved blurb for ${venueKey}.` : `Cleared blurb for ${venueKey}.`);
}

// Explicit clear (the textarea Save also clears on empty; this is the one-click
// path with a confirm, for pulling a wrong blurb fast). Also drops any pending
// draft, so clearing a venue leaves it genuinely empty.
export async function clearBlurb(formData: FormData) {
  const venueKey = requireField(formData, "venue_key", ADMIN_PATH, "venue");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_venues")
    .update({
      blurb: null,
      blurb_generated_at: null,
      blurb_draft: null,
      blurb_draft_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("venue_key", venueKey);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  revalidatePath("/");
  flashRedirect(ADMIN_PATH, `Cleared blurb for ${venueKey}.`);
}

// Discard a pending AI draft without publishing — clears the draft text so the
// venue stays unblurbed and the box goes empty. The one-click "no thanks" on a
// draft the machine queued. (Editing + Save is the "yes, with tweaks" path.)
//
// It deliberately KEEPS blurb_draft_at: that timestamp is the weekly drafter's
// "already proposed, human declined" marker, so a discarded venue is not
// re-drafted next week (respecting the human's no). Writing a blurb by hand, or
// the Clear action, resets it. No public change, so "/" isn't busted.
export async function discardDraft(formData: FormData) {
  const venueKey = requireField(formData, "venue_key", ADMIN_PATH, "venue");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_venues")
    .update({ blurb_draft: null, updated_at: new Date().toISOString() })
    .eq("venue_key", venueKey);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, `Discarded draft for ${venueKey}. It won't be re-drafted automatically.`);
}
