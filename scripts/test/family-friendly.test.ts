// Regression lock for the read-time family-friendly tag (lib/family-friendly.ts).
//
// Two things are load-bearing: the promote case (Jen's Kids chip must surface
// events that advertise kids/families while keeping their real category) and
// the age-gate exclude (a "kids welcome" mention must never promote a 21+ /
// age-gated event). Bare "family"/"kids" tokens are not a signal.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFamilyFriendly,
  matchesKidsFilter,
} from "../../lib/family-friendly.js";
import type { EventCategory } from "../../lib/types.js";

function event(
  name: string,
  description: string | null,
  category: EventCategory = "live_music"
) {
  return { name, description, category };
}

test("promote: explicit kids-welcome / family-friendly language, category intact", () => {
  const cameo = event(
    "Cameo Plaza Summer Concert: Flashback",
    "Free outdoor concert at Cameo Plaza featuring Flashback. Bring lawn chairs and snacks. Dogs and kids welcome.",
    "live_music"
  );
  assert.equal(cameo.category, "live_music");
  assert.ok(isFamilyFriendly(cameo));
  assert.ok(matchesKidsFilter(cameo));

  const hermitfest = event(
    "Hermitfest West – Music Festival",
    "Held on the first weekend after Labor Day in Bear Valley, this family-friendly event has multiple live music performances as well as art and food vendors.",
    "live_music"
  );
  assert.ok(isFamilyFriendly(hermitfest));
  assert.ok(matchesKidsFilter(hermitfest));

  const oktoberfest = event(
    "Oktoberfest @ Murphys Creek Park",
    "Hosted by the Murphys Community Club, this annual event features local craft beer, bratwurst, live music, and family-friendly activities.",
    "live_music"
  );
  assert.ok(isFamilyFriendly(oktoberfest));

  const grapeStomp = event(
    "Grape Stomp and Gold Rush Street Faire",
    "This community event has become an annual tradition for families and friends to gather for a weekend of wine fun.",
    "wine"
  );
  assert.equal(grapeStomp.category, "wine");
  assert.ok(isFamilyFriendly(grapeStomp));
  assert.ok(matchesKidsFilter(grapeStomp));

  const band = event(
    "Calaveras Community Band Labor Day Concert",
    "Bring your friends and family to the Murphys Park to enjoy free, live music.",
    "live_music"
  );
  assert.ok(isFamilyFriendly(band));

  const allAges = event(
    "Hermitfest West 2026 featuring The Highlife Band",
    "On Saturday, September 12th, The Highlife Band will be headlining this amazing festival in Bear Valley, CA. 4pm, free, all ages.",
    "festival"
  );
  assert.ok(isFamilyFriendly(allAges));
});

test("promote: kids-under pricing is a family signal, even when adults can buy drinks", () => {
  // Native Sons pancake breakfast: kids priced in, bloody marys for 21+.
  // "21 and over" here is a drink menu, not an admission gate.
  const pancakes = event(
    "Native Sons 3rd Sunday Pancake Breakfast",
    "$12 Cash Only Adults, $5 Kids under 12. Breakfast open From 7:30 – 11:30 AM. For those 21 and over, we will be offering bloody mary's ($9) and mimosas ($6).",
    "civic"
  );
  assert.ok(isFamilyFriendly(pancakes));
  assert.ok(matchesKidsFilter(pancakes));
  assert.equal(pancakes.category, "civic");
});

test("exclude: kids-welcome must not promote a 21+ / age-gated event", () => {
  assert.ok(
    !isFamilyFriendly(
      event(
        "Wine tasting on the patio",
        "Kids welcome on the lawn. Must be 21 to attend the tasting.",
        "wine"
      )
    )
  );
  assert.ok(
    !isFamilyFriendly(
      event(
        "Late Night at the Saloon",
        "Live music, kids welcome before 8. 21+ after that, no minors.",
        "live_music"
      )
    )
  );
  assert.ok(
    !matchesKidsFilter(
      event(
        "Barrel tasting",
        "Family-friendly grounds, 21+ only to enter the cellar.",
        "wine"
      )
    )
  );
  assert.ok(
    !isFamilyFriendly(
      event("Bar show", "Kids welcome. 21+ event.", "live_music")
    )
  );
  assert.ok(
    !isFamilyFriendly(
      event(
        "Private blending night",
        "A fun night out. Adults only, no kids please.",
        "wine"
      )
    )
  );
  assert.ok(
    !isFamilyFriendly(
      event(
        "Wine Blending Night",
        "Kids welcome to watch. This is a 21 and over event.",
        "wine"
      )
    )
  );
});

test("exclude: bare family/kids tokens are not a signal (never-guess)", () => {
  assert.ok(
    !isFamilyFriendly(
      event("Willie Nelson & Family", "Willie Nelson & Family play Ironstone.", "live_music")
    )
  );
  assert.ok(
    !isFamilyFriendly(
      event(
        "Calaveras on the Green",
        "A fun day that supports the Calaveras Crisis Center and Children's Advocacy Center.",
        "live_music"
      )
    )
  );
  assert.ok(
    !isFamilyFriendly(
      event(
        "Live Like Lilly Fundraising Dinner",
        "This memorable night will bring friends, family and supporters together for dinner, dancing, and fundraising. GUN RAFFLE and DANCING!",
        "civic"
      )
    )
  );
  assert.ok(
    !isFamilyFriendly(
      event(
        "Wine-Down Wednesdays",
        "Every Wednesday from 11 AM–5 PM, a casual tasting experience filled with stories, tips, and delicious discoveries.",
        "wine"
      )
    )
  );
  assert.ok(
    !isFamilyFriendly(event("Family-owned winery open house", null, "wine"))
  );
});

test("Kids filter: category=kids always matches; others need the tag", () => {
  const storytime = event("Storytime with Miss Debbie", null, "kids");
  assert.ok(matchesKidsFilter(storytime));
  assert.ok(!isFamilyFriendly(storytime)); // no hospitality phrase, but category already kids

  const jamboree = event("29th Annual Logging Jamboree", "A day in the woods.", "kids");
  assert.ok(matchesKidsFilter(jamboree));

  const concert = event("Patio jazz", "An evening set on the patio.", "live_music");
  assert.ok(!matchesKidsFilter(concert));
  assert.ok(!isFamilyFriendly(concert));
});
