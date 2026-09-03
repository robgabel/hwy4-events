import { cache } from "react";
import { generateEventSlug, townSlug } from "./slugs";
import { gateEventDescription } from "./description-quality";
import type { Hwy4Event } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared by the event detail page and the generated-poster route so the slug →
// event resolution can't drift. `image_url` is included because the poster
// branching (supplied vs generated) keys off it.
export const EVENT_COLUMNS =
  "id, name, description, date, start_time, end_time, venue_name, town, address, category, artists, status, price, cost_tier, event_url, source_url, source_name, visibility, org_slug, robs_pick, sold_out, community_sourced, venue_key, image_url, created_at, verification_status";

const PAGE_SIZE = 60;

const matchSlug = (events: Hwy4Event[] | null, slug: string): Hwy4Event | null =>
  events?.find((e) => generateEventSlug(e.name, e.date, e.town) === slug) ?? null;

/**
 * Resolve an event from its computed slug. Wrapped in React cache() so repeated
 * lookups in one request (page + metadata) share a single fetch. The slug embeds
 * the date (YYYY-MM-DD), so we query just that date; falls back to a paginated
 * scan only when the date can't be parsed.
 */
export const findEventBySlug = cache(
  async (slug: string): Promise<Hwy4Event | null> => {
    const { getSupabase } = await import("./supabase");
    const supabase = getSupabase();

    const dateMatch = slug.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      const { data } = await supabase
        .from("hwy4_events")
        .select(EVENT_COLUMNS)
        .eq("date", dateMatch[0])
        .neq("status", "cancelled")
        .neq("is_routine", true);
      const hit = matchSlug(data as unknown as Hwy4Event[] | null, slug);
      if (hit) return gateEventDescription(hit);
    }

    // Pacific civil date, not UTC — otherwise this fallback scan would skip an
    // event happening today once it's past 5pm Pacific (UTC midnight).
    const { pacificToday } = await import("./date-windows");
    const today = pacificToday().iso;
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("hwy4_events")
        .select(EVENT_COLUMNS)
        .gte("date", today)
        .neq("status", "cancelled")
        .neq("is_routine", true)
        .order("date", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error || !data) break;
      const hit = matchSlug(data as unknown as Hwy4Event[], slug);
      if (hit) return gateEventDescription(hit);
      if (data.length < PAGE_SIZE) break;
    }
    return null;
  }
);

// --- Loose slug recovery (301 source) -------------------------------------
// Event URLs are a pure function of the *current* name (generateEventSlug).
// So a title edit, a scraper title-cleanup, or a dedup merge that keeps a
// differently-titled survivor silently orphans the previously-indexed/shared
// URL into a 404. This recovers those: given a stale slug, find the event it
// almost certainly meant so the page can 301 to the canonical slug.

/** Split a computed slug into its name part and town part around the date. */
function splitSlug(
  slug: string
): { nameTokens: string[]; town: string } | null {
  const date = slug.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!date) return null;
  const idx = slug.indexOf(`-${date}-`);
  if (idx < 0) return null;
  const namePart = slug.slice(0, idx);
  const town = slug.slice(idx + date.length + 2); // skip "-<date>-"
  return { nameTokens: namePart.split("-").filter(Boolean), town };
}

/** A token matches if equal, or one is a prefix of the other (≥4 chars) — so
 * "arnold" ↔ "arnolds" and "fest" ↔ "festival" count, but "a" ↔ "art" don't. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

function nameScore(
  reqTokens: string[],
  candTokens: string[]
): { score: number; matched: number } {
  if (!reqTokens.length || !candTokens.length) return { score: 0, matched: 0 };
  const used = new Array(candTokens.length).fill(false);
  let matched = 0;
  for (const t of reqTokens) {
    const j = candTokens.findIndex((c, i) => !used[i] && tokensMatch(t, c));
    if (j >= 0) {
      used[j] = true;
      matched++;
    }
  }
  return {
    score: matched / Math.max(reqTokens.length, candTokens.length),
    matched,
  };
}

const MIN_SCORE = 0.7; // confident-enough to redirect; below this we 404

// Dominance second chance: a partial name match too weak for MIN_SCORE is
// still confident when it's substantial AND nothing else comes close — an
// exact date + town with one 60%-overlap candidate and dead silence behind it
// is not a coincidence. The real case: "Rotary's Annual Shrimp Feed & Auction"
// was renamed to "Annual Shrimp & Pasta Feed Fundraiser" by the 2026-08-11
// hand merge, orphaning the old slug at 0.6 while every other same-day event
// scored 0 — and the already-sent newsletter still pointed at it.
const DOMINANT_MIN_SCORE = 0.5;
const DOMINANT_MIN_MATCHED = 3;
const DOMINANT_MAX_RUNNER_UP = 0.25;

/** Tokens of a bare phrase in slug alphabet (same normalization as slugs). */
function phraseTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean);
}

// Venue words too generic to identify a venue on their own — without this,
// "murphys-community-park" would containment-match every event in the park.
const GENERIC_VENUE_TOKENS = new Set([
  "a",
  "an",
  "and",
  "at",
  "center",
  "club",
  "community",
  "hall",
  "lodge",
  "of",
  "park",
  "parks",
  "plaza",
  "square",
  "state",
  "the",
]);

type FallbackEvent = {
  name: string;
  date: string;
  town: string;
  artists?: string[] | null;
  venue_name?: string | null;
};

/**
 * Second-chance identity containment for slugs the name matcher can't see.
 * LLM-written surfaces (briefings, newsletters) mint slugs from their prose
 * rename of an event — the act ("kane-brown-murphys-…" for a row named
 * "Ironstone Summer Concert Series") or the venue ("live-music-brice-station-
 * vineyards-…" for "Deep Thicket Dwellers") — which share zero name tokens
 * with the row. If the stale slug carries ALL tokens of exactly one same-town
 * candidate's act (≥2 tokens) or distinctive venue core (≥2 tokens), that
 * candidate is the event; two hits is ambiguity and stays a 404.
 */
function containmentFallback<T extends FallbackEvent>(
  candidates: T[],
  slugTokens: string[]
): T | null {
  if (slugTokens.length < 2) return null;
  const covers = (tokens: string[]) =>
    tokens.length >= 2 &&
    tokens.every((t) => slugTokens.some((s) => tokensMatch(t, s)));
  const hits = candidates.filter((e) => {
    if ((e.artists ?? []).some((a) => covers(phraseTokens(a)))) return true;
    const venueCore = phraseTokens(e.venue_name).filter(
      (t) => !GENERIC_VENUE_TOKENS.has(t)
    );
    return covers(venueCore);
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Pure: pick the event a stale slug almost certainly meant. Requires the same
 * town and a strong, *unambiguous* name match (clear winner over runner-up),
 * so we never 301 to the wrong event when two share a date+town; when the name
 * pass fails, a stricter act/venue containment pass catches slugs written from
 * an event's artist or venue instead of its title. Returns null when nothing
 * is confident — a 404 is safer than a wrong redirect.
 */
export function pickFallbackEvent<T extends FallbackEvent>(
  events: T[],
  slug: string
): T | null {
  const parsed = splitSlug(slug);
  if (!parsed) return null;
  const sameTown = events.filter((e) => townSlug(e.town) === parsed.town);
  const scored = sameTown
    .map((e) => {
      const candSlug = generateEventSlug(e.name, e.date, e.town);
      const candNameTokens = candSlug
        .slice(0, candSlug.indexOf(`-${e.date}-`))
        .split("-")
        .filter(Boolean);
      return { e, ...nameScore(parsed.nameTokens, candNameTokens) };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (best && best.score >= MIN_SCORE) {
    if (runnerUp && runnerUp.score >= best.score - 0.05) return null; // ambiguous
    return best.e;
  }
  if (
    best &&
    best.score >= DOMINANT_MIN_SCORE &&
    best.matched >= DOMINANT_MIN_MATCHED &&
    (!runnerUp || runnerUp.score <= DOMINANT_MAX_RUNNER_UP)
  ) {
    return best.e;
  }
  return containmentFallback(sameTown, parsed.nameTokens);
}

// --- Merge-loser recovery (exact, via event_merge_log) ---------------------
// The daily reconcile (lib/reconcile.ts) merges duplicate rows and DELETES the
// loser, so a loser's slug 404s the moment it's merged — and those dupes
// usually carry a *different* title than their survivor (that's what made them
// dupes the fuzzy matcher below can't see), so name-scoring can't recover
// them. The merge log snapshots every deleted row; recomputing the loser's
// slug from the snapshot gives an exact stale-slug → survivor mapping.

type MergeLogRow = {
  survivor_id: string;
  merged_snapshot: {
    name?: string | null;
    date?: string | null;
    town?: string | null;
  } | null;
};

/** Pure: find the survivor id whose merged (deleted) row owned this slug. */
export function matchMergedSlug(
  rows: MergeLogRow[],
  slug: string
): string | null {
  for (const r of rows) {
    const s = r.merged_snapshot;
    if (!s?.name || !s?.date || !s?.town) continue;
    if (generateEventSlug(s.name, s.date, s.town) === slug) {
      return r.survivor_id;
    }
  }
  return null;
}

// A survivor can itself be merged away by a later reconcile run; follow a
// short merged_from → survivor chain rather than 404ing on the middle link.
const MERGE_HOPS = 3;

/**
 * event_merge_log is RLS service-role-only (snapshots hold full rows), so this
 * recovery layer reads it with the service key and degrades to null (plain
 * 404) when the key isn't configured.
 */
async function findMergedEvent(slug: string): Promise<Hwy4Event | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, serviceKey);

  let survivorId: string | null = null;
  if (UUID_RE.test(slug)) {
    // A dead /events/{id} deep link (calendar "Details" URLs) whose row was
    // merged away: jump straight to merged_from_id.
    survivorId = slug;
  } else {
    const date = slug.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!date) return null;
    const { data } = await admin
      .from("event_merge_log")
      .select("survivor_id, merged_snapshot")
      .eq("merged_snapshot->>date", date);
    survivorId = matchMergedSlug((data as MergeLogRow[] | null) ?? [], slug);
    if (!survivorId) return null;
  }

  for (let hop = 0; hop < MERGE_HOPS && survivorId; hop++) {
    // Definite string local — .eq()'s generic otherwise ties survivorId's
    // flow-narrowed type back to this query's result (TS7022 cycle).
    const fromId: string = survivorId;
    const { data: ev } = await admin
      .from("hwy4_events")
      .select(EVENT_COLUMNS)
      .eq("id", fromId)
      .neq("status", "cancelled")
      .maybeSingle();
    if (ev) return gateEventDescription(ev as unknown as Hwy4Event);
    const nextHop: { data: { survivor_id: string } | null } = await admin
      .from("event_merge_log")
      .select("survivor_id")
      .eq("merged_from_id", fromId)
      .order("merged_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    survivorId = nextHop.data?.survivor_id ?? null;
  }
  return null;
}

/**
 * Recover an event from a stale/non-canonical slug. Resolves a bare event UUID
 * (also fixes the `/events/{id}` calendar-detail link), then an exact
 * merge-log match (reconcile-deleted losers), then fuzzy-matches a renamed
 * event by date+town. The detail page 301s to the canonical slug.
 */
export const findEventFallback = cache(
  async (slug: string): Promise<Hwy4Event | null> => {
    const { getSupabase } = await import("./supabase");
    const supabase = getSupabase();

    if (UUID_RE.test(slug)) {
      const { data } = await supabase
        .from("hwy4_events")
        .select(EVENT_COLUMNS)
        .eq("id", slug)
        .neq("status", "cancelled")
        .neq("is_routine", true)
        .maybeSingle();
      if (data) return gateEventDescription(data as unknown as Hwy4Event);
      return findMergedEvent(slug);
    }

    // Exact recovery first: a merge-log hit knows precisely which survivor a
    // deleted row's URL should carry to, so it outranks name similarity.
    const merged = await findMergedEvent(slug);
    if (merged) return merged;

    const date = slug.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!date) return null;
    const { data } = await supabase
      .from("hwy4_events")
      .select(EVENT_COLUMNS)
      .eq("date", date)
      .neq("status", "cancelled")
      .neq("is_routine", true);
    const hit = pickFallbackEvent(
      (data as unknown as Hwy4Event[] | null) ?? [],
      slug
    );
    return hit ? gateEventDescription(hit) : null;
  }
);

/** Canonical URL path for an event, e.g. "/events/<slug>". */
export function canonicalEventPath(event: {
  name: string;
  date: string;
  town: string;
}): string {
  return `/events/${generateEventSlug(event.name, event.date, event.town)}`;
}
