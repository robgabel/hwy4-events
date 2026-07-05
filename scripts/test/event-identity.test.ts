// Regression lock for the ONE "same event" rule (lib/event-identity.ts).
//
// Every case here is a real duplicate class we've hit in production, or a guard
// against over-merging. The matcher used to be copied into read-time and
// write-time files that drifted; this suite pins the shared predicate so the
// drift bugs (end_time bucketing, series-vs-artist split) can't come back.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSameEvent,
  isGenericTitle,
  generateDedupKey,
  normalizeForMatch,
  type EventIdentity,
} from "../../lib/event-identity.js";

test("normalizeForMatch folds '&' and strips a leading ordinal-annual prefix", () => {
  assert.equal(
    normalizeForMatch("54th Annual Sierra Nevada Arts & Crafts Festival"),
    "sierra nevada arts and crafts festival"
  );
  assert.equal(normalizeForMatch("Annual Fireman's Muster"), "fireman's muster");
  // Mid-title "annual" is untouched; only the leading prefix is stripped.
  assert.equal(normalizeForMatch("The Big Annual Bash"), "big annual bash");
});

test("generateDedupKey is NOT affected by match-time normalization (key stability)", () => {
  // "&" vs "and" must still hash differently — the stored keys were generated
  // with normalizeName, and changing the hash would orphan the whole catalog.
  assert.notEqual(
    generateDedupKey("Arts & Crafts Fair", "2026-07-04", "Arnold"),
    generateDedupKey("Arts and Crafts Fair", "2026-07-04", "Arnold")
  );
});

test("generateDedupKey: 32 hex chars, deterministic, normalization-invariant", () => {
  const k = generateDedupKey("Storytime with Miss Debbie", "2026-06-03", "Arnold");
  assert.match(k, /^[0-9a-f]{32}$/);
  assert.equal(k, generateDedupKey("Storytime with Miss Debbie", "2026-06-03", "Arnold"));
  // normalizeName folds case, whitespace, and a leading "the"
  assert.equal(
    generateDedupKey("The   Foo Fest", "2026-07-01", "Murphys"),
    generateDedupKey("foo fest", "2026-07-01", "Murphys")
  );
  // normalizeTown aliases White Pines -> Arnold
  assert.equal(
    generateDedupKey("Trivia Night", "2026-07-01", "White Pines"),
    generateDedupKey("Trivia Night", "2026-07-01", "Arnold")
  );
});

/** Build an event with sensible defaults; override only what the case needs. */
function ev(p: Partial<EventIdentity> & { name: string }): EventIdentity {
  return {
    date: "2026-06-06",
    town: "Murphys",
    venue_name: null,
    start_time: "19:00:00",
    end_time: null,
    description: null,
    artists: null,
    ...p,
  };
}

const cases: { label: string; a: EventIdentity; b: EventIdentity; same: boolean }[] = [
  {
    // The bug that started it all: GoCalaveras lists the umbrella series with no
    // artists and an end time; the venue feed lists the act with no end time.
    // Must merge via the act name appearing in the series' description.
    label: "series umbrella (end 22:00, no artists) vs act (no end) — same",
    a: ev({
      name: "Brice Station Vineyards – Hilltop Concert Series",
      venue_name: "Brice Station Vineyards",
      end_time: "22:00:00",
      description: "Jimbo Scott & Yesterdays Biscuits – June 6, 2026 @ 7pm",
    }),
    b: ev({
      name: "Jimbo Scott & Yesterdays Biscuits",
      venue_name: "Brice Station Vineyards",
      artists: ["Jimbo Scott & Yesterdays Biscuits"],
      description: "Live music performance featuring Jimbo Scott & Yesterdays Biscuits.",
    }),
    same: true,
  },
  {
    // The Bistro case: aggregator umbrella whose blurb does NOT name the act, so
    // actNamedInOther can't catch it. Must merge because the umbrella TITLE is
    // recognized as a series placeholder (isGenericTitle) at the same venue+time.
    label: "umbrella series (act not in blurb) vs act, same venue — same",
    a: ev({
      name: "Bistro Summer Concerts Series",
      date: "2026-06-13",
      town: "Arnold",
      venue_name: "Bistro Espresso",
      start_time: "18:00:00",
      end_time: "21:00:00",
      description: "Summer concert season is back. Live music every Saturday 6-9 PM, smoky BBQ.",
    }),
    b: ev({
      name: "Avalon Revival",
      date: "2026-06-13",
      town: "Arnold",
      venue_name: "Bistro Espresso",
      start_time: "18:00:00",
      end_time: "21:00:00",
      artists: ["Avalon Revival"],
    }),
    same: true,
  },
  {
    // End-time drift in isolation: one row has an end, the other doesn't, but
    // they share an artist. The end must NOT split them.
    label: "end 22:00 vs end null, overlapping artists — same",
    a: ev({ name: "Concert in the Park", venue_name: "Murphys Community Park", end_time: "22:00:00", artists: ["The Star Dogs"] }),
    b: ev({ name: "The Star Dogs", venue_name: "Murphys Community Park", end_time: null, artists: ["The Star Dogs"] }),
    same: true,
  },
  {
    // Generic aggregator placeholder + specific act at the same venue/time.
    label: "generic 'Live Music @ X' vs specific act, same venue — same",
    a: ev({ name: "Live Music @ The Lube Room", town: "Dorrington", date: "2026-08-07", venue_name: "The Lube Room Saloon" }),
    b: ev({ name: "Live at The Lube: Breakaway", town: "Dorrington", date: "2026-08-07", venue_name: "The Lube Room Saloon", artists: ["Breakaway"] }),
    same: true,
  },
  {
    // Cross-venue: same pattern at a different venue. Act named in series desc.
    label: "series + act named in description, Ironstone — same",
    a: ev({
      name: "Ironstone Summer Concert Series",
      date: "2026-08-28",
      venue_name: "Ironstone Vineyards",
      start_time: "20:00:00",
      description: "Featuring Alison Krauss & Union Station",
    }),
    b: ev({
      name: "Alison Krauss & Union Station",
      date: "2026-08-28",
      venue_name: "Ironstone Vineyards",
      start_time: "20:00:00",
      artists: ["Alison Krauss & Union Station"],
    }),
    same: true,
  },
  {
    // Guard: two genuinely different shows at one venue, same start. No shared
    // title/artist/desc signal — must stay separate.
    label: "two different specific titles, same venue + start — NOT same",
    a: ev({ name: "Salsa Night", date: "2026-07-10", venue_name: "Murphys Community Park", end_time: "21:00:00", artists: ["Los Caminos"], description: "Salsa dancing" }),
    b: ev({ name: "Open Mic", date: "2026-07-10", venue_name: "Murphys Community Park", end_time: "21:00:00", artists: ["Jane Doe"], description: "Bring your own instrument" }),
    same: false,
  },
  {
    // Guard: a title that names the act AFTER the series ("... Summer Concert:
    // Foo") is specific, not a bare umbrella — two of them at the same venue +
    // start must NOT collapse into one.
    label: "two 'Summer Concert: <act>' specifics, same venue + start — NOT same",
    a: ev({ name: "Cameo Plaza Summer Concert: Leilani & The Distractions", date: "2026-06-13", town: "Arnold", venue_name: "Cameo Plaza", start_time: "18:00:00", artists: ["Leilani & The Distractions"] }),
    b: ev({ name: "Cameo Plaza Summer Concert: Snarky Cats", date: "2026-06-13", town: "Arnold", venue_name: "Cameo Plaza", start_time: "18:00:00", artists: ["Snarky Cats"] }),
    same: false,
  },
  {
    // Guard: identical titles but back-to-back start times = different shows.
    label: "same title/venue, different start times — NOT same",
    a: ev({ name: "Live Music @ The Lube Room", town: "Dorrington", date: "2026-08-07", venue_name: "The Lube Room Saloon", start_time: "15:00:00" }),
    b: ev({ name: "Live Music @ The Lube Room", town: "Dorrington", date: "2026-08-07", venue_name: "The Lube Room Saloon", start_time: "19:00:00" }),
    same: false,
  },
  {
    // Guard: same act/venue/start but different DATE = different shows.
    label: "same act/venue/start, different date — NOT same",
    a: ev({ name: "The Star Dogs", date: "2026-07-04", venue_name: "Murphys Community Park", artists: ["The Star Dogs"] }),
    b: ev({ name: "The Star Dogs", date: "2026-07-11", venue_name: "Murphys Community Park", artists: ["The Star Dogs"] }),
    same: false,
  },
  {
    // FLIPPED 2026-07-05 (the Coffee & Cars triple). This case used to lock
    // "both ends known but disagree = different slots", and that lock was wrong
    // in production: three sources listed the same Meadowmont Lodge car show
    // with three different extracted ends (11:00 / 17:00 / 12:00), and the veto
    // blinded every dedup layer. Same venue + same date + same start = one
    // physical slot; a conflicting end is scrape noise when the venues agree.
    label: "same act/venue/start, both ends known but differ — same (venue agrees)",
    a: ev({ name: "The Star Dogs", venue_name: "Murphys Community Park", start_time: "19:00:00", end_time: "21:00:00", artists: ["The Star Dogs"] }),
    b: ev({ name: "The Star Dogs", venue_name: "Murphys Community Park", start_time: "19:00:00", end_time: "23:00:00", artists: ["The Star Dogs"] }),
    same: true,
  },
  {
    // Guard: end disagreement still splits rows when the venues DON'T provably
    // agree — one side venue-unknown keeps the conservative default.
    label: "same title, one venue unknown, ends differ — NOT same",
    a: ev({ name: "The Star Dogs", venue_name: "Murphys Community Park", start_time: "19:00:00", end_time: "21:00:00" }),
    b: ev({ name: "The Star Dogs", venue_name: null, start_time: "19:00:00", end_time: "23:00:00" }),
    same: false,
  },
  {
    // The 2026-07-05 Coffee & Cars triple, pair 1 (real prod rows): two FB/VM
    // scrapes of the same car show, same venue, ends 11:00 vs 17:00. One row's
    // act-ish name ("Coffee & Cars") appears verbatim in the other's blob.
    label: "Coffee & Cars: same venue, ends 11:00 vs 17:00, act named in other — same",
    a: ev({
      name: "Free Coffee & Cars Car Show at the Lodge",
      date: "2026-07-05",
      town: "Arnold",
      venue_name: "Meadowmont Lodge",
      address: "2011 Highway 4, Arnold, CA 95223",
      start_time: "08:00:00",
      end_time: "11:00:00",
      description: "Fuel your adrenaline with a FREE car show! Join the Arnold Meadowmont Lodge on July 5th from 8am to 11am, featuring Central Valley Corvettes.",
    }),
    b: ev({
      name: "Coffee & Cars",
      date: "2026-07-05",
      town: "Arnold",
      venue_name: "Meadowmont Lodge",
      address: "2011 Highway 4, Arnold, CA 95223",
      start_time: "08:00:00",
      end_time: "17:00:00",
      description: "Arnold Meadowmont Lodge is hosting the Central Valley Corvette Club over the 4th of July weekend.",
    }),
    same: true,
  },
  {
    // The triple, pair 2: the FB discover scraper wrote the LOCALITY as the
    // venue ("Meadowmont, California") with no address. The locality strip must
    // let the core ("meadowmont") fuzzy-match the real venue instead of
    // tripping the different-venues veto; the end mismatch (12:00 vs 17:00) is
    // then forgiven because the venues agree.
    label: "Coffee & Cars: locality-artifact venue 'Meadowmont, California' — same",
    a: ev({
      name: "Coffee & Cars Car Show ~ Arnold Meadowmont Lodge",
      date: "2026-07-05",
      town: "Arnold",
      venue_name: "Meadowmont, California",
      address: null,
      start_time: "08:00:00",
      end_time: "12:00:00",
      description: "https://www.gocalaveras.com/events/coffee-cars-car-show/",
    }),
    b: ev({
      name: "Coffee & Cars",
      date: "2026-07-05",
      town: "Arnold",
      venue_name: "Meadowmont Lodge",
      address: "2011 Highway 4, Arnold, CA 95223",
      start_time: "08:00:00",
      end_time: "17:00:00",
      description: "Arnold Meadowmont Lodge is hosting the Central Valley Corvette Club over the 4th of July weekend.",
    }),
    same: true,
  },
  {
    // Guard: a locality venue that is just the event's own TOWN ("Arnold,
    // California") is venue-UNKNOWN, not a venue match — it must not unlock the
    // venue-anchored signals (generic-title / act-named) against a real venue.
    label: "town-as-venue 'Arnold, California' + generic title vs real venue — NOT same",
    a: ev({ name: "Live Music", date: "2026-07-10", town: "Arnold", venue_name: "Arnold, California", start_time: "19:00:00" }),
    b: ev({ name: "The Sky Kings", date: "2026-07-10", town: "Arnold", venue_name: "Arnold Library", start_time: "19:00:00", artists: ["The Sky Kings"] }),
    same: false,
  },
  {
    // Sanity: a byte-identical re-scrape is obviously the same event.
    label: "identical rows — same",
    a: ev({ name: "Trivia Night", venue_name: "Murphys Irish Pub", artists: ["Quizmaster"] }),
    b: ev({ name: "Trivia Night", venue_name: "Murphys Irish Pub", artists: ["Quizmaster"] }),
    same: true,
  },
  {
    // Venue veto (2026-07-02 review, P3): the SAME generic title at two DIFFERENT
    // known venues on the same night is two different events — must NOT merge,
    // even though the titles are byte-identical (textSimilarity = 1).
    label: "same 'Trivia Night' title, two different known venues — NOT same",
    a: ev({ name: "Trivia Night", date: "2026-07-10", town: "Murphys", venue_name: "Murphys Irish Pub", start_time: "19:00:00" }),
    b: ev({ name: "Trivia Night", date: "2026-07-10", town: "Murphys", venue_name: "V Restaurant & Bar", start_time: "19:00:00" }),
    same: false,
  },
  {
    // Venue veto extends to the artist-overlap shortcut: a shared act at two
    // different known venues at the same time is a data artifact, not one event.
    label: "shared artist, two different known venues — NOT same",
    a: ev({ name: "Open Mic", date: "2026-07-10", venue_name: "The Lube Room Saloon", start_time: "19:00:00", artists: ["Jane Doe"] }),
    b: ev({ name: "Songwriter Night", date: "2026-07-10", venue_name: "Alchemy Market", start_time: "19:00:00", artists: ["Jane Doe"] }),
    same: false,
  },
  {
    // The veto must NOT block the legitimate cross-source merge where one feed
    // names the venue and the other leaves it unknown — that pairing is the whole
    // reason the matcher exists. One side generic → veto does not fire → merges
    // on the identical title.
    label: "same title, one venue known + one 'Unknown Venue' — same",
    a: ev({ name: "Spring Peddlers Faire", date: "2026-05-02", town: "Arnold", venue_name: "Independence Hall", start_time: "09:00:00" }),
    b: ev({ name: "Spring Peddlers Faire", date: "2026-05-02", town: "Arnold", venue_name: "Unknown Venue", start_time: "09:00:00" }),
    same: true,
  },
  {
    // The 2026-07-04 Arts & Crafts Festival dupe (real prod rows): a hand-entered
    // Rob's Pick and a GoCalaveras scrape of the same festival. Two failures
    // compounded: (1) the sources named the same lot differently, so the venue
    // veto fired before any title check; (2) "54th Annual … Arts & Crafts" vs
    // "… Arts and Crafts" scored ~0.7, under the 0.85 title bar. Fixed by the
    // same-street-number address anchor + match-time "&"/ordinal normalization.
    label: "annual-prefix + '&' title, renamed venue but same street number — same",
    a: ev({
      name: "Sierra Nevada Arts and Crafts Festival",
      date: "2026-07-04",
      town: "Arnold",
      venue_name: "Bristol's Ranch House Cafe",
      address: "961 Highway 4",
      start_time: "10:00:00",
      end_time: null,
      description: "The 54th annual Sierra Nevada Arts & Crafts Festival takes over the park-like grounds.",
    }),
    b: ev({
      name: "54th Annual Sierra Nevada Arts & Crafts Festival",
      date: "2026-07-04",
      town: "Arnold",
      venue_name: "Bristols’s Cafe Parking Lot",
      address: "961 CA-4, Arnold, CA 95223",
      start_time: "10:00:00",
      end_time: "17:00:00",
      description: "We are excited to invite you to the 54th Annual Sierra Nevada Arts & Crafts Festival.",
    }),
    same: true,
  },
  {
    // Guard: the address anchor must not weaken the veto when the street
    // numbers genuinely differ — same generic title, two real venues.
    label: "same 'Trivia Night' title, different venues + different street numbers — NOT same",
    a: ev({ name: "Trivia Night", date: "2026-07-10", town: "Murphys", venue_name: "Murphys Irish Pub", address: "402 Main St, Murphys, CA", start_time: "19:00:00" }),
    b: ev({ name: "Trivia Night", date: "2026-07-10", town: "Murphys", venue_name: "V Restaurant & Bar", address: "3009 Main St, Murphys, CA", start_time: "19:00:00" }),
    same: false,
  },
  {
    // Guard: a town-only address ("Arnold, CA") has no street number and must
    // never anchor two different venues together.
    label: "different venues, town-only addresses — NOT same",
    a: ev({ name: "Trivia Night", date: "2026-07-10", town: "Murphys", venue_name: "Murphys Irish Pub", address: "Murphys, CA", start_time: "19:00:00" }),
    b: ev({ name: "Trivia Night", date: "2026-07-10", town: "Murphys", venue_name: "V Restaurant & Bar", address: "Murphys, CA", start_time: "19:00:00" }),
    same: false,
  },
];

for (const c of cases) {
  test(c.label, () => {
    assert.equal(isSameEvent(c.a, c.b), c.same, c.label);
    // The relation must be symmetric.
    assert.equal(isSameEvent(c.b, c.a), c.same, `${c.label} (symmetric)`);
  });
}

test("isGenericTitle flags bare umbrella / series placeholders", () => {
  assert.equal(isGenericTitle("Bistro Summer Concerts Series"), true);
  assert.equal(isGenericTitle("Hilltop Concert Series"), true);
  assert.equal(isGenericTitle("Summer Concerts"), true);
  assert.equal(isGenericTitle("Live Music @ The Lube Room"), true);
  assert.equal(isGenericTitle("Music in the Park"), true);
});

test("isGenericTitle keeps titles that name a specific act", () => {
  assert.equal(isGenericTitle("Avalon Revival"), false);
  assert.equal(isGenericTitle("The Sky Kings"), false);
  assert.equal(
    isGenericTitle("Cameo Plaza Summer Concert: Leilani & The Distractions"),
    false
  );
});
