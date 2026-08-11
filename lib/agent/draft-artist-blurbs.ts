import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeName } from "@/lib/event-identity";
import { pacificToday } from "@/lib/date-windows";
import { researchArtist, type ArtistResearch } from "./research-artist";
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
// Idempotent + self-limiting, same gate shape as the address queue:
//   no hwy4_artists row yet, OR a row with
//     blurb IS NULL AND blurb_draft IS NULL AND blurb_draft_at IS NULL
//   (blurb_draft_at is stamped even on an empty research result — the "already
//    tried" marker — so a no-signal act isn't re-researched every day).
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

type Candidate = { artist_key: string; name: string; town: string | null };

// Collect the distinct acts named across upcoming public live-music events, keyed
// by normalizeName so "Star Dogs"/"StarDogs" collapse. Keeps the first-seen display
// spelling and a town (for the research prompt's regional signal).
async function collectCandidates(supabase: SupabaseClient): Promise<Candidate[]> {
  const today = pacificToday().iso;
  const { data, error } = await supabase
    .from("hwy4_events")
    .select("artists, town")
    .eq("category", "live_music")
    .eq("visibility", "public")
    .gte("date", today)
    .neq("status", "cancelled")
    .neq("is_routine", true) // match the public feed (live_music is never routine, but be exact)
    .not("artists", "is", null);
  if (error) throw error;

  const byKey = new Map<string, Candidate>();
  for (const row of (data ?? []) as { artists: string[] | null; town: string | null }[]) {
    for (const raw of row.artists ?? []) {
      const name = (raw ?? "").trim();
      if (!name) continue;
      const key = normalizeName(name);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, { artist_key: key, name, town: row.town ?? null });
    }
  }
  return [...byKey.values()];
}

export async function draftMissingArtistBlurbs(opts?: {
  limit?: number;
  client?: SupabaseClient;
}): Promise<DraftArtistsResult> {
  const limit = opts?.limit ?? 6;
  const supabase = opts?.client ?? adminClient();
  if (!supabase) throw new Error("Missing Supabase service credentials");

  const candidates = await collectCandidates(supabase);

  // Which keys are already resolved (published, drafted, or tried-and-empty)?
  const keys = candidates.map((c) => c.artist_key);
  const handled = new Set<string>();
  if (keys.length > 0) {
    const { data: existing, error } = await supabase
      .from("hwy4_artists")
      .select("artist_key, blurb, blurb_draft, blurb_draft_at")
      .in("artist_key", keys);
    if (error) throw error;
    for (const r of (existing ?? []) as {
      artist_key: string;
      blurb: string | null;
      blurb_draft: string | null;
      blurb_draft_at: string | null;
    }[]) {
      if (r.blurb || r.blurb_draft || r.blurb_draft_at) handled.add(r.artist_key);
    }
  }

  const todo = candidates.filter((c) => !handled.has(c.artist_key));
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
      research = await researchArtist(c.name, c.town);
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
