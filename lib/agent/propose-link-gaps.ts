import type { SupabaseClient } from "@supabase/supabase-js";
import { computeActionableLinkGaps } from "@/lib/link-gaps";
import { researchOrgCanonical, type OrgResearch } from "@/lib/agent/research-org";

// The create_org_row proposer (PRD-agent-cockpit.md, Stage 1). Reads the shared
// actionable-link-gaps worklist and writes one `proposed` agent_actions row per
// single-operator venue that needs a durable link. It WEB-RESEARCHES each new
// venue's canonical events page (Sonnet + web_search) so the proposal arrives
// pre-filled — the human verifies and approves rather than researching from
// scratch. Research is best-effort: a miss just leaves canonical_url blank for the
// human. Idempotent: re-running never duplicates a venue with an org row or an open
// proposal. Capped per run so the web-research latency stays bounded.

const NEW_PROPOSALS_PER_RUN = 6;

export type ProposeResult = {
  gaps: number;
  proposed: number;
  researched: number;
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
  if (actionable.length === 0) return { gaps: 0, proposed: 0, researched: 0, skipped: 0 };

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

  let proposed = 0;
  let researched = 0;
  let skipped = 0;
  for (const g of actionable) {
    const slug = slugify(g.venue);
    if (!slug || existingSlugs.has(slug) || queuedSlugs.has(slug)) {
      skipped++;
      continue;
    }
    // Bound web-research latency: defer the rest of the backlog to the next run.
    if (proposed >= NEW_PROPOSALS_PER_RUN) {
      skipped++;
      continue;
    }

    let research: OrgResearch = {
      canonical_url: null,
      confidence: "low",
      display_name: null,
      notes: null,
      sources: [],
    };
    try {
      research = await researchOrgCanonical(g.venue, g.town);
      researched++;
    } catch (err) {
      console.error(`[propose-link-gaps] research failed for "${g.venue}":`, err);
    }

    const base = `${g.count} upcoming events at ${g.venue} resolve only to the non-durable GoCalaveras link. An hwy4_orgs row with the organizer's canonical events URL upgrades all of them to a durable link.`;
    const rationale = research.canonical_url
      ? `${base} Researched canonical (${research.confidence} confidence): ${research.canonical_url}`
      : `${base} Couldn't auto-find a canonical URL — paste the organizer's events page before approving.`;

    const row = {
      type: "create_org_row",
      title: `Add an org row for "${g.venue}"`,
      rationale,
      payload: {
        slug,
        display_name: g.venue.trim(),
        canonical_url: research.canonical_url ?? "",
        match_patterns: [g.venue.trim()],
        town: g.town,
        research: {
          confidence: research.confidence,
          sources: research.sources,
          notes: research.notes,
        },
      },
      blast_radius: "low",
      reversible: true,
      outward_facing: false,
      status: "proposed",
    };
    const { error } = await supabase.from("agent_actions").insert(row);
    if (error) {
      skipped++;
      continue;
    }
    proposed++;
    queuedSlugs.add(slug);
  }

  return { gaps: actionable.length, proposed, researched, skipped };
}
