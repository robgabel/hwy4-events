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
  type EventIdentity,
} from "../../lib/event-identity.js";

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
    // Guard: both end times known but disagree = treat as different slots.
    label: "same act/venue/start, both ends known but differ — NOT same",
    a: ev({ name: "The Star Dogs", venue_name: "Murphys Community Park", start_time: "19:00:00", end_time: "21:00:00", artists: ["The Star Dogs"] }),
    b: ev({ name: "The Star Dogs", venue_name: "Murphys Community Park", start_time: "19:00:00", end_time: "23:00:00", artists: ["The Star Dogs"] }),
    same: false,
  },
  {
    // Sanity: a byte-identical re-scrape is obviously the same event.
    label: "identical rows — same",
    a: ev({ name: "Trivia Night", venue_name: "Murphys Irish Pub", artists: ["Quizmaster"] }),
    b: ev({ name: "Trivia Night", venue_name: "Murphys Irish Pub", artists: ["Quizmaster"] }),
    same: true,
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
