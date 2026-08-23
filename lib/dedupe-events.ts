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
  isGenericTitle,
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
  // For the survivor tie-break (HWY-29). Optional: read-time projections drop
  // the timestamps; reconcile selects `*`, so its rows carry it.
  created_at?: string | null;
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
  // A listing that states when it starts beats one that doesn't. Only matters
  // since timeless rows became mergeable (HWY-10): the survivor decides which
  // clock the card shows, and "7:00 PM" is strictly more useful than silence.
  if (e.start_time) s += 4;
  s += Math.min((e.description?.length ?? 0) / 50, 6);
  if (e.source_event_id) s += 2;
  if (e.image_url) s += 1;
  if (e.event_url) s += 1;
  // An umbrella/series placeholder ("Bistro Summer Concerts Series") must lose
  // the display slot to the specific act sharing its venue + time, so the card
  // shows the band name and its category, not the generic series row.
  if (e.name && isGenericTitle(e.name)) s -= 12;
  return s;
}

/** Groups rows that *could* be the same event so clustering stays near-linear.
 *  Keyed on date + visibility only — every identity field is left to
 *  `isSameEvent`, which is the single owner of the "same event" rule.
 *
 *  This key has twice been caught holding a silent second copy of a rule that
 *  lives in the predicate, and each time it made a whole class of duplicate
 *  unreachable no matter how the predicate was loosened:
 *   - **start time** (removed HWY-10): a row with no start hashed to a bucket of
 *     its own and was never compared to its timed twin (the Kane Brown double,
 *     the Moose "Rib Feed" pair).
 *   - **town** (removed 2026-07-28): a community submission that labeled
 *     Calaveras Big Trees State Park "Camp Connell" instead of "Arnold" landed in
 *     a different bucket from the park's own listing of the same program on the
 *     same night, so the softened town veto in `isSameEvent` could never have
 *     been reached from here.
 *  What is left is purely a performance device, which is all it was ever meant
 *  to be. Buckets stay small: one corridor date is a few dozen rows even on a
 *  busy Saturday, and the in-bucket pairwise pass over that is trivial. */
function bucketKey(e: DedupableEvent): string {
  return [e.date, e.visibility ?? ""].join("|");
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

/** The richest row of a cluster — the one to keep / display. On a richness tie,
 *  break deterministically toward the OLDER row (HWY-29): a 1-day-old aggregator
 *  re-insert must not displace a months-old enriched resident, and the survivor
 *  must not flip on nondeterministic DB row order (which reset the row's id and
 *  its verification/price stamps every reconcile). Falls back to keeping the
 *  incumbent when neither row carries a created_at. */
export function pickSurvivor<T extends DedupableEvent>(cluster: T[]): T {
  return cluster.reduce((best, cur) => {
    const rc = richness(cur);
    const rb = richness(best);
    if (rc !== rb) return rc > rb ? cur : best;
    const ac = cur.created_at ?? null;
    const ab = best.created_at ?? null;
    if (ac && ab && ac !== ab) return ac < ab ? cur : best; // older wins
    if (ac && !ab) return cur; // a known age beats an unknown one
    return best; // both unknown or equal: keep the incumbent (stable)
  });
}

/** The survivor of a cluster, enriched by backfilling display fields it lacks
 *  from its siblings. The richest row keeps its identity (title, artists,
 *  category, link target), but a sibling can still donate the description /
 *  image a bare act row is missing — so the surviving card carries the band
 *  name AND the umbrella listing's blurb + poster. Returns a shallow copy;
 *  inputs are never mutated. Mirrors `buildFill` in lib/reconcile.ts, which does
 *  the same backfill on DB state. */
export function mergeCluster<T extends DedupableEvent>(cluster: T[]): T {
  const winner = pickSurvivor(cluster);
  if (cluster.length === 1) return winner;
  const merged: T = { ...winner };
  const len = (v: unknown) => (typeof v === "string" ? v.trim().length : 0);
  // Description: a bare act row often has none; the umbrella sibling carries the
  // blurb. Take the longest in the cluster so the card isn't empty.
  for (const e of cluster) {
    if (len(e.description) > len(merged.description)) merged.description = e.description;
  }
  // Clock: a timeless survivor inherits the sibling's time rather than showing
  // a card with no hour (HWY-10). Mirrors buildFill in lib/reconcile.ts.
  if (!merged.start_time) {
    const donor = cluster.find((e) => e.start_time);
    if (donor) {
      merged.start_time = donor.start_time;
      if (!merged.end_time) merged.end_time = donor.end_time;
    }
  }
  // Image / link: keep the winner's (the band photo), else borrow from a sibling.
  if (!merged.image_url) {
    const donor = cluster.find((e) => e.image_url)?.image_url;
    if (donor) merged.image_url = donor;
  }
  if (!merged.event_url) {
    const donor = cluster.find((e) => e.event_url)?.event_url;
    if (donor) merged.event_url = donor;
  }
  return merged;
}

/**
 * Collapse same-event duplicates, keeping the merged survivor of each cluster
 * and preserving input order (survivor emitted at the cluster's earliest
 * position).
 */
export function dedupeEvents<T extends DedupableEvent>(events: T[]): T[] {
  const survivorOf = new Map<T, T>();
  for (const cluster of clusterEvents(events)) {
    const survivor = mergeCluster(cluster);
    for (const m of cluster) survivorOf.set(m, survivor);
  }

  const emitted = new Set<T>();
  const result: T[] = [];
  for (const e of events) {
    const survivor = survivorOf.get(e) ?? e;
    if (emitted.has(survivor)) continue;
    emitted.add(survivor);
    result.push(survivor);
  }
  return result;
}

/** Clusters with 2+ members — i.e. duplicate groups. For the audit. */
export function findDuplicateClusters<T extends DedupableEvent>(events: T[]): T[][] {
  return clusterEvents(events).filter((c) => c.length > 1);
}

// The read-time layer's history, for the archaeologist: `dedupeEvents` ran a
// silent COLLAPSE on every user-facing list until HWY-16 (2026-08-11)
// downgraded it to a loud, non-collapsing `assertNoResidentDuplicates`, and
// that assertion was removed from the render paths entirely on 2026-08-23
// after soaking silent for a clean week post-HWY-29 (dedup Move 3 complete).
// Dedup at rest is owned by the write-time merge (scripts/lib/dedup.ts) and
// the nightly /api/reconcile-dupes; the daily /api/check-events audit runs
// the SAME clustering via `findDuplicateClusters` above, so a regression
// still surfaces within a day — just in the audit, not the render path.
// Consumers, precisely: `clusterEvents` + `pickSurvivor` feed
// lib/reconcile.ts; `findDuplicateClusters` feeds /api/check-events;
// `dedupeEvents`/`mergeCluster` have no production consumers and survive for
// the dev CLI (scripts/check-feed-dedup.ts) and as the collapse
// implementation should a read-time layer ever be wanted back.
