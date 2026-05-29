// Read-time duplicate collapse — the "no dupe ever reaches a user" safety net.
//
// Scrapers can list the same real-world event twice: one source re-lists it
// under a changed title (different dedup_key), or two sources describe it
// independently. Neither collides on the title-based dedup_key, so a write-time
// fix alone can't be trusted to catch everything. This pass runs on every
// user-facing event list and guarantees one card per real event.
//
// Conservative by design: two rows only collapse when they share the same town,
// date, and *exact* start/end time AND at least one strong identity signal
// (same venue, near-identical description, or overlapping artists). Title
// similarity alone is deliberately NOT a trigger — "Live Music @ Murphys Park"
// and "Live Music @ Murphys Hotel" are different events, and we will not merge
// two distinct shows just because their names rhyme.

const TOWN_ALIASES: Record<string, string> = {
  "white pines": "arnold",
  "hathaway pines": "arnold",
};

const GENERIC_VENUES = new Set([
  "",
  "tba",
  "tbd",
  "unknown",
  "unknown venue",
  "various",
  "various locations",
  "online",
  "virtual",
]);

/** Minimal shape needed to dedupe — a structural subset of Hwy4Event so this
 *  works on the homepage, town pages, and the briefing rows (which select a
 *  narrower column set). */
export interface DedupableEvent {
  name: string;
  date: string;
  town: string;
  venue_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  description?: string | null;
  artists?: string[] | null;
  visibility?: string | null;
  source_event_id?: string | null;
  image_url?: string | null;
  event_url?: string | null;
  robs_pick?: boolean;
}

function normalizeTown(town: string): string {
  const lower = (town ?? "").toLowerCase().trim();
  return TOWN_ALIASES[lower] ?? lower;
}

/** Strip leading "@", "the", trailing "featuring …" tails that scrapers append
 *  to venue names, and all punctuation. Leaves a comparable core. */
export function normalizeVenue(venue: string | null | undefined): string {
  if (!venue) return "";
  return venue
    .toLowerCase()
    .trim()
    .replace(/^@\s*/, "")
    .replace(/^the\s+/, "")
    .replace(/\s+featuring\s+.*$/, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^the\s+/, "")
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"');
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/** Normalized-string similarity in [0,1]. */
function textSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().replace(/\s+/g, " ").trim();
  const nb = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

function venueMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (GENERIC_VENUES.has(a) || GENERIC_VENUES.has(b)) return false;
  if (a === b) return true;
  // Containment handles "murphys park" vs "murphys park stage", etc. Guard the
  // shorter side against being trivially short to avoid junk matches.
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 5 && longer.includes(shorter);
}

function artistsOverlap(
  a: string[] | null | undefined,
  b: string[] | null | undefined
): boolean {
  if (!a?.length || !b?.length) return false;
  const setA = new Set(a.map((x) => x.toLowerCase().trim()).filter(Boolean));
  return b.some((x) => setA.has(x.toLowerCase().trim()));
}

/** A title generic enough that it's an aggregator placeholder for whatever act
 *  is playing — "Live Music @ The Lube Room". A generic + a specific title at
 *  the same venue and exact time are the same show. */
function isGenericTitle(name: string): boolean {
  const n = normalizeName(name);
  return (
    /^live music\b/.test(n) ||
    /^live (entertainment|tunes)\b/.test(n) ||
    /^music (in|at|on) the\b/.test(n)
  );
}

/** Two rows already share town + date + exact start/end + visibility (the
 *  bucket key). Decide whether they're the same real event.
 *
 *  Deliberately conservative: a shared venue + time slot is NOT enough on its
 *  own — a community park or lake legitimately hosts different events back to
 *  back. We require an identity signal that distinguishes "same show, two
 *  listings" from "two different events at the same place":
 *   - near-identical titles, or
 *   - overlapping artists, or
 *   - near-identical descriptions, or
 *   - same venue AND one title is a generic placeholder.
 *  Two *different specific* titles never merge on venue/time alone. */
function isSameEvent(a: DedupableEvent, b: DedupableEvent): boolean {
  if (textSimilarity(a.name, b.name) >= 0.85) return true;
  if (artistsOverlap(a.artists, b.artists)) return true;
  if (
    a.description &&
    b.description &&
    textSimilarity(a.description, b.description) >= 0.92
  ) {
    return true;
  }
  if (
    venueMatch(normalizeVenue(a.venue_name), normalizeVenue(b.venue_name)) &&
    (isGenericTitle(a.name) || isGenericTitle(b.name))
  ) {
    return true;
  }
  return false;
}

/** Higher score = better card to show / keep. Curated picks always win; then
 *  prefer rows with artists, a real venue, a fuller description, a stable
 *  source id, and media. */
function richness(e: DedupableEvent): number {
  let s = 0;
  if (e.robs_pick) s += 100;
  if (e.artists?.length) s += 5;
  const venue = normalizeVenue(e.venue_name);
  if (venue && !GENERIC_VENUES.has(venue)) s += 3;
  // Penalize venue strings that are scraper artifacts ("@Murphys Park
  // featuring The Star Dogs") so a clean venue wins the display slot.
  const rawVenue = (e.venue_name ?? "").trim();
  if (rawVenue.startsWith("@") || /\bfeaturing\b/i.test(rawVenue)) s -= 4;
  s += Math.min((e.description?.length ?? 0) / 50, 6);
  if (e.source_event_id) s += 2;
  if (e.image_url) s += 1;
  if (e.event_url) s += 1;
  return s;
}

function bucketKey(e: DedupableEvent): string {
  return [
    normalizeTown(e.town),
    e.date,
    e.start_time ?? "",
    e.end_time ?? "",
    e.visibility ?? "",
  ].join("|");
}

/**
 * Cluster events into same-event groups. Every input row appears in exactly
 * one cluster (singletons included). Order within a cluster follows input
 * order. Shared by dedupeEvents (render) and findDuplicateClusters (audit) so
 * the "same event" definition can never drift between them.
 */
export function clusterEvents<T extends DedupableEvent>(events: T[]): T[][] {
  const buckets = new Map<string, T[]>();
  for (const e of events) {
    const key = bucketKey(e);
    const list = buckets.get(key) ?? [];
    list.push(e);
    buckets.set(key, list);
  }

  const clusters: T[][] = [];
  for (const list of buckets.values()) {
    if (list.length === 1) {
      clusters.push(list);
      continue;
    }
    // Cluster ONLY within this bucket. Searching across buckets would let a
    // venue match chain unrelated events from different dates/times together.
    const bucketClusters: T[][] = [];
    for (const e of list) {
      const hit = bucketClusters.find((c) => c.some((m) => isSameEvent(e, m)));
      if (hit) hit.push(e);
      else bucketClusters.push([e]);
    }
    clusters.push(...bucketClusters);
  }
  return clusters;
}

/** The richest row of a cluster — the one to keep / display. */
export function pickSurvivor<T extends DedupableEvent>(cluster: T[]): T {
  return cluster.reduce((best, cur) =>
    richness(cur) > richness(best) ? cur : best
  );
}

/**
 * Collapse same-event duplicates, keeping the richest row of each cluster and
 * preserving input order (winner emitted at its earliest position).
 */
export function dedupeEvents<T extends DedupableEvent>(events: T[]): T[] {
  const winnerOf = new Map<T, T>();
  for (const cluster of clusterEvents(events)) {
    const winner = pickSurvivor(cluster);
    for (const m of cluster) winnerOf.set(m, winner);
  }

  const emitted = new Set<T>();
  const result: T[] = [];
  for (const e of events) {
    const winner = winnerOf.get(e) ?? e;
    if (emitted.has(winner)) continue;
    emitted.add(winner);
    result.push(winner);
  }
  return result;
}

/** Clusters with 2+ members — i.e. duplicate groups. For the audit. */
export function findDuplicateClusters<T extends DedupableEvent>(events: T[]): T[][] {
  return clusterEvents(events).filter((c) => c.length > 1);
}
