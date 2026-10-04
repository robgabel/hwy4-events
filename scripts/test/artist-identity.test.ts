// Locks lib/artist-identity.ts and the title-to-act extractor in
// lib/event-identity.ts (artist coverage + accuracy, 2026-10-04).
//
// Every positive case is a live title or a live catalog pair from 2026-10-04;
// every negative is a title the extractor must refuse, asserted as hard as
// the positives, because a wrong act name feeds a wrong band bio.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { artistIdentityKey, isNonActName, tidyArtistList } from "../../lib/artist-identity.js";
import { extractActFromTitle, mergeArtistLists } from "../../lib/event-identity.js";

test("variants of one act share an identity key", () => {
  const same: [string, string][] = [
    ["Greg Sutton & Friends", "Greg Sutton and Friends"],
    ["Blue Monday", "Blue Monday Band"],
    ["The ElderBerries", "The Elder Berries"],
    ["Rod Harris", "Rod Harris and Friends"],
    ["Brian Jirka", "Brian Jirka Project"],
    ["Pub is Dead", "Pub is Dead (1)"],
    ["Earth Tones Trio & Band", "Earth Tones"],
    ["Chris Baron Duo", "Chris Baron"],
  ];
  for (const [a, b] of same) assert.equal(artistIdentityKey(a), artistIdentityKey(b), `${a} vs ${b}`);
});

test("different acts keep different keys (no fuzzy guessing)", () => {
  const different: [string, string][] = [
    ["Sipsy River Band", "Sipsey River Band"], // a typo no rule can tell from a second band
    ["Greg Sutton & Friends", "Gregory Sutton"], // nickname
    ["Tarantula Hawk", "Andy & Tarantula Hawk"],
    ["Hit Replay", "Hit Eject"],
    ["Alison Krauss", "Alison Krauss & Union Station"],
  ];
  for (const [a, b] of different) assert.notEqual(artistIdentityKey(a), artistIdentityKey(b), `${a} vs ${b}`);
  assert.ok(artistIdentityKey("The Band").length > 0, "a suffix-only name keeps a key");
});

test("isNonActName: karaoke hosts and theme nights are not acts", () => {
  for (const n of [
    "Karaoke with Kim",
    "KJ Johnny Rocksmith",
    "Throw Back Thursday “Jazz Edition “",
    "Open Mic Night",
    "Trivia",
    "TBA",
  ]) {
    assert.equal(isNonActName(n), true, n);
  }
  for (const n of ["Kim Carnes", "Blue Monday", "Hired Gunn", "Mercedeez", "Hwy 4 Blues"]) {
    assert.equal(isNonActName(n), false, n);
  }
});

test("tidyArtistList collapses variants and keeps a compound billing whole", () => {
  assert.deepEqual(tidyArtistList(["Pub is Dead", "Pub is Dead (1)"]), ["Pub is Dead"]);
  assert.deepEqual(
    tidyArtistList(["Alison Krauss", "Union Station", "Alison Krauss & Union Station"]),
    ["Alison Krauss & Union Station"]
  );
  assert.deepEqual(tidyArtistList(["Eva Grace", "Sipsy River Band"]), ["Eva Grace", "Sipsy River Band"]);
  assert.deepEqual(tidyArtistList(["  ", null, " Hired Gunn "]), ["Hired Gunn"]);
  assert.equal(tidyArtistList([]), null);
  assert.equal(tidyArtistList(null), null);
});

test("mergeArtistLists collapses the same act from two sources", () => {
  assert.deepEqual(
    mergeArtistLists(
      { name: "Greg Sutton & Friends", artists: ["Greg Sutton & Friends"] },
      { name: "Greg Sutton and Friends", artists: ["Greg Sutton and Friends"] }
    ),
    ["Greg Sutton & Friends"]
  );
});

test("extractActFromTitle reads the act from the corridor's real title shapes", () => {
  const cases: [string, string | null, string][] = [
    ["Live Music - Carlos Castillo", "Sequoia Woods Country Club", "Carlos Castillo"],
    ["Live Music with Lost in the Shuffle", "Somewhere", "Lost in the Shuffle"],
    ["Live Music @ The Lube Room: Breakaway", "The Lube Room Saloon", "Breakaway"],
    ["Music In The Square- Hired Gunn", "Copperopolis Town Square", "Hired Gunn"],
    ["Live Music – Beer Garden Concert Series – Dirty Cello", "Murphys Wine & Beer Garden", "Dirty Cello"],
    ["Live Music - Greg Sutton & Friends 6-9pm", "Bistro Espresso", "Greg Sutton & Friends"],
    ["Live Music - Kip Allert - 7pm", "Murphys Wine & Beer Garden", "Kip Allert"],
    ["Halloween Party (LIVE MUSIC - SEQUOIA BLUE)", "Sequoia Woods Country Club", "Sequoia Blue"],
    ['Rib Feed and Live Band "Blue Monday"', "Ebbetts Pass Moose Lodge", "Blue Monday"],
    ["Patio Party #4 featuring live music - The Hit Men", "Sequoia Woods Country Club", "The Hit Men"],
    ["Patio Party #4 featuring live music by Flashback", "Sequoia Woods Country Club", "Flashback"],
    ["Ali & Heidi Crooks Live Music @ Murphys Irish Pub", "Murphys Irish Pub", "Ali & Heidi Crooks"],
    ["Blue Monday Band Live Music @ Murphys Irish Pub", "Murphys Irish Pub", "Blue Monday Band"],
  ];
  for (const [title, venue, act] of cases) {
    assert.equal(extractActFromTitle(title, venue), act, title);
  }
});

test("extractActFromTitle refuses placeholders, places, events and ambiguity", () => {
  const refused: [string, string | null][] = [
    ["Live Music @ Stevenot Winery", "Stevenot Winery"],
    ["Live Music - Stevenot Winery", "Stevenot Winery"],
    ["Live Music - Friday Night", "Somewhere"],
    ["Live Music (TBD)", "Somewhere"],
    ["Live Music Upstairs", "Boyle MacDonald Wines"],
    ["Live Music @ Sierra Nevada Adventure Company (Arnold)", "Sierra Nevada Adventure Company"],
    ["Patio Party #4 featuring live music (TBD)", "Sequoia Woods Country Club"],
    ["Wine Tasting with Live Music by the Pool", "Somewhere"],
    ["Live Music @ The Beer Gardens at Camp Connell", "Unknown Venue"],
    ["Friday Night Live Music @ The Pub", "The Pub"],
    ["Vintage Car Show, Hatcher Wine & Live Music", "The Golf Club at Copper Valley"],
    ["Murphys Wine Bar & Beer Garden Concert Series", "Murphys Wine & Beer Garden"],
    ["Music in the Parks Summer Concert Series", "Copperopolis Town Square"],
    ["Thursday Summer Concert Series @ The Watering Hole", "The Watering Hole"],
    ["Karaoke - Taylor Made", "Sequoia Woods Country Club"],
    ["Karaoke at The Murphys Irish Pub", "Murphys Irish Pub"],
    ["Line Dancing with Mercedeez @ Miner’s Lounge", "The Miners Lounge"],
    ["Open Mic @ Val du Vino Music Barn", "Val Du Vino Winery"],
    ["Live After Five Thursdays- Downtown Angels Camp", "Historic Downtown Angels Camp"],
    // Two acts or an act plus a venue after the dash: ambiguous, so nothing.
    ["Live Music - Greg Sutton - Bistro Espresso Patio", "Bistro Espresso"],
    ["", null],
  ];
  for (const [title, venue] of refused) {
    assert.equal(extractActFromTitle(title, venue), null, title);
  }
});
