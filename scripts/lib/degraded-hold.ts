/**
 * Degraded-insert hold (dedup v2 Phase 0.4, PRD-dedup-merge-v2.md).
 *
 * The treadmill this closes. When source B's listing merges into source A's
 * row, B's keys are gone (overwritten, or orphaned under A's source_name), so
 * B's next scrape cannot exact-match and has to win the fuzzy match again every
 * day. GoCalaveras loses that match exactly on the days its detail pages are
 * rate-limited: the month AJAX feed alone carries no venue ("Unknown Venue")
 * and no description, which leaves the matcher with a title and a clock and
 * nothing else. The row inserts as a fresh duplicate and lives until a later
 * scrape re-enriches it AND the nightly reconcile runs. Merged-away rows lived
 * a median 122h; Bear Valley Trail Stewardship 10-10 was re-merged five times
 * in 30 days, the last copy created 2026-09-27 as "Unknown Venue", no
 * description, 13 days before the event.
 *
 * The rule: a NEW row is held (not inserted) when the source's detail-page
 * enrichment failed for it this run AND it is still venue-less and
 * description-less after the upsert pre-pass has had its chance to resolve a
 * venue from the registry. Nothing else changes:
 *   - exact-key updates still flow (a known row is refreshed as usual, and the
 *     keepStr / placeholder guards already stop a degraded payload from wiping
 *     stored fields);
 *   - a strong match still merges (if the matcher can see through the
 *     degradation, it should);
 *   - a detail page that LOADED and was simply bare (`empty`) is not a failure.
 *     Waiting a day buys nothing there, and the bare row is the truth.
 * Tomorrow's scrape, with enrichment working, inserts the row properly, or its
 * restored venue + description let it merge into the resident it duplicates.
 *
 * The hold can only DEFER an event, never lose one. An event dated inside
 * `DEGRADED_HOLD_MIN_DAYS_OUT` inserts even degraded, because no later scrape
 * can help a listing that is already happening. So during a multi-day 429 wall
 * a genuinely new listing shows up on its own day at the latest, degraded, which
 * is what it would have looked like anyway.
 *
 * Pure (no fetch, no DB, no clock) so scripts/test/degraded-hold.test.ts can pin
 * it without touching the network.
 */

import type { ExtractedEvent } from "./extract.js";
import { isGenericVenue } from "./venue-matcher.js";

/** Hold only events dated at least this many days after the run date. 1 means
 *  an event happening today is never held. */
export const DEGRADED_HOLD_MIN_DAYS_OUT = 1;

type HoldInput = Pick<ExtractedEvent, "date" | "venue_name" | "description" | "enrichment_failed">;

/** Enrichment failed AND the row still has neither a venue nor a description:
 *  the shape the matcher cannot place. A named venue or a description (both of
 *  which the AJAX feed sometimes carries) gives the matcher a real signal, so
 *  either one is enough to let the row through. */
export function isDegradedListing(e: HoldInput): boolean {
  if (!e.enrichment_failed) return false;
  const venue = (e.venue_name ?? "").trim();
  if (venue && !isGenericVenue(venue)) return false;
  return !(e.description ?? "").trim();
}

/** Whole calendar days from `today` to `date` (both YYYY-MM-DD). Anchored at
 *  noon UTC so a DST edge can never shift the count. NaN when either is not a
 *  date. */
function daysUntil(today: string, date: string): number {
  const a = Date.parse(`${today}T12:00:00Z`);
  const b = Date.parse(`${date}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Should `upsertEvents` hold this row instead of inserting it? Only ever asked
 *  at the INSERT decision, after exact-key and strong-match lookups missed. An
 *  unparseable date never holds (NaN fails the comparison): when in doubt, the
 *  existing behavior wins. */
export function shouldHoldDegradedInsert(e: HoldInput, runDate: string): boolean {
  if (!isDegradedListing(e)) return false;
  return daysUntil(runDate, e.date) >= DEGRADED_HOLD_MIN_DAYS_OUT;
}

/** One greppable line per held row. The count also lands in
 *  scrape_runs.source_results as `held`, so it is durable per source per run. */
export function degradedHoldLine(e: Pick<ExtractedEvent, "name" | "date" | "venue_name">): string {
  return `    DEGRADED_INSERT_HELD "${e.name}" ${e.date} (enrichment failed; venue "${e.venue_name}", no description)`;
}
