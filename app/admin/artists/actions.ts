"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/admin/db";
import { failRedirect, field, flashRedirect, requireField } from "@/lib/admin/flash";

const ADMIN_PATH = "/admin/artists";

// Publish (or clear) an artist's genre + blurb + outbound links. A human Save is the
// ONLY path that writes the live columns — the daily drafter only ever stages
// blurb_draft. Publishing consumes the pending draft: we clear blurb_draft/meta and
// KEEP blurb_draft_at as a stamp so a link-only or blank save isn't re-researched
// tomorrow (the drafter's gate skips any row whose blurb_draft_at is set).
//
// Links are applied from the pending draft's meta (Tier-A attribution — the model's
// job was to find the right site/socials; Rob's ask is to always link out when we
// can). hometown/is_local ride along too.
export async function saveArtist(formData: FormData) {
  const artistKey = requireField(formData, "artist_key", ADMIN_PATH, "artist");
  const genre = field(formData, "genre");
  const blurb = field(formData, "blurb");
  const supabase = getAdminClient();

  // Pull the researched links/hometown/is_local from the pending draft meta so a
  // publish carries them onto the live row. Read before the update clears the draft.
  const { data: before } = await supabase
    .from("hwy4_artists")
    .select("blurb_draft_meta, links, hometown, is_local")
    .eq("artist_key", artistKey)
    .maybeSingle();
  const meta = (before?.blurb_draft_meta as Record<string, unknown> | null) ?? null;
  const draftLinks = (meta?.links as Record<string, string> | undefined) ?? undefined;
  const draftHometown = typeof meta?.hometown === "string" ? (meta.hometown as string) : null;
  const draftIsLocal = meta?.is_local === true;

  const { error } = await supabase
    .from("hwy4_artists")
    .update({
      genre: genre || null,
      blurb: blurb || null,
      blurb_generated_at: blurb ? new Date().toISOString() : null,
      // Apply researched links only when the row has none yet (don't clobber a
      // hand-set links object on a re-save that carries no draft).
      links: draftLinks ?? (before?.links as Record<string, string> | null) ?? null,
      hometown: draftHometown ?? (before?.hometown as string | null) ?? null,
      is_local: draftIsLocal || before?.is_local === true,
      // Consume the pending draft; keep blurb_draft_at as the resolved marker.
      blurb_draft: null,
      blurb_draft_meta: null,
      blurb_draft_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("artist_key", artistKey);
  if (error) failRedirect(ADMIN_PATH, error.message);

  revalidatePath(ADMIN_PATH);
  flashRedirect(
    ADMIN_PATH,
    blurb || genre ? `Saved ${artistKey}.` : `Saved links for ${artistKey}.`
  );
}

// Clear a published artist back to empty (pull a wrong blurb fast). Also drops any
// pending draft. Leaves blurb_draft_at set so it isn't immediately re-drafted; use
// the drafter's manual limit if you want a fresh pass.
export async function clearArtist(formData: FormData) {
  const artistKey = requireField(formData, "artist_key", ADMIN_PATH, "artist");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_artists")
    .update({
      genre: null,
      blurb: null,
      blurb_generated_at: null,
      links: null,
      blurb_draft: null,
      blurb_draft_meta: null,
      blurb_draft_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("artist_key", artistKey);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, `Cleared ${artistKey}.`);
}

// Discard a pending AI draft without publishing — clears the draft text/meta but
// KEEPS blurb_draft_at as the "already proposed, human declined" marker so the daily
// drafter won't re-research it. (Editing + Save is the "yes" path.)
export async function discardArtistDraft(formData: FormData) {
  const artistKey = requireField(formData, "artist_key", ADMIN_PATH, "artist");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("hwy4_artists")
    .update({ blurb_draft: null, blurb_draft_meta: null, updated_at: new Date().toISOString() })
    .eq("artist_key", artistKey);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, `Discarded draft for ${artistKey}. It won't be re-drafted automatically.`);
}
