import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin.js";
import type { ExtractedEvent } from "./extract.js";
import { KNOWN_VENUES, GENERIC_VENUE_NAMES } from "./venues.js";

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
  merged: number; // distinct rows that collided into one via the unique key
}

/**
 * Version stamp for the name+place normalization. Bump when the rules below
 * change so the rehash migration can detect rows produced by an older formula.
 */
export const DEDUP_KEY_VERSION = 2;

/**
 * Canonicalize a name for identity purposes.
 *
 * Removes trailing parenthetical/qualifier noise that frequently differs
 * between sources (e.g. "(through Aug 2)", " – Matinee" suffixes are kept,
 * but "at the Lodge" trailers and a "Free " / "The " prefix are dropped).
 */
export function nameRoot(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    // Replace all dash/hyphen variants with a plain hyphen
    .replace(/[‐-―−﹘﹣－]/g, "-")
    // Smart quotes → straight quotes
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Strip trailing parenthetical noise: "Bear Valley Music Festival (through Aug 2)"
    .replace(/\s*\([^)]*\)\s*$/g, "")
    // Strip trailing " at <Venue>" / " @ <Venue>" — venue is anchored separately
    .replace(/\s+(?:at|@)\s+.+$/i, "")
    // Strip leading "Free " / "The "
    .replace(/^(?:free|the)\s+/, "")
    // Collapse runs of whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Backwards-compatible alias. Callers outside this file used `normalizeName`.
 */
export const normalizeName = nameRoot;

/**
 * Normalize a town string for matching (lowercase, trimmed).
 * Town is now only used as a last-resort place anchor.
 */
function normalizeTown(town: string | null | undefined): string {
  return (town ?? "").toLowerCase().trim();
}

/**
 * Normalize an address into a stable token (street number + name + city,
 * stripping suite/unit qualifiers, ZIP, and state codes).
 */
function normalizeAddress(address: string | null | undefined): string {
  if (!address) return "";
  return address
    .toLowerCase()
    .normalize("NFKC")
    // Drop ZIP codes
    .replace(/\b\d{5}(?:-\d{4})?\b/g, "")
    // Drop state codes at end of common patterns: ", CA"
    .replace(/,\s*[a-z]{2}\b/g, "")
    // Drop "Suite", "Ste", "Unit", "#" qualifiers
    .replace(/\b(?:suite|ste|unit|#)\s*\w+/g, "")
    // Normalize common abbreviations
    .replace(/\bhighway\b/g, "hwy")
    .replace(/\bstreet\b/g, "st")
    .replace(/\broad\b/g, "rd")
    .replace(/\bavenue\b/g, "ave")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a venue_name to a known-venue slug if possible. Generic
 * placeholders ("Unknown Venue", town names, etc.) return "".
 */
function venueSlug(venueName: string | null | undefined): string {
  if (!venueName) return "";
  const norm = venueName
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[''`]/g, "'")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (GENERIC_VENUE_NAMES.has(norm)) return "";
  for (const [slug, venue] of Object.entries(KNOWN_VENUES)) {
    if (venue.aliases.some((a) => a === norm) || norm === venue.canonical.toLowerCase()) {
      return slug;
    }
  }
  return norm; // fall back to the normalized literal
}

/**
 * Derive the most stable place anchor available for an event.
 * Address > known venue slug > town. Returns "" if nothing usable.
 */
export function placeAnchor(
  address: string | null | undefined,
  venueName: string | null | undefined,
  town: string | null | undefined
): string {
  const addr = normalizeAddress(address);
  if (addr) return `addr:${addr}`;
  const slug = venueSlug(venueName);
  if (slug) return `venue:${slug}`;
  const t = normalizeTown(town);
  if (t) return `town:${t}`;
  return "";
}

/**
 * Deterministic dedup key. Format:
 *   sha256(`v{VERSION}|{nameRoot}|{date}|{placeAnchor}`) → 32-char hex
 */
export function generateDedupKey(
  name: string,
  date: string,
  town: string,
  address?: string | null,
  venueName?: string | null
): string {
  const anchor = placeAnchor(address, venueName, town);
  const input = `v${DEDUP_KEY_VERSION}|${nameRoot(name)}|${date}|${anchor}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Smart merge — never overwrite richer data with thinner data.
// ---------------------------------------------------------------------------

interface MergeableFields {
  name: string;
  description: string | null;
  venue_name: string | null;
  start_time: string | null;
  end_time: string | null;
  price: string | null;
  event_url: string | null;
  address: string | null;
}

function isEmpty(v: string | null | undefined): boolean {
  return v == null || v.trim() === "";
}

function isGenericVenueValue(v: string | null | undefined): boolean {
  if (isEmpty(v)) return true;
  return GENERIC_VENUE_NAMES.has(v!.toLowerCase().trim());
}

/**
 * Prefer the existing value unless the incoming value is strictly richer.
 *   - Existing empty → take incoming.
 *   - Incoming empty → keep existing.
 *   - Both non-empty → keep the longer one (tie-break: existing).
 */
function preferLonger(
  existing: string | null,
  incoming: string | null
): string | null {
  if (isEmpty(existing)) return isEmpty(incoming) ? existing : incoming!;
  if (isEmpty(incoming)) return existing;
  return incoming!.length > existing!.length ? incoming! : existing;
}

/**
 * Always prefer existing for venue unless incoming is non-generic AND existing is generic.
 * If both are non-generic, prefer the longer canonical form.
 */
function preferSpecificVenue(
  existing: string | null,
  incoming: string | null
): string | null {
  const exGen = isGenericVenueValue(existing);
  const inGen = isGenericVenueValue(incoming);
  if (exGen && !inGen) return incoming;
  if (!exGen && inGen) return existing;
  if (exGen && inGen) return isEmpty(existing) ? incoming : existing;
  return preferLonger(existing, incoming);
}

/**
 * Prefer newest non-null value for fields where freshness matters more
 * than richness (times, price, URL).
 */
function preferIncomingIfPresent(
  existing: string | null,
  incoming: string | null
): string | null {
  return isEmpty(incoming) ? existing : incoming;
}

export function mergeEventFields(
  existing: MergeableFields,
  incoming: MergeableFields
): { merged: MergeableFields; changed: boolean } {
  const merged: MergeableFields = {
    name: existing.name, // keep canonical name (variants tracked separately in Phase 2)
    venue_name: preferSpecificVenue(existing.venue_name, incoming.venue_name),
    address: preferLonger(existing.address, incoming.address),
    description: preferLonger(existing.description, incoming.description),
    start_time: preferIncomingIfPresent(existing.start_time, incoming.start_time),
    end_time: preferIncomingIfPresent(existing.end_time, incoming.end_time),
    price: preferIncomingIfPresent(existing.price, incoming.price),
    event_url: preferIncomingIfPresent(existing.event_url, incoming.event_url),
  };

  const changed =
    merged.name !== existing.name ||
    merged.venue_name !== existing.venue_name ||
    merged.address !== existing.address ||
    merged.description !== existing.description ||
    merged.start_time !== existing.start_time ||
    merged.end_time !== existing.end_time ||
    merged.price !== existing.price ||
    merged.event_url !== existing.event_url;

  return { merged, changed };
}

// ---------------------------------------------------------------------------
// Upsert pipeline
// ---------------------------------------------------------------------------

const EXISTING_SELECT =
  "id, name, venue_name, description, start_time, end_time, price, event_url, address, sources";

interface SourceEntry {
  source_name: string;
  source_url: string | null;
  source_event_id: string | null;
  last_seen_at: string;
}

/**
 * Merge a new source attribution into the existing sources array, keyed by
 * source_name. Re-running the same scraper updates last_seen_at in place
 * instead of appending duplicates.
 */
function mergeSources(
  existing: SourceEntry[] | null | undefined,
  entry: SourceEntry
): SourceEntry[] {
  const arr = Array.isArray(existing) ? [...existing] : [];
  const idx = arr.findIndex((s) => s.source_name === entry.source_name);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...entry };
  } else {
    arr.push(entry);
  }
  return arr;
}

async function applyExistingMatch(
  existingId: string,
  existing: MergeableFields & { sources?: SourceEntry[] | null },
  incoming: MergeableFields,
  sourceEntry: SourceEntry,
  result: UpsertResult,
  now: string
): Promise<void> {
  const { merged, changed } = mergeEventFields(existing, incoming);
  const nextSources = mergeSources(existing.sources, sourceEntry);
  // jsonb equality on the array — a no-op write still counts as changed if we
  // appended a new source for the first time.
  const sourcesChanged =
    JSON.stringify(existing.sources ?? []) !== JSON.stringify(nextSources);

  if (changed || sourcesChanged) {
    await supabaseAdmin
      .from("hwy4_events")
      .update({
        venue_name: merged.venue_name,
        address: merged.address,
        description: merged.description,
        start_time: merged.start_time,
        end_time: merged.end_time,
        price: merged.price,
        event_url: merged.event_url,
        sources: nextSources,
        last_scraped_at: now,
      })
      .eq("id", existingId);
    result.updated++;
  } else {
    await supabaseAdmin
      .from("hwy4_events")
      .update({ last_scraped_at: now })
      .eq("id", existingId);
    result.unchanged++;
  }
}

/**
 * Upsert extracted events into hwy4_events.
 *
 * Pipeline per event:
 *   1. Compute place-anchored dedup_key.
 *   2. If a row exists with that key → smart-merge fields, never clobber.
 *   3. Otherwise INSERT.
 *      - On unique-violation (23505), some concurrent or stale row exists at
 *        the same key; re-fetch and merge instead of failing silently.
 */
export async function upsertEvents(
  events: ExtractedEvent[],
  sourceName: string,
  orgSlug: string,
  sourceUrl: string
): Promise<UpsertResult> {
  const result: UpsertResult = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    merged: 0,
  };

  for (const event of events) {
    const dedupKey = generateDedupKey(
      event.name,
      event.date,
      event.town,
      event.address,
      event.venue_name
    );
    const now = new Date().toISOString();

    const incoming: MergeableFields = {
      name: event.name,
      venue_name: event.venue_name,
      address: event.address,
      description: event.description,
      start_time: event.start_time,
      end_time: event.end_time,
      price: event.price,
      event_url: event.event_url,
    };

    const sourceEntry: SourceEntry = {
      source_name: sourceName,
      source_url: event.event_url ?? sourceUrl,
      source_event_id: event.source_event_id ?? null,
      last_seen_at: now,
    };

    // (1) source_event_id idempotency check — same scraper + same upstream id.
    // Beats the keyed lookup when the upstream renames the event in place.
    if (event.source_event_id) {
      const { data: bySource } = await supabaseAdmin
        .from("hwy4_events")
        .select(EXISTING_SELECT)
        .eq("source_name", sourceName)
        .eq("source_event_id", event.source_event_id)
        .maybeSingle();
      if (bySource) {
        await applyExistingMatch(
          bySource.id,
          bySource as MergeableFields & { sources?: SourceEntry[] | null },
          incoming,
          sourceEntry,
          result,
          now
        );
        continue;
      }
    }

    // (2) place-anchored dedup_key.
    const { data: existing } = await supabaseAdmin
      .from("hwy4_events")
      .select(EXISTING_SELECT)
      .eq("dedup_key", dedupKey)
      .maybeSingle();

    if (existing) {
      await applyExistingMatch(
        existing.id,
        existing as MergeableFields & { sources?: SourceEntry[] | null },
        incoming,
        sourceEntry,
        result,
        now
      );
      continue;
    }

    const { error } = await supabaseAdmin.from("hwy4_events").insert({
      name: event.name,
      description: event.description,
      date: event.date,
      start_time: event.start_time,
      end_time: event.end_time,
      venue_name: event.venue_name,
      town: event.town,
      address: event.address,
      category: event.category,
      artists: event.artists,
      status: "confirmed",
      is_past: false,
      price: event.price,
      event_url: event.event_url,
      source_url: sourceUrl,
      source_name: sourceName,
      source_event_id: event.source_event_id ?? null,
      sources: [sourceEntry],
      visibility: "public",
      org_slug: orgSlug,
      dedup_key: dedupKey,
      last_scraped_at: now,
    });

    if (!error) {
      result.inserted++;
      continue;
    }

    // 23505 = unique_violation. Another row with this dedup_key snuck in
    // between our SELECT and INSERT — re-fetch and merge.
    if ((error as { code?: string }).code === "23505") {
      const { data: raceRow } = await supabaseAdmin
        .from("hwy4_events")
        .select(EXISTING_SELECT)
        .eq("dedup_key", dedupKey)
        .maybeSingle();
      if (raceRow) {
        await applyExistingMatch(
          raceRow.id,
          raceRow as MergeableFields & { sources?: SourceEntry[] | null },
          incoming,
          sourceEntry,
          result,
          now
        );
        result.merged++;
        continue;
      }
    }

    console.error(`Failed to insert event "${event.name}":`, error.message);
  }

  return result;
}
