/**
 * Venue detection: matches event text against the known venue registry
 * to resolve generic or missing venue names.
 *
 * Runs after LLM extraction, before database upsert. Zero API cost,
 * deterministic, and fast.
 *
 * Signal layers, highest confidence first:
 *   1. Address match — registry address (normalized) is a prefix of event.address
 *   2. Text match — registry alias appears in title / description / venue_name / URL slug
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
    .replace(/[‐-―−]/g, "-")
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

// ---------- Address index ----------

/**
 * Normalize an address for matching:
 *  - Lowercase, collapse whitespace, strip punctuation
 *  - Spell number-words to digits ("six" → "6") so "Six Mile Rd" matches "6 Mile Rd"
 *  - Normalize street suffix abbreviations (st/street, rd/road, etc.)
 *  - Drop directional + state/zip noise at the end
 */
const WORD_NUMBERS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
};

const STREET_SUFFIX_CANONICAL: Record<string, string> = {
  st: "st", street: "st",
  rd: "rd", road: "rd",
  dr: "dr", drive: "dr",
  ave: "ave", avenue: "ave",
  blvd: "blvd", boulevard: "blvd",
  ln: "ln", lane: "ln",
  ct: "ct", court: "ct",
  pl: "pl", place: "pl",
  hwy: "hwy", highway: "hwy",
  pkwy: "pkwy", parkway: "pkwy",
  ter: "ter", terrace: "ter",
  way: "way",
  cir: "cir", circle: "cir",
};

function normalizeAddress(addr: string): string {
  let s = addr.toLowerCase();
  s = s.replace(/[.,]/g, " ");
  s = s.replace(/[‐-―−]/g, "-");
  s = s.replace(/\s+/g, " ").trim();

  // Drop trailing ", CA 95247" / "CA 95247" / "95247" / ", USA"
  s = s.replace(/\s+(usa|united states)$/, "");
  s = s.replace(/\s+\d{5}(-\d{4})?$/, "");
  s = s.replace(/\s+ca$/, "");
  s = s.replace(/,/g, "");

  const tokens = s.split(/\s+/).map((t) => {
    if (WORD_NUMBERS[t]) return WORD_NUMBERS[t];
    if (STREET_SUFFIX_CANONICAL[t]) return STREET_SUFFIX_CANONICAL[t];
    return t;
  });

  return tokens.join(" ").trim();
}

const _addressCandidates: { norm: string; key: string; venue: KnownVenue }[] = [];
for (const [key, venue] of Object.entries(KNOWN_VENUES)) {
  if (!venue.address) continue;
  _addressCandidates.push({ norm: normalizeAddress(venue.address), key, venue });
}

// Some venues genuinely share a street address (e.g. Ebbetts Pass Moose Lodge
// and White Pines Lake Park are both 1965 Blagen Rd — co-located at the park
// entrance). An address that maps to more than one distinct venue can't
// disambiguate, so we exclude it from the address index entirely and let the
// alias/title text scan decide. Prevents an event correctly named for one
// venue from being flipped to the other purely on a shared address.
const _normToKeys = new Map<string, Set<string>>();
for (const c of _addressCandidates) {
  const set = _normToKeys.get(c.norm) ?? new Set<string>();
  set.add(c.key);
  _normToKeys.set(c.norm, set);
}
const AMBIGUOUS_ADDRESSES = new Set(
  [..._normToKeys].filter(([, keys]) => keys.size > 1).map(([norm]) => norm)
);

const ADDRESS_INDEX = _addressCandidates
  .filter((c) => !AMBIGUOUS_ADDRESSES.has(c.norm))
  // Longer normalized address first so the most specific wins
  .sort((a, b) => b.norm.length - a.norm.length);

/**
 * Match by address: the registry's normalized address must appear as a
 * leading substring of the event's normalized address (or vice versa).
 * Falls back to a tight street-number + first-two-tokens match so that
 * minor city/zip differences don't block the link.
 */
function matchByAddress(eventAddress: string): VenueMatch | null {
  const e = normalizeAddress(eventAddress);
  if (!e) return null;

  for (const { norm, key, venue } of ADDRESS_INDEX) {
    if (!norm) continue;
    if (e === norm) return toMatch(venue, key, `address:${norm}`);
    if (e.startsWith(norm + " ") || norm.startsWith(e + " ")) {
      return toMatch(venue, key, `address:${norm}`);
    }
    // Tight prefix: same street number + same next two tokens (e.g. "1894 6 mile")
    const eTokens = e.split(" ");
    const nTokens = norm.split(" ");
    if (
      eTokens.length >= 3 &&
      nTokens.length >= 3 &&
      eTokens[0] === nTokens[0] &&
      /^\d+$/.test(eTokens[0]) &&
      eTokens[1] === nTokens[1] &&
      eTokens[2] === nTokens[2]
    ) {
      return toMatch(venue, key, `address-prefix:${eTokens.slice(0, 3).join(" ")}`);
    }
  }
  return null;
}

/**
 * True if `alias` appears in `haystack` (already normalized) as a whole token —
 * i.e. not embedded inside a larger word. Used for both venue-name self-match
 * and the title/description/URL scan.
 */
function containsAlias(haystack: string, alias: string): boolean {
  const validBoundary = (ch: string) => /[\s,.\-—–;:!?'"()&/|]/.test(ch);
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(alias, from);
    if (idx === -1) return false;
    const before = idx > 0 ? haystack[idx - 1] : " ";
    const after =
      idx + alias.length < haystack.length ? haystack[idx + alias.length] : " ";
    const okBefore = validBoundary(before) || !/\w/.test(before);
    const okAfter = validBoundary(after) || !/\w/.test(after);
    if (okBefore && okAfter) return true;
    from = idx + 1;
  }
}

function toMatch(venue: KnownVenue, key: string, alias: string): VenueMatch {
  return {
    venue_name: venue.canonical,
    town: venue.town,
    address: venue.address ?? null,
    matched_alias: alias,
    venue_key: key,
  };
}

/**
 * Extract the URL path slug (last non-numeric segment) so venue hints in URLs
 * like "/events/live-music-stevenot-winery-6/" become matchable as
 * "live music stevenot winery".
 */
function urlSlugText(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    // Walk backwards, skipping pure numeric tail segments
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (!/^\d+$/.test(s)) {
        return s.replace(/-\d+$/, "").replace(/-/g, " ");
      }
    }
  } catch {
    /* not a parseable URL — ignore */
  }
  return "";
}

/**
 * Attempt to detect a known venue from event fields.
 *
 * @param title - Event title/name
 * @param description - Event description (nullable)
 * @param currentVenue - Current venue_name from scraper
 * @param address - Event address (nullable, but a strong signal when present)
 * @param eventUrl - Event URL (nullable, slug provides venue hints)
 * @returns VenueMatch if a known venue was detected, null otherwise
 */
export function matchVenue(
  title: string,
  description: string | null,
  currentVenue: string,
  address: string | null = null,
  eventUrl: string | null = null
): VenueMatch | null {
  const venueIsGeneric = isGenericVenue(currentVenue);
  const venueNorm = normalize(currentVenue);

  // Layer 0: the venue_name itself names a known venue. Trust the name over
  // everything else — a shared street address must NOT flip a correctly-named
  // venue (e.g. Hovey Winery and Murphys Pourhouse are both 350 Main St), and
  // title text must not either. Resolves messy-but-named strings like
  // "Bear Valley Music Festival Tent" or "White Pines Lake: White Pines, CA".
  // Skipped for generic placeholder names, which carry no venue signal.
  if (!venueIsGeneric) {
    for (const { alias, key, venue } of ALIAS_INDEX) {
      if (!containsAlias(venueNorm, alias)) continue;
      if (venueNorm === normalize(venue.canonical)) return null; // already canonical
      return toMatch(venue, key, alias);
    }
  }

  // Layer 1: address (highest confidence for a venue that did NOT self-identify
  // above — e.g. a partial marketing label like "Tasting Room").
  if (address) {
    const addrMatch = matchByAddress(address);
    if (addrMatch) {
      if (!venueIsGeneric && venueNorm === normalize(addrMatch.venue_name)) {
        return null;
      }
      return addrMatch;
    }
  }

  // Layer 2: text scan across title + description + URL slug. Only overrides a
  // generic placeholder venue — a title mention must never clobber a specific
  // (but un-self-identified) venue name.
  if (venueIsGeneric) {
    const searchText = normalize(
      [title, description ?? "", currentVenue, urlSlugText(eventUrl)].join(" ")
    );
    for (const { alias, key, venue } of ALIAS_INDEX) {
      if (!containsAlias(searchText, alias)) continue;
      return toMatch(venue, key, alias);
    }
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
  event_url?: string | null;
}): boolean {
  const match = matchVenue(
    event.name,
    event.description,
    event.venue_name,
    event.address,
    event.event_url ?? null
  );
  if (!match) return false;

  event.venue_name = match.venue_name;
  event.town = match.town;
  if (match.address && !event.address) {
    event.address = match.address;
  }
  return true;
}
