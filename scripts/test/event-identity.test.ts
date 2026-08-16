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
  {
    // The 2026-07-16 Murphys Wine & Beer Garden trivia dupe (real prod rows).
    // Two sources listed the same weekly trivia night under different titles
    // ("Thirsty Thursday Trivia" / "Trivia Thursday @ …") at the same venue,
    // date, and 5:00 PM start. Both failed the old signals: title sim ~0.4,
    // and each source edited the shared blurb (Doug Conrad "crafted and
    // presented" vs "crafted … presented by Phil Gomez", plus Visit Murphys
    // appended a recurrence tail) so whole-string description sim landed ~0.6,
    // under 0.92. Recovered by the shared-description-core signal (the opening
    // sentence is byte-identical) — and independently by the title-token
    // signal once the "@ venue" tail is stripped.
    label: "trivia re-title + edited blurb, same venue/slot — same",
    a: ev({
      name: "Thirsty Thursday Trivia",
      date: "2026-07-16",
      town: "Murphys",
      venue_name: "Murphys Wine & Beer Garden",
      start_time: "17:00:00",
      end_time: "19:00:00",
      description:
        "Our Trivia is 3 rounds, all Multiple Choice. Crafted by and presented by our own Doug Conrad. Come out for a night of learning and laughter! Every 1st and 3rd Thursday. Starts at 5:00 Three rounds, 10 questions each. Play 1 or 2 or all 3 rounds!",
    }),
    b: ev({
      name: "Trivia Thursday @ Murphys Wine Bar and Beer Garden",
      date: "2026-07-16",
      town: "Murphys",
      venue_name: "Murphys Wine & Beer Garden",
      start_time: "17:00:00",
      end_time: null,
      description:
        "Our Trivia is 3 rounds, all Multiple Choice. Crafted by our own Doug Conrad and presented by Phil Gomez. Come out for a night of learning and laughter!",
    }),
    same: true,
  },
  {
    // Real prod rows (2026-08-15): a community submission and a Visit Murphys
    // scrape of the same event, titles differing only by a mid-string "Annual"
    // (which the leading-only ordinal strip can't remove) — title sim ~0.82,
    // under 0.85. Recovered by the title-token signal (Jaccard 0.83).
    label: "'Rotary's Annual Shrimp Feed' vs 'Rotary's Shrimp Feed', same venue/slot — same",
    a: ev({ name: "Rotary’s Annual Shrimp Feed & Auction", date: "2026-08-15", town: "Murphys", venue_name: "Murphys Community Park", start_time: "16:00:00" }),
    b: ev({ name: "Rotary's Shrimp Feed & Auction", date: "2026-08-15", town: "Murphys", venue_name: "Murphys Community Park", start_time: "16:00:00" }),
    same: true,
  },
  {
    // Guard for the new signals: two genuinely different Big Trees programs run
    // at the same venue + same 10:00 start with distinct titles AND distinct
    // program descriptions. Neither the title-token nor the description-core
    // signal may collapse them (this is the case the conservative design
    // protects — merging would silently hide one program).
    label: "Big Trees Junior Rangers vs South Grove Guided Hike, same venue/slot — NOT same",
    a: ev({
      name: "Junior Rangers @ Big Trees State Park",
      date: "2026-07-18",
      town: "Arnold",
      venue_name: "Calaveras Big Trees State Park",
      start_time: "10:00:00",
      description: "Kids ages 7 to 12 earn a Junior Ranger badge through hands-on activities and a short discovery walk with a park interpreter.",
    }),
    b: ev({
      name: "South Grove Guided Hike @ Big Trees State Park",
      date: "2026-07-18",
      town: "Arnold",
      venue_name: "Calaveras Big Trees State Park",
      start_time: "10:00:00",
      description: "Join a docent for a five mile round trip hike into the South Grove to see the largest giant sequoias in the park.",
    }),
    same: false,
  },
  {
    // Guard for the title-token signal: two different acts sharing a venue +
    // series prefix in the title ("Cameo Plaza Summer Concert: <act>") must
    // stay split — the distinguishing act name is what differs, and Jaccard on
    // the shared prefix lands ~0.4 (under 0.6). Mirrors the existing artists
    // case but exercises the token path with null artists/descriptions.
    label: "two 'Summer Concert: <act>' titles, same venue/slot, no desc — NOT same",
    a: ev({ name: "Cameo Plaza Summer Concert: Leilani & The Distractions", date: "2026-06-13", town: "Arnold", venue_name: "Cameo Plaza", start_time: "18:00:00" }),
    b: ev({ name: "Cameo Plaza Summer Concert: Snarky Cats", date: "2026-06-13", town: "Arnold", venue_name: "Cameo Plaza", start_time: "18:00:00" }),
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

test("isGenericTitle flags a bare '<venue> presents' placeholder (HWY-29)", () => {
  // GoCalaveras titles every Murphys Creek Theatre show "... presents" with the
  // real play name only in the URL slug.
  assert.equal(isGenericTitle("Murphys Creek Theatre presents"), true);
  assert.equal(isGenericTitle("The Barn Presents"), true);
  // ...but a title that names the show after "presents" stays specific.
  assert.equal(
    isGenericTitle("Murphys Creek Theatre presents What the Constitution Means to Me"),
    false
  );
});

test("isGenericTitle flags trailing TBD/TBA act placeholders", () => {
  // The Sequoia Woods Patio Party dupe (2026-07-16 QA): the venue re-lists
  // the same night once the act is named, and the placeholder row must merge.
  assert.equal(isGenericTitle("Patio Party #4 featuring live music (TBD)"), true);
  assert.equal(isGenericTitle("Live Music at the Beer Garden (Act TBA)"), true);
  assert.equal(
    isGenericTitle("Patio Party #4 featuring live music - The Hit Men"),
    false
  );
  // TBD mid-title is not a placeholder marker.
  assert.equal(isGenericTitle("TBD Brewing Anniversary Party"), false);
});

test("TBD placeholder merges with the named-act re-listing (same venue+slot)", () => {
  const placeholder = {
    name: "Patio Party #4 featuring live music (TBD)",
    date: "2026-08-08",
    town: "Arnold",
    venue_name: "Sequoia Woods Country Club",
    start_time: "19:00",
    end_time: "22:00",
    description: null,
    artists: null,
  };
  const named = {
    ...placeholder,
    name: "Patio Party #4 featuring live music - The Hit Men",
  };
  assert.equal(isSameEvent(placeholder, named), true);
  assert.equal(isSameEvent(named, placeholder), true);
});

// ---------------------------------------------------------------------------
// HWY-10: timeless rows are mergeable; marked festival umbrellas are not.
//
// A listing that omits the start time used to be invisible to every merge
// layer, because `timesAnchor` required two known, equal starts. That was load-
// bearing for exactly one shape — the curated festival umbrella card — and
// accidentally protected every real duplicate that happened to omit a clock.
// `series_umbrella` makes the umbrella's separation explicit so the rest of the
// timeless population can merge normally.
// ---------------------------------------------------------------------------

const kaneBrownTimed = {
  name: "Kane Brown",
  date: "2026-08-16",
  town: "Murphys",
  venue_name: "Ironstone Amphitheatre at Ironstone Vineyards",
  start_time: "19:00",
  end_time: null as string | null,
  description: "Kane Brown plays the Ironstone Amphitheatre.",
  artists: ["Kane Brown"],
};

const kaneBrownTimeless = {
  name: "Kane Brown - Murphys",
  date: "2026-08-16",
  town: "Murphys",
  venue_name: "Ironstone Vineyards",
  start_time: null as string | null,
  end_time: null as string | null,
  description: "An unforgettable night with Kane Brown at Ironstone Vineyards.",
  artists: ["Kane Brown"],
};

test("a timeless listing merges with its timed twin at the same venue", () => {
  assert.equal(isSameEvent(kaneBrownTimed, kaneBrownTimeless), true);
  assert.equal(isSameEvent(kaneBrownTimeless, kaneBrownTimed), true);
});

test("two timeless listings of the same show merge", () => {
  // The live Moose Lodge pair (2026-09-19): both rows carry no start time, so
  // even a same-venue same-title duplicate could never match before HWY-10.
  const a = {
    name: 'Rib Feed & Live Band "Blue Monday"',
    date: "2026-09-19",
    town: "Arnold",
    venue_name: "Ebbetts Pass Moose Lodge",
    start_time: null as string | null,
    end_time: null as string | null,
    description: "A rib feed dinner with live music from Blue Monday on September 19.",
    artists: null,
  };
  const b = {
    ...a,
    name: "Rib Feed & Live Band",
    description: "Rib feed dinner with live music by Blue Monday.",
  };
  assert.equal(isSameEvent(a, b), true);
});

test("a marked festival umbrella NEVER merges into one of its nightly shows", () => {
  // The whole point of the flag. The umbrella is dated opening day with no
  // start time and must survive alongside the 7pm opening-night concert.
  const umbrella = {
    name: "Bear Valley Music Festival 2026",
    date: "2026-07-17",
    town: "Bear Valley",
    venue_name: "Big White Tent",
    start_time: null as string | null,
    end_time: null as string | null,
    description:
      "July 17 through August 2, 2026. Three weeks of music under the Big White Tent.",
    artists: null,
    series_umbrella: true,
  };
  const openingNight = {
    name: "Bear Valley Music Festival",
    date: "2026-07-17",
    town: "Bear Valley",
    venue_name: "Big White Tent",
    start_time: "19:00",
    end_time: null as string | null,
    description: "Opening night of the Bear Valley Music Festival under the tent.",
    artists: ["Bear Valley Festival Orchestra"],
  };
  assert.equal(isSameEvent(umbrella, openingNight), false);
  assert.equal(isSameEvent(openingNight, umbrella), false);
  // And it is the MARK doing the work, not the missing clock: drop the flag and
  // the same two rows become mergeable.
  const { series_umbrella: _drop, ...unmarked } = umbrella;
  assert.equal(isSameEvent(unmarked, openingNight), true);
});

test("an umbrella is also protected from a timeless sibling", () => {
  const umbrella = {
    name: "Bear Valley Music Festival 2026",
    date: "2026-07-17",
    town: "Bear Valley",
    venue_name: "Big White Tent",
    start_time: null as string | null,
    end_time: null as string | null,
    description: "Three weeks of music under the Big White Tent.",
    artists: null,
    series_umbrella: true,
  };
  const timelessSibling = {
    ...umbrella,
    name: "Bear Valley Music Festival",
    series_umbrella: false,
  };
  assert.equal(isSameEvent(umbrella, timelessSibling), false);
});

test("a timeless row does NOT merge across different venues", () => {
  // With no clock, the venue is the only anchor left, so it is required.
  const a = {
    name: "Trivia Night",
    date: "2026-08-16",
    town: "Murphys",
    venue_name: "Murphys Irish Pub",
    start_time: null as string | null,
    end_time: null as string | null,
    description: "Weekly trivia night with prizes for the top three teams.",
    artists: null,
  };
  const b = { ...a, venue_name: "The Pour House" };
  assert.equal(isSameEvent(a, b), false);
});

test("a timeless row does NOT merge when the other side's venue is unknown", () => {
  const known = {
    name: "Summer Concert",
    date: "2026-08-16",
    town: "Murphys",
    venue_name: "Ironstone Vineyards",
    start_time: null as string | null,
    end_time: null as string | null,
    description: "An outdoor summer concert with food trucks and a full bar.",
    artists: null,
  };
  const unknownVenue = { ...known, venue_name: "TBA" };
  assert.equal(isSameEvent(known, unknownVenue), false);
});

test("a timeless row still needs an identity signal, not just a shared venue", () => {
  // Two genuinely different programs the same day at one venue must stay split.
  const juniorRangers = {
    name: "Junior Rangers",
    date: "2026-08-16",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    start_time: null as string | null,
    end_time: null as string | null,
    description:
      "A hands-on program for kids ages 7 to 12 earning their Junior Ranger badge.",
    artists: null,
  };
  const campfire = {
    name: "Campfire: Laugh then Learn",
    date: "2026-08-16",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    start_time: null as string | null,
    end_time: null as string | null,
    description:
      "A weekend-evening campfire program in the amphitheater. Topics vary by week.",
    artists: null,
  };
  assert.equal(isSameEvent(juniorRangers, campfire), false);
});

// ---------------------------------------------------------------------------
// Town is a LABEL, not an identity key (2026-07-28, the Doc Nancy dupe).
//
// A community submission put Calaveras Big Trees State Park in "Camp Connell";
// the park's own listing says "Arnold". Same program, same night, same 8:00 PM
// start. The town veto fired before any signal could be read, so the read-time
// collapse, the write-time merge, the nightly reconcile, and the triage agent's
// candidate query were ALL blind to it, and the duplicate shipped to the
// homepage. These lock the softened rule: a differing town label loses to
// provable venue agreement, and gets no other privileges.
// ---------------------------------------------------------------------------

test("cross-town: the SAME program at one venue merges despite different town labels", () => {
  const parkListing = {
    name: "Night Skies with Doc Nancy @ Big Trees State Park",
    date: "2026-08-01",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    address: "1170 East Highway 4, Arnold, CA 95223",
    start_time: "20:00:00",
    end_time: null as string | null,
    description:
      "Doc Nancy shares the science, constellations, and stories of the night sky. Meet at the Scenic Overlook.",
    artists: null,
  };
  const submission = {
    name: "Night skies with Doc Nancy",
    date: "2026-08-01",
    town: "Camp Connell",
    venue_name: "Big tree State Park overlook",
    address: null as string | null,
    start_time: "20:00:00",
    end_time: "22:30:00",
    description: "Bring a chair and a blanket",
    artists: null,
  };
  // The venue names agree on token overlap even though neither contains the
  // other, which lets the town labels stop vetoing; titlesShareTokens then
  // supplies the identity signal (both title cores are "night skies with doc
  // nancy" once the "@ venue" tail is stripped).
  assert.equal(isSameEvent(parkListing, submission), true);
  assert.equal(isSameEvent(submission, parkListing), true);
});

test("cross-town: a shared venue_key settles it outright, whatever the strings say", () => {
  const a = ev({
    name: "Junior Rangers",
    date: "2026-08-16",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    venue_key: "big-trees-state-park",
    start_time: "10:00:00",
  });
  const b = ev({
    name: "Junior Rangers",
    date: "2026-08-16",
    town: "Dorrington",
    venue_name: "the big trees park, north grove",
    venue_key: "big-trees-state-park",
    start_time: "10:00:00",
  });
  assert.equal(isSameEvent(a, b), true);
  // Drop the shared key and the loose venue strings no longer clear the token
  // bar, so the town labels veto again. The key is doing the work, on purpose.
  assert.equal(
    isSameEvent({ ...a, venue_key: null }, { ...b, venue_key: null }),
    false
  );
});

test("cross-town: an identical GENERIC title at different venues still does NOT merge", () => {
  // The reason the town veto existed. Trivia runs everywhere at 7pm; loosening
  // town must not let two towns' trivia nights collapse into one card.
  const murphys = ev({
    name: "Trivia Night",
    date: "2026-07-10",
    town: "Murphys",
    venue_name: "Murphys Irish Pub",
    start_time: "19:00:00",
  });
  const arnold = ev({
    name: "Trivia Night",
    date: "2026-07-10",
    town: "Arnold",
    venue_name: "Bistro Espresso",
    start_time: "19:00:00",
  });
  assert.equal(isSameEvent(murphys, arnold), false);
});

test("cross-town: venues sharing a naming convention are not the same venue", () => {
  // The token-overlap fallback must clear these: 2 shared tokens, not 3.
  const lodge = ev({
    name: "Live Music",
    date: "2026-07-10",
    town: "Bear Valley",
    venue_name: "Bear Valley Lodge",
    start_time: "19:00:00",
  });
  const adventureCo = ev({
    name: "Live Music",
    date: "2026-07-10",
    town: "Arnold",
    venue_name: "Bear Valley Adventure Company",
    start_time: "19:00:00",
  });
  assert.equal(isSameEvent(lodge, adventureCo), false);

  const murphysPark = ev({
    name: "Summer Concert",
    date: "2026-07-10",
    town: "Murphys",
    venue_name: "Murphys Community Park",
    start_time: "18:00:00",
  });
  const arnoldPark = ev({
    name: "Summer Concert",
    date: "2026-07-10",
    town: "Arnold",
    venue_name: "Arnold Community Park",
    start_time: "18:00:00",
  });
  assert.equal(isSameEvent(murphysPark, arnoldPark), false);
});

test("cross-town: one side's venue unknown still splits on the town label", () => {
  // Nothing proves a shared room here, so the label keeps its veto and the
  // conservative default holds.
  const known = ev({
    name: "Pancake Breakfast",
    date: "2026-07-10",
    town: "Arnold",
    venue_name: "Ebbetts Pass Moose Lodge",
    start_time: "08:00:00",
  });
  const unknown = ev({
    name: "Pancake Breakfast",
    date: "2026-07-10",
    town: "Murphys",
    venue_name: "TBA",
    start_time: "08:00:00",
  });
  assert.equal(isSameEvent(known, unknown), false);
});

test("cross-town: venue words written INTO the title don't defeat the comparison", () => {
  // The second duplicate from the same submitter, same night, same failure class.
  // One source separates the venue with "@" (titleCore strips it), the other runs
  // it straight into the title (titleCore cannot). Once the venues are known to
  // agree, those words are noise on both sides.
  const parkListing = {
    name: "Optical Astronomy Nights @ Big Trees State Park",
    date: "2026-08-13",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    address: "1170 East Highway 4, Arnold, CA 95223",
    start_time: "20:00:00",
    end_time: null as string | null,
    description:
      "Telescope viewing with park astronomers. Start times shift with sunset and the moon. Meet at the Scenic Overlook.",
    artists: null,
  };
  const submission = {
    name: "Optical astronomy big tree State Park",
    date: "2026-08-13",
    town: "Camp Connell",
    venue_name: "Big tree State Park overlook",
    address: null as string | null,
    start_time: "20:00:00",
    end_time: null as string | null,
    description: "Bring a chair and a jacket",
    artists: null,
  };
  assert.equal(isSameEvent(parkListing, submission), true);
  assert.equal(isSameEvent(submission, parkListing), true);
});

test("discounting venue words does NOT merge different programs at one venue", () => {
  // The guard the venue-word strip must not break: two real, distinct Big Trees
  // programs in the same slot. Stripping the venue leaves "junior rangers" vs
  // "south grove guided hike", which share nothing.
  const juniorRangers = ev({
    name: "Junior Rangers @ Big Trees State Park",
    date: "2026-08-16",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    start_time: "10:00:00",
    description: "A hands-on badge program for kids ages 7 to 12.",
  });
  const southGrove = ev({
    name: "South Grove Guided Hike @ Big Trees State Park",
    date: "2026-08-16",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    start_time: "10:00:00",
    description: "A ranger-led walk through the South Grove. Five miles, moderate.",
  });
  assert.equal(isSameEvent(juniorRangers, southGrove), false);

  // A title that is ONLY the venue name would strip to nothing, so the
  // comparison falls back to the plain token sets rather than treating an empty
  // set as a match against everything sharing the slot.
  const venueOnly = ev({
    name: "Big Trees State Park",
    date: "2026-08-16",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    start_time: "10:00:00",
    description: "A day at the park.",
  });
  const bareTitle = ev({
    name: "South Grove Guided Hike",
    date: "2026-08-16",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    start_time: "10:00:00",
    description: "A ranger-led walk. Five miles, moderate.",
  });
  assert.equal(isSameEvent(venueOnly, bareTitle), false);
});

test("discounting venue words is additive: it never un-merges a shared-venue-word pair", () => {
  // Both titles carry the venue name, so stripping it removes a SHARED token and
  // can only push Jaccard down (0.6 -> 0.5 here). The plain comparison must still
  // be allowed to win, or this "improvement" would quietly lose existing merges.
  const anniversary = ev({
    name: "Ironstone Concours d'Elegance (30th Anniversary)",
    date: "2026-09-26",
    town: "Murphys",
    venue_name: "Ironstone Vineyards",
    start_time: "09:00:00",
    description: null,
  });
  const plain = ev({
    name: "Ironstone Concours d'Elegance",
    date: "2026-09-26",
    town: "Murphys",
    venue_name: "Ironstone Vineyards",
    start_time: "09:00:00",
    description: null,
  });
  assert.equal(isSameEvent(anniversary, plain), true);
});

test("an identical start-AND-end window at the same venue is itself an identity signal", () => {
  // 2026-08-11, the Angels-Murphys Rotary shrimp feed. Two aggregators listed
  // the same fundraiser with independently-written titles AND prose, so every
  // text signal missed by roughly half: titles 0.33 (bar 0.85), descriptions
  // 0.27 (bar 0.92), title tokens 0.375 (bar 0.60), both artists arrays NULL.
  // All that is left to match on is the window itself.
  const visitMurphys = ev({
    name: "Rotary’s Annual Shrimp Feed & Auction",
    date: "2026-08-15",
    town: "Murphys",
    venue_name: "Murphys Community Park",
    venue_key: "murphys-community-park",
    start_time: "16:00:00",
    end_time: "21:00:00",
    description:
      "The Angels-Murphys Rotary Club Annual Shrimp Feed & Online Auction is taking place on Saturday, August 15, 2026, from 4:00 PM to 9:00 PM at Murphys Community Park. Adults: $60 Children (under 12): $30.",
  });
  const goCalaveras = ev({
    name: "Annual Shrimp & Pasta Feed Fundraiser",
    date: "2026-08-15",
    town: "Murphys",
    venue_name: "Murphys Community Park",
    venue_key: "murphys-community-park",
    start_time: "16:00:00",
    end_time: "21:00:00",
    description:
      "Join us for a delicious night at The Shrimp Feed in Murphys Park on Saturday, August 15, 2026! Indulge in delicious shrimp while supporting crucial community projects. Do good while having fun!",
  });
  assert.equal(isSameEvent(visitMurphys, goCalaveras), true);
});

test("a shared START time alone never merges simultaneous programs at one venue", () => {
  // The counterexample that makes the end time mandatory rather than a nicety.
  // Calaveras Big Trees really does run these three at 10:00 in the same park;
  // measured over the whole upcoming catalog, same-venue + same-date +
  // same-START yielded 6 pairs of which only 1 was a duplicate. Merging on the
  // start would delete four real programs off the calendar.
  const base = {
    date: "2026-08-15",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    venue_key: "big-trees-state-park",
    start_time: "10:00:00",
  };
  const southGrove = ev({
    ...base,
    name: "South Grove Guided Hike @ Big Trees State Park",
    end_time: "13:00:00",
    description: "A ranger-led walk through the South Grove. Five miles, moderate.",
  });
  const meadowWalk = ev({
    ...base,
    name: "Meadow Walk @ Big Trees State Park",
    end_time: "11:00:00",
    description: "An easy stroll across the meadow looking for wildflowers.",
  });
  // Differing ends: stays split even though the venue and start agree.
  assert.equal(isSameEvent(southGrove, meadowWalk), false);

  // A NULL end on either side is NOT a match — two rows that both omit the end
  // share no information, and treating NULL as equal re-admits these pairs.
  const juniorRangers = ev({
    ...base,
    name: "Junior Rangers @ Big Trees State Park",
    end_time: null,
    description: "A hands-on badge program for kids ages 7 to 12.",
  });
  assert.equal(isSameEvent(southGrove, juniorRangers), false);
  assert.equal(isSameEvent(meadowWalk, juniorRangers), false);

  const alsoNoEnd = ev({
    ...base,
    name: "Campfire: Laugh then Learn @ Big Trees State Park",
    end_time: null,
    description: "An evening campfire program with songs and a short talk.",
  });
  assert.equal(isSameEvent(juniorRangers, alsoNoEnd), false);
});

test("an exact window does NOT merge across different venues", () => {
  // The window signal is gated on venue agreement like every other venue-based
  // signal, so two towns running a 17:00-20:00 event the same night stay split.
  const arnold = ev({
    name: "Summer Concert on the Green",
    date: "2026-08-15",
    town: "Arnold",
    venue_name: "Arnold Community Park",
    venue_key: "arnold-community-park",
    start_time: "17:00:00",
    end_time: "20:00:00",
    description: "An evening of music on the lawn.",
  });
  const murphys = ev({
    name: "Music in the Park",
    date: "2026-08-15",
    town: "Murphys",
    venue_name: "Murphys Community Park",
    venue_key: "murphys-community-park",
    start_time: "17:00:00",
    end_time: "20:00:00",
    description: "Bring a blanket and enjoy the band.",
  });
  assert.equal(isSameEvent(arnold, murphys), false);
});

test("an exact window is disqualified when the two rows name different acts", () => {
  // A venue can run two different shows in the same 19:00-21:00 slot. Rows that
  // each name an act and disagree on who is playing are asserting two different
  // shows — real evidence that outranks the matching window.
  const salsa = ev({
    name: "Salsa Night",
    date: "2026-07-10",
    venue_name: "Murphys Community Park",
    start_time: "19:00:00",
    end_time: "21:00:00",
    artists: ["Los Caminos"],
    description: "Salsa dancing",
  });
  const openMic = ev({
    name: "Open Mic",
    date: "2026-07-10",
    venue_name: "Murphys Community Park",
    start_time: "19:00:00",
    end_time: "21:00:00",
    artists: ["Jane Doe"],
    description: "Bring your own instrument",
  });
  assert.equal(isSameEvent(salsa, openMic), false);

  // One side naming an act while the other says nothing is NOT a disagreement,
  // so the window still carries the merge (the aggregator-vs-venue shape).
  const openMicNoActs = ev({ ...openMic, artists: null });
  assert.equal(isSameEvent(salsa, openMicNoActs), true);
});
