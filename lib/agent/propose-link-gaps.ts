import type { SupabaseClient } from "@supabase/supabase-js";
import { computeActionableLinkGaps } from "@/lib/link-gaps";

// The create_org_row proposer (PRD-agent-cockpit.md, Stage 1). Reads the shared
// actionable-link-gaps worklist and writes one `proposed` agent_actions row per
// single-operator venue that needs a durable link. The proposal is deterministic
// and pre-fills everything EXCEPT the canonical URL — that one field is the human's
// 30-second research job (find the organizer's events page), done in the approve
// form. The agent surfaces the work and stages it; the human supplies the URL and
// clicks approve; the executor inserts the hwy4_orgs row. Idempotent: re-running
// never duplicates a venue that already has an org row or an open proposal.

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

  let proposed = 0;
  let skipped = 0;
  for (const g of actionable) {
    const slug = slugify(g.venue);
    if (!slug || existingSlugs.has(slug) || queuedSlugs.has(slug)) {
      skipped++;
      continue;
    }
    const row = {
      type: "create_org_row",
      title: `Add an org row for "${g.venue}"`,
      rationale: `${g.count} upcoming events at ${g.venue} resolve only to the non-durable GoCalaveras link. An hwy4_orgs row with the organizer's canonical events URL upgrades all of them to a durable link.`,
      payload: {
        slug,
        display_name: g.venue.trim(),
        canonical_url: "", // the human's research job — fill before approving
        match_patterns: [g.venue.trim()],
        town: g.town,
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

  return { gaps: actionable.length, proposed, skipped };
}
