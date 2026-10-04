import { normalizeName } from "../event-identity";
import { artistIdentityKey, isNonActName } from "../artist-identity";
import type { ArtistShow } from "./research-artist";

// The artist-blurb drafter's worklist, as a pure function (artist coverage +
// accuracy, 2026-10-04). Split out of draft-artist-blurbs.ts so the rules that
// decide WHO gets researched, and WHICH row a result lands on, are testable
// without Supabase or Anthropic. Locked by scripts/test/artist-worklist.test.ts.
//
// Three changes from the original inline worklist:
//
// 1. One identity per act. Acts are grouped by artistIdentityKey, so "Rod
//    Harris" is not researched again while "Rod Harris and Friends" is
//    published, and a result lands on the act's EXISTING row rather than
//    minting a fresh variant row beside it.
//
// 2. The researcher gets the bookings. Each item carries up to three listings
//    (venue, date, link, description), preferring distinct venues, because a
//    venue is what tells "Overdrive" the local cover band from the five other
//    Overdrives on the web.
//
// 3. A blank is no longer forever. The old gate stamped blurb_draft_at on an
//    empty result and never looked again, so an act researched blind in July
//    stayed blank even after it was booked at three more venues. A tried-empty
//    act is retried when:
//      - it was researched before listings were passed (no context_venues),
//      - it is now booked at a venue it was not researched with,
//      - the voice floor dropped prose for an act the model DID identify, or
//      - the last try is older than RETRY_AFTER_DAYS.
//    Never-researched acts always go first, so retries only spend spare slots.
//    A row with any live field (blurb, genre, links) is never retried: the
//    auto-publish path writes those columns verbatim, and a human set them.

export const RETRY_AFTER_DAYS = 60;
const MAX_SHOWS = 3;

export type ShowRow = {
  artists: string[] | null;
  name: string;
  town: string | null;
  venue_name: string | null;
  date: string;
  event_url: string | null;
  description: string | null;
};

export type CatalogRow = {
  artist_key: string;
  name: string;
  blurb: string | null;
  genre: string | null;
  links: Record<string, unknown> | null;
  blurb_draft: string | null;
  blurb_draft_at: string | null;
  blurb_draft_meta: unknown;
};

export type WorkReason = "new" | "voice_retry" | "new_venue" | "no_context" | "stale";

export type WorkItem = {
  /** The row the result is written to: the act's existing row when it has one. */
  artist_key: string;
  /** Display name to store on a NEW row; an existing row keeps its own. */
  name: string;
  isNewRow: boolean;
  town: string | null;
  shows: ArtistShow[];
  /** Lowercased venues the research is run with, stored as context_venues. */
  venues: string[];
  reason: WorkReason;
};

const REASON_ORDER: WorkReason[] = ["new", "voice_retry", "new_venue", "no_context", "stale"];

function venueKey(v: string | null | undefined): string {
  return (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function metaOf(row: CatalogRow): Record<string, unknown> {
  return row.blurb_draft_meta && typeof row.blurb_draft_meta === "object"
    ? (row.blurb_draft_meta as Record<string, unknown>)
    : {};
}

function hasLiveFields(row: CatalogRow): boolean {
  return Boolean(
    (row.blurb && row.blurb.trim()) ||
      (row.genre && row.genre.trim()) ||
      (row.links && Object.keys(row.links).length > 0)
  );
}

type Act = { name: string; town: string | null; shows: ArtistShow[] };

/** Group upcoming listings by act identity, keeping the first-seen spelling
 *  and up to MAX_SHOWS bookings (distinct venues first, then soonest). */
export function collectActs(rows: ShowRow[]): Map<string, Act> {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const acts = new Map<string, Act & { all: ArtistShow[] }>();
  for (const row of sorted) {
    // A karaoke night's "artist" is its host, not an act.
    if (isNonActName(row.name)) continue;
    for (const raw of row.artists ?? []) {
      const name = (raw ?? "").trim();
      if (!name || isNonActName(name)) continue;
      const key = artistIdentityKey(name);
      if (!key) continue;
      let act = acts.get(key);
      if (!act) {
        act = { name, town: row.town ?? null, shows: [], all: [] };
        acts.set(key, act);
      }
      act.all.push({
        date: row.date,
        venue: row.venue_name ?? null,
        town: row.town ?? null,
        title: row.name,
        url: row.event_url ?? null,
        description: row.description ?? null,
      });
    }
  }
  const out = new Map<string, Act>();
  for (const [key, act] of acts) {
    const seenVenues = new Set<string>();
    const distinct: ArtistShow[] = [];
    const rest: ArtistShow[] = [];
    for (const s of act.all) {
      const v = venueKey(s.venue);
      if (!seenVenues.has(v)) {
        seenVenues.add(v);
        distinct.push(s);
      } else rest.push(s);
    }
    out.set(key, { name: act.name, town: act.town, shows: [...distinct, ...rest].slice(0, MAX_SHOWS) });
  }
  return out;
}

function priorContextVenues(row: CatalogRow): string[] {
  const ctx = metaOf(row).context_venues;
  return Array.isArray(ctx) ? ctx.map((v) => venueKey(String(v))).filter(Boolean) : [];
}

/** Why a tried-and-blank row should be researched again, or null. */
export function retryReason(
  row: CatalogRow,
  showVenues: string[],
  nowMs: number
): Exclude<WorkReason, "new"> | null {
  if (hasLiveFields(row)) return null;
  const meta = metaOf(row);
  if (meta.voice_rejected === true && meta.voice_retried !== true) return "voice_retry";
  const ctx = Array.isArray(meta.context_venues)
    ? (meta.context_venues as unknown[]).map((v) => venueKey(String(v)))
    : null;
  if (!ctx) return "no_context";
  if (showVenues.some((v) => v && !ctx.includes(v))) return "new_venue";
  const at = row.blurb_draft_at ? Date.parse(row.blurb_draft_at) : NaN;
  if (Number.isFinite(at) && nowMs - at > RETRY_AFTER_DAYS * 86_400_000) return "stale";
  return null;
}

export function buildArtistWorklist(
  rows: ShowRow[],
  catalog: CatalogRow[],
  nowMs: number
): WorkItem[] {
  const groups = new Map<string, CatalogRow[]>();
  for (const r of catalog) {
    const key = artistIdentityKey(r.name || r.artist_key);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const items: WorkItem[] = [];
  for (const [key, act] of collectActs(rows)) {
    const venues = [...new Set(act.shows.map((s) => venueKey(s.venue)).filter(Boolean))];
    const base = { town: act.town, shows: act.shows, venues };
    const group = groups.get(key) ?? [];

    if (group.length === 0) {
      items.push({ ...base, artist_key: normalizeName(act.name), name: act.name, isNewRow: true, reason: "new" });
      continue;
    }
    // Published or awaiting review under any spelling: the act is covered.
    if (group.some((r) => (r.blurb && r.blurb.trim()) || (r.blurb_draft && r.blurb_draft.trim()))) continue;

    // Write to the act's own row: the exact spelling if it has one, else the
    // most recently researched variant.
    const exact = group.find((r) => r.artist_key === normalizeName(act.name));
    const target =
      exact ??
      [...group].sort((a, b) => (b.blurb_draft_at ?? "").localeCompare(a.blurb_draft_at ?? ""))[0];

    // Any live field on any variant means a human or the auto-publisher
    // already spoke for this act. Checked before the never-tried branch, so
    // "a row with live fields is never researched" holds by construction.
    if (group.some(hasLiveFields)) continue;
    if (!target.blurb_draft_at) {
      items.push({ ...base, artist_key: target.artist_key, name: target.name, isNewRow: false, reason: "new" });
      continue;
    }
    const reason = retryReason(target, venues, nowMs);
    if (reason) {
      // Record every venue this act has ever been researched with, not just
      // this run's top 3: an act rotating through four venues would otherwise
      // trip new_venue on a venue it was already researched with, forever
      // (review of PR #324, finding 3).
      const union = [...new Set([...priorContextVenues(target), ...venues])];
      items.push({ ...base, venues: union, artist_key: target.artist_key, name: target.name, isNewRow: false, reason });
    }
  }

  return items.sort((a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason));
}
