// The "same event" identity rule — the SINGLE source of truth.
//
// The same real-world event can be listed twice: one source re-titles it, or two
// sources describe it independently. Deciding whether two rows are the same show
// is needed in two places — read-time collapse (`lib/dedupe-events.ts`, runs on
// every render) and write-time merge (`scripts/lib/dedup.ts`, runs on ingest).
//
// This module exists so that rule lives in exactly ONE place. Both sides import
// `isSameEvent`. Previously the rule was copied into both files and the copies
// drifted — the read-time bucket keyed on exact end_time while the write-time
// matcher did not, so a "7:00 PM" listing and a "7:00 PM – 10:00 PM" listing of
// the same concert never got compared. Single-sourcing makes that class of bug
// structurally impossible. The behavior is locked by scripts/test/event-identity.test.ts.
//
// Conservative by design: two rows only match when they describe the same time
// slot AND share a strong identity signal (near-identical title, overlapping
// artists, near-identical description, or a venue match paired with a generic
// placeholder / the act named in the other's text). Two *different specific*
// titles never merge on venue + time alone — a park hosts different shows back
// to back.

import { createHash } from "node:crypto";

/** The minimal shape the matching predicate reads. Both the app's `Hwy4Event`
 *  and the scraper's `ExtractedEvent` are structural supersets of this. `date`
 *  and `town` are optional because a candidate row passed by the write path may
 *  omit them (the caller has already pre-filtered on both); when present they're
 *  used as defensive anchors. */
export interface EventIdentity {
  name: string;
  date?: string;
  town?: string;
  venue_name?: string | null;
  address?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  description?: string | null;
  artists?: string[] | null;
  /** Curated festival "umbrella" card — the one row that says "this festival
   *  runs Jul 17 to Aug 2", sitting alongside the real nightly shows. Set only
   *  by the seed scripts (see CLAUDE.md "Festival umbrella rows"); every
   *  scraper writes false. It is what keeps an umbrella card OUT of a merge:
   *  before this flag existed, umbrellas stayed separate purely because their
   *  NULL start time could never share a dedup bucket, which also made a
   *  genuine timeless duplicate invisible to every layer (HWY-10). */
  series_umbrella?: boolean | null;
  /** The venue registry key (`scripts/lib/venues.ts`), resolved at write time by
   *  `resolveVenueKey` and stored on `hwy4_events.venue_key`. When two rows carry
   *  the SAME key they are provably in the same physical room, which is stronger
   *  than any name fuzzy: the registry, not the scraped string, is the authority
   *  on what a venue is and where it sits. */
  venue_key?: string | null;
  /** The feed that wrote the row (`hwy4_events.source_name`). Two DIFFERENT
   *  feeds disagreeing on the start is often scrape noise (gates-open vs first
   *  act vs last year's hours), so they may match across a clock gap; one feed
   *  listing two starts is that feed enumerating two sessions, so it may not
   *  (dedup v2 Phase 1.2). Absent on either side means no clock tolerance. */
  source_name?: string | null;
  /** A routine venue operation (`hwy4_events.is_routine`, lib/notability.ts):
   *  a weekly dinner, a deli special. A placeholder never pairs with one, since
   *  the pair would merge a concert into the hidden dinner (dedup v2 1.7). */
  is_routine?: boolean | null;
}

const TOWN_ALIASES: Record<string, string> = {
  "white pines": "arnold",
  "hathaway pines": "arnold",
};

export const GENERIC_VENUES = new Set([
  "",
  "tba",
  "tbd",
  "unknown",
  "unknown venue",
  "various",
  "various locations",
  "online",
  "virtual",
]);

export function normalizeTown(town: string | null | undefined): string {
  const lower = (town ?? "").toLowerCase().trim();
  return TOWN_ALIASES[lower] ?? lower;
}

/** Lowercase, collapse whitespace, normalize dash/quote variants, drop a leading
 *  "the". Used for title and description comparison so two scrapes of the same
 *  event don't diverge on typographic punctuation. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^the\s+/, "")
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"');
}

/** Strip leading "@", "the", trailing "featuring …" tails that scrapers append
 *  to venue names, and all punctuation. Leaves a comparable core. */
export function normalizeVenue(venue: string | null | undefined): string {
  if (!venue) return "";
  return venue
    .toLowerCase()
    .trim()
    .replace(/^@\s*/, "")
    .replace(/^the\s+/, "")
    .replace(/\s+featuring\s+.*$/, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "HH:MM" / "HH:MM:SS" / "H:MM" → "HH:MM". */
export function normalizeTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  return `${(h ?? "").padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/** Comparison-only normalization on top of `normalizeName`: fold "&" to "and"
 *  and strip a leading "Nth Annual" / "Annual" ordinal prefix, so "54th Annual
 *  Sierra Nevada Arts & Crafts Festival" and "Sierra Nevada Arts and Crafts
 *  Festival" read as the same title. Deliberately NOT applied in
 *  `generateDedupKey` — changing that hash would orphan every stored dedup_key
 *  and re-duplicate the whole catalog on the next scrape. */
export function normalizeForMatch(name: string): string {
  return normalizeName(name)
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:\d+(?:st|nd|rd|th)\s+)?annual\s+/, "");
}

/** Normalized-string similarity in [0,1]. Normalizes both inputs, returns 1 on
 *  exact match, a containment ratio when one is a substring of the other, else
 *  Levenshtein-based similarity. */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na === nb) return 1;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  if (shorter.length === 0) return 0;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

/** Two rows carry addresses anchored to the same street number — "961 Highway
 *  4" and "961 CA-4, Arnold, CA 95223" are the same lot even though the venue
 *  *names* diverge ("Bristol's Ranch House Cafe" vs "Bristols's Cafe Parking
 *  Lot"). Sources routinely rename the same physical place, and the venue-name
 *  fuzzy can't see through it; the street number can. Requires ≥2 digits so a
 *  bare "4 Main St"-style token can't anchor. Callers already require same
 *  town + date + exact start time, so a same-number-different-street collision
 *  would additionally need another identity signal to cause a false merge. */
function sameStreetNumber(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = streetNumber(a);
  return !!na && na === streetNumber(b);
}

/** The house number `sameStreetNumber` anchors on: 2 to 6 leading digits, or
 *  "" when there is none. Exported so the degraded-insert hold
 *  (scripts/lib/degraded-hold.ts) asks "can the matcher place this row by its
 *  address?" with the matcher's own rule. */
export function streetNumber(addr: string | null | undefined): string {
  const m = (addr ?? "").trim().match(/^(\d{2,6})\b/);
  return m ? m[1] : "";
}

function venueMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (GENERIC_VENUES.has(a) || GENERIC_VENUES.has(b)) return false;
  if (a === b) return true;
  // Containment handles "murphys park" vs "murphys park stage", etc. Guard the
  // shorter side against being trivially short to avoid junk matches.
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 5 && longer.includes(shorter);
}

/** Venue-name tokens for overlap comparison: the normalized venue split into
 *  words, short connectives dropped, and a trailing "s" folded so "Big Trees"
 *  and "Big Tree" read alike. */
function venueTokens(v: string): Set<string> {
  return new Set(
    v
      .split(" ")
      .filter((t) => t.length >= 3)
      .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t))
  );
}

/** Two venue strings name the same place even though neither *contains* the
 *  other (2026-07-28, the Doc Nancy dupe: "Calaveras Big Trees State Park" vs
 *  "Big tree State Park overlook"). A community submitter describes a spot in
 *  their own words, so containment fails from both ends at once — a dropped
 *  prefix AND an added sub-location — and the venue veto then splits two
 *  listings of the same program.
 *
 *  Deliberately a high bar, because venue names in this corridor share naming
 *  conventions: at least 3 shared distinctive tokens AND 80% of the smaller
 *  name. That admits the Big Trees pair (4 shared of 5) while still rejecting
 *  "Bear Valley Lodge" vs "Bear Valley Adventure Company" and "Murphys
 *  Community Park" vs "Arnold Community Park" (2 shared each), which are
 *  genuinely different places. The caller still requires the same date, the
 *  same time slot, and an identity signal on top. */
function venueTokensAgree(a: string, b: string): boolean {
  if (!a || !b || GENERIC_VENUES.has(a) || GENERIC_VENUES.has(b)) return false;
  const ta = venueTokens(a);
  const tb = venueTokens(b);
  if (ta.size < 3 || tb.size < 3) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared < 3) return false;
  return shared / Math.min(ta.size, tb.size) >= 0.8;
}

/** Do two free-text venue strings name the same place? The name-only half of the
 *  venue agreement `isSameEvent` computes (containment or high token overlap),
 *  exported so the registry lookup in `lib/venue-match.ts` resolves a messy
 *  submitted venue under exactly the rule the matcher will later apply to it.
 *  Address and `venue_key` agreement are deliberately NOT folded in here — those
 *  are properties of a row, not of a name. */
export function venuesLikelyEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizeVenue(a);
  const nb = normalizeVenue(b);
  return venueMatch(na, nb) || venueTokensAgree(na, nb);
}

function artistsOverlap(
  a: string[] | null | undefined,
  b: string[] | null | undefined
): boolean {
  if (!a?.length || !b?.length) return false;
  const setA = new Set(a.map((x) => x.toLowerCase().trim()).filter(Boolean));
  return b.some((x) => setA.has(x.toLowerCase().trim()));
}

/** True when a row is a curated festival umbrella card. Umbrella cards are the
 *  ONE listing shape that is duplicative on purpose, so they are excluded from
 *  the timeless-merge path below. */
function isUmbrella(e: EventIdentity): boolean {
  return e.series_umbrella === true;
}

/** Max start-time drift, in minutes, between a venue's series-placeholder
 *  listing (GoCalaveras's usual 7:00 PM Hilltop slot) and the named-act
 *  listing for the same night (the organizer moved this show an hour early).
 *  Gated on exactly one title being generic; two specific titles still need
 *  equal starts (matinee vs evening of the same play; two named acts an hour
 *  apart). Two generic titles at different hours stay split too (afternoon
 *  live music vs the evening set). */
export const GENERIC_SERIES_START_TOLERANCE_MIN = 90;

function clockMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m || 0);
}

/** Two rows describe the same time slot: starts must be known and equal, and
 *  end times must agree *only when both are known*. A source that omits the end
 *  time ("7:00 PM") must still anchor to the same source's fuller listing
 *  ("7:00 PM – 10:00 PM") — keying on an exact end would split them apart.
 *
 *  A row that states NO start time (2026-07-27, HWY-10) anchors as a wildcard
 *  against any slot at the same venue on the same date, provided NEITHER row is
 *  a marked festival umbrella. A listing that omits the clock is still the same
 *  show as its timed twin: the Kane Brown Ironstone double and the Moose Lodge
 *  "Rib Feed & Live Band" pair both sat on the site because a NULL start could
 *  never equal a known start, so they were invisible to the read-time collapse,
 *  the write-time merge, and the nightly reconcile alike. Umbrellas used to
 *  stay separate by relying on that same blindness; now they stay separate
 *  because they are MARKED, which is what makes the rest of the timeless
 *  population safe to merge. The wildcard requires `venuesAgree` — with no
 *  clock to anchor on, the physical room is the only thing standing between
 *  "the same show listed twice" and "two different events the same day", and
 *  the caller still demands an identity signal on top.
 *
 *  `venuesAgree` softens the end-time rule (2026-07-05, the Coffee & Cars
 *  triple): three sources listed the SAME Meadowmont Lodge car show with three
 *  different extracted end times (11:00 / 17:00 / 12:00 — one source's own
 *  description said "8am to 11am" while its structured end said 5pm), and the
 *  end-disagreement veto made every dedup layer blind to it. When two rows
 *  agree on the physical venue (name fuzzy or street-number anchor) and start
 *  at the same instant on the same date, a conflicting end is scrape noise,
 *  not a different show — one room can't host two events that begin together.
 *  Ends still split rows when the venues DON'T provably agree (one side
 *  unknown), keeping the conservative default.
 *
 *  `seriesStartTolerance` (2026-09-19, the Brice Hilltop pair) softens the
 *  START-time rule the same way, but only for a generic series placeholder vs
 *  a named act. GoCalaveras lists every Hilltop night at the series default
 *  (7:00–10:00 PM, often with a leftover act from a prior EventON occurrence)
 *  while Brice's own ticket product states this show's real start ("one hour
 *  earlier than our usual start time"). Exact-start was a hard veto, so every
 *  layer that shares `isSameEvent` was blind. The caller sets the flag only
 *  when exactly one title is generic; without that gate this would merge two
 *  real showtimes. */
function timesAnchor(
  a: EventIdentity,
  b: EventIdentity,
  venuesAgree: boolean,
  seriesStartTolerance = false
): boolean {
  const sa = normalizeTime(a.start_time);
  const sb = normalizeTime(b.start_time);
  if (!sa || !sb) {
    // At least one side states no start. A marked umbrella never merges; every
    // other timeless row anchors on the venue instead of the clock.
    if (isUmbrella(a) || isUmbrella(b)) return false;
    return venuesAgree;
  }
  if (sa !== sb) {
    if (
      !venuesAgree ||
      !seriesStartTolerance ||
      Math.abs(clockMinutes(sa) - clockMinutes(sb)) >
        GENERIC_SERIES_START_TOLERANCE_MIN
    ) {
      return false;
    }
    // Series placeholder vs named act, starts within the tolerance: the clock
    // disagreement is the aggregator's series-default vs the organizer's
    // this-night time. The placeholder's end is equally untrustworthy (the
    // usual 7–10 window), so do not let a conflicting end split them.
    return true;
  }
  const ea = normalizeTime(a.end_time);
  const eb = normalizeTime(b.end_time);
  if (ea && eb && ea !== eb && !venuesAgree) return false;
  return true;
}

/** Normalized "act identity" strings for a row: its title plus any listed
 *  artists — the specific-act names a sibling listing would mention. */
function actStrings(e: EventIdentity): string[] {
  const out: string[] = [];
  const n = normalizeName(e.name ?? "");
  if (n) out.push(n);
  for (const a of e.artists ?? []) {
    const na = normalizeName(a ?? "");
    if (na) out.push(na);
  }
  return out;
}

/** Searchable text of a row: title + description, normalized. */
function searchBlob(e: EventIdentity): string {
  return normalizeName(`${e.name ?? ""} ${e.description ?? ""}`);
}

/** A sibling listing names this row's act. The classic cross-source split: an
 *  aggregator lists the venue's umbrella series ("Brice Station Vineyards –
 *  Hilltop Concert Series", artists empty) while the venue feed lists the act
 *  itself ("Jimbo Scott & Yesterdays Biscuits") — each describing the other.
 *  Neither title is similar, neither is a "Live Music" placeholder, and the
 *  aggregator row often has no artists to overlap on. But the act's name shows
 *  up verbatim in the other listing's title+description. If one row's specific
 *  act name (title or artist) is a substring of the other's blob, they're the
 *  same show. Caller guards with venue match + the time anchor; a length floor
 *  keeps short/common tokens ("jam", "free") from triggering it. */
function actNamedInOther(a: EventIdentity, b: EventIdentity): boolean {
  const aBlob = searchBlob(a);
  const bBlob = searchBlob(b);
  const hit = (acts: string[], blob: string) =>
    acts.some((s) => s.length >= 6 && blob.includes(s));
  return hit(actStrings(a), bBlob) || hit(actStrings(b), aBlob);
}

/** Word-level token set of a string, normalized via `normalizeForMatch` (so
 *  "&"/"and", case, whitespace, and typographic punctuation are folded). Empty
 *  tokens are dropped; punctuation stays attached to its word, which is fine for
 *  set overlap because it lands identically on both sides. */
function tokenSet(s: string | null | undefined): Set<string> {
  return new Set(
    normalizeForMatch(s ?? "")
      .split(" ")
      .filter((t) => t.length > 0)
  );
}

/** Overlap coefficient |A∩B| / min(|A|,|B|). Robust to one side appending extra
 *  text: a tail inflates the union but not the min. That is exactly how two
 *  sources of the SAME event diverge — one copies the venue's blurb verbatim,
 *  the other edits a clause or appends a recurrence line ("Every 1st and 3rd
 *  Thursday. Starts at 5:00…"), so a whole-string ratio drops below the 0.92
 *  bar while the shared core stays obvious. */
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  const small = a.size <= b.size ? a : b;
  const big = a.size <= b.size ? b : a;
  if (small.size === 0) return 0;
  let hit = 0;
  for (const t of small) if (big.has(t)) hit++;
  return hit / small.size;
}

/** Jaccard |A∩B| / |A∪B| of two token sets. */
function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / (a.size + b.size - hit);
}

/** Two rows share a substantive description core (2026-07-16, the Murphys Wine
 *  & Beer Garden trivia dupe). Two sources listed the same weekly trivia night
 *  under different titles ("Thirsty Thursday Trivia" / "Trivia Thursday @ …")
 *  with the SAME opening blurb, but each source edited a middle clause and one
 *  appended a recurrence tail, so the whole-string description similarity landed
 *  ~0.6 — under the strict 0.92 bar — and every dedup layer stayed blind for
 *  weeks. The overlap coefficient sees through the edit: both descriptions are
 *  substantive (≥8 tokens each) and one's token set is ≥70% contained in the
 *  other. Caller gates this on venue agreement + same date + same exact start,
 *  so genuinely-different same-venue programs (Big Trees' Junior Rangers vs
 *  South Grove Guided Hike, both 10:00) — which carry distinct program text —
 *  stay split. */
function descriptionsShareCore(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size < 8 || sb.size < 8) return false;
  return tokenOverlap(sa, sb) >= 0.7;
}

/** The title minus a scraper-appended "@ venue" / "~ venue" tail, so the
 *  comparable core is the event name itself. "Trivia Thursday @ Murphys Wine
 *  Bar and Beer Garden" → "trivia thursday"; "Junior Rangers @ Big Trees State
 *  Park" → "junior rangers". Only punctuation-delimited tails are stripped (the
 *  word "at" is left alone, so "Concert at Sunset" is untouched). */
function titleCore(name: string | null | undefined): string {
  return normalizeForMatch((name ?? "").replace(/\s+[@~]\s*.*$/, ""));
}

/** Two titles share most of their tokens once the "@ venue" tail is removed
 *  (2026-07-16). Catches reordered / prefixed re-titles of the same event —
 *  "Thirsty Thursday Trivia" vs "Trivia Thursday" (Jaccard 0.67), "Rotary's
 *  Annual Shrimp Feed & Auction" vs "Rotary's Shrimp Feed & Auction" (0.83) —
 *  that the 0.85 whole-string `textSimilarity` bar misses on a single inserted
 *  word or a reordering. Kept at 0.6 so two *different* acts sharing a venue +
 *  series prefix stay split: "Cameo Plaza Summer Concert: Leilani …" vs "… :
 *  Snarky Cats" scores 0.4, "Junior Rangers" vs "South Grove Guided Hike"
 *  scores 0. Caller gates on venue agreement + same date + same exact start. */
function titlesShareTokens(
  a: string | null | undefined,
  b: string | null | undefined,
  venueNoise: Set<string>
): boolean {
  const ta = titleCore(a);
  const tb = titleCore(b);
  if (!ta || !tb) return false;
  const sa = tokenSet(ta);
  const sb = tokenSet(tb);
  if (tokenJaccard(sa, sb) >= 0.6) return true;

  // Second chance, discounting venue words. Once the venues are known to agree,
  // venue words in a title carry no identity information: they describe a place
  // both rows already share. Dropping them recovers the case where one source
  // separates the venue with punctuation ("… @ Big Trees State Park", which
  // `titleCore` strips) while the other runs it straight into the title
  // ("Optical astronomy big tree State Park", which it cannot) — there the venue
  // words inflate one side's token count without helping the intersection, and
  // the pair reads as 0.29 similar when the real titles are "Optical Astronomy
  // Nights" and "Optical astronomy" (2026-07-28, the second duplicate from the
  // Doc Nancy submitter).
  //
  // Strictly ADDITIVE, never a replacement. When the venue words appear in BOTH
  // titles ("Ironstone Concours d'Elegance (30th Anniversary)" vs "Ironstone
  // Concours d'Elegance") they are shared tokens, and removing a shared token can
  // only push Jaccard down (0.6 -> 0.5 for that pair) — so stripping instead of
  // adding would silently UN-merge pairs that match today. Requires both sides to
  // survive the strip, so a title that is nothing but the venue name compares its
  // real tokens above rather than an empty set here.
  const stripA = new Set([...sa].filter((t) => !venueNoise.has(t)));
  const stripB = new Set([...sb].filter((t) => !venueNoise.has(t)));
  if (stripA.size === 0 || stripB.size === 0) return false;
  return tokenJaccard(stripA, stripB) >= 0.6;
}

/** The venue words to discount when comparing two titles: the union of both
 *  rows' venue names, tokenized the same way titles are, plus a singular/plural
 *  fold so a title saying "big tree" is cleared by a venue saying "Big Trees". */
function venueNoiseTokens(...venues: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const v of venues) {
    for (const t of tokenSet(normalizeVenue(v))) {
      out.add(t);
      out.add(t.endsWith("s") ? t.slice(0, -1) : `${t}s`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Distinctive title identity (dedup v2 Phase 1.1, PRD-dedup-merge-v2.md).
//
// Two sources re-title one event in their own words: "The Gathering on Murphys
// Main Street" vs "Murphys Gathering – A Celebration of All Things Magical",
// "Karaoke W/ Kim" vs "Karaoke with Kim @ Murphys Irish Pub", "1st Annual Live
// Like Lilly Dinner and Dance" vs "Live Like Lilly Fundraising Dinner". Every
// other title signal compares whole titles, so the words that differ (the
// venue, the town, "annual", "celebration", a date, "@") drown the one or two
// words that name the event. This reduces a title to its DISTINCTIVE words and
// asks whether all of one listing's words appear in the other's.
// ---------------------------------------------------------------------------

/** Words that never name an event. */
const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "at", "on", "in", "for", "with", "to",
  "by", "from", "as", "our", "your", "all", "most", "w", "is", "it", "its",
  "this", "be", "join", "us", "come", "presents", "present", "featuring",
  "feat", "ft", "vs",
]);

/** Event-TYPE words: they say what kind of thing it is, not which one. Two
 *  listings of one event share its distinctive words ("lilly", "hallows",
 *  "gathering", "hermitfest"), not these. */
const EVENT_TYPE_WORDS = new Set([
  "annual", "celebration", "celebrating", "celebrate", "festival", "fest",
  "faire", "fair", "event", "events", "party", "night", "nights", "day", "days",
  "evening", "morning", "afternoon", "weekend", "live", "music", "concert",
  "concerts", "series", "show", "shows", "dinner", "lunch", "brunch",
  "breakfast", "dance", "fundraiser", "fundraising", "benefit", "class",
  "classes", "workshop", "session", "program", "tour", "tours", "special",
  "grand", "opening", "free", "family", "kids", "community", "new", "summer",
  "fall", "winter", "spring", "holiday", "tasting", "wine", "market",
]);

/** Calendar words: a date is not an identity, and the matcher has already
 *  compared dates. Weekdays included, plural too ("Mimosa Sundays"). */
const CALENDAR_WORDS = new Set([
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct",
  "nov", "dec", "january", "february", "march", "april", "june", "july",
  "august", "september", "october", "november", "december", "monday",
  "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mondays",
  "tuesdays", "wednesdays", "thursdays", "fridays", "saturdays", "sundays",
  "today", "tonight", "am", "pm",
]);

/** A title as comparable word tokens: `normalizeForMatch`, then a Facebook
 *  Discover "Town, CALIFORNIA - " prefix, parentheticals ("(Oct 24-25)"), an "@
 *  venue" tail, and apostrophes are dropped and "w/" is read as "with", before
 *  splitting on anything that is not a letter or digit. Stopwords and one-letter
 *  fragments are removed. */
export function titleWordTokens(name: string | null | undefined): string[] {
  let n = normalizeForMatch(name ?? "");
  n = n.replace(/^[a-z .']{2,40},\s*(?:california|calif\.?|ca)\s*[-:]\s*/, "");
  n = n.replace(/\([^)]*\)/g, " ");
  n = n.replace(/\s+[@~]\s*.*$/, "");
  n = n.replace(/\bw\//g, "with ");
  n = n.replace(/['`]/g, "");
  return n
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !TITLE_STOPWORDS.has(t));
}

/** Ordinals, numbers, clock fragments ("7pm", "3rd", "2026"), calendar words. */
function isNoiseToken(t: string): boolean {
  return /\d/.test(t) || CALENDAR_WORDS.has(t);
}

/** A venue or town name as a word set, with a singular/plural fold so a title
 *  saying "big tree" is cleared by a venue saying "Big Trees". */
function placeWords(v: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of normalizeVenue(v).split(" ")) {
    if (!t) continue;
    out.add(t);
    out.add(t.endsWith("s") ? t.slice(0, -1) : `${t}s`);
  }
  return out;
}

/** The words that name THIS event: the title's tokens minus event-type words,
 *  calendar noise, both rows' towns, and the venue words BOTH rows' venue names
 *  share. Only the shared venue words go: a junk venue string can carry the
 *  event's own name ("All Hallows Fantasy Faire, Gary PooBar Britt…" as the
 *  venue of the All Hallows Faire), and stripping every venue word would delete
 *  the very token that identifies the event. */
export function distinctiveTitleTokens(
  e: EventIdentity,
  other: EventIdentity
): Set<string> {
  const mine = placeWords(e.venue_name);
  const theirs = placeWords(other.venue_name);
  const strip = new Set([...mine].filter((t) => theirs.has(t)));
  for (const t of placeWords(e.town)) strip.add(t);
  for (const t of placeWords(other.town)) strip.add(t);
  return new Set(
    titleWordTokens(e.name).filter(
      (t) => !strip.has(t) && !EVENT_TYPE_WORDS.has(t) && !isNoiseToken(t)
    )
  );
}

/** Every distinctive word of one title appears in the other ("gathering" ⊂
 *  "gathering, things, magical"). Full containment of the smaller set, not a
 *  share of it: at one venue on one night, the single word that differs is
 *  usually the whole difference ("North Grove Guided Walk" vs "South Grove
 *  Guided Walk", "Kids Clay" vs "Adult Clay"). A title with no distinctive
 *  words at all ("Live Music", "Wine Tasting") never matches here. */
export function distinctiveTitleMatch(a: EventIdentity, b: EventIdentity): boolean {
  const da = distinctiveTitleTokens(a, b);
  const db = distinctiveTitleTokens(b, a);
  if (da.size === 0 || db.size === 0) return false;
  const [small, big] = da.size <= db.size ? [da, db] : [db, da];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/** A title that is nothing but its venue's name ("Murphys Creek Theatre" at
 *  Murphys Creek Theatre, how GoCalaveras titled some occurrences) carries no
 *  show identity, so it is a placeholder (dedup v2 1.3). Exact equality after
 *  venue normalization, deliberately: a looser containment test would read a
 *  title like "Park" or "The Barn" at a longer-named venue as venue-only. */
export function isVenueOnlyTitle(e: {
  name?: string | null;
  venue_name?: string | null;
}): boolean {
  const v = normalizeVenue(e.venue_name);
  if (!v || GENERIC_VENUES.has(v)) return false;
  return normalizeVenue(e.name) === v;
}

/** Duration assumed for a row that states no end, for the overlap test. */
export const ASSUMED_EVENT_DURATION_MIN = 120;
/** Largest start disagreement two different feeds may have and still be one
 *  event (the Murphys Gathering: 11:00 on one aggregator, 12:00 on another). */
export const CROSS_SOURCE_MAX_START_DRIFT_MIN = 180;

/** [start, end) in minutes after midnight; an end at or before the start
 *  crosses midnight. Null when the start is unknown. */
function windowOf(e: EventIdentity): [number, number] | null {
  const s = normalizeTime(e.start_time);
  if (!s) return null;
  const sm = clockMinutes(s);
  const en = normalizeTime(e.end_time);
  let em = en ? clockMinutes(en) : sm + ASSUMED_EVENT_DURATION_MIN;
  if (em <= sm) em += 24 * 60;
  return [sm, em];
}

/** Two different feeds, both starts known, starts within the drift cap, and
 *  the windows overlap. The overlap is what keeps a matinee and an evening
 *  performance apart, and the source test is what keeps a venue's own two
 *  sessions apart: one feed listing two starts is two occurrences. */
function crossSourceWindowsOverlap(a: EventIdentity, b: EventIdentity): boolean {
  const sa = (a.source_name ?? "").trim();
  const sb = (b.source_name ?? "").trim();
  if (!sa || !sb || sa === sb) return false;
  const wa = windowOf(a);
  const wb = windowOf(b);
  if (!wa || !wb) return false;
  if (Math.abs(wa[0] - wb[0]) > CROSS_SOURCE_MAX_START_DRIFT_MIN) return false;
  return wa[0] < wb[1] && wb[0] < wa[1];
}

/** The venue string to use for matching. Facebook-style place fields often
 *  carry a locality instead of a venue — "Meadowmont, California" for an event
 *  at Meadowmont Lodge (2026-07-05, the Coffee & Cars triple). Strip a trailing
 *  ", California" / ", CA" so the place core ("meadowmont") can fuzzy-match the
 *  real venue name ("meadowmont lodge") via the existing containment rule. If
 *  what remains is just the event's own town ("Arnold, California"), the field
 *  carried no venue at all — return "" so the row is treated as venue-unknown
 *  (eligible for cross-source merge on title/artists/description, but never
 *  able to anchor a venue-based signal). The comma is required, so a venue
 *  genuinely NAMED "… California" (no comma) is untouched. */
function venueForMatch(e: EventIdentity): string {
  const raw = (e.venue_name ?? "").trim();
  const m = raw.match(/^(.+?),\s*(?:california|calif\.?|ca)\.?$/i);
  if (!m) return normalizeVenue(raw);
  const core = normalizeVenue(m[1]);
  if (!core || normalizeTown(core) === normalizeTown(e.town ?? "")) return "";
  return core;
}

/** A title generic enough that it's an aggregator placeholder for whatever act
 *  is playing — "Live Music @ The Lube Room". A generic + a specific title at
 *  the same venue and exact time are the same show. */
export function isGenericTitle(name: string): boolean {
  const n = normalizeName(name);
  return (
    /^live music\b/.test(n) ||
    /^live (entertainment|tunes)\b/.test(n) ||
    /^music (in|at|on) the\b/.test(n) ||
    // Umbrella / series placeholder for a venue's recurring program (e.g.
    // "Bistro Summer Concerts Series", "Hilltop Concert Series"). End-anchored
    // so a title that names the act after the series ("... Summer Concert:
    // Leilani & The Distractions") stays specific.
    /\b(?:concerts?|music) series$/.test(n) ||
    /\bsummer concerts?$/.test(n) ||
    // Act-slot placeholder: "Patio Party #4 featuring live music (TBD)",
    // "Live Music at the Beer Garden (Act TBA)". When the venue later names
    // the act and re-lists, the placeholder row must merge into the named row
    // (2026-07-16 QA: the Sequoia Woods Patio Party #4 dupe). End-anchored
    // (normalizeName keeps punctuation, so allow a trailing ")").
    /\b(?:tbd|tba)\W*$/.test(n) ||
    // "<Venue> presents" with no show name after it: GoCalaveras titles every
    // Murphys Creek Theatre occurrence "Murphys Creek Theatre presents" and
    // puts the real play name only in the URL slug (HWY-29). End-anchored, so
    // "... presents What the Constitution Means to Me" stays specific and the
    // -12 richness penalty lets the specific-titled row win the display slot.
    /\bpresents?\b\W*$/.test(n)
  );
}

/** Tail words that name no act: when/where qualifiers ("Live Music - Friday
 *  Night", "Live Music: Upstairs"), the connectors an act can sit behind ("...
 *  Friday Night featuring X" still names X, because X is not in this set), and
 *  explicit no-act-yet markers ("Act TBA", "to be announced"). A tail made only
 *  of these is still a placeholder. */
const NON_ACT_TAIL_WORDS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "night", "nights", "evening", "afternoon", "tonight", "weekend", "the", "on",
  "in", "at", "upstairs", "downstairs", "deck", "patio", "lounge", "bar",
  "with", "featuring", "feat", "ft", "w", "by", "and",
  "tbd", "tba", "act", "acts", "to", "be", "announced", "determined",
]);

/** The prefix arms of `isGenericTitle`. Its other arms are end-anchored ("...
 *  Concert Series", "... (TBD)", "... presents"), so only a title that starts
 *  with one of these can carry an act name after it. */
const GENERIC_TITLE_PREFIX =
  /^(?:live (?:music|entertainment|tunes)|music (?:in|at|on) the)\b/;

/** Where an act name can begin after a generic prefix: a dash or colon right
 *  after the prefix ("Live Music-X", "Live Music:X"), a dash with a space on at
 *  least one side ("Live Music - X", "Music in The Square- X"; the in-word
 *  hyphen of "Val-du-Vino" is not one), a colon followed by a space ("@ The
 *  Lube Room: X", not "7:30"), an opening parenthesis, or a connector word
 *  ("with", "featuring", "feat.", "ft.", "w/", "by"). Text between the prefix
 *  and the separator is where the venue or the night goes ("Live Music @ The
 *  Lube Room: X", "Live Music Thursday - X") and is not read as an act. */
const ACT_SEPARATOR =
  /^\s*[-:]|\s-|-\s|:\s|\(|\b(?:with|featuring|feat|ft|by)\b|\bw\//;

/** A prefix-anchored generic title split at its first act separator: `rest` is
 *  everything after the prefix, `tail` the text after the separator ("Live
 *  Music - Neil Buettner" -> "neil buettner", "Live Music with Lost in the
 *  Shuffle" -> "lost in the shuffle"), null when there is no separator ("Live
 *  Music @ The Lube Room", "Live Music Upstairs", "Music in the Park"). Null
 *  overall when the title does not start with a generic prefix.
 *  `normalizeName` has already folded every dash variant to "-". */
function splitGenericTitle(name: string): { rest: string; tail: string | null } | null {
  const n = normalizeName(name);
  const prefix = n.match(GENERIC_TITLE_PREFIX);
  if (!prefix) return null;
  const rest = n.slice(prefix[0].length);
  const sep = ACT_SEPARATOR.exec(rest);
  return { rest, tail: sep ? rest.slice(sep.index + sep[0].length).trim() : null };
}

/** Word tokens of a tail. Apostrophes are dropped (not split on) so "Howard's"
 *  lines up with `normalizeVenue`'s "howards". Deliberately not
 *  `normalizeVenue` itself, which discards everything after "featuring" and
 *  would read "Friday Night featuring X" as all filler. */
function tailWords(tail: string): string[] {
  return tail
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** A generic title that carries no act: the only shape the matcher may pair
 *  with any other title at its venue on the placeholder signal, and the only
 *  shape the survivor penalty demotes.
 *
 *  Deliberately NARROWER than `isGenericTitle`, whose live-music and "music in
 *  the" arms are prefix-anchored and so also admit titles that NAME the act
 *  after the prefix: "Live Music - Neil Buettner", "Live Music with Lost in the
 *  Shuffle", "Music in the Square- Bad Jovi". Treating those as placeholders
 *  (dedup v2, PRD-dedup-merge-v2.md Phase 0.3) let a named act merge into ANY
 *  other row at the same venue, a routine "Wednesday Night Deli Special" or a
 *  different band, and the -12 placeholder penalty then kept the other row, so
 *  reconcile would have deleted the concert. A tail that is only TBD/TBA
 *  markers, the venue's own name ("Live Music - Stevenot Winery"), or filler
 *  words ("Live Music: Friday Night") still reads as a placeholder, so every
 *  merge that relied on a true placeholder keeps working. When a tail is
 *  ambiguous it reads as an act. For MATCHING that can only cost a merge, never
 *  a concert, because every generic placeholder here is also `isGenericTitle`,
 *  so the predicate merged less than before this test existed (Phase 0; the
 *  venue-only shape joined in Phase 1.3, measured separately). For
 *  SURVIVORSHIP it is not free: an act-read title also escapes the -12
 *  penalty, so a rich aggregator row titled "Live Music - Greg Sutton" can now
 *  outrank the organizer's own listing of that show. No real cluster changed
 *  survivor when this shipped; letting authority beat richness is Phase 2. */
export function isPlaceholderForMatch(e: {
  name?: string | null;
  venue_name?: string | null;
}): boolean {
  const name = e.name ?? "";
  // A title that only restates the venue names no show (dedup v2 1.3). The
  // one placeholder shape that is not `isGenericTitle`; the start tolerance in
  // `isSameEvent` reads it too, so the tolerance stays at least as broad as
  // this signal.
  if (isVenueOnlyTitle(e)) return true;
  if (!isGenericTitle(name)) return false;
  const parts = splitGenericTitle(name);
  // An end-anchored generic arm ("... Concert Series", "... (TBD)"), or a
  // generic prefix with no act separator after it: no act.
  if (!parts || parts.tail === null) return true;
  // Words that restate the venue, plus at most filler, name no act ("Live
  // Music - Stevenot Winery", "... Stevenot Winery Patio"). The WHOLE venue
  // must be restated: sharing one word is not enough, because acts get named
  // after places (Sequoia Woods books a band called "Sequoia Blue").
  const venueWords = normalizeVenue(e.venue_name).split(" ").filter(Boolean);
  const namesNoAct = (words: string[]): boolean => {
    const restates = venueWords.length > 0 && venueWords.every((w) => words.includes(w));
    const rest = restates ? words.filter((w) => !venueWords.includes(w)) : words;
    return rest.every((w) => NON_ACT_TAIL_WORDS.has(w));
  };
  // The whole remainder can be the venue's own name even when that name holds
  // a separator ("Live Music @ Sierra Nevada Adventure Company (Arnold)").
  if (namesNoAct(tailWords(parts.rest))) return true;
  return namesNoAct(tailWords(parts.tail));
}

/** Aggregator placeholder shapes that carry NO act information. Deliberately
 *  NARROWER than `isGenericTitle` (adversarial review of #264, finding B1):
 *  the TBD/TBA tail is an organizer retraction that must land, and the
 *  live-music arm of `isGenericTitle` is prefix-anchored so "Live Music -
 *  Jill Warren" classifies as generic even though it names the act. Used by
 *  the write-time name-steal guard and by `mergeArtistLists` so a series
 *  placeholder's leftover artists (EventON recycling last month's act onto
 *  this occurrence) cannot pollute a named-act survivor. */
export function isActlessPlaceholderTitle(name: string): boolean {
  const n = normalizeName(name);
  return (
    /\bpresents?\b\W*$/.test(n) ||
    /^live (?:music|entertainment|tunes)(?:\s*@.*)?$/.test(n) ||
    /\b(?:concerts?|music) series$/.test(n) ||
    /\bsummer concerts?$/.test(n)
  );
}

/** Union two rows' artist lists, dropping the actless-placeholder side.
 *  A Hilltop Concert Series row carrying stale "Earth Tones Trio" artists
 *  must not donate them onto "Greg Sutton and Friends". If every side is a
 *  placeholder (or none name artists), fall back to a plain union so an
 *  Ironstone series row that really does carry Kane Brown in `artists` is
 *  not stripped when merging two series-titled listings. */
export function mergeArtistLists(
  ...rows: { name?: string; artists?: string[] | null }[]
): string[] | null {
  const take = (e: { name?: string; artists?: string[] | null }) =>
    isActlessPlaceholderTitle(e.name ?? "") ? [] : (e.artists ?? []);
  const collected: string[] = [];
  for (const r of rows) collected.push(...take(r));
  if (collected.length === 0) {
    for (const r of rows) collected.push(...(r.artists ?? []));
  }
  const set = new Set(
    collected.map((x) => x?.trim()).filter((x): x is string => !!x)
  );
  return set.size > 0 ? [...set] : null;
}

/** An aggregator's series-placeholder listing defers to a named-act row
 *  already published for that night.
 *
 *  Two layers made the 2026-09-19 Brice pair durable: `timesAnchor` missed
 *  the 18:00 vs 19:00 split (the 90-minute series tolerance above), AND
 *  GoCalaveras's exact `source_event_id` hit kept refreshing the Hilltop
 *  EventON row as its own card even after Brice's Shopify product listed
 *  Greg Sutton. Call this before an exact-key UPDATE of a placeholder: if
 *  a named-act sibling matches `isSameEvent`, skip the write so the
 *  organizer card stays the one listing.
 *
 *  Returns the named-act resident to defer to, or null (write the
 *  placeholder — it is still the coverage when the venue has not listed
 *  this night). The venue's own scraper (`askingOrgSlug === venue_key`)
 *  is never deferred. Two named acts never defer (incoming is not a
 *  placeholder). */
export function namedActTakesPrecedence(
  incoming: EventIdentity,
  residents: EventIdentity[],
  askingOrgSlug?: string | null
): EventIdentity | null {
  if (!isActlessPlaceholderTitle(incoming.name ?? "")) return null;
  if (
    incoming.venue_key &&
    askingOrgSlug &&
    askingOrgSlug === incoming.venue_key
  ) {
    return null;
  }
  for (const r of residents) {
    if (!r.name || isActlessPlaceholderTitle(r.name)) continue;
    if (!isSameEvent(incoming, r)) continue;
    return r;
  }
  return null;
}

/** Two rows occupy the exact same window: start AND end both known on both
 *  sides, and both equal. Gated by the caller on venue agreement, this is an
 *  identity signal in its own right — the last resort for a duplicate whose two
 *  sources share no comparable text at all (2026-08-11, the Angels-Murphys
 *  Rotary shrimp feed: Visit Murphys listed "Rotary's Annual Shrimp Feed &
 *  Auction", GoCalaveras listed "Annual Shrimp & Pasta Feed Fundraiser", each
 *  with independently-written prose. Same registry venue, same 16:00–21:00,
 *  and every existing signal missed by roughly half — titles 0.33 against a
 *  0.85 bar, descriptions 0.27 against 0.92, title tokens 0.375 against 0.60,
 *  both `artists` arrays NULL. Because all four dedup layers reach this one
 *  predicate, the pair was invisible to the read-time collapse, the write-time
 *  merge, the nightly reconcile AND the audit simultaneously.)
 *
 *  The END time is what makes this safe, and it is not a detail. Same venue +
 *  same date + same START is emphatically NOT sufficient: measured over the
 *  whole upcoming catalog at ship time, that shape yielded 6 pairs of which
 *  only 1 was a duplicate. The other 5 are Calaveras Big Trees genuinely
 *  running Junior Rangers, Meadow Walk and the South Grove Guided Hike all at
 *  10:00 in the same park — merging on start alone would have silently deleted
 *  four real programs off the calendar. Requiring both ends known and equal
 *  leaves exactly the 1 true duplicate: the park's programs are different
 *  lengths, so they self-separate. One room cannot host two different events
 *  that begin *and* end on the same minute.
 *
 *  Both ends must be KNOWN — a NULL end on either side falls through. Two rows
 *  that merely both omit an end share no information, and treating NULL as a
 *  matching value is what would re-admit the Big Trees pairs.
 *
 *  Naming DIFFERENT acts disqualifies the window outright. A venue can run a
 *  Salsa Night with Los Caminos and an Open Mic with Jane Doe in the same
 *  19:00–21:00 slot, and two rows that each name an act and disagree about who
 *  is playing are asserting two different shows — that is real evidence, not an
 *  absence of it, and it outranks the window. (By the time control reaches
 *  here, `artistsOverlap` has already returned false, so any two known artist
 *  lists are disjoint.) The signal is therefore aimed exactly where it is
 *  needed: rows carrying no act information at all, which is the shape of the
 *  cross-source aggregator duplicate it exists to catch. */
function sameExactWindow(a: EventIdentity, b: EventIdentity): boolean {
  const sa = normalizeTime(a.start_time);
  const sb = normalizeTime(b.start_time);
  const ea = normalizeTime(a.end_time);
  const eb = normalizeTime(b.end_time);
  if (!sa || !sb || !ea || !eb) return false;
  if (sa !== sb || ea !== eb) return false;
  const namesAct = (e: EventIdentity) => (e.artists ?? []).some((x) => (x ?? "").trim());
  if (namesAct(a) && namesAct(b)) return false;
  return true;
}

/** Both rows name an act and no act is shared: two rows that disagree about
 *  who is playing are asserting two different shows. */
function namesDifferentActs(a: EventIdentity, b: EventIdentity): boolean {
  const namesAct = (e: EventIdentity) => (e.artists ?? []).some((x) => (x ?? "").trim());
  return namesAct(a) && namesAct(b) && !artistsOverlap(a.artists, b.artists);
}

/** Minimum description length for the shared-press-release signal. Short blurbs
 *  ("Live music in the beer garden") repeat across genuinely different events;
 *  only a substantial body of copied text carries identity. */
const PRESS_RELEASE_MIN_CHARS = 200;
const PRESS_RELEASE_SIMILARITY = 0.92;

/** Two sources copied the same organizer press release verbatim (2026-09-04,
 *  the Calaveras wine-trail dupe).
 *
 *  A region-wide event has no single venue to agree on: the "Red, White & Rosé
 *  Tasting Experience" runs across 13 tasting rooms on one ticket, so
 *  GoCalaveras filed it under the alliance's ticket office ("Calaveras
 *  Winegrape Alliance Information Center") while Visit Murphys filed it under a
 *  stretch of road ("Hwy 4 and Main Street Murphys"), and they disagreed on the
 *  start time by an hour (10:00 vs 11:00) because neither is a real door time.
 *  Every venue-gated signal was therefore unreachable and `timesAnchor` failed
 *  on the differing start, so the pair was invisible to all four dedup layers
 *  at once even though the two descriptions were byte-identical after their
 *  opening clause (similarity 0.949 over ~470 chars).
 *
 *  Deliberately gated on the venues NOT agreeing, which reads backwards next to
 *  every other signal here and is the whole point. When two sources cannot even
 *  agree what to call the place, the clock is not evidence and the copied text
 *  is. When they DO agree on the venue, the clock is meaningful and must match:
 *  Murphys Creek Theatre runs "An Act of God" at 14:00 and again at 19:30 on
 *  2026-12-19, two real performances sharing one synopsis, and this path must
 *  never merge them. The existing same-venue signals keep them split.
 *
 *  Naming different acts still disqualifies, for the reason spelled out on
 *  `sameExactWindow`: two rows that each name an act and disagree about who is
 *  playing are asserting two different shows. */
function sharedPressRelease(a: EventIdentity, b: EventIdentity): boolean {
  const da = (a.description ?? "").trim();
  const db = (b.description ?? "").trim();
  if (
    da.length < PRESS_RELEASE_MIN_CHARS ||
    db.length < PRESS_RELEASE_MIN_CHARS
  ) {
    return false;
  }
  const namesAct = (e: EventIdentity) =>
    (e.artists ?? []).some((x) => (x ?? "").trim());
  if (namesAct(a) && namesAct(b) && !artistsOverlap(a.artists, b.artists)) {
    return false;
  }
  return textSimilarity(da, db) >= PRESS_RELEASE_SIMILARITY;
}

/** Do two rows name the same physical place? `bothVenuesKnown`: both carry a
 *  real (non-generic) venue. `venuesAgree`: they provably share one.
 *
 *  Venue veto (2026-07-02 security/correctness review, P3). Two events at
 *  DIFFERENT *known* venues are never the same show — even with an identical
 *  title or a shared artist. "Trivia Night", "Open Mic", "Karaoke", "Bingo"
 *  run at many venues on the same night at the same time; merging them would
 *  hide one immediately and let a later reconcile/delete permanently drop it.
 *  Only fires when BOTH venues are known and non-generic: a row with an
 *  empty/"Unknown Venue" side stays eligible for the legitimate cross-source
 *  merge (one feed names the venue, the other doesn't).
 *
 *  The venue registry key is the strongest signal available: two rows carrying
 *  the same `venue_key` were resolved to the same registry entry at write time,
 *  so no amount of string divergence matters. Below it, the fuzzies: venue-name
 *  containment, a same-street-number address anchor (two sources naming the same
 *  lot differently — "Bristol's Ranch House Cafe" vs "Bristols's Cafe Parking
 *  Lot", both at 961 Highway 4), and token overlap for a name rewritten from
 *  both ends at once. */
function venueAgreement(
  a: EventIdentity,
  b: EventIdentity
): { bothVenuesKnown: boolean; venuesAgree: boolean } {
  const va = venueForMatch(a);
  const vb = venueForMatch(b);
  return {
    bothVenuesKnown: !!va && !!vb && !GENERIC_VENUES.has(va) && !GENERIC_VENUES.has(vb),
    venuesAgree:
      (!!a.venue_key && a.venue_key === b.venue_key) ||
      venueMatch(va, vb) ||
      sameStreetNumber(a.address, b.address) ||
      venueTokensAgree(va, vb),
  };
}

/** What says two rows are different events (see `distinctEventEvidence`). */
export type DistinctEventEvidence = "venues" | "acts" | "sessions" | "titles";

/** Positive evidence that two rows are DIFFERENT events, for callers that group
 *  rows (dedup v2 Phase 1.5). The pairwise rule is not transitive: a row that
 *  resembles two others can pull them into one cluster even though they do not
 *  match each other. Most such pairs are harmless (a vague "Dinner" beside
 *  "Queen of Hearts & Dinner"), but these are not:
 *   - `venues`: two known venues that differ;
 *   - `acts`: two named acts, none shared;
 *   - `sessions`: one feed listing two different starts (a venue's morning and
 *     evening sessions, which an all-day aggregator listing overlaps both of);
 *   - `titles`: two titles that each name something and neither names the
 *     other ("Junior Rangers" and "Meadow Walk" in the same park at 10:00).
 *  `titles` is the one a third row can outweigh: two partial titles of one
 *  dinner ("Dinner - Tacos", "Moose Legion Dinner") are joined by a row that
 *  names both ("Dinner - Moose Legion Tacos"), see `titleCovers`. Meaningful
 *  only for a pair `isSameEvent` rejects. */
export function distinctEventEvidence(
  a: EventIdentity,
  b: EventIdentity
): DistinctEventEvidence | null {
  const { bothVenuesKnown, venuesAgree } = venueAgreement(a, b);
  if (bothVenuesKnown && !venuesAgree) return "venues";
  if (namesDifferentActs(a, b)) return "acts";
  const sa = normalizeTime(a.start_time);
  const sb = normalizeTime(b.start_time);
  const src = (e: EventIdentity) => (e.source_name ?? "").trim();
  if (src(a) && src(a) === src(b) && sa && sb && sa !== sb) return "sessions";
  const da = distinctiveTitleTokens(a, b);
  const db = distinctiveTitleTokens(b, a);
  if (da.size === 0 || db.size === 0) return null;
  const within = (x: Set<string>, y: Set<string>) => [...x].every((t) => y.has(t));
  return !within(da, db) && !within(db, da) ? "titles" : null;
}

/** Row `c`'s title names every distinctive word of row `a`'s. A placeholder
 *  names nothing, so it never covers anything. */
export function titleCovers(c: EventIdentity, a: EventIdentity): boolean {
  const da = distinctiveTitleTokens(a, c);
  if (da.size === 0) return false;
  const dc = distinctiveTitleTokens(c, a);
  for (const t of da) if (!dc.has(t)) return false;
  return true;
}

/** How two rows matched. `cross_source`: two different feeds disagree on the
 *  start and the match rests on the cross-source window rule (dedup v2 1.2),
 *  so it holds only because different feeds wrote the rows; a writer that
 *  overwrote one row with the other's keys and clock would break it (see
 *  `buildCrossSourceFillUpdate` in scripts/lib/dedup.ts). `standard`: every
 *  other rule, all of which hold whoever wrote the rows. */
export type SameEventMatch = "standard" | "cross_source";

/** Are two rows the same real event? The one definition, imported by both the
 *  read-time collapse and the write-time merge.
 *
 *  Requires: same date; the same town when both are known AND the venues do not
 *  provably agree (a shared `venue_key`, a name match, a street-number anchor, or
 *  high venue-token overlap outranks a differing town label — see the veto
 *  below); the same time slot (`timesAnchor`: equal start; conflicting
 *  known ends split the rows UNLESS the venues agree — same venue + same start
 *  means a differing end is scrape noise; a row with NO start anchors on the
 *  venue instead, unless either row is a marked `series_umbrella`), AND at
 *  least one identity signal:
 *   - near-identical titles, or
 *   - overlapping artists, or
 *   - near-identical descriptions, or
 *   - same venue AND one title is a placeholder (generic, or only the venue's
 *     name) AND neither row is a routine operation, or
 *   - same venue AND one row's act name appears in the other's text, or
 *   - same venue AND a shared substantive description core, or
 *   - same venue AND heavily-overlapping title tokens (minus the "@ venue" tail), or
 *   - same venue AND the distinctive words of one title are all in the other, or
 *   - same venue AND an identical start-AND-end window (`sameExactWindow`).
 *  Two *different specific* titles with distinct descriptions never merge on
 *  venue + date + START time alone — a park runs simultaneous programs. They do
 *  merge when the whole window matches end to end. A placeholder vs a named
 *  act at the same venue may disagree on start by up to
 *  `GENERIC_SERIES_START_TOLERANCE_MIN` (the aggregator's series-default clock
 *  vs the organizer's this-night time).
 *
 *  Across a clock gap (dedup v2 1.2): two DIFFERENT feeds at the same venue
 *  whose windows overlap and whose starts are within
 *  `CROSS_SOURCE_MAX_START_DRIFT_MIN` match on strong identity only
 *  (distinctive title, shared artist, the act named in the other, or a near-
 *  identical description), never on a placeholder or the window alone. */
export function isSameEvent(a: EventIdentity, b: EventIdentity): boolean {
  return sameEventMatch(a, b) !== null;
}

/** `isSameEvent`, reporting which rule matched (see `SameEventMatch`), or null. */
export function sameEventMatch(
  a: EventIdentity,
  b: EventIdentity
): SameEventMatch | null {
  if (a.date && b.date && a.date !== b.date) return null;
  // Both rows dated (and so the same night). The two Phase 1 signals, the
  // cross-source clock rule and distinctive-title containment, were designed
  // and measured on one night's listings only. The poster and verification
  // "whole series" actions call this with the dates stripped to match a
  // recurring event across nights, where containment is weaker evidence ("Trivia
  // Night" is contained in "Halloween Trivia Night", the one-off special), so
  // those callers keep the pre-Phase-1 rule.
  const sameNight = !!a.date && !!b.date;

  const { bothVenuesKnown, venuesAgree } = venueAgreement(a, b);

  // Town veto, softened by venue agreement (2026-07-28, the Doc Nancy dupe).
  // `town` is a HUMAN-ENTERED LABEL, not a fact about the event: the corridor is
  // one continuous string of settlements along Highway 4, and Calaveras Big Trees
  // State Park sits between Arnold (its mailing address) and Camp Connell (what a
  // submitter reasonably called it). Treating that label as an infallible identity
  // key made every dedup layer — read-time collapse, write-time merge, the nightly
  // reconcile, and the triage agent's candidate query — blind to the same program
  // listed under two town names. So the label only vetoes when the venues do NOT
  // provably agree; when they do, the physical room outranks the label, and the
  // usual identity signal is still required below.
  if (
    !venuesAgree &&
    a.town &&
    b.town &&
    normalizeTown(a.town) !== normalizeTown(b.town)
  ) {
    return null;
  }

  // A distributed event listed by two sources under two different pseudo-venues:
  // the copied press release is the only signal either source preserved. Sits
  // ahead of the venue veto and the clock because both are exactly what this
  // shape destroys; the same-town requirement above still applies, since the
  // town veto fires on this branch (venues do not agree).
  if (
    !venuesAgree &&
    !isUmbrella(a) &&
    !isUmbrella(b) &&
    sharedPressRelease(a, b)
  ) {
    return "standard";
  }

  if (bothVenuesKnown && !venuesAgree) return null;

  // Exactly one title is a placeholder: allow the aggregator's series-default
  // start to disagree with the named act's this-night start (2026-09-19
  // Brice: 7:00 PM Hilltop vs 6:00 PM Greg Sutton). XOR — two generic titles
  // at different hours stay split, and two specific titles still need equal
  // starts. Keyed on the BROAD `isGenericTitle` on purpose, not
  // `isPlaceholderForMatch`: the narrower test would pass a TBD slot and a
  // different named act through the tolerance ("Patio Party #4 featuring live
  // music (TBD)" 19:00 vs "Live Music - Jamie Byous" 18:30, the 2026-08-08
  // Sequoia night), and the placeholder signal below would then merge two
  // events (dedup v2 Phase 0 review, 2026-09-28). A venue-only title ("Murphys
  // Creek Theatre") is the one placeholder `isGenericTitle` misses, so it
  // joins the broad side here (Phase 1.3), keeping the tolerance at least as
  // broad as the placeholder signal.
  const placeholderish = (e: EventIdentity) =>
    isGenericTitle(e.name) || isVenueOnlyTitle(e);
  const seriesStartTolerance =
    !!a.name && !!b.name && placeholderish(a) !== placeholderish(b);

  if (!timesAnchor(a, b, venuesAgree, seriesStartTolerance)) {
    // Two DIFFERENT feeds at the same venue whose windows overlap but whose
    // starts disagree: gates-open vs first act vs last year's hours (the
    // Murphys Gathering, 11:00 on one aggregator and 12:00 on the other, was
    // invisible to every layer). Strong identity only: never the placeholder
    // or window signals, which say nothing about WHICH event a listing is.
    // One feed listing two starts is two sessions, so it never gets here.
    if (!sameNight || !venuesAgree || isUmbrella(a) || isUmbrella(b)) return null;
    if (!crossSourceWindowsOverlap(a, b)) return null;
    // Two rows that each name an act and disagree about who is playing are
    // two shows, whatever their titles share (see `sameExactWindow`).
    if (namesDifferentActs(a, b)) return null;
    if (
      distinctiveTitleMatch(a, b) ||
      artistsOverlap(a.artists, b.artists) ||
      actNamedInOther(a, b) ||
      (!!a.description &&
        !!b.description &&
        textSimilarity(a.description, b.description) >= 0.92)
    ) {
      return "cross_source";
    }
    return null;
  }

  if (a.name && b.name && textSimilarity(a.name, b.name) >= 0.85) return "standard";
  if (artistsOverlap(a.artists, b.artists)) return "standard";
  if (
    a.description &&
    b.description &&
    textSimilarity(a.description, b.description) >= 0.92
  ) {
    return "standard";
  }
  // A placeholder pairs with any title at its venue in the slot, which is
  // exactly why it must never pair with a routine operation: "Live Music @
  // Sequoia Woods" 19:00 would otherwise merge with the hidden "Thursday Night
  // Dinner" 18:00, and the concert would vanish into a row the site never
  // shows (dedup v2 1.7).
  if (
    venuesAgree &&
    !a.is_routine &&
    !b.is_routine &&
    (isPlaceholderForMatch(a) || isPlaceholderForMatch(b))
  ) {
    return "standard";
  }
  if (venuesAgree && actNamedInOther(a, b)) {
    return "standard";
  }
  // Same venue + same slot, but the two sources gave the event different
  // specific titles and edited the shared blurb between listings, so neither
  // the 0.85 title bar nor the 0.92 whole-string description bar tripped
  // (2026-07-16, the Murphys Wine & Beer Garden trivia dupe). Two token-level
  // signals recover these without loosening the cross-venue guards: a shared
  // substantive description core, or heavily-overlapping title tokens once the
  // "@ venue" tail is stripped. Both are gated on venue agreement, so a park
  // hosting different back-to-back programs (distinct titles AND distinct
  // description text) still stays split.
  if (venuesAgree && descriptionsShareCore(a.description, b.description)) {
    return "standard";
  }
  if (
    venuesAgree &&
    titlesShareTokens(a.name, b.name, venueNoiseTokens(a.venue_name, b.venue_name))
  ) {
    return "standard";
  }
  // The same event re-titled in each source's own words: every distinctive
  // word of one title is in the other once venue, town, event-type words and
  // dates are set aside (dedup v2 1.1). "Karaoke at The Murphys Irish Pub" vs
  // "Karaoke W/ Kim", "3rd of July Murphys Annual Patriotic Car Cruise" vs
  // "Murphys 3rd Annual Most Patriotic Car Cruise Celebrating America's
  // Independence".
  if (sameNight && venuesAgree && distinctiveTitleMatch(a, b)) {
    return "standard";
  }
  if (venuesAgree && sameExactWindow(a, b)) {
    return "standard";
  }
  return null;
}

/** Deterministic dedup key: `sha256(normalizeName(name)|date|normalizeTown(town))`,
 *  first 32 hex chars. The ONE definition of a row's identity key — the
 *  write-time matcher (`scripts/lib/dedup.ts`) re-exports it, and the
 *  `/admin/submissions` publish action imports it, so a hand-published event and
 *  a scraped one collide on the same `dedup_key` instead of duplicating. */
export function generateDedupKey(name: string, date: string, town: string): string {
  const input = `${normalizeName(name)}|${date}|${normalizeTown(town)}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}
