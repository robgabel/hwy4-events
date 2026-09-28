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
  distinctEventEvidence,
  titleCovers,
  isPlaceholderForMatch,
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
  // Row identity, for a deterministic clustering order (with created_at).
  id?: string | null;
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
  // shows the band name and its category, not the generic series row. A title
  // that names its act after a generic prefix ("Live Music - Jill Warren") is
  // not a placeholder and is not penalized: it IS the band name.
  if (e.name && isPlaceholderForMatch(e)) s -= 12;
  // A routine operation ("Thursday Night Dinner") is hidden on every public
  // surface, so a cluster that also holds a real event must never keep the
  // routine row: the event would vanish with it (dedup v2 1.7). Outweighs
  // everything above, a Rob's Pick included.
  if (e.is_routine) s -= ROUTINE_SURVIVOR_PENALTY;
  return s;
}

/** Larger than every positive richness term combined, so any non-routine row
 *  outranks any routine one. */
const ROUTINE_SURVIVOR_PENALTY = 1000;

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

/** A match the clustering split, reported under the row that bridges it: the
 *  row resembles events that must stay apart (so joining any would be a
 *  guess), or it matched one row of a cluster that holds a row it provably is
 *  not. `matches` are the rows it matched outside its own cluster. Each split
 *  pair appears once. */
export interface RefusedMatch<T> {
  row: T;
  matches: T[];
}

export interface ClusterResult<T> {
  /** Every input row in exactly one cluster (singletons included). */
  clusters: T[][];
  /** Matches the clustering declined to act on, for a human to review. */
  refused: RefusedMatch<T>[];
}

/**
 * Cluster events into same-event groups. Every input row appears in exactly
 * one cluster (singletons included). Order within a cluster follows input
 * order. Shared by dedupeEvents (render) and findDuplicateClusters (audit) so
 * the "same event" definition can never drift between them.
 */
export function clusterEvents<T extends DedupableEvent>(events: T[]): T[][] {
  return clusterEventsDetailed(events).clusters;
}

/**
 * `clusterEvents`, plus the matches it declined (dedup v2 Phase 1.5).
 *
 * Union-find over the pairwise rule, with a cannot-link. The rule is not
 * transitive, and Phase 1 loosened it (clock tolerance across feeds, title
 * containment), so plain chaining would let one row that resembles two events
 * glue them together: a venue-only placeholder at Calaveras Big Trees matches
 * every program in its slot, and Junior Rangers plus the Meadow Walk would
 * become one cluster, one of them deleted by reconcile. So a union happens
 * only if the combined cluster holds no pair with positive evidence of being
 * different events (`distinctEventEvidence`: two named venues, two acts, one
 * feed at two start times, two titles naming different things, unless another
 * row in the cluster names both titles). A pair that is merely too vague to
 * match ("Dinner" beside "Queen of Hearts & Dinner") does not block, so
 * today's merges keep happening.
 *
 * A row that matches two rows which must stay apart is torn between two
 * events: it is taken out, the bucket is re-clustered without it, and it is
 * reported in `refused` with the rows it matched. Leaving a duplicate is
 * recoverable; merging the wrong pair deletes an event.
 *
 * Deterministic whatever order the database returns rows in: each bucket is
 * processed oldest row first (`created_at`, then `id`, then input position).
 */
export function clusterEventsDetailed<T extends DedupableEvent>(
  events: T[]
): ClusterResult<T> {
  const buckets = new Map<string, number[]>();
  events.forEach((e, i) => {
    const key = bucketKey(e);
    const list = buckets.get(key) ?? [];
    list.push(i);
    buckets.set(key, list);
  });

  const clusters: number[][] = [];
  const refused: RefusedMatch<T>[] = [];
  for (const list of buckets.values()) {
    if (list.length === 1) {
      clusters.push(list);
      continue;
    }
    // Cluster ONLY within this bucket. Searching across buckets would let a
    // venue match chain unrelated events from different dates together.
    const order = [...list].sort((i, j) => compareRowAge(events[i], events[j]) || i - j);
    const n = events.length;
    const matchCache = new Map<number, boolean>();
    const match = (i: number, j: number): boolean => {
      const k = i < j ? i * n + j : j * n + i;
      let v = matchCache.get(k);
      if (v === undefined) {
        v = isSameEvent(events[i], events[j]);
        matchCache.set(k, v);
      }
      return v;
    };
    const evidenceCache = new Map<number, ReturnType<typeof distinctEventEvidence>>();
    const evidence = (i: number, j: number) => {
      const k = i < j ? i * n + j : j * n + i;
      if (!evidenceCache.has(k)) {
        evidenceCache.set(k, match(i, j) ? null : distinctEventEvidence(events[i], events[j]));
      }
      return evidenceCache.get(k)!;
    };
    // Two rows provably different that no row in `pool` joins. A `titles`
    // pair is joined by a row that matches both and names both of their
    // titles: then they read as two partial titles of one event.
    const apart = (i: number, j: number, pool: number[]): boolean => {
      const ev = evidence(i, j);
      if (!ev) return false;
      if (ev !== "titles") return true;
      return !pool.some(
        (c) =>
          c !== i &&
          c !== j &&
          match(c, i) &&
          match(c, j) &&
          titleCovers(events[c], events[i]) &&
          titleCovers(events[c], events[j])
      );
    };
    // Would one cluster of these parts hold two rows that must stay apart?
    const conflicts = (parts: number[][]): boolean => {
      const pool = parts.flat();
      for (let p = 0; p < parts.length; p++)
        for (let q = p + 1; q < parts.length; q++)
          for (const i of parts[p]) for (const j of parts[q]) if (apart(i, j, pool)) return true;
      return false;
    };

    // Union-find in age order, then set aside every row that bridges two rows
    // which must stay apart, and repeat without them until nothing is torn.
    const settle = (pool: number[]): { groups: number[][]; torn: number[] } => {
      const out = new Set<number>();
      for (;;) {
        const active = pool.filter((j) => !out.has(j));
        let groups: number[][] = [];
        for (const i of active) {
          const hits = groups.filter((g) => g.some((j) => match(i, j)));
          if (hits.length > 0 && !conflicts([[i], ...hits])) {
            groups = groups.filter((g) => !hits.includes(g));
            groups.push([...hits.flat(), i]);
          } else {
            groups.push([i]);
          }
        }
        const torn = active.filter((c) => {
          const nb = active.filter((j) => j !== c && match(c, j));
          for (let x = 0; x < nb.length; x++)
            for (let y = x + 1; y < nb.length; y++) if (apart(nb[x], nb[y], active)) return true;
          return false;
        });
        if (torn.length === 0) return { groups, torn: pool.filter((j) => out.has(j)) };
        for (const i of torn) out.add(i);
      }
    };
    const main = settle(order);
    // The rows set aside may still be one listing twice (two copies of the
    // same vague placeholder); they cluster among themselves, never with
    // either side. A row torn again here stays alone.
    const aside = settle(main.torn);
    const groups = [...main.groups, ...aside.groups, ...aside.torn.map((i) => [i])];
    const groupOf = new Map<number, number[]>();
    for (const g of groups) for (const i of g) groupOf.set(i, g);

    for (const g of groups) clusters.push(g);
    // Report each match the clustering split once, under the row that bridges
    // the most of them (the placeholder, not each program it matched).
    let split: [number, number][] = [];
    for (let x = 0; x < order.length; x++)
      for (let y = x + 1; y < order.length; y++) {
        const [i, j] = [order[x], order[y]];
        if (groupOf.get(i) !== groupOf.get(j) && match(i, j)) split.push([i, j]);
      }
    while (split.length > 0) {
      const count = new Map<number, number>();
      for (const [i, j] of split) {
        count.set(i, (count.get(i) ?? 0) + 1);
        count.set(j, (count.get(j) ?? 0) + 1);
      }
      const bridge = order.reduce((best, i) =>
        (count.get(i) ?? 0) > (count.get(best) ?? 0) ? i : best
      );
      const partners = split
        .filter(([i, j]) => i === bridge || j === bridge)
        .map(([i, j]) => (i === bridge ? j : i));
      refused.push({ row: events[bridge], matches: partners.map((j) => events[j]) });
      split = split.filter(([i, j]) => i !== bridge && j !== bridge);
    }
  }

  // Input order within each cluster, clusters by first appearance.
  for (const c of clusters) c.sort((a, b) => a - b);
  clusters.sort((a, b) => a[0] - b[0]);
  return {
    clusters: clusters.map((c) => c.map((i) => events[i])),
    refused,
  };
}

/** Oldest first: `created_at`, then `id`. Rows without either compare equal
 *  and fall back to input order. */
function compareRowAge(a: DedupableEvent, b: DedupableEvent): number {
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  if (ca !== cb) {
    if (!ca) return 1;
    if (!cb) return -1;
    return ca < cb ? -1 : 1;
  }
  const ia = a.id ?? "";
  const ib = b.id ?? "";
  if (ia !== ib) {
    if (!ia) return 1;
    if (!ib) return -1;
    return ia < ib ? -1 : 1;
  }
  return 0;
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
  // Description: a bare act row often has none; the umbrella sibling carries the
  // blurb. Fill only when the winner is empty so a named-act bio is never
  // replaced by a longer stale series blurb (2026-09-19 Brice: Earth Tones
  // leftover on the Hilltop row vs Greg Sutton's own copy).
  if (!merged.description) {
    const donor = cluster.find((e) => (e.description ?? "").trim());
    if (donor) merged.description = donor.description;
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
