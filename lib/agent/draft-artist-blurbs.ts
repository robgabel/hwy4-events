import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pacificToday } from "@/lib/date-windows";
import { researchArtist, type ArtistResearch } from "./research-artist";
import { buildArtistWorklist, type CatalogRow, type ShowRow } from "./artist-worklist";
import { autoPublishColumns, shouldAutoPublishArtist } from "./artist-autopublish";

// Self-healing artist/band-blurb drafter (PRD-artist-descriptions.md, Phase 1).
// Mirrors lib/agent/draft-venue-addresses.ts, with one deliberate divergence.
//
// Worklist: the distinct acts named in the `artists` field of upcoming PUBLIC
// live_music events that don't yet have a resolved hwy4_artists row. For each, it
// web-researches the act (lib/agent/research-artist.ts — conservative, errs on
// nothing). What happens next is a SPLIT policy (standing rule — Rob, 2026-08-11):
// a HIGH-confidence result with prose auto-publishes the live
// `blurb`/`genre`/`links` outright (the cron route Slack-informs; no approval),
// while medium and below stage a PENDING draft that only a human Save at
// /admin/artists publishes. See lib/agent/artist-autopublish.ts for the policy
// and why artists (not venues) earned it.
//
// Idempotent + self-limiting. Who gets researched is decided by
// ./artist-worklist.ts (2026-10-04): acts are grouped by identity so a variant
// spelling never re-researches a covered act, a result lands on the act's
// existing row, the researcher is handed the act's bookings, and a tried-blank
// act is retried only on new evidence (a new venue, prose the voice floor
// dropped, research that predates the listings context) or after 60 days.
// blurb_draft_at is still stamped on every result, and never-researched acts
// always take the batch first.
// Steady state is a no-op; a burst of newly-scraped acts drains a few per run.

export type DraftArtistsResult = {
  scanned: number; // distinct candidate acts found needing a draft
  researched: number; // acts we actually ran this batch (bounded by limit)
  drafted: number; // research produced a blurb staged as a pending draft
  published: number; // high-confidence results auto-published live (Rob's rule)
  empty: number; // looked, found nothing publishable (still stamped)
  artists: {
    artist_key: string;
    name: string;
    confidence: string;
    hasBlurb: boolean;
    published: boolean;
  }[];
};

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Upcoming public live-music listings that name an act. The worklist rules
// (identity grouping, show context, retries) live in ./artist-worklist.ts.
async function fetchShows(supabase: SupabaseClient): Promise<ShowRow[]> {
  const today = pacificToday().iso;
  const { data, error } = await supabase
    .from("hwy4_events")
    .select("artists, name, town, venue_name, date, event_url, description")
    .eq("category", "live_music")
    .eq("visibility", "public")
    .gte("date", today)
    .neq("status", "cancelled")
    .neq("is_routine", true) // match the public feed (live_music is never routine, but be exact)
    .not("artists", "is", null);
  if (error) throw error;
  return (data ?? []) as ShowRow[];
}

export async function draftMissingArtistBlurbs(opts?: {
  limit?: number;
  client?: SupabaseClient;
}): Promise<DraftArtistsResult> {
  const limit = opts?.limit ?? 6;
  const supabase = opts?.client ?? adminClient();
  if (!supabase) throw new Error("Missing Supabase service credentials");

  const shows = await fetchShows(supabase);
  const { data: catalog, error: catErr } = await supabase
    .from("hwy4_artists")
    .select("artist_key, name, blurb, genre, links, blurb_draft, blurb_draft_at, blurb_draft_meta");
  if (catErr) throw catErr;

  const todo = buildArtistWorklist(shows, (catalog ?? []) as CatalogRow[], Date.now());
  const result: DraftArtistsResult = {
    scanned: todo.length,
    researched: 0,
    drafted: 0,
    published: 0,
    empty: 0,
    artists: [],
  };

  for (const c of todo.slice(0, limit)) {
    let research: ArtistResearch;
    try {
      research = await researchArtist(c.name, c.town, c.shows);
    } catch (err) {
      console.error(`[draft-artist-blurbs] research failed for "${c.name}":`, err);
      continue;
    }

    const now = new Date().toISOString();

    // High confidence publishes straight to the live columns (Rob's standing
    // rule, 2026-08-11) — identical writes to a human Save, so the row leaves
    // the review queue as published. The route Slack-informs afterward.
    if (shouldAutoPublishArtist(research)) {
      const { error: pubErr } = await supabase.from("hwy4_artists").upsert(
        { artist_key: c.artist_key, name: c.name, ...autoPublishColumns(research, now) },
        { onConflict: "artist_key" }
      );
      if (pubErr) throw pubErr;

      result.researched += 1;
      result.published += 1;
      result.artists.push({
        artist_key: c.artist_key,
        name: c.name,
        confidence: research.confidence,
        hasBlurb: true,
        published: true,
      });
      continue;
    }

    const meta = {
      confidence: research.confidence,
      genre: research.genre,
      hometown: research.hometown,
      is_local: research.isLocal,
      links: research.links,
      notes: research.notes,
      sources: research.sources,
      // What the retry rules read next time (./artist-worklist.ts).
      context_venues: c.venues,
      voice_rejected: research.voiceRejected,
      voice_retried: c.reason === "voice_retry",
      reason: c.reason,
    };

    // Medium and below: upsert on artist_key as a PENDING draft — insert a fresh
    // row, or fill an as-yet-untried existing one. blurb_draft_at stamps
    // regardless (the "already tried" marker), so an empty result isn't
    // re-researched tomorrow. Live blurb/genre/links stay NULL — a human Save
    // writes those.
    const { error: upErr } = await supabase.from("hwy4_artists").upsert(
      {
        artist_key: c.artist_key,
        name: c.name,
        blurb_draft: research.blurb, // null when nothing publishable was found
        blurb_draft_at: now,
        blurb_draft_meta: meta,
        updated_at: now,
      },
      { onConflict: "artist_key" }
    );
    if (upErr) throw upErr;

    result.researched += 1;
    if (research.blurb) result.drafted += 1;
    else result.empty += 1;
    result.artists.push({
      artist_key: c.artist_key,
      name: c.name,
      confidence: research.confidence,
      hasBlurb: Boolean(research.blurb),
      published: false,
    });
  }

  return result;
}
