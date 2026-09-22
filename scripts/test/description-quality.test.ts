// Regression lock for the description quality gate (lib/description-quality.ts).
//
// Fixtures are the real failures from the June 9 2026 AI-detection audit:
// calendar-widget junk (Native Sons / Coffee & Cars), a colon-terminated stub
// (Bingo), an LLM title-restatement (archery), and a legit long-ish description
// that must PASS (Forest School). Plus the meta-truncation "for purc" tell.
//
// Run: `cd scripts && npm test`  (tsx --test, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeDescription,
  sanitizeDescriptionDetailed,
  assessDescription,
  displayDescription,
  truncateMeta,
} from "../../lib/description-quality.js";

// --- Real calendar-widget junk (EventON) -----------------------------------
const NATIVE_SONS = `@



Please join us on the 3rd Sunday of the month for a fantastic all you can eat pancake breakfast. Breakfast includes pancakes, scrambled eggs, sausage, biscuits with sausage gravy, OJ, coffee, or hot chocolate.

$12 Cash Only Adults, $5 Kids under 12. Breakfast open From 7:30 - 11:30 AM.

389 Main Street, Murphys


 Add to calendar

 Google Calendar
 iCalendar
 Outlook 365
 Outlook Live

 Details

 Date:

 Time:`;

test("sanitize: strips calendar-widget chrome but keeps the real prose", () => {
  const out = sanitizeDescription(NATIVE_SONS);
  // Real content survives.
  assert.match(out, /pancake breakfast/);
  assert.match(out, /\$12 Cash Only Adults/);
  // Widget chrome is gone.
  for (const junk of [
    "Add to calendar",
    "Google Calendar",
    "iCalendar",
    "Outlook 365",
    "Outlook Live",
    "Date:",
    "Time:",
  ]) {
    assert.ok(!out.includes(junk), `should strip "${junk}"`);
  }
  // Leading orphan "@" line is gone; no 3+ blank-line runs remain.
  assert.ok(!out.startsWith("@"));
  assert.ok(!/\n{3,}/.test(out));
});

test("sanitize: heavily-stripped junk row still renders (content is good)", () => {
  const { strippedRatio } = sanitizeDescriptionDetailed(NATIVE_SONS);
  assert.ok(strippedRatio > 0.3, "widget rows trip the >30% stripped signal");
  // But the cleaned remainder is good, so we show it, not suppress it.
  assert.notEqual(
    displayDescription({
      description: NATIVE_SONS,
      name: "Native Sons 3rd Sunday Pancake Breakfast",
      venue_name: "Native Sons Hall",
      town: "Murphys",
    }),
    null,
  );
});

test("sanitize: empty/undefined is safe", () => {
  assert.equal(sanitizeDescription(null), "");
  assert.equal(sanitizeDescription(undefined), "");
  assert.equal(sanitizeDescription("   \n  \n"), "");
});

// --- Raw HTML / entity bleed (page-builder markup, any source) -------------
test("sanitize: strips raw HTML tags but keeps the text", () => {
  const out = sanitizeDescription(
    "<p>Live music on the <strong>patio</strong> tonight, <a href='https://x.com'>details here</a>.</p>",
  );
  assert.ok(!/[<>]/.test(out), "no angle brackets remain");
  assert.match(out, /Live music on the patio tonight, details here\./);
});

test("sanitize: decodes common entities (named + numeric)", () => {
  const out = sanitizeDescription("Coffee &amp; Cars &#8212; Saturday at 9&nbsp;AM");
  assert.match(out, /Coffee & Cars/);
  assert.ok(!out.includes("&amp;"));
  assert.ok(!out.includes("&nbsp;"));
});

test("sanitize: drops <script>/<style> blocks wholesale", () => {
  const out = sanitizeDescription(
    "<style>.x{color:red}</style>Family fun day at the park.<script>alert(1)</script>",
  );
  assert.ok(!out.includes("alert"));
  assert.ok(!out.includes("color:red"));
  assert.match(out, /Family fun day at the park\./);
});

test("sanitize: conservative — math/emoticons survive (tag must open with a letter)", () => {
  assert.equal(sanitizeDescription("groups < 10 welcome <3"), "groups < 10 welcome <3");
});

// --- Suppress cases ---------------------------------------------------------
test("suppress: colon-terminated boilerplate (Bingo)", () => {
  const text =
    "Bingo Night is back at the Murphys Pourhouse and we have a packed calendar coming together for everyone. Consider this your early heads-up on some of our 2026 events:";
  const a = assessDescription(text, "Bingo Night at Murphys Pourhouse", "Murphys Pourhouse");
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.includes("ends_with_colon"));
});

test("suppress: LLM title-restatement that only adds a date (archery)", () => {
  const text =
    "An archery shooting event held at Bear Valley Mountain Resort. The event runs June 13-14, 2026.";
  const a = assessDescription(text, "High Sierra Archery", "Bear Valley Mountain Resort", {
    town: "Bear Valley",
  });
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.includes("title_restatement"));
  assert.equal(
    displayDescription({
      description: text,
      name: "High Sierra Archery",
      venue_name: "Bear Valley Mountain Resort",
      town: "Bear Valley",
    }),
    null,
  );
});

test("suppress: under 15 words", () => {
  const a = assessDescription("Bingo. Doors open 5:30pm", "Bingo", "Ebbetts Pass Moose Lodge");
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.some((r) => r.startsWith("too_short")));
});

test("suppress: pure exclamatory hype, nothing concrete", () => {
  const text =
    "You really have to come out and join us for the best time ever, it is going to be amazing and so much fun for everyone who shows up!";
  const a = assessDescription(text, "Summer Bash", "The Lot");
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.includes("generic_hype"));
});

test("suppress: no terminal punctuation (looks truncated)", () => {
  const a = assessDescription(
    "Join us downtown this weekend for a full slate of music and food and family activities all day long",
    "Street Fair",
    "Main Street",
  );
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.includes("no_terminal_punctuation"));
});

// --- Pass cases -------------------------------------------------------------
const FOREST_SCHOOL =
  "It's that time of year again! Forest School Adventure Camp is running at White Pines this summer under a new brand name, Sugar Pine! As always, children are invited to do more than just crafts or typical summer camp activities. They're invited to wonder, explore, experiment, create, and connect with the natural world in meaningful ways. Our STEAM-powered arts and crafts classes and nature-based camps blend science, art, engineering, storytelling, and outdoor exploration into hands-on experiences designed to spark curiosity and creativity. Whether campers are examining dragonflies at the lake, watercoloring wildflowers, building flight challenges inspired by birds, or exploring forest trails, children are encouraged to slow down, ask questions, and learn through discovery and play.";

test("pass: legit organizer description (Forest School) renders", () => {
  const a = assessDescription(FOREST_SCHOOL, "Forest School Adventure Camp", "White Pines Community Park");
  assert.equal(a.verdict, "pass");
  assert.equal(
    displayDescription({
      description: FOREST_SCHOOL,
      name: "Forest School Adventure Camp",
      venue_name: "White Pines Community Park",
      town: "Arnold",
    }),
    FOREST_SCHOOL,
  );
});

test("pass: short-but-specific description with logistics", () => {
  const text =
    "Newsome Harlow pours its new releases on the patio Saturday afternoon with the Gilpin Trio playing bluegrass from 2pm. Bring a picnic; kids and dogs welcome.";
  assert.equal(assessDescription(text, "Patio Pour", "Newsome Harlow").verdict, "pass");
});

// ---------------------------------------------------------------------------
// HWY-46: short factual content must render.
//
// The 15-word cliff plus "no terminal punctuation" and "generic hype" were
// hiding lineups, prices, and activity lists. Concrete value (a price, a
// comma-separated list, or a real name — including one that is also in the
// title) moves these from suppress to pass. Empty, a trailing colon, and the
// date-only archery stub stay suppressed (those tests above).
// ---------------------------------------------------------------------------

const HWY46_EVIDENCE: { name: string; venue: string; town: string; description: string }[] = [
  {
    name: "Storytime with Miss Debbie",
    venue: "Arnold Library",
    town: "Arnold",
    description: "Come sing songs, dance and listen to stories every week with Miss Debbie!",
  },
  {
    name: "Tribute Fest",
    venue: "Ironstone Amphitheater",
    town: "Murphys",
    description: "Piano Man (Elton John and Billy Joel), Australian Bee Gees, Fleetwood Mask",
  },
  {
    name: "Dinner and Karaoke",
    venue: "Ebbetts Pass Moose Lodge",
    town: "Arnold",
    description: "Chicken fried Steak dinner, Karaoke at 6:30pm, $18",
  },
  {
    name: "Copperopolis Summer Concert Series",
    venue: "Copperopolis Coppertown Square",
    town: "Copperopolis",
    description: "Bon Jovi Tribute",
  },
  {
    name: "Fall Event",
    venue: "Lodge Lake",
    town: "Arnold",
    description:
      "A fall festival featuring carnival games, buffet, and music. Includes a Volunteer Appreciation Dinner.",
  },
  {
    name: "Live Music @ Stevenot Winery",
    venue: "Stevenot Winery",
    town: "Murphys",
    description: "Stevenot Winery Presents:Jill Warren – FREE Live Music",
  },
  {
    name: "1st Annual Live Like Lilly Dinner and Dance",
    venue: "Calaveras County Fair & Jumping Frog Jubilee",
    town: "Angels Camp",
    description: "Dinner, Dancing, Silent Auction, Raffle Prizea and amazing food!! More details to come!",
  },
  {
    name: "Oktoberfest Dinner",
    venue: "Ebbetts Pass Moose Lodge",
    town: "Arnold",
    description: "Oktoberfest dinner at the Ebbetts Pass Moose Lodge.",
  },
  {
    name: "EskiCup 2026",
    venue: "The Golf Club at Copper Valley",
    town: "Copperopolis",
    description: "Only for EskiCup participants",
  },
  {
    name: "Stevenot Winery Halloween Party",
    venue: "Stevenot Winery",
    town: "Murphys",
    description: "Join us for a Halloween Party at Stevenot Winery!",
  },
  // Stored text drifted after the 2026-09-19 snapshot. Same events, same gate.
  {
    name: "Dinner and Karaoke",
    venue: "Ebbetts Pass Moose Lodge",
    town: "Arnold",
    description: "Dinner at 6pm, karaoke at 6:30pm. Chicken fried steak dinner $18",
  },
  {
    name: "Oktoberfest Dinner",
    venue: "Ebbetts Pass Moose Lodge",
    town: "Arnold",
    description: "Oktoberfest dinner at the Ebbetts Pass Moose Lodge on October 3.",
  },
];

test("pass: HWY-46 evidence set renders (verdict is not suppress)", () => {
  for (const row of HWY46_EVIDENCE) {
    const a = assessDescription(row.description, row.name, row.venue, { town: row.town });
    assert.notEqual(a.verdict, "suppress", `${row.name} [${a.reasons.join(", ")}]`);
    assert.equal(
      displayDescription({
        description: row.description,
        name: row.name,
        venue_name: row.venue,
        town: row.town,
      }),
      row.description,
      row.name,
    );
  }
});

test("pass: lineup with no terminal punctuation", () => {
  const text = "Piano Man (Elton John and Billy Joel), Australian Bee Gees, Fleetwood Mask";
  const a = assessDescription(text, "Tribute Fest", "Ironstone Amphitheater", { town: "Murphys" });
  assert.equal(a.verdict, "pass");
  assert.ok(!a.reasons.includes("no_terminal_punctuation"));
  assert.equal(
    displayDescription({
      description: text,
      name: "Tribute Fest",
      venue_name: "Ironstone Amphitheater",
      town: "Murphys",
    }),
    text,
  );
});

test("pass: price and time fragment", () => {
  const text = "Chicken fried Steak dinner, Karaoke at 6:30pm, $18";
  const a = assessDescription(text, "Dinner and Karaoke", "Ebbetts Pass Moose Lodge", {
    town: "Arnold",
  });
  assert.equal(a.verdict, "pass");
  assert.ok(!a.reasons.some((r) => r.startsWith("too_short")));
});

test("pass: short sentence whose only proper noun is also in the title", () => {
  const text = "Come sing songs, dance and listen to stories every week with Miss Debbie!";
  const a = assessDescription(text, "Storytime with Miss Debbie", "Arnold Library", {
    town: "Arnold",
  });
  assert.equal(a.verdict, "pass");
  assert.ok(!a.reasons.includes("generic_hype"));
  assert.ok(!a.reasons.some((r) => r.startsWith("too_short")));
});

test("suppress: a short generic sentence is not rescued by its opening capital", () => {
  // "Get" is capitalized only because it starts the sentence. It is not in the
  // title, and the town square is already on the card. Length still hides it.
  const text = "Get your costumes ready for a fun evening in the Town Square.";
  const a = assessDescription(text, "Trick or Treat in the Town Square", "Copperopolis Town Square", {
    town: "Copperopolis",
  });
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.some((r) => r.startsWith("too_short")));
});

test("suppress: a trailing colon still wins over a concrete list", () => {
  const text = "Carnival games, buffet, and live music:";
  const a = assessDescription(text, "Fall Event", "Lodge Lake", { town: "Arnold" });
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.includes("ends_with_colon"));
});

test("rewrite: over-long but usable still renders (not suppressed)", () => {
  const text =
    "The Calaveras County Fair returns to Frogtown with four days of rodeo, carnival rides, livestock shows, and live music on three stages. ".repeat(
      10,
    );
  const a = assessDescription(text.trim(), "Calaveras County Fair", "Frogtown");
  assert.equal(a.verdict, "rewrite");
  assert.ok(a.reasons.some((r) => r.startsWith("too_long")));
  assert.notEqual(
    displayDescription({ description: text, name: "Calaveras County Fair", venue_name: "Frogtown" }),
    null,
  );
});

// --- Meta truncation --------------------------------------------------------
test("truncateMeta: short text is returned unchanged", () => {
  assert.equal(truncateMeta("Live music on the patio tonight."), "Live music on the patio tonight.");
});

test("truncateMeta: prefers a full sentence boundary", () => {
  const input =
    "Tickets for the summer concert series go on sale this Friday at noon sharp. Each show includes two opening acts and a headliner plus food trucks in the lot.";
  const out = truncateMeta(input);
  assert.ok(out.length <= 155);
  assert.ok(out.endsWith("."));
  assert.equal(out, "Tickets for the summer concert series go on sale this Friday at noon sharp.");
});

test("truncateMeta: never ends mid-word (kills the 'for purc' tell)", () => {
  const input =
    "Tickets are available now for purchase at the door or online through our website and we strongly recommend buying yours early because this popular community event sells out fast.";
  const out = truncateMeta(input);
  assert.ok(out.length <= 156);
  assert.ok(out.endsWith("…"));
  const stem = out.slice(0, -1);
  assert.ok(input.startsWith(stem), "truncation is an exact prefix of the source");
  // The character right after the kept stem is a space => we cut on a word boundary.
  assert.equal(input[stem.length], " ");
  assert.ok(!out.includes("purc "), "did not cut mid-word into 'purc'");
});

// ---------------------------------------------------------------------------
// HWY-11: reseller-copy scrub.
//
// Fixtures are verbatim live rows. The two Ironstone descriptions were
// hand-cleaned once already (July 16) and came straight back on the next
// scrape, which is why the fix lives in the shared sanitizer.
// ---------------------------------------------------------------------------

const kaneBrown =
  "Welcome to an unforgettable night with Kane Brown at Ironstone Amphitheatre " +
  "At Ironstone Vineyards in Murphys, a local favorite for live entertainment " +
  "and summer singalongs. **Kane Brown California** fans know this is the kind " +
  "of show that turns a simple evening out into a full-on memory.";

const geneSimmons =
  "Welcome to a night of rock in Murphys as the Gene Simmons Band storms the " +
  "stage at Ironstone Amphitheatre At Ironstone Vineyards-one of the area's " +
  "go-to spots for live entertainment. This is **Gene Simmons - Murphys " +
  "Murphys**, and locals know it's the kind of show you talk about.";

test("strips markdown emphasis artifacts from scraped prose", () => {
  const out = sanitizeDescription(kaneBrown, { town: "Murphys" });
  assert.ok(!out.includes("**"), out);
  assert.ok(out.includes("Kane Brown California fans know"), out);
});

test("removes the fake-local venue appositive", () => {
  const out = sanitizeDescription(kaneBrown, { town: "Murphys" });
  assert.ok(!/local favorite/i.test(out), out);
  // The sentence still terminates cleanly at the venue.
  assert.ok(out.includes("At Ironstone Vineyards in Murphys."), out);
});

test("removes a dash-delimited go-to-spot appositive too", () => {
  const out = sanitizeDescription(geneSimmons, { town: "Murphys" });
  assert.ok(!/go-to spot/i.test(out), out);
  assert.ok(out.includes("At Ironstone Vineyards."), out);
});

test("collapses a doubled town name", () => {
  const out = sanitizeDescription(geneSimmons, { town: "Murphys" });
  assert.ok(!/Murphys Murphys/i.test(out), out);
  assert.ok(out.includes("This is Gene Simmons - Murphys,"), out);
});

test("the doubled-name collapse is scoped to the event's own town", () => {
  // Reduplicated place names are real, and this is wine country. Without a
  // matching town, nothing is collapsed.
  const text = "Pouring a flight of Walla Walla reds on the patio all afternoon.";
  assert.equal(sanitizeDescription(text, { town: "Murphys" }), text);
  assert.equal(sanitizeDescription(text), text);
});

// --- Ticket links ----------------------------------------------------------

test("strips a link to a known ticket-resale site", () => {
  const { text, removedResaleLinks } = sanitizeDescriptionDetailed(
    "Doors at 6, show at 7 under the oaks. Tickets at https://regtixs.com/e/12345 " +
      "or from the winery directly.",
  );
  assert.deepEqual(removedResaleLinks, ["https://regtixs.com/e/12345"]);
  assert.ok(!text.includes("regtixs"), text);
});

test("legitimate organizer and ticket links survive untouched", () => {
  // Every URL currently living in an upcoming description. An allowlist-shaped
  // gate would have deleted all of these.
  for (const url of [
    "https://www.murphyscreektheatre.org/spirit-song",
    "http://www.angelsmurphysrotary.org",
    "https://events.ticketleap.com/tickets/cstarskids/oz",
    "https://onecau.se/rotaryshrimpfeed",
  ]) {
    const text = `Full details and tickets are available at ${url} for this one.`;
    const out = sanitizeDescriptionDetailed(text);
    assert.equal(out.removedResaleLinks.length, 0, url);
    assert.ok(out.text.includes(url), `${url} was stripped: ${out.text}`);
  }
});

// --- What must NOT be touched ---------------------------------------------

test("organizer copy that merely uses the word 'favorite' survives", () => {
  // Three live rows that a naive phrase match would have mangled. None of them
  // is an appositive claiming local standing for a venue.
  const farmersMarket =
    "Join us for another wonderful season of shopping your favorite local " +
    "vendors, eating delicious food, and listening to live music by the creek " +
    "at beautiful Murphys Community Park. 9:00am - 1:00pm.";
  assert.equal(sanitizeDescription(farmersMarket, { town: "Murphys" }), farmersMarket);

  const rotary =
    "The Drinks: A full bar will feature local wines and specialty cocktails. " +
    "Live Music: Local favorites The Fabulous Off Brothers will provide the " +
    "live soundtrack for the evening.";
  assert.equal(sanitizeDescription(rotary, { town: "Murphys" }), rotary);

  const craftFair =
    "It's one of our favorite events of the year, and we can't wait to welcome " +
    "everyone back!";
  assert.equal(sanitizeDescription(craftFair, { town: "Angels Camp" }), craftFair);
});

test("a lone asterisk is not treated as markdown", () => {
  const text = "Adults $20, kids under 12 free* (*with a paying adult, all day).";
  assert.equal(sanitizeDescription(text), text);
});

test("the scrub is idempotent", () => {
  const once = sanitizeDescription(kaneBrown, { town: "Murphys" });
  assert.equal(sanitizeDescription(once, { town: "Murphys" }), once);
});
