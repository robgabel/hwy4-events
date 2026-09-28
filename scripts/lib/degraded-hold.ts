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
 * enrichment failed for it this run AND, after the upsert pre-pass has had its
 * chance to resolve a venue from the registry, it still has no venue, no
 * description and no street number to anchor on. Nothing else changes:
 *   - exact-key updates still flow (a known row is refreshed as usual, and the
 *     keepStr / placeholder guards already stop a degraded payload from wiping
 *     stored fields);
 *   - a strong match still merges (if the matcher can see through the
 *     degradation, it should);
 *   - a detail page that LOADED and was simply bare (`empty`) is not a failure,
 *     and neither is a 404/410: waiting buys nothing there, so the row inserts
 *     as it always did (see `isEnrichFailure`).
 * Tomorrow's scrape, with enrichment working, inserts the row properly, or its
 * restored venue + description let it merge into the resident it duplicates.
 *
 * The hold defers an event; it does not drop one. An event dated inside
 * `DEGRADED_HOLD_MIN_DAYS_OUT` inserts even degraded, because no later scrape
 * can help a listing that is already happening. So during a multi-day 429 wall
 * a genuinely new listing shows up on the first run that enriches it, or on
 * its own day's run at the latest, degraded, which is what it would have looked
 * like anyway. The residual risk is an event-day run that fails outright (the
 * Action does fail some days), which a daily scrape cannot cover by
 * construction. The circuit breaker trips on many days, so deferrals of a few
 * days are routine rather than rare.
 *
 * Pure (no fetch, no DB, no clock) so scripts/test/degraded-hold.test.ts can pin
 * it without touching the network.
 */

import type { ExtractedEvent } from "./extract.js";
import { isGenericVenue } from "./venue-matcher.js";
import { streetNumber } from "../../lib/event-identity.js";

/** Hold only events dated at least this many days after the run date. 1 means
 *  an event happening today is never held. */
export const DEGRADED_HOLD_MIN_DAYS_OUT = 1;

type HoldInput = Pick<
  ExtractedEvent,
  "date" | "venue_name" | "description" | "address" | "enrichment_failed"
>;

/** Enrichment failed AND the row still has no venue, no description and no
 *  street number: the shape the matcher cannot place. Any one of those (the
 *  AJAX feed sometimes carries a location or prose, and EventON's venue field
 *  can hold a street address the pre-pass moves into `address`) gives the
 *  matcher a real signal (a venue match, text similarity, or the same-street-
 *  number anchor), so any one is enough to let the row through. */
export function isDegradedListing(e: HoldInput): boolean {
  if (!e.enrichment_failed) return false;
  const venue = (e.venue_name ?? "").trim();
  if (venue && !isGenericVenue(venue)) return false;
  if (streetNumber(e.address)) return false;
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
 *  scrape_runs.source_results as `held`, so it is durable per source per run
 *  (recorded only: /admin/scrapers does not surface it yet, same as
 *  `unpinned`). */
export function degradedHoldLine(e: Pick<ExtractedEvent, "name" | "date" | "venue_name">): string {
  return `    DEGRADED_INSERT_HELD "${e.name}" ${e.date} (enrichment failed; venue "${e.venue_name}", no description)`;
}
