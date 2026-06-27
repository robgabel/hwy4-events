import type { SupabaseClient } from "@supabase/supabase-js";
import { computeVenueGaps } from "@/lib/venue-gaps";
import { researchVenueAddress } from "@/lib/agent/research-venue";
import type { AgentActionRow } from "@/lib/agent/policy";

// The create_venue_row proposer (PRD-live-music-experience.md Phase 1A). Reads the
// shared venue-gap worklist and writes one `proposed` agent_actions row per
// unregistered venue with >= VENUE_GAP_THRESHOLD upcoming events.
//
// Same split as the link-gap proposer: proposing is FAST and deterministic (DB
// queries + inserts, no LLM); the Tier-A address research is a SEPARATE per-card
// step (one Anthropic call), driven on-demand by the "Research address" button and
// in small batches by the cron, so the "Scan" button stays instant.
//
// Idempotent: never duplicates a venue that already has a hwy4_venues row or an
// open create_venue_row proposal.

export type ProposeVenueResult = {
  gaps: number;
  proposed: number;
  skipped: number;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Seed aliases for the registry snippet — the lowercased canonical plus a
// punctuation-stripped variant, deduped. The matcher normalizes apostrophes and
// "&", so these match the common forms; the human refines before committing.
export function seedAliases(canonical: string): string[] {
  const lower = canonical.toLowerCase().trim();
  const noPunct = lower.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return [...new Set([lower, noPunct].filter(Boolean))];
}

export async function proposeVenueRowActions(
  supabase: SupabaseClient
): Promise<ProposeVenueResult> {
  const gaps = await computeVenueGaps(supabase);
  if (gaps.length === 0) return { gaps: 0, proposed: 0, skipped: 0 };

  // Don't propose a venue that already has a registry row (by key).
  const { data: venueRows } = await supabase.from("hwy4_venues").select("venue_key");
  const existingKeys = new Set((venueRows ?? []).map((v) => (v as { venue_key: string }).venue_key));

  // Don't re-propose a venue with an open create_venue_row proposal.
  const { data: openActions } = await supabase
    .from("agent_actions")
    .select("payload")
    .eq("type", "create_venue_row")
    .in("status", ["proposed", "approved"]);
  const queuedKeys = new Set(
    (openActions ?? [])
      .map((a) => (a.payload as { venue_key?: string } | null)?.venue_key)
      .filter((k): k is string => Boolean(k))
  );

  const toInsert = [];
  for (const g of gaps) {
    const venue_key = slugify(g.venue);
    if (!venue_key || existingKeys.has(venue_key) || queuedKeys.has(venue_key)) continue;
    queuedKeys.add(venue_key);
    toInsert.push({
      type: "create_venue_row",
      title: `Register venue "${g.venue}"`,
      rationale: `${g.count} upcoming events list "${g.venue}", but it isn't in the venue registry, so their detail pages show no venue section (no map pin, Google facts, or local-voice blurb). Approving inserts the hwy4_venues row (Google facts then sync automatically). Commit the emitted scripts/lib/venues.ts snippet to link the events durably. Click "Research address" to auto-find the street address.`,
      payload: {
        venue_key,
        canonical: g.venue.trim(),
        town: g.town,
        address: "",
        aliases: seedAliases(g.venue),
        event_count: g.count,
        research: null,
      },
      blast_radius: "low",
      reversible: true,
      outward_facing: false,
      status: "proposed",
    });
  }

  let proposed = 0;
  if (toInsert.length > 0) {
    const { error, count } = await supabase
      .from("agent_actions")
      .insert(toInsert, { count: "exact" });
    if (!error) proposed = count ?? toInsert.length;
  }

  return { gaps: gaps.length, proposed, skipped: gaps.length - proposed };
}

// Research ONE proposed create_venue_row action's street address (one Anthropic
// call). Fast enough for a button click. Fills payload.address + the research blob;
// safe to re-run.
export async function researchVenueById(
  supabase: SupabaseClient,
  id: string
): Promise<{ ok: boolean; confidence?: string; address?: string | null; error?: string }> {
  const { data } = await supabase.from("agent_actions").select("*").eq("id", id).maybeSingle();
  if (!data) return { ok: false, error: "Action not found." };
  const action = data as AgentActionRow;
  if (action.type !== "create_venue_row") return { ok: false, error: "Not a create_venue_row action." };
  if (action.status !== "proposed") return { ok: false, error: `Action is "${action.status}", not researchable.` };

  const p = action.payload as { canonical?: string; town?: string; address?: string };
  const venue = (p.canonical ?? "").trim();
  if (!venue) return { ok: false, error: "Proposal has no venue name to research." };

  let research;
  try {
    research = await researchVenueAddress(venue, p.town ?? null);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const payload = {
    ...action.payload,
    address: research.address ?? p.address ?? "",
    research: {
      confidence: research.confidence,
      sources: research.sources,
      notes: research.notes,
    },
  };
  const { error } = await supabase.from("agent_actions").update({ payload }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, confidence: research.confidence, address: research.address };
}

// Cron helper: research up to `max` proposed create_venue_row actions that still
// have a blank address. Bounded so the cron can't time out (each call ~15-25s).
export async function researchPendingVenueProposals(
  supabase: SupabaseClient,
  max = 2
): Promise<{ researched: number }> {
  const { data } = await supabase
    .from("agent_actions")
    .select("id, payload")
    .eq("type", "create_venue_row")
    .eq("status", "proposed")
    .order("created_at", { ascending: true })
    .limit(20);
  const blanks = ((data ?? []) as { id: string; payload: { address?: string } }[])
    .filter((a) => !(a.payload?.address ?? "").trim())
    .slice(0, max);

  let researched = 0;
  for (const a of blanks) {
    const r = await researchVenueById(supabase, a.id);
    if (r.ok) researched++;
  }
  return { researched };
}
