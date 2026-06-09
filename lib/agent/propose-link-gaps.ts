import type { SupabaseClient } from "@supabase/supabase-js";
import { computeActionableLinkGaps } from "@/lib/link-gaps";
import { researchOrgCanonical } from "@/lib/agent/research-org";
import type { AgentActionRow } from "@/lib/agent/policy";

// The create_org_row proposer (PRD-agent-cockpit.md, Stage 1). Reads the shared
// actionable-link-gaps worklist and writes one `proposed` agent_actions row per
// single-operator venue that needs a durable link.
//
// Proposing is FAST and deterministic — pure DB queries + inserts, no LLM. The web
// research that finds each venue's canonical URL is a SEPARATE step (one Anthropic
// call per venue), driven on-demand by the "Research URL" button in the cockpit and
// in small batches by the cron. This split keeps the user-facing "Scan" button
// instant: batching 6 web-search calls into one click took ~30-120s and timed out.
//
// Idempotent: re-running never duplicates a venue with an org row or an open proposal.

export type ProposeResult = {
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

export async function proposeLinkGapActions(supabase: SupabaseClient): Promise<ProposeResult> {
  const { actionable } = await computeActionableLinkGaps(supabase);
  if (actionable.length === 0) return { gaps: 0, proposed: 0, skipped: 0 };

  // Don't propose an org that already exists (by slug).
  const { data: orgRows } = await supabase.from("hwy4_orgs").select("slug");
  const existingSlugs = new Set((orgRows ?? []).map((o) => (o as { slug: string }).slug));

  // Don't re-propose a venue that already has an open create_org_row proposal.
  const { data: openActions } = await supabase
    .from("agent_actions")
    .select("payload")
    .eq("type", "create_org_row")
    .in("status", ["proposed", "approved"]);
  const queuedSlugs = new Set(
    (openActions ?? [])
      .map((a) => (a.payload as { slug?: string } | null)?.slug)
      .filter((s): s is string => Boolean(s))
  );

  const toInsert = [];
  for (const g of actionable) {
    const slug = slugify(g.venue);
    if (!slug || existingSlugs.has(slug) || queuedSlugs.has(slug)) continue;
    queuedSlugs.add(slug);
    toInsert.push({
      type: "create_org_row",
      title: `Add an org row for "${g.venue}"`,
      rationale: `${g.count} upcoming events at ${g.venue} resolve only to the non-durable GoCalaveras link. An hwy4_orgs row with the organizer's canonical events URL upgrades all of them to a durable link. Click "Research URL" to auto-find the organizer's events page, or paste it before approving.`,
      payload: {
        slug,
        display_name: g.venue.trim(),
        canonical_url: "",
        match_patterns: [g.venue.trim()],
        town: g.town,
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

  return {
    gaps: actionable.length,
    proposed,
    skipped: actionable.length - proposed,
  };
}

// Research ONE proposed create_org_row action's canonical URL (one Anthropic call).
// Fast enough to run from a button click (the proven "Re-analyze" pattern). Fills
// payload.canonical_url + the research blob; safe to re-run.
export async function researchActionById(
  supabase: SupabaseClient,
  id: string
): Promise<{ ok: boolean; confidence?: string; url?: string | null; error?: string }> {
  const { data } = await supabase.from("agent_actions").select("*").eq("id", id).maybeSingle();
  if (!data) return { ok: false, error: "Action not found." };
  const action = data as AgentActionRow;
  if (action.type !== "create_org_row") return { ok: false, error: "Not a create_org_row action." };
  if (action.status !== "proposed") return { ok: false, error: `Action is "${action.status}", not researchable.` };

  const p = action.payload as { display_name?: string; town?: string; canonical_url?: string };
  const venue = (p.display_name ?? "").trim();
  if (!venue) return { ok: false, error: "Proposal has no venue name to research." };

  let research;
  try {
    research = await researchOrgCanonical(venue, p.town ?? null);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const payload = {
    ...action.payload,
    canonical_url: research.canonical_url ?? p.canonical_url ?? "",
    research: {
      confidence: research.confidence,
      sources: research.sources,
      notes: research.notes,
    },
  };
  const { error } = await supabase.from("agent_actions").update({ payload }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, confidence: research.confidence, url: research.canonical_url };
}

// Cron helper: research up to `max` proposed create_org_row actions that still have
// a blank URL. Bounded so the cron can't time out (each call ~15-25s).
export async function researchPendingProposals(
  supabase: SupabaseClient,
  max = 3
): Promise<{ researched: number }> {
  const { data } = await supabase
    .from("agent_actions")
    .select("id, payload")
    .eq("type", "create_org_row")
    .eq("status", "proposed")
    .order("created_at", { ascending: true })
    .limit(20);
  const blanks = ((data ?? []) as { id: string; payload: { canonical_url?: string } }[])
    .filter((a) => !(a.payload?.canonical_url ?? "").trim())
    .slice(0, max);

  let researched = 0;
  for (const a of blanks) {
    const r = await researchActionById(supabase, a.id);
    if (r.ok) researched++;
  }
  return { researched };
}
