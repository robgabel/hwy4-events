/**
 * Venue detection: matches event text against the known venue registry
 * to resolve generic or missing venue names.
 *
 * Runs after LLM extraction, before database upsert. Zero API cost,
 * deterministic, and fast.
 */

import { KNOWN_VENUES, GENERIC_VENUE_NAMES, type KnownVenue } from "./venues.js";

export interface VenueMatch {
  venue_name: string;
  town: string;
  address: string | null;
  matched_alias: string;
  venue_key: string;
}

/**
 * Normalize text for matching: lowercase, collapse whitespace,
 * normalize apostrophes and punctuation.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Patterns that indicate the venue_name was poisoned by scraper-side
 * artist/host text rather than an actual venue. Treat as generic so the
 * matcher can still resolve a real venue from the event title.
 *
 * GoCalaveras's evcal_subtitle field used to leak into venue_name with values
 * like "Featuring James Michael Day" or "Hosted by KJ Johnny Rocksmith".
 * Those are not venues; we'd rather let the title-scan override.
 */
const POISONED_VENUE_PREFIXES = /^(featuring|hosted by|with|feat\.?|w\/)\b/;

/**
 * Check if a venue_name is generic (i.e. a scraper default we should override).
 *
 * "Generic" means the matcher is allowed to overwrite this venue when it
 * finds a known venue alias in the title/description. This covers:
 *   - explicit generic names ("Downtown Murphys", "Unknown Venue")
 *   - bare town names that the scraper used as a venue fallback
 *   - scraper-polluted strings like "Featuring …" / "Hosted by …"
 */
export function isGenericVenue(venueName: string): boolean {
  const n = normalize(venueName);
  if (GENERIC_VENUE_NAMES.has(n)) return true;
  if (POISONED_VENUE_PREFIXES.test(n)) return true;
  return false;
}

/**
 * Build a pre-sorted alias index for efficient matching.
 * Aliases are sorted longest-first so the most specific match wins.
 */
const ALIAS_INDEX: { alias: string; key: string; venue: KnownVenue }[] = [];

for (const [key, venue] of Object.entries(KNOWN_VENUES)) {
  for (const alias of venue.aliases) {
    ALIAS_INDEX.push({ alias, key, venue });
  }
}

// Sort by alias length descending — longest (most specific) match wins
ALIAS_INDEX.sort((a, b) => b.alias.length - a.alias.length);

/**
 * Attempt to detect a known venue from event text fields.
 *
 * @param title - Event title/name
 * @param description - Event description (nullable)
 * @param currentVenue - Current venue_name from scraper
 * @returns VenueMatch if a known venue was detected, null otherwise
 */
export function matchVenue(
  title: string,
  description: string | null,
  currentVenue: string
): VenueMatch | null {
  // If the current venue is already specific (not generic), don't override it
  // unless it doesn't match any known venue and the title clearly contains one
  const venueIsGeneric = isGenericVenue(currentVenue);

  // Combine all text fields for scanning
  const searchText = normalize(
    [title, description ?? "", currentVenue].join(" ")
  );

  // Find the first (longest) alias that appears in the combined text
  for (const { alias, key, venue } of ALIAS_INDEX) {
    // Word boundary check: ensure the alias isn't part of a larger word.
    // We check that the character before and after the match (if any)
    // is not a word character.
    const idx = searchText.indexOf(alias);
    if (idx === -1) continue;

    const before = idx > 0 ? searchText[idx - 1] : " ";
    const after =
      idx + alias.length < searchText.length
        ? searchText[idx + alias.length]
        : " ";

    // Allow word boundaries: space, punctuation, start/end of string
    const validBoundary = (ch: string) => /[\s,.\-—–;:!?'"()&/|]/.test(ch);
    if (!validBoundary(before) && /\w/.test(before)) continue;
    if (!validBoundary(after) && /\w/.test(after)) continue;

    // If current venue is already specific and matches this same venue, no change needed
    if (!venueIsGeneric && normalize(currentVenue) === normalize(venue.canonical)) {
      return null;
    }

    // Only override if the current venue is generic
    if (!venueIsGeneric) continue;

    return {
      venue_name: venue.canonical,
      town: venue.town,
      address: venue.address ?? null,
      matched_alias: alias,
      venue_key: key,
    };
  }

  return null;
}

/**
 * Apply venue detection to an event, mutating it in place.
 * Returns true if the venue was updated.
 */
export function applyVenueDetection(event: {
  name: string;
  description: string | null;
  venue_name: string;
  town: string;
  address: string | null;
}): boolean {
  const match = matchVenue(event.name, event.description, event.venue_name);
  if (!match) return false;

  event.venue_name = match.venue_name;
  event.town = match.town;
  // Only override address if we have one and the event doesn't already
  if (match.address && !event.address) {
    event.address = match.address;
  }
  return true;
}
