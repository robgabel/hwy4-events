// Facebook Events Discover — the per-town config shape and its activation gate.
//
// Deliberately dependency-free (no axios, no SDK), so the gate can be unit-tested
// without pulling the Apify transport in behind it.

export interface TownLocationConfig {
  /** Slug used for org_slug column (e.g. "fb-discover-arnold"). */
  orgSlug: string;
  /** Display label used for source_name (e.g. "Arnold"). */
  label: string;
  /** Canonical town value used as fallback when FB address doesn't disambiguate. */
  defaultTown: string;
  /** Facebook place ID for this town. Empty until someone looks it up in a
   *  logged-in browser — see docs/HANDOFF-fb-location-ids.md. */
  locationId: string;
  /** Slug used in the /events/explore/<slug>/<id> URL (e.g. "arnold-ca"). */
  exploreSlug: string;
}

/**
 * A town is live once it has a numeric Facebook place ID.
 *
 * The un-launched towns ship as real config entries with an empty `locationId`
 * so enabling one is a single paste rather than a code edit. That is only safe
 * because an unconfigured entry is SKIPPED: the explore URL built from an empty
 * (or half-pasted) ID resolves to Facebook's GLOBAL events page, which would
 * pour non-corridor events into the corridor filter and burn an Apify run on
 * every scrape. Hence the strict all-digits test rather than a truthiness check.
 */
export function isConfiguredTown(config: { locationId?: string }): boolean {
  return /^\d+$/.test((config.locationId ?? "").trim());
}
