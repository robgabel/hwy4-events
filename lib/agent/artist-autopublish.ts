import type { ArtistResearch } from "./research-artist";

/**
 * Auto-publish policy for band blurbs (standing rule — Rob, 2026-08-11):
 * a HIGH-confidence research result that produced prose publishes straight to
 * the live columns and INFORMS (Slack ping from the cron route); medium and
 * below still stage a pending draft for a human Save at /admin/artists.
 *
 * Scope: artists only. The venue blurb queue keeps its full human gate — a
 * venue blurb speaks in the site's own voice about a neighbor's business,
 * while a band blurb summarizes an act's own public materials, which is the
 * lower-stakes half; Rob accepted that trade explicitly for high confidence.
 * The drafter's coercion floor (research-artist.ts) still enforces that a
 * sourceless or low-confidence result has NO prose at all, so "high" here
 * means sourced, single-match research — not model optimism.
 *
 * Kept dependency-free (type-only import) so scripts/test can lock the policy
 * without Anthropic/Supabase env. Locked by
 * scripts/test/artist-autopublish.test.ts.
 */
export function shouldAutoPublishArtist(
  research: Pick<ArtistResearch, "confidence" | "blurb">
): boolean {
  return research.confidence === "high" && Boolean(research.blurb);
}

/**
 * The column writes a human Save performs (app/admin/artists/actions.ts
 * saveArtist), with three named divergences:
 *
 *  - links / hometown / is_local are written from the research verbatim, where
 *    saveArtist preserves a pre-existing value when the draft has none. The
 *    difference is unreachable today — every in-app writer stamps
 *    blurb_draft_at, so an existing row never re-enters the drafter's worklist
 *    (0 of 82 prod rows lack the stamp) — but a future link-only writer (the
 *    PRD's Phase 3 artist-link layer is that shape) would reach it; revisit
 *    then.
 *  - blurb_draft_meta is KEPT, not cleared: it is the only place the research
 *    sources/confidence/notes live, and an UNREVIEWED publish must keep its
 *    evidence at rest ("why did we say this?" needs an answer; Clear-and-fix
 *    needs something to review). An auto_published_at marker inside it is what
 *    distinguishes an agent publish from a hand publish. Safe to keep:
 *    /admin/artists' isReviewable short-circuits on isPublished (blurb set)
 *    and the nav badge filters `.is("blurb", null)`, so residual meta cannot
 *    re-list a published row.
 *  - blurb_draft itself IS consumed (null), same as a human Save.
 */
export function autoPublishColumns(research: ArtistResearch, nowIso: string) {
  return {
    blurb: research.blurb,
    genre: research.genre ?? null,
    blurb_generated_at: nowIso,
    links:
      research.links && Object.keys(research.links).length > 0 ? research.links : null,
    hometown: research.hometown ?? null,
    is_local: research.isLocal === true,
    blurb_draft: null,
    blurb_draft_meta: {
      confidence: research.confidence,
      genre: research.genre,
      hometown: research.hometown,
      is_local: research.isLocal,
      links: research.links,
      notes: research.notes,
      sources: research.sources,
      auto_published_at: nowIso,
    },
    blurb_draft_at: nowIso,
    updated_at: nowIso,
  };
}
