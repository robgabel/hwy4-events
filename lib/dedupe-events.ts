// Read-time duplicate collapse — the "no dupe ever reaches a user" safety net.
//
// Scrapers can list the same real-world event twice: one source re-lists it
// under a changed title (different dedup_key), or two sources describe it
// independently. Neither collides on the title-based dedup_key, so a write-time
// fix alone can't be trusted to catch everything. This pass runs on every
// user-facing event list and guarantees one card per real event.
//
// The "same event" decision lives in ONE place — `isSameEvent` in
// `lib/event-identity.ts`, imported here and by the write-time matcher in
// `scripts/lib/dedup.ts`. This file owns only the read-time concerns layered on
// top of that predicate: bucketing for near-linear clustering, survivor scoring,
// and order-preserving collapse.

import {
  isSameEvent,
  normalizeTown,
  normalizeTime,
  normalizeVenue,
  GENERIC_VENUES,
  type EventIdentity,
} from "./event-identity";

export { normalizeVenue };

/** Minimal shape needed to dedupe — a structural subset of Hwy4Event so this
 *  works on the homepage, town pages, and the briefing rows (which select a
 *  narrower column set). Extends the shared identity shape with the render-only
 *  fields used for bucketing and survivor selection. */
export interface DedupableEvent extends EventIdentity {
  date: string;
  town: string;
  visibility?: string | null;
  source_event_id?: string | null;
  image_url?: string | null;
  event_url?: string | null;
  robs_pick?: boolean;
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

/** Groups rows that *could* be the same event so clustering stays near-linear.
 *  Keyed on town + date + normalized start + visibility — NOT end time: a
 *  source that omits the end ("7:00 PM") must share a bucket with the same
 *  source's fuller listing ("7:00 PM – 10:00 PM"). The end-time rule lives in
 *  `isSameEvent` (`timesAnchor`), so this is purely a performance pre-filter. */
function bucketKey(e: DedupableEvent): string {
  return [
    normalizeTown(e.town),
    e.date,
    normalizeTime(e.start_time),
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
