"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/admin/db";
import { failRedirect, field, flashRedirect, requireField } from "@/lib/admin/flash";
import { captureBlurbFact } from "@/lib/local-facts";

const ADMIN_PATH = "/admin/venues";

// Save (or clear, if the textarea is emptied) a venue's local-voice blurb. The
// blurb renders on every event detail page at that venue, so revalidate "/" too.
// Detail pages read the venue at request time, so the edit shows on next load.
export async function saveBlurb(formData: FormData) {
  const venueKey = requireField(formData, "venue_key", ADMIN_PATH, "venue");
  const blurb = field(formData, "blurb");
  const supabase = getAdminClient();

  // Capture what the AI had proposed (if anything) BEFORE the update clears it,
  // so the local_facts record can carry the AI-draft -> human-approved delta.
  const { data: before } = await supabase
    .from("hwy4_venues")
    .select("blurb_draft")
    .eq("venue_key", venueKey)
    .maybeSingle();
  const priorDraft = (before?.blurb_draft as string | null) ?? null;

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

  // KB capture loop (lib/local-facts.ts): persist the human-approved blurb as
  // durable, provenance-carrying knowledge so it grounds future regenerations.
  // Best-effort — a capture failure must never block the publish. Skipped on a
  // clear (empty blurb), which carries no knowledge to keep.
  if (blurb) {
    const cap = await captureBlurbFact(supabase, { venueKey, blurb, priorDraft });
    if (!cap.ok) {
      console.error(`[saveBlurb] local_facts capture failed for ${venueKey}: ${cap.error}`);
    }
  }

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

// Approve (or hand-enter) a venue's street ADDRESS. Mirrors saveBlurb: a human
// click is the only path that writes the live `address` column; the daily address
// drafter only ever stages address_draft. Writing the address consumes any pending
// draft. The map pin + directions read the address at request time, so revalidate
// "/" too. The /admin/venues card also shows a scripts/lib/venues.ts snippet to
// commit so the address survives a registry re-seed (the row is the immediate fix).
export async function saveAddress(formData: FormData) {
  const venueKey = requireField(formData, "venue_key", ADMIN_PATH, "venue");
  const address = field(formData, "address");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_venues")
    .update({
      address: address || null,
      address_draft: null,
      address_draft_meta: null,
      // Stamp the "looked" marker so an emptied/saved venue isn't re-researched.
      address_draft_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("venue_key", venueKey);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  revalidatePath("/");
  flashRedirect(
    ADMIN_PATH,
    address
      ? `Saved address for ${venueKey}. Commit the venues.ts snippet so it survives a re-seed.`
      : `Cleared address for ${venueKey}.`
  );
}

// Discard a pending AI address draft without applying it — clears the suggested
// text but KEEPS address_draft_at as the "already proposed, human declined" marker
// so the daily drafter won't re-research it. (Editing + Save is the "yes" path.)
export async function discardAddressDraft(formData: FormData) {
  const venueKey = requireField(formData, "venue_key", ADMIN_PATH, "venue");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_venues")
    .update({ address_draft: null, address_draft_meta: null, updated_at: new Date().toISOString() })
    .eq("venue_key", venueKey);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, `Discarded address suggestion for ${venueKey}. It won't be re-researched automatically.`);
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
