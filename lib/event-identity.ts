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
  start_time?: string | null;
  end_time?: string | null;
  description?: string | null;
  artists?: string[] | null;
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

/** Normalized-string similarity in [0,1]. Normalizes both inputs, returns 1 on
 *  exact match, a containment ratio when one is a substring of the other, else
 *  Levenshtein-based similarity. */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  if (shorter.length === 0) return 0;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
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

/** Two rows describe the same time slot: starts must be known and equal, and
 *  end times must agree *only when both are known*. A source that omits the end
 *  time ("7:00 PM") must still anchor to the same source's fuller listing
 *  ("7:00 PM – 10:00 PM") — keying on an exact end would split them apart. */
function timesAnchor(a: EventIdentity, b: EventIdentity): boolean {
  const sa = normalizeTime(a.start_time);
  const sb = normalizeTime(b.start_time);
  if (!sa || !sb || sa !== sb) return false;
  const ea = normalizeTime(a.end_time);
  const eb = normalizeTime(b.end_time);
  if (ea && eb && ea !== eb) return false;
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

/** A title generic enough that it's an aggregator placeholder for whatever act
 *  is playing — "Live Music @ The Lube Room". A generic + a specific title at
 *  the same venue and exact time are the same show. */
function isGenericTitle(name: string): boolean {
  const n = normalizeName(name);
  return (
    /^live music\b/.test(n) ||
    /^live (entertainment|tunes)\b/.test(n) ||
    /^music (in|at|on) the\b/.test(n)
  );
}

/** Are two rows the same real event? The one definition, imported by both the
 *  read-time collapse and the write-time merge.
 *
 *  Requires: same date + town when both are known (defensive — callers already
 *  guarantee it), the same time slot (`timesAnchor`: equal start, end agreeing
 *  only when both known), AND at least one identity signal:
 *   - near-identical titles, or
 *   - overlapping artists, or
 *   - near-identical descriptions, or
 *   - same venue AND one title is a generic placeholder, or
 *   - same venue AND one row's act name appears in the other's text.
 *  Two *different specific* titles never merge on venue/time alone. */
export function isSameEvent(a: EventIdentity, b: EventIdentity): boolean {
  if (a.date && b.date && a.date !== b.date) return false;
  if (a.town && b.town && normalizeTown(a.town) !== normalizeTown(b.town)) return false;
  if (!timesAnchor(a, b)) return false;
  if (a.name && b.name && textSimilarity(a.name, b.name) >= 0.85) return true;
  if (artistsOverlap(a.artists, b.artists)) return true;
  if (
    a.description &&
    b.description &&
    textSimilarity(a.description, b.description) >= 0.92
  ) {
    return true;
  }
  const va = normalizeVenue(a.venue_name);
  const vb = normalizeVenue(b.venue_name);
  if (venueMatch(va, vb) && (isGenericTitle(a.name) || isGenericTitle(b.name))) {
    return true;
  }
  if (venueMatch(va, vb) && actNamedInOther(a, b)) {
    return true;
  }
  return false;
}
