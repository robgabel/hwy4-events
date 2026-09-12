import { unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import {
  toPublicArtist,
  type ArtistRowInput,
  type PublicArtist,
} from "@/lib/artists";

// Cached published-artist catalog for public render (HWY-36).
// Selects ONLY live columns — never blurb_draft* — so a draft cannot leak
// into the client even if a caller forgets toPublicArtist. Tagged `artists`
// so an admin Save busts it without waiting out the 30-min window.

export const ARTISTS_CACHE_TAG = "artists";
const REVALIDATE_SECONDS = 1800;

const ARTIST_COLUMNS =
  "artist_key, name, genre, blurb, links, hometown, is_local";

async function fetchPublishedArtists(): Promise<PublicArtist[]> {
  const { data, error } = await getSupabase()
    .from("hwy4_artists")
    .select(ARTIST_COLUMNS);
  if (error) {
    console.error("[artists-data] fetchPublishedArtists failed:", error);
    return [];
  }
  const out: PublicArtist[] = [];
  for (const row of (data ?? []) as ArtistRowInput[]) {
    const artist = toPublicArtist(row);
    if (artist) out.push(artist);
  }
  return out;
}

export const getPublishedArtists = unstable_cache(
  fetchPublishedArtists,
  ["hwy4-published-artists"],
  { revalidate: REVALIDATE_SECONDS, tags: [ARTISTS_CACHE_TAG] }
);
