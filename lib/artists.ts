import { normalizeName } from "./event-identity";
import { isHttpUrl } from "./url";

// Public artist helpers (PRD-artist-descriptions.md Phase 2 / HWY-36).
//
// An event links to a hwy4_artists row by NORMALIZED NAME — the same
// normalizeName() the drafter uses as artist_key — so "The Star Dogs" and
// "Star Dogs" collapse. Draft columns (blurb_draft*) never enter this module's
// output types: a wrong-band bio is worse than a blank, and a pending draft
// is not a published field.
//
// Relative (not "@/") imports so the scripts/ test runner can lock this.

export type ArtistLinkKind =
  | "website"
  | "spotify"
  | "bandcamp"
  | "facebook"
  | "instagram";

export type ArtistLinks = Partial<Record<ArtistLinkKind, string>>;

/** Published-only artist row. No draft fields, by construction. */
export type PublicArtist = {
  artist_key: string;
  name: string;
  genre: string | null;
  blurb: string | null;
  links: ArtistLinks;
  hometown: string | null;
  is_local: boolean;
};

/** Raw row as stored / selected. Draft keys may be present; they are dropped. */
export type ArtistRowInput = {
  artist_key: string;
  name: string;
  genre?: string | null;
  blurb?: string | null;
  links?: ArtistLinks | Record<string, unknown> | null;
  hometown?: string | null;
  is_local?: boolean | null;
  blurb_draft?: string | null;
  blurb_draft_at?: string | null;
  blurb_draft_meta?: unknown;
};

export const ARTIST_LINK_KINDS: readonly ArtistLinkKind[] = [
  "website",
  "spotify",
  "bandcamp",
  "facebook",
  "instagram",
] as const;

export const ARTIST_LINK_LABELS: Record<ArtistLinkKind, string> = {
  website: "Website",
  spotify: "Spotify",
  bandcamp: "Bandcamp",
  facebook: "Facebook",
  instagram: "Instagram",
};

/** artist_key for a listed name — identical to the drafter's write key. */
export function artistKey(name: string): string {
  return normalizeName(name);
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** Keep only the known link kinds whose values are http(s). */
export function sanitizeArtistLinks(
  raw: ArtistLinks | Record<string, unknown> | null | undefined
): ArtistLinks {
  if (!raw || typeof raw !== "object") return {};
  const out: ArtistLinks = {};
  for (const kind of ARTIST_LINK_KINDS) {
    const value = raw[kind];
    if (typeof value === "string" && isHttpUrl(value)) out[kind] = value;
  }
  return out;
}

export function publishedLinkEntries(
  links: ArtistLinks | null | undefined
): [ArtistLinkKind, string][] {
  const clean = sanitizeArtistLinks(links);
  return ARTIST_LINK_KINDS.filter((k) => clean[k]).map((k) => [k, clean[k]!]);
}

/** True when any published field is present. Draft-only rows are blank. */
export function hasPublishedFields(
  artist: Pick<
    PublicArtist,
    "genre" | "blurb" | "links" | "hometown" | "is_local"
  >
): boolean {
  return Boolean(
    trimOrNull(artist.genre) ||
      trimOrNull(artist.blurb) ||
      publishedLinkEntries(artist.links).length > 0 ||
      trimOrNull(artist.hometown) ||
      artist.is_local === true
  );
}

/**
 * Project a stored row to the public shape. Returns null (Tier C) when the
 * row has no published fields — including a row that only carries a draft.
 * Never copies blurb_draft*.
 */
export function toPublicArtist(row: ArtistRowInput | null | undefined): PublicArtist | null {
  if (!row?.artist_key || !row.name) return null;
  const artist: PublicArtist = {
    artist_key: row.artist_key,
    name: row.name,
    genre: trimOrNull(row.genre),
    blurb: trimOrNull(row.blurb),
    links: sanitizeArtistLinks(row.links),
    hometown: trimOrNull(row.hometown),
    is_local: row.is_local === true,
  };
  return hasPublishedFields(artist) ? artist : null;
}

export function indexPublicArtists(
  catalog: PublicArtist[]
): Map<string, PublicArtist> {
  const map = new Map<string, PublicArtist>();
  for (const artist of catalog) map.set(artist.artist_key, artist);
  return map;
}

/**
 * Match listed names to published catalog rows, preserving listing order.
 * Unknown / draft-only names are omitted (Tier C).
 */
export function matchPublishedArtists(
  names: string[] | null | undefined,
  catalog: PublicArtist[]
): PublicArtist[] {
  if (!names?.length) return [];
  const byKey = indexPublicArtists(catalog);
  const out: PublicArtist[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = artistKey(name);
    const hit = byKey.get(key);
    if (hit && !seen.has(hit.artist_key)) {
      seen.add(hit.artist_key);
      out.push(hit);
    }
  }
  return out;
}

/** artist_key → published genre, for the EventCard chip. */
export function artistGenreMap(
  catalog: PublicArtist[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const artist of catalog) {
    if (artist.genre) map[artist.artist_key] = artist.genre;
  }
  return map;
}

export function artistChipLabel(
  name: string,
  genre: string | null | undefined
): string {
  const g = trimOrNull(genre);
  return g ? `${name} · ${g}` : name;
}

export type SchemaPerformer =
  | { "@type": "Person"; name: string }
  | {
      "@type": "MusicGroup";
      name: string;
      genre?: string;
      description?: string;
      url?: string;
      sameAs?: string[];
    };

function buildMusicGroup(
  artist: PublicArtist,
  listedName: string
): SchemaPerformer {
  const sameAs = publishedLinkEntries(artist.links).map(([, url]) => url);
  const website = artist.links.website;
  return {
    "@type": "MusicGroup",
    name: artist.name || listedName,
    ...(artist.genre && { genre: artist.genre }),
    ...(artist.blurb && { description: artist.blurb }),
    ...(website && { url: website }),
    ...(sameAs.length > 0 && { sameAs }),
  };
}

/**
 * JSON-LD performers: MusicGroup when a published artist row matches,
 * otherwise the existing Person-with-name fallback. Never emits draft fields.
 */
export function buildPerformers(
  names: string[] | null | undefined,
  catalog: PublicArtist[] = []
): SchemaPerformer[] | undefined {
  if (!names?.length) return undefined;
  const byKey = indexPublicArtists(catalog);
  return names.map((name) => {
    const hit = byKey.get(artistKey(name));
    return hit ? buildMusicGroup(hit, name) : { "@type": "Person", name };
  });
}
