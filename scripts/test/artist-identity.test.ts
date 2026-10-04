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
import { extractActFromTitle, isSameEvent, mergeArtistLists, type EventIdentity } from "../../lib/event-identity.js";

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

// Review of PR #324, finding 1: every one of these returned an "act" in the
// first cut. Blank beats wrong: a fake act is a wrong chip, a wrong bio, and
// (via actNamedInOther) a possible false merge.
test("extractActFromTitle refuses events, statuses, amenities, genres and places", () => {
  const titles = [
    "Live Music - Happy Hour", "Live Music - Wine Tasting", "Live Music - Cancelled",
    "Live Music - Postponed", "Live Music - Sold Out", "Live Music - Private Event",
    "Live Music - Closed", "Live Music - Rescheduled", "Live Music - Members Only",
    "Live Music - Fundraiser", "Live Music - Benefit Concert", "Live Music - Halloween Party",
    "Live Music - 4th of July", "Live Music - Oktoberfest", "Live Music - Free",
    "Live Music - No Cover", "Live Music - All Ages", "Live Music - $10 Cover",
    "Live Music - Jazz", "Live Music - Acoustic", "Live Music - Classic Rock",
    "Live Music - Tribute Band", "Live Music - Cover Band", "Live Music - Duo",
    "Live Music - Special Guest", "Live Music - Local Band", "Live Music - Various Artists",
    "Live Music - Coming Soon", "Live Music - TBA Soon", "Live Music with Dinner",
    "Live Music w/ Food Truck", "Live Music with Sunset Views", "Live Music by the Pool",
    "Live Music by the Creek", "Live Music by the Fire Pit", "Live Music (Outdoors)",
    "Live Music (Weather Permitting)", "Live Music (Free)", "Music in the Park - Bring a Chair",
    "Music in the Square - Week 3", "Music in the Square - Season Finale",
    "Live Music - Bear Valley Lodge", "Live Music - Calaveras Big Trees State Park",
    "Live Music - Sonora", "Live Music - San Andreas", "Live Music: Jill Warren & Dinner Special",
    "Bagpipes Live Music @ Murphys Irish Pub", "CANCELLED Live Music @ Murphys Irish Pub",
    "Late Night Live Music @ Murphys Irish Pub",
    "Halloween Costume Contest Live Music @ Murphys Irish Pub",
  ];
  for (const t of titles) assert.equal(extractActFromTitle(t, "Somewhere"), null, t);
});

test("extractActFromTitle trims trailing setting, separators and dates off a real act", () => {
  assert.equal(extractActFromTitle("Live Music - Jill Warren on the Patio", "X"), "Jill Warren");
  assert.equal(extractActFromTitle("Live Music - Jill Warren | 6-9pm", "X"), "Jill Warren");
  assert.equal(extractActFromTitle("Live Music - Jill Warren 10/12", "X"), "Jill Warren");
  // Real acts carrying a soft word still pass on their name words.
  assert.equal(extractActFromTitle("Live Music - Bob Eisenman Jazz Band", "X"), "Bob Eisenman Jazz Band");
  assert.equal(extractActFromTitle("Live Music - Private Reserve Band", "X"), "Private Reserve Band");
  assert.equal(extractActFromTitle("Live Music with The Yacht Rockers", "X"), "The Yacht Rockers");
});

const row = (over: Partial<EventIdentity>): EventIdentity => ({
  name: "x",
  date: "2026-10-10",
  town: "Arnold",
  venue_name: "Sequoia Woods Country Club",
  venue_key: "sequoia-woods",
  start_time: "18:00",
  end_time: "21:00",
  description: null,
  artists: null,
  ...over,
});

test("a refused title cannot manufacture a merge (review finding 1)", () => {
  // Before the fix, "Live Music with Dinner" filled artists ["Dinner"], which
  // actNamedInOther then matched against "Thursday Night Dinner".
  const act = extractActFromTitle("Live Music with Dinner", "Sequoia Woods Country Club");
  assert.equal(act, null);
  assert.equal(
    isSameEvent(
      row({ name: "Live Music with Dinner", artists: act ? [act] : null, end_time: null }),
      row({ name: "Thursday Night Dinner", end_time: null })
    ),
    false
  );
});

test("variant spellings of one act do not trip the different-acts veto (review finding 2)", () => {
  const venue = { venue_name: "Copperopolis Town Square", venue_key: "copperopolis-town-square", town: "Copperopolis" };
  assert.equal(
    isSameEvent(
      row({ ...venue, name: "Music In The Square- Bad Jovi", artists: ["Bad Jovi"] }),
      row({ ...venue, name: "Saturday Night Music in Copper Valley Town Square", artists: ["Bad Jovi Band"] })
    ),
    true
  );
  // Two genuinely different acts in the same window still split.
  assert.equal(
    isSameEvent(
      row({ ...venue, name: "Music In The Square- Bad Jovi", artists: ["Bad Jovi"] }),
      row({ ...venue, name: "Music In The Square- Hired Gunn", artists: ["Hired Gunn"] })
    ),
    false
  );
});

test("tidyArtistList keeps names with no ASCII letters (review finding 4)", () => {
  assert.deepEqual(tidyArtistList(["東京事変", "Sigur Rós", "!!!"]), ["東京事変", "Sigur Rós", "!!!"]);
  assert.notEqual(artistIdentityKey("東京事変"), artistIdentityKey("!!!"));
});

test("a compound billing absorbs its listed parts, by design (review finding 5)", () => {
  // "Alison Krauss & Union Station" is one act, and a bare "Union Station" is
  // a famous name the researcher would get wrong. The cost is a true co-bill
  // listed three ways; none exists in the catalog (checked 2026-10-04).
  assert.deepEqual(
    tidyArtistList(["Jill Warren", "Greg Sutton", "Jill Warren & Greg Sutton"]),
    ["Jill Warren & Greg Sutton"]
  );
});

test("second review of #324: night/day, food, promo and activity heads are not acts", () => {
  const titles = [
    "Live Music - Taco Tuesday", "Live Music - Ladies Night", "Live Music - Date Night",
    "Live Music - Opening Night", "Live Music - Comedy Night", "Live Music - Wine Down Wednesday",
    "Live Music - Mimosa Sunday", "Live Music - Labor Day Weekend", "Live Music - Summer Nights",
    "Labor Day Live Music @ Murphys Irish Pub", "St. Patrick's Day Live Music @ Murphys Irish Pub",
    "Live Music - BBQ", "Live Music - Pizza", "Live Music - Wine Pairing",
    "Live Music - Hit Collective & Taco Bar", "Live Music - Kids Eat Free",
    "Live Music - Free Admission", "Live Music - Reservations Recommended",
    "Live Music - Cornhole Tournament", "Live Music - Sip & Paint", "Live Music - Magic Show",
    "Live Music - Friends", "Live Music - Local Talent", "Live Music - Local Musicians",
    "Irish Session Live Music @ Murphys Irish Pub", "Live Music - Pool Party",
    "Live Music - Thirsty Thursday",
  ];
  for (const t of titles) assert.equal(extractActFromTitle(t, "Somewhere"), null, t);
  // Real acts carrying those words mid-name still pass.
  assert.equal(extractActFromTitle("Live Music - Them Party Dolls", "X"), "Them Party Dolls");
  assert.equal(extractActFromTitle("Live Music - Blue Monday Band", "X"), "Blue Monday Band");
  assert.equal(extractActFromTitle("Live Music - Blue Monday", "X"), "Blue Monday");
  assert.equal(extractActFromTitle("Live Music - James Michael Day", "X"), "James Michael Day");
  assert.equal(extractActFromTitle("Live Music - Poor Man's Whiskey", "X"), "Poor Man's Whiskey");
  assert.equal(extractActFromTitle("Live Music - Scott Patrick", "X"), "Scott Patrick");
  // Act-before-"Live Music @" shape: real acts with event-ish words.
  for (const act of ["Kruel Summer", "Them Party Dolls", "Bay Area Special Bluegrass"]) {
    assert.equal(extractActFromTitle(`${act} Live Music @ Murphys Irish Pub`, "Murphys Irish Pub"), act);
  }
});

test("'Live Music - Taco Tuesday' cannot manufacture a merge with 'Taco Tuesday Trivia'", () => {
  const act = extractActFromTitle("Live Music - Taco Tuesday", "Sequoia Woods Country Club");
  assert.equal(act, null);
  assert.equal(
    isSameEvent(
      row({ name: "Live Music - Taco Tuesday", artists: null, end_time: null }),
      row({ name: "Taco Tuesday Trivia", end_time: null })
    ),
    false
  );
});
