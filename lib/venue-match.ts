// Resolve a free-text venue name against the venue registry, app-side.
//
// Every scraper writes through `upsertEvents`, which runs `normalizeEventLocation`
// → `resolveVenueKey` (scripts/lib/venue-matcher.ts) and stamps `venue_key` +
// the registry address on the row. The community-submission publish path did
// not: it raw-inserted the reviewer's form fields, so a community row entered
// the catalog with `venue_key IS NULL` and no address. That is what let the
// 2026-07-28 Doc Nancy duplicate through — the submitted "Big tree State Park
// overlook" never resolved to `big-trees-state-park`, so the strongest available
// identity signal (a shared registry key) simply wasn't on the row.
//
// The scripts-side matcher can't be reused directly: `tsconfig.json` excludes
// `scripts/`, and the alias table lives there. What IS reachable from the app is
// `hwy4_venues`, the seeded projection of that registry. Matching against its
// canonical names covers the realistic case (a submitter writes a recognizable
// variant of the real venue name) using the SAME comparison `isSameEvent` uses,
// so the resolution and the later dedup can't disagree.

import { venuesLikelyEqual, normalizeVenue } from "./event-identity";

/** The `hwy4_venues` columns this lookup needs. */
export interface VenueRegistryRow {
  venue_key: string;
  canonical: string;
  town: string;
  address: string | null;
}

/** Resolve a free-text venue name to its registry row, or null.
 *
 *  Exact normalized equality wins outright. Otherwise the fuzzy
 *  (`venuesLikelyEqual`: containment or high token overlap) must land on exactly
 *  ONE registry row — an ambiguous name resolves to null rather than guessing,
 *  because a wrong `venue_key` would assert a shared physical room and could
 *  merge two genuinely different events. */
export function matchVenueRow(
  venueName: string | null | undefined,
  rows: VenueRegistryRow[]
): VenueRegistryRow | null {
  const target = normalizeVenue(venueName);
  if (!target) return null;

  const exact = rows.find((r) => normalizeVenue(r.canonical) === target);
  if (exact) return exact;

  const fuzzy = rows.filter((r) => venuesLikelyEqual(venueName, r.canonical));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}
