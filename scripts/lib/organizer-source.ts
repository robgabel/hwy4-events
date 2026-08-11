import type { ExtractedEvent } from "./extract.js";
import type { UpsertResult } from "./dedup.js";
import type { SweepPlan } from "./stale-sweep.js";

/**
 * The organizer-source spine (HWY-23, 2026-08-11).
 *
 * Four scrapers arrived at the same sequence independently — brice-station
 * (Shopify products.json), arnold-rim-trail (Tribe REST), sequoia-woods (a Duda
 * month grid) and murphys-irish-pub (Wix per-event pages): read the organizer's
 * own structured feed, map each item to a row pinned by a stable
 * `source_event_id` and its permalink, write through `upsertEvents`, then
 * retract what the source stopped asserting. Only the sequence is shared; the
 * four transports have no code in common and are not force-fit here.
 *
 * What this module owns is the part that must not vary per source:
 *  - one run date, used by both the future-only floor and any sweep window;
 *  - the future-only floor itself, as a floor under each scraper's own filter;
 *  - the visibility-ordered write (public before members-only);
 *  - the two rules the retraction hangs on — a sweep runs only AFTER the write,
 *    and only when the write actually happened (see sweepIsAllowed).
 *
 * Deliberately NOT here: the fetch, the per-item mapping and its logging, venue
 * detection (three of the four call it, each reporting differently), and every
 * sweep input that is genuinely per-source — the window derivation, the
 * presence set, and the ownership predicate. Those decide what gets deleted;
 * they belong in the file that can explain them.
 *
 * Pure (nothing but type imports) so scripts/test/organizer-source.test.ts can
 * lock the rules without Supabase or Anthropic env. The writing half lives in
 * organizer-source-exec.ts, the same split as stale-sweep / stale-sweep-exec.
 */

/** Who is writing, declared once at the top of a run. */
export interface OrganizerSource {
  /** Printed as the run's "=== … ===" banner. */
  title: string;
  /** `source_name` on every row this run writes. */
  sourceName: string;
  /** `org_slug` on every row this run writes, and the ONLY org its sweep may
   *  retract — the write and the retraction read the same field, so they can
   *  never drift apart. */
  orgSlug: string;
  /** `source_url` on every row: the source's own listing page. */
  pageUrl: string;
}

export interface OrganizerRun extends OrganizerSource {
  /**
   * The run's date (YYYY-MM-DD, UTC — as every scraper here computed it before
   * this module existed). Read ONCE per run and reused, because the future
   * floor and a sweep window must agree: two clock reads either side of UTC
   * midnight would let a row be written into a date the window then excludes.
   */
  today: string;
}

export function beginOrganizerRun(source: OrganizerSource): OrganizerRun {
  console.log(`=== ${source.title} ===`);
  return { ...source, today: new Date().toISOString().slice(0, 10) };
}

/** One `upsertEvents` call: rows plus the visibility they are written under. */
export interface UpsertGroup {
  events: ExtractedEvent[];
  visibility: "public" | "private";
}

/** What a run produced, handed to the writer. */
export interface OrganizerBatch {
  /** Rows to write as public, in the order the source enumerated them. */
  events: ExtractedEvent[];
  /**
   * Rows to write as members-only (`visibility='private'`), written after the
   * public group. Only sequoia-woods splits a batch today: its club calendar
   * mixes members' competitions with public dining and music nights, and
   * `upsertEvents` takes one visibility per call.
   */
  privateEvents?: ExtractedEvent[];
  /**
   * This run's retraction plan, or null to skip it (log your own reason).
   * Absent = this source never sweeps.
   *
   * A thunk, not a value, because the plan must be built from the batch the
   * source actually asserted and consulted only once the write is done — the
   * writer calls it after upserting. It is consulted even when nothing was
   * written, so a source can still report WHY it is not sweeping; the plan it
   * returns is executed only under sweepIsAllowed.
   */
  planSweep?: () => SweepPlan | null;
}

export interface OrganizerWrite {
  upsert: UpsertResult;
  swept: number;
  /** Rows handed to `upsertEvents`. 0 means nothing was written, and therefore
   *  nothing was swept. */
  written: number;
}

export function emptyUpsertResult(): UpsertResult {
  return { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0, unpinned: 0 };
}

/** Fold one call's counters into a run total. Every field, so a split write's
 *  totals are never quietly partial. */
export function addUpsertResult(total: UpsertResult, r: UpsertResult): void {
  total.inserted += r.inserted;
  total.updated += r.updated;
  total.unchanged += r.unchanged;
  total.skippedFuzzy += r.skippedFuzzy;
  total.unpinned += r.unpinned;
}

/**
 * The ordered, non-empty groups a batch will write, plus how many rows the
 * future floor removed.
 *
 * Future-only is a FLOOR, not the source's filter. Each scraper still filters
 * for itself, because each logs the rows it is about to write and no two log
 * them the same way — so this drops nothing today. It is here so the next
 * organizer source cannot forget, and so forgetting is loud (the writer warns
 * on a non-zero drop) rather than a silent past-dated row.
 */
export function planUpserts(
  batch: Pick<OrganizerBatch, "events" | "privateEvents">,
  today: string
): { groups: UpsertGroup[]; droppedPast: number } {
  const groups: UpsertGroup[] = [];
  let droppedPast = 0;
  for (const [events, visibility] of [
    [batch.events, "public"],
    [batch.privateEvents ?? [], "private"],
  ] as const) {
    const future = events.filter((e) => e.date >= today);
    droppedPast += events.length - future.length;
    if (future.length > 0) groups.push({ events: future, visibility });
  }
  return { groups, droppedPast };
}

/**
 * May this run's sweep plan execute? Only if the run wrote rows.
 *
 * An empty batch cannot be told apart from a broken fetch, and a sweep with an
 * empty presence set selects every resident row inside its window — the abort
 * cap would stop the mass case and wave the small one through. Both sweeping
 * scrapers already refused an empty batch by their own route (sequoia-woods
 * returned before reaching its sweep; the pub's floor of three parsed events
 * can never be met by zero). Making it the spine's rule means the next source
 * inherits it instead of rediscovering it.
 */
export function sweepIsAllowed(groups: UpsertGroup[]): boolean {
  return groups.length > 0;
}
