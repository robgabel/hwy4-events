import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { researchVenueAddress } from "./research-venue";

// Self-healing venue ADDRESS drafter (mirrors the weekly blurb_draft queue).
//
// Finds venues in hwy4_venues with no street address, web-researches the Tier-A
// street address (lib/agent/research-venue.ts), and stages it as a PENDING draft
// in address_draft for human review at /admin/venues. It NEVER writes the live
// `address` column — a human Save does (the accuracy contract: a machine may
// draft, a human approves a verified address, because a wrong one drops the map
// pin in the wrong place).
//
// Selection gate is idempotent + self-limiting, same shape as the blurb queue:
//   address IS NULL            — needs one
//   AND address_draft IS NULL  — nothing already staged
//   AND address_draft_at IS NULL — never looked before (the "already tried" marker
//                                  is stamped even when research finds nothing, so a
//                                  venue with no findable address isn't re-run daily)
//   AND COALESCE(places_locked,false) = false — skip the ones we deliberately froze
// So steady state is a no-op; a burst of new venues drains a few per daily run.

export type AddressDraftMeta = {
  confidence: "high" | "medium" | "low";
  notes: string | null;
  sources: { title: string; url: string }[];
};

export type DraftAddressesResult = {
  scanned: number;
  drafted: number; // research returned an address
  empty: number; // looked, found nothing (stamped so we don't retry every day)
  venues: { venue_key: string; address: string | null; confidence: string }[];
};

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function draftMissingVenueAddresses(opts?: {
  limit?: number;
  client?: SupabaseClient;
}): Promise<DraftAddressesResult> {
  const limit = opts?.limit ?? 6;
  const supabase = opts?.client ?? adminClient();
  if (!supabase) throw new Error("Missing Supabase service credentials");

  const { data, error } = await supabase
    .from("hwy4_venues")
    .select("venue_key, canonical, town, places_locked")
    .is("address", null)
    .is("address_draft", null)
    .is("address_draft_at", null)
    .order("canonical")
    .limit(limit);
  if (error) throw error;

  const candidates = (data ?? []).filter((v) => v.places_locked !== true);
  const result: DraftAddressesResult = { scanned: candidates.length, drafted: 0, empty: 0, venues: [] };

  for (const v of candidates) {
    const research = await researchVenueAddress(v.canonical, v.town ?? null);
    const meta: AddressDraftMeta = {
      confidence: research.confidence,
      notes: research.notes,
      sources: research.sources,
    };
    const { error: upErr } = await supabase
      .from("hwy4_venues")
      .update({
        // null when research found nothing — address_draft_at still stamps below,
        // marking "looked, came up empty" so we don't re-research every day.
        address_draft: research.address,
        address_draft_at: new Date().toISOString(),
        address_draft_meta: meta,
        updated_at: new Date().toISOString(),
      })
      .eq("venue_key", v.venue_key);
    if (upErr) throw upErr;

    if (research.address) result.drafted += 1;
    else result.empty += 1;
    result.venues.push({
      venue_key: v.venue_key,
      address: research.address,
      confidence: research.confidence,
    });
  }

  return result;
}
