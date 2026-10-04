// One identity per band (artist coverage + accuracy, 2026-10-04).
//
// The artists catalog keyed acts by `normalizeName`, which only folds case,
// whitespace and typographic punctuation. So the same act landed as several
// rows, each researched separately and each able to contradict the others:
// "Greg Sutton & Friends" / "Greg Sutton and Friends", "Blue Monday" / "Blue
// Monday Band", "The ElderBerries" / "The Elder Berries", "Rod Harris" (a
// medium draft) beside "Rod Harris and Friends" (high, published), and
// "Pub is Dead" beside its Squarespace copy artifact "Pub is Dead (1)".
//
// `artistIdentityKey` is the MATCH key, not the storage key: `artist_key`
// stays `normalizeName` so no stored row is orphaned. It folds "&" to "and",
// drops a copy suffix, strips ensemble suffixes ("Band", "Duo", "Trio",
// "Quartet", "Project", "& Friends", "& Band"), and compares letters and
// digits only. Deliberately NOT fuzzy: "Sipsy River Band" vs "Sipsey River
// Band" is a typo no rule can tell from two different bands, and "Gregory
// Sutton" vs "Greg Sutton" is a nickname. Those stay separate rows. The known
// cost is that a band named "X" and a different band named "X Band" would
// share a key; nothing in the corridor's catalog has that shape.
//
// Dependency-free on purpose (no import from event-identity, which imports
// `tidyArtistList` from here), so the scripts/ test runner can lock it.
// Locked by scripts/test/artist-identity.test.ts.

const COPY_SUFFIX = /\s*\((?:\d+|copy(?:\s*\d+)?)\)\s*$/;
const ENSEMBLE_SUFFIX =
  /(?:\s+and\s+(?:friends|band|company)|\s+(?:band|duo|trio|quartet|project))$/;

function baseForm(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(COPY_SUFFIX, "")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

/** Match key for an act name. Two listings with the same key are the same act. */
export function artistIdentityKey(name: string): string {
  let n = baseForm(name);
  // Repeat so "Earth Tones Trio & Band" sheds both suffixes.
  for (let i = 0; i < 3; i++) {
    const stripped = n.replace(ENSEMBLE_SUFFIX, "").trim();
    if (!stripped || stripped === n) break;
    n = stripped;
  }
  const key = n.replace(/[^a-z0-9]+/g, "");
  if (key) return key;
  // A name that is nothing but a suffix ("The Band") keeps its own letters.
  const bare = baseForm(name).replace(/[^a-z0-9]+/g, "");
  if (bare) return bare;
  // No ASCII letters at all ("東京事変", "!!!"): the folded form itself, so the
  // act is kept and never collides with every other such name on "".
  return baseForm(name).replace(/\s+/g, " ");
}

/** Names that are not a performing act: a karaoke host, a weekly theme night,
 *  an open mic. Researching them burns a web search and can only produce a
 *  wrong bio ("Kim" from "Karaoke with Kim"). */
export function isNonActName(name: string): boolean {
  const n = baseForm(name);
  if (!/[a-z]/.test(n) || n.length > 60) return true;
  return (
    /\b(?:karaoke|open mic|open jam|jam session|trivia|bingo|line danc\w*|dj night)\b/.test(n) ||
    /^(?:kj|dj)\b/.test(n) ||
    /\bthrow ?back (?:mon|tues|wednes|thurs|fri|satur|sun)day\b/.test(n) ||
    /^(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/.test(n) ||
    /^(?:tbd|tba|to be announced)$/.test(n)
  );
}

/** Split a compound billing ("Alison Krauss & Union Station") into its parts. */
function compoundParts(name: string): string[] {
  const parts = baseForm(name).split(/\s+and\s+/);
  return parts.length >= 2 ? parts : [];
}

/**
 * Clean an event's `artists` list without losing an act:
 *  - trims and drops empties,
 *  - collapses variants of one act to the first spelling listed
 *    ("Pub is Dead", "Pub is Dead (1)" -> "Pub is Dead"),
 *  - drops a name that is only a part of a compound billing also in the list
 *    ("Alison Krauss", "Union Station", "Alison Krauss & Union Station" ->
 *    the compound alone). The split parts used to become their own catalog
 *    rows, and "Union Station" alone is a famous name for the researcher to
 *    get wrong.
 * Returns null for an empty result, matching the column's convention.
 */
export function tidyArtistList(list: (string | null | undefined)[] | null | undefined): string[] | null {
  if (!list?.length) return null;
  const names = list.map((a) => (a ?? "").trim()).filter(Boolean);
  const partKeys = new Set<string>();
  for (const n of names) {
    for (const p of compoundParts(n)) partKeys.add(artistIdentityKey(p));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const key = artistIdentityKey(n);
    if (!key || seen.has(key)) continue;
    // A part of a listed compound is covered by the compound.
    if (compoundParts(n).length === 0 && partKeys.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.length > 0 ? out : null;
}
