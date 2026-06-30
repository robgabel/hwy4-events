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
  "id, name, description, date, start_time, end_time, venue_name, town, address, category, artists, status, price, cost_tier, event_url, source_url, source_name, visibility, org_slug, importance, robs_pick, community_sourced, venue_key, image_url, created_at, verification_status";

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
        .neq("status", "cancelled");
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

function nameScore(reqTokens: string[], candTokens: string[]): number {
  if (!reqTokens.length || !candTokens.length) return 0;
  const used = new Array(candTokens.length).fill(false);
  let matched = 0;
  for (const t of reqTokens) {
    const j = candTokens.findIndex((c, i) => !used[i] && tokensMatch(t, c));
    if (j >= 0) {
      used[j] = true;
      matched++;
    }
  }
  return matched / Math.max(reqTokens.length, candTokens.length);
}

const MIN_SCORE = 0.7; // confident-enough to redirect; below this we 404

/**
 * Pure: pick the event a stale slug almost certainly meant. Requires the same
 * town and a strong, *unambiguous* name match (clear winner over runner-up),
 * so we never 301 to the wrong event when two share a date+town. Returns null
 * when nothing is confident — a 404 is safer than a wrong redirect.
 */
export function pickFallbackEvent<
  T extends { name: string; date: string; town: string }
>(events: T[], slug: string): T | null {
  const parsed = splitSlug(slug);
  if (!parsed) return null;
  const scored = events
    .filter((e) => townSlug(e.town) === parsed.town)
    .map((e) => {
      const candSlug = generateEventSlug(e.name, e.date, e.town);
      const candNameTokens = candSlug
        .slice(0, candSlug.indexOf(`-${e.date}-`))
        .split("-")
        .filter(Boolean);
      return { e, score: nameScore(parsed.nameTokens, candNameTokens) };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < MIN_SCORE) return null;
  const runnerUp = scored[1];
  if (runnerUp && runnerUp.score >= best.score - 0.05) return null; // ambiguous
  return best.e;
}

/**
 * Recover an event from a stale/non-canonical slug. Resolves a bare event UUID
 * (also fixes the `/events/{id}` calendar-detail link) or fuzzy-matches a
 * renamed event by date+town. The detail page 301s to the canonical slug.
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
        .maybeSingle();
      return data ? gateEventDescription(data as unknown as Hwy4Event) : null;
    }

    const date = slug.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!date) return null;
    const { data } = await supabase
      .from("hwy4_events")
      .select(EVENT_COLUMNS)
      .eq("date", date)
      .neq("status", "cancelled");
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
