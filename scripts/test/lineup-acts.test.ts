// HWY-59: a weekly lineup poster (or a source subtitle) names the act.
// The calendar title stays "Live Music". Discovery appends the act onto the
// row that already exists for that date. A later generic scrape must not
// revert the named title, and the old live-music slug must still resolve to
// that row rather than another same-day "Live Music @ …" listing.
//
// The JPEG is the Murphys Irish Pub "This Week's Live Music" poster
// (gocalaveras.com/.../mip-1-1.jpg). The test transcribes it; it does not
// call the model and it does not write the database.
//
// dedup.ts throws at import unless the service-role env is set. Dummy values,
// then a dynamic import, same as null-guard.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDedupKey } from "../../lib/event-identity.js";
import { pickFallbackEvent } from "../../lib/events.js";
import { generateEventSlug } from "../../lib/slugs.js";
import {
  actFromSubtitle,
  applyDiscoveredActs,
  applyLineupReading,
  displayActName,
  lineupPosterPrompt,
  titleWithNamedAct,
  type LineupEvent,
} from "../../lib/lineup-acts.js";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

async function loadDedup() {
  return import("../lib/dedup.js");
}

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/mip-weekly-live-music.jpg"
);
const FIXTURE_SHA = "090be6e40e881739ba910406e5a7cbd1b74706e9ef57d96e760fc9ae0cd9e327";
const POSTER = "https://www.gocalaveras.com/wp-content/uploads/2026/09/mip-1-1.jpg";
const OPEN_MIC_IMAGE = "https://www.gocalaveras.com/wp-content/uploads/open-mic.avif";
const VENUE = "Murphys Irish Pub";
const TOWN = "Murphys";
const VENUE_KEY = "murphys-irish-pub";

const POSTER_NIGHTS = [
  { date: "2026-09-30", act: null, open_mic: true },
  { date: "2026-10-01", act: "Ali & Heidi Crooks", open_mic: false },
  { date: "2026-10-02", act: "Plan B", open_mic: false },
  { date: "2026-10-03", act: "Blue Monday Band", open_mic: false },
  { date: "2026-10-04", act: "Kiana Chanelle", open_mic: false },
];

function night(
  date: string,
  name: string,
  image: string,
  times: { start_time: string; end_time: string }
): LineupEvent & { start_time: string; end_time: string } {
  return {
    name,
    date,
    venue_name: VENUE,
    town: TOWN,
    artists: null,
    image_url: image,
    source_subtitle: null,
    start_time: times.start_time,
    end_time: times.end_time,
  };
}

test("the poster fixture is the Murphys Irish Pub weekly JPEG", () => {
  const bytes = readFileSync(FIXTURE);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), FIXTURE_SHA);
  assert.ok(bytes.length > 10_000);
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
  assert.equal(bytes[2], 0xff);
});

test("displayActName title-cases a shouted poster and leaves mixed case alone", () => {
  assert.equal(displayActName("PLAN B"), "Plan B");
  assert.equal(displayActName("ALI & HEIDI CROOKS"), "Ali & Heidi Crooks");
  assert.equal(displayActName("KIANA CHANELLE"), "Kiana Chanelle");
  assert.equal(displayActName("DJ SHADOW"), "DJ Shadow");
  assert.equal(displayActName("Blue Monday Band"), "Blue Monday Band");
});

test("a subtitle is an act only when it names a performer", () => {
  assert.equal(actFromSubtitle("Featuring Ali & Heidi Crooks", VENUE, TOWN), "Ali & Heidi Crooks");
  assert.equal(actFromSubtitle("Hosted by KJ Johnny Rocksmith", VENUE, TOWN), "KJ Johnny Rocksmith");
  assert.equal(actFromSubtitle("with Plan B", VENUE, TOWN), "Plan B");
  assert.equal(actFromSubtitle("Open Mic Night", VENUE, TOWN), null);
  assert.equal(actFromSubtitle("Featuring Live Music", VENUE, TOWN), null);
  assert.equal(actFromSubtitle(VENUE, VENUE, TOWN), null);
  assert.equal(actFromSubtitle("Ali & Heidi Crooks. Doors at 6.", VENUE, TOWN), null);
  assert.equal(actFromSubtitle("", VENUE, TOWN), null);
  assert.equal(actFromSubtitle("   ", VENUE, TOWN), null);
});

test("the public title keeps Live Music and the venue", () => {
  assert.equal(
    titleWithNamedAct("Kiana Chanelle", "Live Music @ Murphys Irish Pub", VENUE, TOWN),
    "Kiana Chanelle Live Music @ Murphys Irish Pub"
  );
  assert.equal(
    titleWithNamedAct("Kiana Chanelle", "Live Music", VENUE, TOWN),
    "Kiana Chanelle Live Music @ Murphys Irish Pub"
  );
  assert.equal(titleWithNamedAct("Open Mic Night", "Live Music @ Murphys Irish Pub", VENUE, TOWN), null);
  assert.equal(titleWithNamedAct(VENUE, "Live Music", VENUE, TOWN), null);
});

test("the poster prompt refuses invented acts and treats open mic as a format", () => {
  const prompt = lineupPosterPrompt([2026]);
  assert.match(prompt, /Do not invent/);
  assert.match(prompt, /[Oo]pen mic/);
  assert.match(prompt, /2026/);
  assert.match(prompt, /Do not split on &/);
});

test("one shared poster names each night and leaves Open Mic alone", async () => {
  const batch = [
    night("2026-09-30", "Open Mic @ Murphys Irish Pub", OPEN_MIC_IMAGE, {
      start_time: "18:00",
      end_time: "20:00",
    }),
    night("2026-10-01", "Live Music @ Murphys Irish Pub", POSTER, {
      start_time: "18:00",
      end_time: "21:00",
    }),
    night("2026-10-02", "Live Music @ Murphys Irish Pub", POSTER, {
      start_time: "19:00",
      end_time: "22:00",
    }),
    night("2026-10-03", "Live Music @ Murphys Irish Pub", POSTER, {
      start_time: "19:00",
      end_time: "22:00",
    }),
    night("2026-10-04", "Live Music @ Murphys Irish Pub", POSTER, {
      start_time: "16:00",
      end_time: "18:00",
    }),
  ];
  const calls: { url: string; years: number[] }[] = [];
  const appended = await applyDiscoveredActs(batch, async (url, hint) => {
    calls.push({ url, years: hint.years });
    return [
      ...POSTER_NIGHTS,
      { date: "2026-10-05", act: "Nobody Booked", open_mic: false },
    ];
  });

  assert.equal(batch.length, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, POSTER);
  assert.deepEqual(calls[0].years, [2026]);
  assert.equal(appended.length, 4);

  const openMic = batch[0];
  assert.equal(openMic.name, "Open Mic @ Murphys Irish Pub");
  assert.equal(openMic.discovered_act, undefined);
  assert.equal(openMic.artists, null);
  assert.equal(openMic.start_time, "18:00");
  assert.equal(openMic.end_time, "20:00");

  const expected = [
    ["2026-10-01", "Ali & Heidi Crooks", "18:00", "21:00"],
    ["2026-10-02", "Plan B", "19:00", "22:00"],
    ["2026-10-03", "Blue Monday Band", "19:00", "22:00"],
    ["2026-10-04", "Kiana Chanelle", "16:00", "18:00"],
  ] as const;
  const { resolveWrittenName } = await loadDedup();
  for (const [date, act, start, end] of expected) {
    const row = batch.find((e) => e.date === date)!;
    assert.equal(row.name, "Live Music @ Murphys Irish Pub");
    assert.equal(row.discovered_act, act);
    assert.deepEqual(row.artists, [act]);
    assert.equal(row.start_time, start);
    assert.equal(row.end_time, end);
    assert.equal(
      resolveWrittenName(null, row),
      `${act} Live Music @ Murphys Irish Pub`
    );
  }
  assert.equal(
    batch.some((e) => e.name.includes("Nobody")),
    false
  );
});

test("a shared poster that cannot be read does not stamp the series subtitle onto every night", async () => {
  const batch = [
    night("2026-10-01", "Live Music @ Murphys Irish Pub", POSTER, {
      start_time: "18:00",
      end_time: "21:00",
    }),
    night("2026-10-02", "Live Music @ Murphys Irish Pub", POSTER, {
      start_time: "19:00",
      end_time: "22:00",
    }),
  ];
  batch[0].source_subtitle = "Featuring Ali & Heidi Crooks";
  batch[1].source_subtitle = "Featuring Ali & Heidi Crooks";
  const appended = await applyDiscoveredActs(batch, async () => []);
  assert.equal(appended.length, 0);
  assert.equal(batch[0].discovered_act, undefined);
  assert.equal(batch[1].discovered_act, undefined);
  assert.equal(batch[0].name, "Live Music @ Murphys Irish Pub");
});

test("a single-night row takes the subtitle and does not fetch the flyer", async () => {
  const row = night("2026-10-01", "Live Music", "https://example.com/ali.jpg", {
    start_time: "18:00",
    end_time: "21:00",
  });
  row.source_subtitle = "Featuring Ali & Heidi Crooks";
  let calls = 0;
  const appended = await applyDiscoveredActs([row], async () => {
    calls++;
    return [{ date: null, act: "Wrong Act", open_mic: false }];
  });
  assert.equal(calls, 0);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].via, "subtitle");
  assert.equal(row.discovered_act, "Ali & Heidi Crooks");
  assert.equal(row.name, "Live Music");
  assert.deepEqual(row.artists, ["Ali & Heidi Crooks"]);
  const { resolveWrittenName } = await loadDedup();
  assert.equal(
    resolveWrittenName(null, row),
    "Ali & Heidi Crooks Live Music @ Murphys Irish Pub"
  );
});

test("a single-night flyer with one undated act names that row", async () => {
  const row = night("2026-10-02", "Live Music @ Murphys Irish Pub", "https://example.com/plan-b.jpg", {
    start_time: "19:00",
    end_time: "22:00",
  });
  const appended = await applyDiscoveredActs([row], async () => [
    { date: null, act: "Plan B", open_mic: false },
  ]);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].via, "poster");
  assert.equal(row.discovered_act, "Plan B");
  assert.equal(row.name, "Live Music @ Murphys Irish Pub");
});

test("a flyer date that is not this row is not applied", async () => {
  const row = night("2026-10-02", "Live Music @ Murphys Irish Pub", "https://example.com/plan-b.jpg", {
    start_time: "19:00",
    end_time: "22:00",
  });
  const appended = await applyDiscoveredActs([row], async () => [
    { date: "2026-10-09", act: "Plan B", open_mic: false },
  ]);
  assert.equal(appended.length, 0);
  assert.equal(row.discovered_act, undefined);
});

test("two acts or two rows on one date are left alone", () => {
  const row = night("2026-10-01", "Live Music @ Murphys Irish Pub", POSTER, {
    start_time: "18:00",
    end_time: "21:00",
  });
  const ambiguous = applyLineupReading(
    [row],
    [
      { date: "2026-10-01", act: "Ali & Heidi Crooks", open_mic: false },
      { date: "2026-10-01", act: "Plan B", open_mic: false },
    ]
  );
  assert.equal(ambiguous.length, 0);
  assert.equal(row.discovered_act, undefined);

  const a = night("2026-10-01", "Live Music @ Murphys Irish Pub", POSTER, {
    start_time: "18:00",
    end_time: "21:00",
  });
  const b = night("2026-10-01", "Live Music @ Murphys Irish Pub", POSTER, {
    start_time: "21:00",
    end_time: "23:00",
  });
  const doubled = applyLineupReading(
    [a, b],
    [{ date: "2026-10-01", act: "Ali & Heidi Crooks", open_mic: false }]
  );
  assert.equal(doubled.length, 0);
  assert.equal(a.discovered_act, undefined);
  assert.equal(b.discovered_act, undefined);
});

test("GoCalaveras stamps acts before cross-source dedup and does not use the subtitle as the venue", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../scrapers/gocalaveras.ts"),
    "utf8"
  );
  const applyAt = src.indexOf("applyDiscoveredActs(futureEvents");
  const dedupAt = src.indexOf("crossSourceDedup(futureEvents)");
  assert.ok(applyAt > 0 && dedupAt > applyAt);
  assert.match(src, /evcal_subtitle/);
  assert.doesNotMatch(src, /venue_name:\s*subtitle/);
  assert.match(src, /venue_name:\s*locationName/);
});

function storedGeneric(date: string, name = "Live Music @ Murphys Irish Pub") {
  return {
    id: "row-" + date,
    name,
    date,
    venue_name: VENUE,
    venue_key: VENUE_KEY,
    description: null as string | null,
    start_time: "16:00",
    end_time: "18:00",
    price: null as string | null,
    event_url: "https://www.gocalaveras.com/events/live-music-murphys-irish-pub-4/",
    address: "415 Main St, Murphys, CA",
    town: TOWN,
    image_url: POSTER,
    category: "live_music",
    artists: null as string[] | null,
    family_friendly: false,
  };
}

function scrapeOf(
  stored: ReturnType<typeof storedGeneric>,
  extra: Record<string, unknown> = {}
) {
  return {
    ...stored,
    artists: null,
    discovered_act: null,
    source_event_id: "193198",
    ...extra,
  };
}

test("exact match writes the act onto a generic row, and the next generic scrape does not revert it", async () => {
  const { buildExactMatchUpdate, resolveWrittenName, rowChanged, placeholderNameSteal } =
    await loadDedup();
  const now = "2026-10-04T15:00:00.000Z";
  const stored = storedGeneric("2026-10-04");
  const incoming = scrapeOf(stored, {
    discovered_act: "Kiana Chanelle",
    artists: ["Kiana Chanelle"],
  });
  assert.equal(placeholderNameSteal(stored, incoming), false);
  assert.equal(rowChanged(stored as never, incoming as never), true);

  const titled = "Kiana Chanelle Live Music @ Murphys Irish Pub";
  const first = buildExactMatchUpdate(stored as never, incoming as never, "calendar-key", now);
  assert.equal(first.name, titled);
  assert.deepEqual(first.artists, ["Kiana Chanelle"]);
  assert.equal(first.dedup_key, generateDedupKey(titled, "2026-10-04", TOWN));
  assert.equal(first.start_time, "16:00");
  assert.equal(first.end_time, "18:00");

  const named = {
    ...stored,
    name: titled,
    artists: ["Kiana Chanelle"],
  };
  const again = scrapeOf(stored, { discovered_act: null, artists: null });
  assert.equal(placeholderNameSteal(named, again), true);
  assert.equal(rowChanged(named as never, again as never), false);
  const second = buildExactMatchUpdate(named as never, again as never, "calendar-key", now);
  assert.equal(second.name, titled);
  assert.equal("artists" in second, false);
  assert.equal(second.dedup_key, generateDedupKey(titled, "2026-10-04", TOWN));

  const flap = scrapeOf(stored, {
    discovered_act: "Someone Else",
    artists: ["Someone Else"],
  });
  assert.equal(resolveWrittenName(named, flap), titled);
  assert.equal(rowChanged(named as never, flap as never), false);
  const third = buildExactMatchUpdate(named as never, flap as never, "calendar-key", now);
  assert.equal(third.name, titled);
  assert.equal("artists" in third, false);
});

test("a bare Live Music calendar title still picks up the venue", async () => {
  const { resolveWrittenName, buildExactMatchUpdate } = await loadDedup();
  const stored = storedGeneric("2026-10-01", "Live Music");
  stored.start_time = "18:00";
  stored.end_time = "21:00";
  const incoming = scrapeOf(stored, {
    name: "Live Music",
    discovered_act: "Ali & Heidi Crooks",
    artists: ["Ali & Heidi Crooks"],
    source_event_id: "193195",
  });
  assert.equal(
    resolveWrittenName(null, incoming),
    "Ali & Heidi Crooks Live Music @ Murphys Irish Pub"
  );
  const payload = buildExactMatchUpdate(
    stored as never,
    incoming as never,
    "calendar-key",
    "2026-10-04T15:00:00.000Z"
  );
  assert.equal(payload.name, "Ali & Heidi Crooks Live Music @ Murphys Irish Pub");
  assert.deepEqual(payload.artists, ["Ali & Heidi Crooks"]);
});

test("a strong match retitles a placeholder and does not replace a specific name", async () => {
  const { buildStrongMatchUpdate } = await loadDedup();
  const now = "2026-10-04T15:00:00.000Z";
  const stored = storedGeneric("2026-10-04");
  const incoming = scrapeOf(stored, {
    discovered_act: "Kiana Chanelle",
    artists: ["Kiana Chanelle"],
  });
  const merged = buildStrongMatchUpdate(
    stored as never,
    incoming as never,
    "calendar-key",
    now
  ) as Record<string, unknown>;
  const titled = "Kiana Chanelle Live Music @ Murphys Irish Pub";
  assert.equal(merged.name, titled);
  assert.deepEqual(merged.artists, ["Kiana Chanelle"]);
  assert.equal(merged.dedup_key, generateDedupKey(titled, "2026-10-04", TOWN));

  const named = { ...stored, name: titled, artists: ["Kiana Chanelle"] };
  const other = scrapeOf(stored, {
    discovered_act: "Someone Else",
    artists: ["Someone Else"],
  });
  const kept = buildStrongMatchUpdate(
    named as never,
    other as never,
    "calendar-key",
    now
  ) as Record<string, unknown>;
  assert.equal(kept.name, titled);
  assert.deepEqual(kept.artists, ["Kiana Chanelle"]);
});

test("the stale Sunday slug resolves to Kiana and not to another Murphys live-music row", () => {
  const date = "2026-10-04";
  const stale = "live-music-murphys-irish-pub-2026-10-04-murphys";
  const kiana = {
    name: "Kiana Chanelle Live Music @ Murphys Irish Pub",
    date,
    town: TOWN,
    venue_name: VENUE,
    artists: ["Kiana Chanelle"],
  };
  const stevenot = {
    name: "Live Music @ Stevenot Winery",
    date,
    town: TOWN,
    venue_name: "Stevenot Winery",
    artists: null,
  };
  const jazz = {
    name: "Live Music @ The Jazz Cellars",
    date,
    town: TOWN,
    venue_name: "The Jazz Cellars",
    artists: null,
  };
  const hotel = {
    name: "Live Music @ Murphys Hotel",
    date,
    town: TOWN,
    venue_name: "Murphys Hotel",
    artists: null,
  };
  const hit = pickFallbackEvent([stevenot, jazz, hotel, kiana], stale);
  assert.equal(hit, kiana);
  assert.notEqual(generateEventSlug(kiana.name, date, TOWN), stale);

  // A second event at the same pub the same day. The bare title
  // ("Kiana Chanelle @ Murphys Irish Pub") ties Murphys Hotel at 0.6 on the
  // name score and then loses the venue-containment pass, because two rows
  // share the pub. The shaped title still clears 0.7 on "live" + "music".
  const trivia = {
    name: "Trivia Night @ Murphys Irish Pub",
    date,
    town: TOWN,
    venue_name: VENUE,
    artists: null,
  };
  const bare = {
    name: "Kiana Chanelle @ Murphys Irish Pub",
    date,
    town: TOWN,
    venue_name: VENUE,
    artists: ["Kiana Chanelle"],
  };
  assert.equal(pickFallbackEvent([stevenot, jazz, hotel, trivia, bare], stale), null);
  assert.equal(pickFallbackEvent([stevenot, jazz, hotel, trivia, kiana], stale), kiana);
});
