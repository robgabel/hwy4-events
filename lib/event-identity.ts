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
  const num = (addr: string | null | undefined): string => {
    const m = (addr ?? "").trim().match(/^(\d{2,6})\b/);
    return m ? m[1] : "";
  };
  const na = num(a);
  return !!na && na === num(b);
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
 *  unknown), keeping the conservative default. */
function timesAnchor(
  a: EventIdentity,
  b: EventIdentity,
  venuesAgree: boolean
): boolean {
  const sa = normalizeTime(a.start_time);
  const sb = normalizeTime(b.start_time);
  if (!sa || !sb) {
    // At least one side states no start. A marked umbrella never merges; every
    // other timeless row anchors on the venue instead of the clock.
    if (isUmbrella(a) || isUmbrella(b)) return false;
    return venuesAgree;
  }
  if (sa !== sb) return false;
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
  b: string | null | undefined
): boolean {
  const ta = titleCore(a);
  const tb = titleCore(b);
  if (!ta || !tb) return false;
  return tokenJaccard(tokenSet(ta), tokenSet(tb)) >= 0.6;
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
    /\b(?:tbd|tba)\W*$/.test(n)
  );
}

/** Are two rows the same real event? The one definition, imported by both the
 *  read-time collapse and the write-time merge.
 *
 *  Requires: same date + town when both are known (defensive — callers already
 *  guarantee it), the same time slot (`timesAnchor`: equal start; conflicting
 *  known ends split the rows UNLESS the venues agree — same venue + same start
 *  means a differing end is scrape noise; a row with NO start anchors on the
 *  venue instead, unless either row is a marked `series_umbrella`), AND at
 *  least one identity signal:
 *   - near-identical titles, or
 *   - overlapping artists, or
 *   - near-identical descriptions, or
 *   - same venue AND one title is a generic placeholder, or
 *   - same venue AND one row's act name appears in the other's text, or
 *   - same venue AND a shared substantive description core, or
 *   - same venue AND heavily-overlapping title tokens (minus the "@ venue" tail).
 *  Two *different specific* titles with distinct descriptions never merge on
 *  venue/time alone. */
export function isSameEvent(a: EventIdentity, b: EventIdentity): boolean {
  if (a.date && b.date && a.date !== b.date) return false;
  if (a.town && b.town && normalizeTown(a.town) !== normalizeTown(b.town)) return false;

  const va = venueForMatch(a);
  const vb = venueForMatch(b);

  // Venue veto (2026-07-02 security/correctness review, P3). Two events at
  // DIFFERENT *known* venues are never the same show — even with an identical
  // title or a shared artist. "Trivia Night", "Open Mic", "Karaoke", "Bingo"
  // run at many venues on the same night at the same time; merging them would
  // hide one immediately and let a later reconcile/delete permanently drop it.
  // Only fires when BOTH venues are known and non-generic: a row with an
  // empty/"Unknown Venue" side stays eligible for the legitimate cross-source
  // merge (one feed names the venue, the other doesn't). The generic/umbrella +
  // actNamedInOther paths below already require venueMatch, so this veto only
  // removes the title/artist/description shortcuts across conflicting venues.
  const bothVenuesKnown =
    !!va && !!vb && !GENERIC_VENUES.has(va) && !GENERIC_VENUES.has(vb);
  // Venue-name fuzzy OR same-street-number address anchor: two sources naming
  // the same lot differently ("Bristol's Ranch House Cafe" vs "Bristols's Cafe
  // Parking Lot", both at 961 Highway 4) must not trip the veto below.
  const venuesAgree = venueMatch(va, vb) || sameStreetNumber(a.address, b.address);
  if (bothVenuesKnown && !venuesAgree) return false;

  if (!timesAnchor(a, b, venuesAgree)) return false;

  if (a.name && b.name && textSimilarity(a.name, b.name) >= 0.85) return true;
  if (artistsOverlap(a.artists, b.artists)) return true;
  if (
    a.description &&
    b.description &&
    textSimilarity(a.description, b.description) >= 0.92
  ) {
    return true;
  }
  if (venuesAgree && (isGenericTitle(a.name) || isGenericTitle(b.name))) {
    return true;
  }
  if (venuesAgree && actNamedInOther(a, b)) {
    return true;
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
    return true;
  }
  if (venuesAgree && titlesShareTokens(a.name, b.name)) {
    return true;
  }
  return false;
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
