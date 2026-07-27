import { supabaseAdmin } from "./supabase-admin.js";
import type { ExtractedEvent } from "./extract.js";
import { KNOWN_VENUES } from "./venues.js";
import { isGenericVenue, resolveVenueKey } from "./venue-matcher.js";
import { isOutOfCorridor } from "./corridor.js";
import { capSeriesHorizon } from "./ingest-horizon.js";
import { applyUrlDate } from "./url-date.js";
// The "same event" rule + its string helpers live in ONE place, shared with the
// read-time collapse in lib/dedupe-events.ts. Do not re-implement them here.
import {
  isSameEvent,
  normalizeName,
  normalizeTown,
  generateDedupKey,
} from "../../lib/event-identity.js";
import { sanitizeDescriptionDetailed } from "../../lib/description-quality.js";
import { classifyNotabilityDetailed } from "../../lib/notability.js";
import { isHttpUrl } from "../../lib/url.js";
import { recordSourceResult } from "./scrape-run-log.js";

/**
 * Strip HTML tag-like sequences from scraped free-text. Defense in depth for
 * the JSON-LD sink: `serializeJsonLd` escapes "<" at render, and this removes
 * tag shapes at the source so a scraped `</script><script>…` title never even
 * reaches the DB. Deliberately narrow — only `<tag>` / `</tag>` shapes (a letter
 * after "<"), so "5 < 10" or "<3 Music" survive untouched. Returns null when the
 * field collapses to empty, EXCEPT the caller keeps a required field's original.
 */
function stripTagLike(s: string | null | undefined): string | null {
  if (!s) return null;
  const cleaned = s.replace(/<\/?[a-zA-Z][^<>]*>/g, "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

// Re-exported for scripts that import these from this module.
export { normalizeName, generateDedupKey };

// Notability is written ONLY for these two operational venues — the ones that
// publish their own restaurant/lodge calendar, so their "Thursday Night Dinner"
// / "Sunday Brunch" rows leak in as fake events. Every other source leaves
// is_routine = false. See lib/notability.ts + the read-time filters.
const OPERATIONAL_ORG_SLUGS = new Set(["sequoia-woods", "moose-lodge"]);

/**
 * Stamp `is_routine` / `routine_reason` onto an event before it's keyed/written.
 * No-op (writes false) for non-operational sources, so a global read-time filter
 * stays correct while only these two venues can ever set the flag. If a scraper
 * already classified the event (e.g. a future floor+LLM pass), its value stands.
 */
function resolveNotability(event: ExtractedEvent, orgSlug: string): void {
  if (event.is_routine !== undefined) return;
  if (!OPERATIONAL_ORG_SLUGS.has(orgSlug)) {
    event.is_routine = false;
    event.routine_reason = null;
    return;
  }
  const d = classifyNotabilityDetailed(`${event.name} ${event.description ?? ""}`, {
    category: event.category,
  });
  event.is_routine = d.isRoutine;
  event.routine_reason = d.isRoutine ? d.rule : null;
}

/**
 * Emit one structured log line per data-quality failure at write time.
 * Cheaper than QA-ing rows after they ship: caught at the source, while
 * the scraper still has full context in the surrounding output.
 */
function emitDataQualitySignal(
  event: ExtractedEvent,
  sourceName: string,
  orgSlug: string
): void {
  if (isGenericVenue(event.venue_name)) {
    console.warn(
      `  UNRESOLVED_VENUE source=${orgSlug} venue="${event.venue_name}" ` +
      `date=${event.date} town="${event.town}" name="${event.name}" ` +
      `addr="${event.address ?? ""}" url=${event.event_url ?? "—"}`
    );
  }
  if (!event.address || event.address.trim().length === 0) {
    console.warn(
      `  MISSING_ADDRESS source=${orgSlug} venue="${event.venue_name}" ` +
      `date=${event.date} town="${event.town}" name="${event.name}"`
    );
  }
  void sourceName;
}

/**
 * Heuristic: does a string look like a street address?
 * Matches "1276 S. Main St", "48B Copper Cove Dr", "3353 East Highway 4 …".
 * Used to recover from scrapers that wrote the address into the venue_name
 * field (e.g. GoCalaveras for the Arnold Spring Peddlers Faire row).
 */
function looksLikeStreetAddress(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  // Starts with house number (with optional letter suffix like "48B"),
  // followed by at least one word character.
  return /^\d+[A-Z]?\s+[A-Za-z]/.test(trimmed);
}

/**
 * Look up a venue's registered address by matching venue_name or any alias
 * against KNOWN_VENUES.
 */
function findRegisteredAddress(venueName: string | null | undefined): string | null {
  if (!venueName) return null;
  const target = venueName.toLowerCase().trim();
  for (const v of Object.values(KNOWN_VENUES)) {
    if (v.canonical.toLowerCase() === target) return v.address ?? null;
    for (const a of v.aliases) {
      if (a === target) return v.address ?? null;
    }
  }
  return null;
}

/**
 * Three-tier scrape-time address resolution:
 *
 *   1. Event's own address (if it looks real).
 *   2. Venue-registry address (when venue_name matches a registered venue).
 *   3. (Town defaults are render-time only — keep DB nullable so we can tell
 *      "we don't actually know" from "this is the town centroid".)
 *
 * Also: if venue_name *itself* is a street address and event.address is null,
 * swap them (recover from scrapers that crossed wires).
 */
// Placeholder end times that aggregators emit when an organizer leaves the end
// blank, but which look like a real value on the card. GoCalaveras runs EventON,
// which stamps 23:50 (11:50 PM); a genuine event ending at exactly 11:50 PM is
// essentially nonexistent, so we treat it as "no end time" at the write boundary
// (covering EVERY source/write path, not just GoCalaveras).
const PLACEHOLDER_END_TIMES = new Set(["23:50", "23:50:00"]);

// "HH:MM" / "HH:MM:SS" -> minutes since midnight, or null if unparseable.
function timeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Trust the organizer's own permalink over the extractor's reading of the page.
 *
 * The Wolf Jett bug (2026-07-26): a scraper produced date 2026-07-26 for an
 * event whose product URL says `…/wolf-jett-july-25-2026-7pm`, creating a
 * duplicate that advertised a show which had already happened. Slugs like that
 * are authored by the venue, so they outrank a model's guess. Runs in the shared
 * pre-pass BEFORE the dedup_key is computed, so the corrected date is the one
 * that keys the row. Logged, never silent — this firing means an extractor is
 * getting dates wrong and we want to see it.
 */
function correctFromUrl(event: ExtractedEvent, sourceName: string): void {
  const r = applyUrlDate(event);
  if (r.correctedDate) {
    console.warn(
      `  URL_DATE_CORRECTION source=${sourceName} "${event.name}" ` +
      `${r.fromDate} -> ${r.toDate} (per ${event.event_url})`
    );
  }
  if (r.correctedTime) {
    console.warn(
      `  URL_TIME_CORRECTION source=${sourceName} "${event.name}" ` +
      `${r.fromTime ?? "none"} -> ${r.toTime} (per ${event.event_url})`
    );
  }
}

export function normalizeEventTimes(event: ExtractedEvent): void {
  if (event.end_time && PLACEHOLDER_END_TIMES.has(event.end_time)) {
    event.end_time = null;
  }

  // Dropped-PM recovery. Aggregators (e.g. GoCalaveras/EventON) sometimes store
  // a "5:00 PM" end as 05:00 because the organizer omitted the meridiem, which
  // renders as an impossible "11 AM – 5 AM" window. Correct ONLY the unambiguous
  // signature: a daytime start (08:00–16:00) paired with a small-hours end
  // (00:01–07:00) — i.e. an event that appears to end before it starts. Add 12h.
  // Genuine evening/overnight events start after ~6 PM, so they never match.
  const startMin = timeToMinutes(event.start_time);
  const endMin = timeToMinutes(event.end_time);
  if (
    startMin !== null &&
    endMin !== null &&
    startMin >= 8 * 60 &&
    startMin <= 16 * 60 &&
    endMin >= 1 &&
    endMin <= 7 * 60
  ) {
    event.end_time = minutesToTime(endMin + 12 * 60);
  }

  // Impossible-time guards (2026-07-16 QA: "1:00 AM – 1:00 AM" Jazz Cellars,
  // "7:00 PM – 2:00 PM" Bear Valley Music Festival). Per the never-guess
  // policy we DROP a provably-wrong time rather than invent one.
  const s = timeToMinutes(event.start_time);
  const e = timeToMinutes(event.end_time);
  // Zero-length window: a widget copied start into end. Keep the start unless
  // it's small-hours (00:00–05:59) — then the start itself is garbage too.
  if (s !== null && e !== null && s === e) {
    event.end_time = null;
    if (s < 6 * 60) event.start_time = null;
  } else if (s !== null && e !== null && e < s && e > 3 * 60) {
    // End before start that survived the dropped-PM recovery above. A genuine
    // overnight event ends by ~3 AM; anything later-yet-before-start (e.g. a
    // festival's closing-day 2 PM squashed into opening night) is scrape noise.
    event.end_time = null;
  }
}

export function normalizeEventLocation(event: ExtractedEvent): void {
  // Address-in-venue-name recovery
  if (!event.address && looksLikeStreetAddress(event.venue_name)) {
    event.address = event.venue_name;
    event.venue_name = "Unknown Venue";
  }
  // Registry fill-in. Fill when the address is missing OR imprecise — a
  // town-only string like "Murphys, CA" / "Avery, CA 95224" carries no street
  // number and pins the map to the town centroid, so a registry street address
  // is strictly better. Precise (house-numbered) addresses are left untouched.
  if (!looksLikeStreetAddress(event.address)) {
    const registered = findRegisteredAddress(event.venue_name);
    if (registered) event.address = registered;
  }
  // Strip calendar-widget junk (Add to calendar / Google Calendar / iCal / …)
  // AND reseller junk (markdown artifacts, a doubled town name, a fake-local
  // venue appositive, ticket-resale links — HWY-11) at the write boundary so
  // none of it is ever stored. This is the per-event normalize hook both upsert
  // paths call, so it covers every upsertEvents source. Empty after cleaning
  // collapses to null. See lib/description-quality.ts.
  if (event.description) {
    const scrubbed = sanitizeDescriptionDetailed(event.description, {
      town: event.town,
    });
    if (scrubbed.removedResaleLinks.length > 0) {
      // Never silent: a resale link reaching ingest means a source changed, and
      // that should be visible in the scrape log.
      console.log(
        `  RESALE_LINK_STRIPPED "${event.name}": ${scrubbed.removedResaleLinks.join(", ")}`
      );
    }
    event.description = scrubbed.text || null;
  }

  // Security defense in depth (2026-07-02 review). Strip HTML tag-like text from
  // scraped free-text so an injected `</script><script>…` can't reach the DB
  // (the JSON-LD serializer also escapes it at render). Keep a required field's
  // original if stripping empties it. And null a non-http(s) `event_url` so a
  // `javascript:`/`data:` link can never be stored and later rendered as an href.
  event.name = stripTagLike(event.name) ?? event.name;
  // Strip the Squarespace/EventON page-duplication artifact ("… (Copy)") some
  // sources leak into titles. Before dedup_key generation, so the key is
  // computed from the clean title. Real event names never end in "(Copy)".
  event.name = event.name.replace(/\s*\((?:copy|copy\s*\d+)\)\s*$/i, "").trim() || event.name;
  event.venue_name = stripTagLike(event.venue_name) ?? event.venue_name;
  if (event.description) {
    event.description = stripTagLike(event.description);
  }
  if (event.artists && event.artists.length > 0) {
    event.artists = event.artists
      .map((a) => stripTagLike(a))
      .filter((a): a is string => !!a);
  }
  if (event.event_url && !isHttpUrl(event.event_url)) {
    event.event_url = null;
  }
}

/**
 * Drop events that are outside the Hwy 4 corridor. A belt-and-suspenders guard
 * at the write boundary so it covers EVERY source — not just GoCalaveras, which
 * filters at fetch time. Some aggregators (e.g. visit-calaveras) tag an
 * out-of-area venue with a corridor town and would otherwise slip through.
 */
function dropOutOfCorridor(
  events: ExtractedEvent[],
  orgSlug: string
): ExtractedEvent[] {
  const kept: ExtractedEvent[] = [];
  for (const e of events) {
    if (isOutOfCorridor(e.address, e.venue_name, e.description)) {
      console.warn(
        `  OUT_OF_CORRIDOR source=${orgSlug} venue="${e.venue_name}" ` +
        `date=${e.date} town="${e.town}" name="${e.name}" addr="${e.address ?? ""}"`
      );
      continue;
    }
    kept.push(e);
  }
  return kept;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
  skippedFuzzy: number;
}

// generateDedupKey now lives in lib/event-identity.ts (the one identity-key
// definition, shared with the /admin/submissions publish action). Imported and
// re-exported above.


// ---------------------------------------------------------------------------
// Conservative cross-source / re-titled-event matcher.
//
// The dedup_key (normalized-title|date|town) only catches byte-identical
// re-scrapes of the same title. It is blind to the same real event listed
// under a different title — either by the same source over time, or by a
// second source. This matcher closes that gap WITHOUT risking false merges:
// two rows are the same event only if they share town + date + exact start
// time (end times must agree when both are known) AND at least one strong
// identity signal — same venue, near-identical description, or overlapping
// artists. Title similarity alone is deliberately NOT a trigger.
// ---------------------------------------------------------------------------

interface MatchableRow {
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  description: string | null;
  artists?: string[] | null;
  /** Curated festival umbrella card. Selected on every candidate so an incoming
   *  scrape can never be merged INTO an umbrella (HWY-10); scraped events never
   *  set it themselves, so the incoming side is always false. */
  series_umbrella?: boolean | null;
}

/** Decide if an incoming event and an existing same-date/same-town candidate
 *  are the same real event. Thin wrapper over the shared `isSameEvent` so the
 *  write-time and read-time definitions can never diverge. The caller already
 *  guarantees date + town match; `isSameEvent` re-checks the time slot and the
 *  identity signals (title / artists / description / venue+generic / venue+act). */
function isStrongEventMatch(
  event: ExtractedEvent,
  candidate: MatchableRow & { name?: string }
): boolean {
  return isSameEvent(event, { ...candidate, name: candidate.name ?? "" });
}

type MergeableRow = MatchableRow & {
  name: string;
  town: string;
  price: string | null;
  event_url: string | null;
  address: string | null;
  image_url: string | null;
  source_event_id?: string | null;
  price_locked?: boolean | null;
  description_locked?: boolean | null;
  poster_locked?: boolean | null;
  notability_locked?: boolean | null;
  times_locked?: boolean | null;
};

const isArtifactVenue = (v: string | null | undefined): boolean =>
  !v || v.trim().startsWith("@") || /\bfeaturing\b/i.test(v);

/** When two rows are the same event, build an update that keeps the survivor
 *  at least as rich as both: prefer the incoming (freshest) value per field,
 *  but never overwrite a populated field with an empty one, never replace a
 *  clean venue with a scraper-artifact venue, and union the artist lists. */
export function buildStrongMatchUpdate(
  existing: MergeableRow,
  event: ExtractedEvent,
  dedupKey: string,
  now: string
) {
  const pick = <T>(incoming: T, current: T): T =>
    incoming != null && incoming !== "" ? incoming : current;

  const pickVenue = (incoming: string, current: string | null): string => {
    if (isArtifactVenue(incoming) && current && !isArtifactVenue(current)) {
      return current;
    }
    return incoming || current || "";
  };

  const artistSet = new Set(
    [...(existing.artists ?? []), ...(event.artists ?? [])]
      .map((a) => a?.trim())
      .filter((a): a is string => !!a)
  );

  return {
    name: pick(event.name, existing.name),
    venue_name: pickVenue(event.venue_name, existing.venue_name),
    // description + price are human-set when locked — leave them out entirely.
    ...(existing.description_locked
      ? {}
      : { description: pick(event.description, existing.description) }),
    // Times are human-set when locked — leave them out entirely.
    ...(existing.times_locked
      ? {}
      : {
          start_time: pick(event.start_time, existing.start_time),
          end_time: pick(event.end_time, existing.end_time),
        }),
    ...(existing.price_locked ? {} : { price: pick(event.price, existing.price) }),
    event_url: pick(event.event_url, existing.event_url),
    address: pick(event.address, existing.address),
    ...(existing.poster_locked ? {} : { image_url: pick(event.image_url ?? null, existing.image_url) }),
    // Notability is human-set when locked — otherwise write the freshly-resolved flag.
    ...(existing.notability_locked
      ? {}
      : { is_routine: event.is_routine ?? false, routine_reason: event.routine_reason ?? null }),
    // Self-heal category, upgrade-only (never write "other" over a specific type).
    ...(event.category && event.category !== "other"
      ? { category: event.category }
      : {}),
    artists: artistSet.size > 0 ? [...artistSet] : null,
    dedup_key: dedupKey,
    ...(event.source_event_id && { source_event_id: event.source_event_id }),
    last_scraped_at: now,
  };
}

const EXISTING_ROW_SELECT =
  "id, name, date, venue_name, description, start_time, end_time, price, event_url, address, town, image_url, category, dedup_key, source_event_id, price_locked, description_locked, poster_locked, is_routine, notability_locked, times_locked";

type ExistingRow = {
  id: string;
  name: string;
  // Included so a rescheduled event (same stable source_event_id, new date) is
  // detected as changed and the new date propagates. Without it a moved date is
  // silently dropped and the stored row keeps showing the old day.
  date: string;
  venue_name: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  price: string | null;
  event_url: string | null;
  address: string | null;
  town: string;
  image_url: string | null;
  category?: string | null;
  dedup_key?: string | null;
  source_event_id?: string | null;
  // When true, the field is human-set — no scrape write may touch it.
  price_locked?: boolean | null;
  description_locked?: boolean | null;
  poster_locked?: boolean | null;
  is_routine?: boolean | null;
  notability_locked?: boolean | null;
  times_locked?: boolean | null;
};

export function rowChanged(existing: ExistingRow, event: ExtractedEvent): boolean {
  return (
    existing.name !== event.name ||
    // A rescheduled event keeps its stable source_event_id but changes date.
    // (For sources whose source_event_id or dedup_key already embeds the date,
    // the matched row's date equals the incoming date, so this is a no-op.)
    existing.date !== event.date ||
    existing.venue_name !== event.venue_name ||
    // A locked field can't be written, so a diff there is not a change.
    (!existing.description_locked && existing.description !== event.description) ||
    (!existing.times_locked &&
      (existing.start_time !== event.start_time ||
        existing.end_time !== event.end_time)) ||
    (!existing.price_locked && existing.price !== event.price) ||
    existing.event_url !== event.event_url ||
    existing.address !== event.address ||
    existing.town !== event.town ||
    // Self-heal: a specific incoming category that differs from the stored one
    // counts as a change (so a stuck "other" row updates). Never a downgrade —
    // the update payload itself refuses to write "other" over a specific value.
    (event.category !== "other" && existing.category !== event.category) ||
    (!existing.poster_locked && existing.image_url !== (event.image_url ?? null)) ||
    // Re-classification: a routine flag that flips counts as a change (unless the
    // human locked it). Keeps a re-scrape self-healing.
    (!existing.notability_locked && !!existing.is_routine !== !!(event.is_routine ?? false))
  );
}

/**
 * Drop the far-future tail of a recurring series before it is written.
 * See scripts/lib/ingest-horizon.ts for why. Logs what it dropped — a silent
 * cap would read as "we covered everything" when we deliberately didn't.
 */
function dropFarFutureSeries(
  events: ExtractedEvent[],
  sourceName: string
): ExtractedEvent[] {
  const { kept, dropped } = capSeriesHorizon(events);
  if (dropped.length > 0) {
    const bySeries = new Map<string, number>();
    for (const e of dropped) {
      const k = `${e.name} @ ${e.venue_name}`;
      bySeries.set(k, (bySeries.get(k) ?? 0) + 1);
    }
    console.log(
      `  [${sourceName}] horizon cap: dropped ${dropped.length} far-future recurring instance(s)`
    );
    for (const [k, n] of bySeries) console.log(`    - ${n}x ${k}`);
  }
  return kept;
}

/**
 * Batched upsert path. Replaces the per-event SELECT+UPDATE/INSERT loop with
 * a small fixed number of bulk queries regardless of batch size. Enabled by
 * BATCH_DEDUP=1 environment variable; falls back to the serial path otherwise
 * so the rollout can be gradual.
 *
 * Total round trips: 2 SELECTs (by dedup_key, by source_event_id) + 1 SELECT
 * for fuzzy candidates + 1 bulk upsert for matched rows + 1 bulk insert for
 * new rows = 5, vs 2N for the serial path.
 */
async function upsertEventsBatched(
  events: ExtractedEvent[],
  sourceName: string,
  orgSlug: string,
  sourceUrl: string,
  visibility: "public" | "private" = "public"
): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0 };
  const now = new Date().toISOString();

  events = dropOutOfCorridor(events, orgSlug);
  events = dropFarFutureSeries(events, sourceName);

  // Pre-pass: normalize + emit quality signals + compute dedup keys
  const prepared = events.map((event) => {
    correctFromUrl(event, sourceName);
    normalizeEventTimes(event);
    normalizeEventLocation(event);
    resolveNotability(event, orgSlug);
    emitDataQualitySignal(event, sourceName, orgSlug);
    return {
      event,
      dedupKey: generateDedupKey(event.name, event.date, event.town),
    };
  });

  const dedupKeys = prepared.map((p) => p.dedupKey);
  const sourceEventIds = prepared
    .map((p) => p.event.source_event_id)
    .filter((v): v is string => !!v);

  // Bulk fetch existing rows by dedup_key (covers no-stable-id sources)
  // and by (source_name, source_event_id) for stable-id sources, in parallel.
  const [byDedupKey, bySourceEventId] = await Promise.all([
    dedupKeys.length > 0
      ? supabaseAdmin
          .from("hwy4_events")
          .select(EXISTING_ROW_SELECT)
          .in("dedup_key", dedupKeys)
      : Promise.resolve({ data: [], error: null }),
    sourceEventIds.length > 0
      ? supabaseAdmin
          .from("hwy4_events")
          .select(EXISTING_ROW_SELECT)
          .eq("source_name", sourceName)
          .in("source_event_id", sourceEventIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const existingByDedupKey = new Map<string, ExistingRow>();
  for (const row of (byDedupKey.data ?? []) as ExistingRow[]) {
    if (row.dedup_key) existingByDedupKey.set(row.dedup_key, row);
  }
  const existingBySourceEventId = new Map<string, ExistingRow>();
  for (const row of (bySourceEventId.data ?? []) as ExistingRow[]) {
    if (row.source_event_id) existingBySourceEventId.set(row.source_event_id, row);
  }

  // Partition events into matched (will UPDATE) vs unmatched (fuzzy or INSERT)
  const matched: { event: ExtractedEvent; existing: ExistingRow; dedupKey: string; changed: boolean }[] = [];
  const unmatched: { event: ExtractedEvent; dedupKey: string }[] = [];

  for (const { event, dedupKey } of prepared) {
    const existing =
      (event.source_event_id && existingBySourceEventId.get(event.source_event_id)) ||
      existingByDedupKey.get(dedupKey) ||
      null;
    if (existing) {
      matched.push({ event, existing, dedupKey, changed: rowChanged(existing, event) });
    } else {
      unmatched.push({ event, dedupKey });
    }
  }

  // Match the unmatched batch against existing same-date rows in one bulk
  // SELECT. A row is the same event only with the strong anchor (exact start
  // time + venue/description/artist signal) — never title similarity alone.
  let fuzzyMatched: Set<string> = new Set();
  if (unmatched.length > 0) {
    const unmatchedDates = [...new Set(unmatched.map((u) => u.event.date))];
    const { data: candidates } = await supabaseAdmin
      .from("hwy4_events")
      .select(
        "id, name, town, date, start_time, end_time, venue_name, description, artists, price, event_url, address, image_url, source_event_id, series_umbrella, price_locked, description_locked, poster_locked, notability_locked, times_locked"
      )
      .in("date", unmatchedDates);

    type Candidate = MergeableRow & { id: string; date: string };
    const candidatesByDate = new Map<string, Candidate[]>();
    for (const c of (candidates ?? []) as Candidate[]) {
      const list = candidatesByDate.get(c.date) ?? [];
      list.push(c);
      candidatesByDate.set(c.date, list);
    }

    const matchUpdates: { id: string; payload: object; eventName: string; existingName: string }[] = [];
    const claimed = new Set<string>(); // existing row ids already merged into this batch
    for (const u of unmatched) {
      const dateCandidates = candidatesByDate.get(u.event.date) ?? [];
      const canonicalTown = normalizeTown(u.event.town);
      const hit = dateCandidates.find(
        (c) =>
          !claimed.has(c.id) &&
          normalizeTown(c.town) === canonicalTown &&
          isStrongEventMatch(u.event, c)
      );
      if (hit) {
        claimed.add(hit.id);
        matchUpdates.push({
          id: hit.id,
          payload: buildStrongMatchUpdate(hit, u.event, u.dedupKey, now),
          eventName: u.event.name,
          existingName: hit.name,
        });
        fuzzyMatched.add(u.dedupKey);
      }
    }

    if (matchUpdates.length > 0) {
      // Per-row UPDATEs in parallel. Can't use upsert(onConflict:"id") — a
      // partial payload trips NOT NULL constraints before ON CONFLICT routing.
      const updates = await Promise.all(
        matchUpdates.map((m) =>
          supabaseAdmin.from("hwy4_events").update(m.payload).eq("id", m.id)
        )
      );
      let errCount = 0;
      for (const { error } of updates) {
        if (error) errCount++;
      }
      if (errCount > 0) {
        console.error(`Bulk merge: ${errCount}/${matchUpdates.length} failed`);
      }
      result.skippedFuzzy += matchUpdates.length - errCount;
      for (let i = 0; i < matchUpdates.length; i++) {
        if (!updates[i].error) {
          const m = matchUpdates[i];
          console.log(`  Merged duplicate: "${m.eventName}" → existing "${m.existingName}"`);
        }
      }
    }
  }

  // Matched rows: changed → full payload update; unchanged → touch
  // last_scraped_at (+ source_event_id backfill) only. Same NOT NULL trap
  // applies to upsert here, so fan out as parallel per-row UPDATEs.
  if (matched.length > 0) {
    const updates = await Promise.all(
      matched.map(({ event, existing, dedupKey, changed }) => {
        const payload = changed
          ? {
              name: event.name,
              // Propagate a rescheduled date (dedup_key is recomputed from it
              // below, keeping identity self-consistent).
              date: event.date,
              venue_name: event.venue_name,
              venue_key: resolveVenueKey(event),
              // Locked fields are human-set — never overwrite them.
              ...(existing.description_locked ? {} : { description: event.description }),
              ...(existing.times_locked
                ? {}
                : { start_time: event.start_time, end_time: event.end_time }),
              ...(existing.price_locked ? {} : { price: event.price }),
              event_url: event.event_url,
              address: event.address,
              town: event.town,
              ...(existing.poster_locked ? {} : { image_url: event.image_url ?? null }),
              ...(existing.notability_locked
                ? {}
                : { is_routine: event.is_routine ?? false, routine_reason: event.routine_reason ?? null }),
              dedup_key: dedupKey,
              ...(event.source_event_id && { source_event_id: event.source_event_id }),
              last_scraped_at: now,
            }
          : {
              last_scraped_at: now,
              ...(event.source_event_id && { source_event_id: event.source_event_id }),
            };
        return supabaseAdmin.from("hwy4_events").update(payload).eq("id", existing.id);
      })
    );
    let updateErrCount = 0;
    for (let i = 0; i < matched.length; i++) {
      if (updates[i].error) {
        updateErrCount++;
        console.error(`Update failed for "${matched[i].event.name}":`, updates[i].error?.message);
      } else if (matched[i].changed) {
        result.updated++;
      } else {
        result.unchanged++;
      }
    }
    if (updateErrCount > 0) {
      console.warn(`${updateErrCount}/${matched.length} matched-row updates failed`);
    }
  }

  // Bulk INSERT for events that didn't match anything (exact or fuzzy).
  // First, dedupe by dedup_key within the input batch — two scraped events
  // can compute the same key after normalization (rare, but happens when a
  // source emits near-duplicate entries). The unique constraint on dedup_key
  // would atomically abort the whole insert otherwise. Keep the first one,
  // log the dropped names so the underlying data issue is visible.
  const toInsertAll = unmatched.filter((u) => !fuzzyMatched.has(u.dedupKey));
  const seenKeys = new Set<string>();
  const toInsert: typeof toInsertAll = [];
  for (const u of toInsertAll) {
    if (seenKeys.has(u.dedupKey)) {
      console.warn(
        `  Dropped in-batch duplicate (same dedup_key): "${u.event.name}" | ${u.event.date} | ${u.event.town}`
      );
      continue;
    }
    seenKeys.add(u.dedupKey);
    toInsert.push(u);
  }

  if (toInsert.length > 0) {
    const insertPayloads = toInsert.map(({ event, dedupKey }) => ({
      name: event.name,
      description: event.description,
      date: event.date,
      start_time: event.start_time,
      end_time: event.end_time,
      venue_name: event.venue_name,
      venue_key: resolveVenueKey(event),
      town: event.town,
      address: event.address,
      category: event.category,
      artists: event.artists,
      status: "confirmed",
      is_past: false,
      price: event.price,
      event_url: event.event_url,
      image_url: event.image_url ?? null,
      source_url: sourceUrl,
      source_name: sourceName,
      visibility,
      org_slug: orgSlug,
      dedup_key: dedupKey,
      source_event_id: event.source_event_id ?? null,
      is_routine: event.is_routine ?? false,
      routine_reason: event.routine_reason ?? null,
      last_scraped_at: now,
    }));
    const { data, error } = await supabaseAdmin
      .from("hwy4_events")
      .insert(insertPayloads)
      .select("id");
    if (error) {
      console.error(`Bulk insert failed (${toInsert.length} events):`, error.message);
    } else {
      result.inserted = data?.length ?? toInsert.length;
    }
  }

  recordSourceResult(orgSlug, result);
  return result;
}

export async function upsertEvents(
  events: ExtractedEvent[],
  sourceName: string,
  orgSlug: string,
  sourceUrl: string,
  // Member-only sources (Blue Lake Springs, Sequoia Woods, …) pass "private" so
  // rows are gated behind the Clubs filter + render the "Members & Guests" badge.
  // Defaults to "public" so every existing caller is unchanged.
  visibility: "public" | "private" = "public"
): Promise<UpsertResult> {
  // Opt-in batched path. Falls back to the serial path so the rollout can be
  // gated per scrape run via `BATCH_DEDUP=1 npm run scrape`.
  if (process.env.BATCH_DEDUP === "1") {
    return upsertEventsBatched(events, sourceName, orgSlug, sourceUrl, visibility);
  }

  const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0 };

  events = dropOutOfCorridor(events, orgSlug);
  events = dropFarFutureSeries(events, sourceName);

  for (const event of events) {
    // Normalize location fields before keying / writing — recovers from
    // scrapers that crossed venue_name with address, and back-fills address
    // from the venue registry where possible.
    correctFromUrl(event, sourceName);
    normalizeEventTimes(event);
    normalizeEventLocation(event);
    resolveNotability(event, orgSlug);

    // Last-chance data-quality signal: anything still generic / address-less
    // at this point is a real gap the matcher + registry couldn't close.
    emitDataQualitySignal(event, sourceName, orgSlug);

    const dedupKey = generateDedupKey(event.name, event.date, event.town);

    // Prefer the source-side stable id when the scraper provided one — this
    // survives town/venue/name changes so re-scrapes can update in place.
    // Falls back to dedup_key for sources that don't have a stable id.
    let existing: {
      id: string;
      name: string;
      date: string;
      venue_name: string;
      description: string | null;
      start_time: string | null;
      end_time: string | null;
      price: string | null;
      event_url: string | null;
      address: string | null;
      town: string;
      image_url: string | null;
      category?: string | null;
      price_locked?: boolean | null;
      description_locked?: boolean | null;
      poster_locked?: boolean | null;
      is_routine?: boolean | null;
      notability_locked?: boolean | null;
      times_locked?: boolean | null;
    } | null = null;

    if (event.source_event_id) {
      const { data } = await supabaseAdmin
        .from("hwy4_events")
        .select(
          "id, name, date, venue_name, description, start_time, end_time, price, event_url, address, town, image_url, category, price_locked, description_locked, poster_locked, is_routine, notability_locked, times_locked"
        )
        .eq("source_name", sourceName)
        .eq("source_event_id", event.source_event_id)
        .maybeSingle();
      existing = data ?? null;
    }
    if (!existing) {
      const { data } = await supabaseAdmin
        .from("hwy4_events")
        .select(
          "id, name, date, venue_name, description, start_time, end_time, price, event_url, address, town, image_url, category, price_locked, description_locked, poster_locked, is_routine, notability_locked, times_locked"
        )
        .eq("dedup_key", dedupKey)
        .maybeSingle();
      existing = data ?? null;
    }

    const now = new Date().toISOString();

    if (existing) {
      // Check if any mutable fields changed. A locked field can't be written,
      // so a diff there doesn't count as a change.
      const changed =
        existing.name !== event.name ||
        // Rescheduled event (stable source_event_id, new date). No-op for sources
        // whose source_event_id / dedup_key already embeds the date.
        existing.date !== event.date ||
        existing.venue_name !== event.venue_name ||
        (!existing.description_locked && existing.description !== event.description) ||
        (!existing.times_locked &&
          (existing.start_time !== event.start_time ||
            existing.end_time !== event.end_time)) ||
        (!existing.price_locked && existing.price !== event.price) ||
        existing.event_url !== event.event_url ||
        existing.address !== event.address ||
        existing.town !== event.town ||
        (event.category !== "other" && existing.category !== event.category) ||
        (!existing.poster_locked && existing.image_url !== (event.image_url ?? null)) ||
        (!existing.notability_locked && !!existing.is_routine !== !!(event.is_routine ?? false));

      if (changed) {
        await supabaseAdmin
          .from("hwy4_events")
          .update({
            name: event.name,
            // Propagate a rescheduled date; dedup_key below is recomputed from it.
            date: event.date,
            venue_name: event.venue_name,
            venue_key: resolveVenueKey(event),
            // Locked fields are human-set — never overwrite them.
            ...(existing.description_locked ? {} : { description: event.description }),
            ...(existing.times_locked
              ? {}
              : { start_time: event.start_time, end_time: event.end_time }),
            ...(existing.price_locked ? {} : { price: event.price }),
            event_url: event.event_url,
            address: event.address,
            town: event.town,
            // Self-heal category on re-scrape so a row that once landed in
            // "other" (e.g. a failed classify run) gets corrected when a later
            // run classifies it. Only ever *upgrade*: never overwrite a specific
            // category with "other" (avoids the reverse ratchet).
            ...(event.category && event.category !== "other"
              ? { category: event.category }
              : {}),
            ...(existing.poster_locked ? {} : { image_url: event.image_url ?? null }),
            ...(existing.notability_locked
              ? {}
              : { is_routine: event.is_routine ?? false, routine_reason: event.routine_reason ?? null }),
            // Keep dedup_key in sync with the (possibly-changed) town so
            // dedup_key lookups still find this row if source_event_id
            // ever disappears.
            dedup_key: dedupKey,
            ...(event.source_event_id && {
              source_event_id: event.source_event_id,
            }),
            last_scraped_at: now,
          })
          .eq("id", existing.id);
        result.updated++;
      } else {
        // Just touch last_scraped_at — but also opportunistically backfill
        // source_event_id on pre-existing rows that pre-date this column
        // being populated.
        await supabaseAdmin
          .from("hwy4_events")
          .update({
            last_scraped_at: now,
            ...(event.source_event_id && {
              source_event_id: event.source_event_id,
            }),
          })
          .eq("id", existing.id);
        result.unchanged++;
      }
    } else {
      // Cross-source / re-titled-event match: same date + town + exact start
      // time + a strong identity signal (venue / description / artists). This
      // catches the same real event listed under a different title that the
      // title-based dedup_key can't see.
      const canonicalTown = normalizeTown(event.town);
      const { data: candidates } = await supabaseAdmin
        .from("hwy4_events")
        .select(
          "id, name, town, start_time, end_time, venue_name, description, artists, price, event_url, address, image_url, source_event_id, series_umbrella, price_locked, description_locked, poster_locked, notability_locked, times_locked"
        )
        .eq("date", event.date);

      const strongMatch = candidates?.find(
        (c) =>
          normalizeTown(c.town) === canonicalTown &&
          isStrongEventMatch(event, c as MatchableRow)
      );

      if (strongMatch) {
        // Merge into the existing row so the survivor keeps the best of both,
        // and re-key it to the incoming dedup_key.
        await supabaseAdmin
          .from("hwy4_events")
          .update(buildStrongMatchUpdate(strongMatch as MergeableRow, event, dedupKey, now))
          .eq("id", strongMatch.id);
        result.skippedFuzzy++;
        console.log(`  Merged duplicate: "${event.name}" → existing "${strongMatch.name}"`);
        continue;
      }

      // Insert new event
      const { error } = await supabaseAdmin.from("hwy4_events").insert({
        name: event.name,
        description: event.description,
        date: event.date,
        start_time: event.start_time,
        end_time: event.end_time,
        venue_name: event.venue_name,
        venue_key: resolveVenueKey(event),
        town: event.town,
        address: event.address,
        category: event.category,
        artists: event.artists,
        status: "confirmed",
        is_past: false,
        price: event.price,
        event_url: event.event_url,
        image_url: event.image_url ?? null,
        source_url: sourceUrl,
        source_name: sourceName,
        visibility,
        org_slug: orgSlug,
        dedup_key: dedupKey,
        source_event_id: event.source_event_id ?? null,
        is_routine: event.is_routine ?? false,
        routine_reason: event.routine_reason ?? null,
        last_scraped_at: now,
      });

      if (error) {
        console.error(`Failed to insert event "${event.name}":`, error.message);
      } else {
        result.inserted++;
      }
    }
  }

  recordSourceResult(orgSlug, result);
  return result;
}
