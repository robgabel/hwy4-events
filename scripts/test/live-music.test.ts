// Regression lock for the live-music hub (lib/live-music.ts, HWY-37).
//
// Load-bearing: the three lenses (tonight is Pacific-day + not-ended;
// weekend is the shared Friday–Sunday window; upcoming drops today's ended
// shows), public live_music only, and the fixed copy's voice rules (no em
// dashes; every Q&A answer resolves in its first sentence).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLiveMusicEvent,
  parseLiveMusicLens,
  liveMusicHref,
  liveMusicWindow,
  selectLiveMusic,
  LIVE_MUSIC_HORIZON_DAYS,
  LIVE_MUSIC_LENSES,
  LIVE_MUSIC_PAGE,
  LIVE_MUSIC_PATH,
  type LiveMusicLens,
} from "../../lib/live-music.js";
import { addDays } from "../../lib/date-windows.js";

const TODAY = "2026-09-12"; // Saturday
const WEEKEND = { start: "2026-09-11", end: "2026-09-13" }; // Fri–Sun

function at(dateStr: string, time24: string): number {
  const [h, m] = time24.split(":").map(Number);
  const [y, mo, d] = dateStr.split("-").map(Number);
  return y * 525960 + (mo - 1) * 43830 + d * 1440 + h * 60 + m;
}

function ev(over: {
  category?: "live_music" | "festival" | "kids";
  visibility?: "public" | "private";
  date?: string;
  start_time?: string | null;
  end_time?: string | null;
}) {
  return {
    category: over.category ?? ("live_music" as const),
    visibility: over.visibility ?? ("public" as const),
    date: over.date ?? TODAY,
    start_time: over.start_time === undefined ? "19:00" : over.start_time,
    end_time: over.end_time === undefined ? "22:00" : over.end_time,
  };
}

function select(
  events: ReturnType<typeof ev>[],
  lens: LiveMusicLens,
  now = at(TODAY, "18:00")
) {
  return selectLiveMusic(events, lens, {
    todayIso: TODAY,
    nowMinutes: now,
    weekend: WEEKEND,
    horizonEnd: addDays(TODAY, LIVE_MUSIC_HORIZON_DAYS),
  });
}

test("isLiveMusicEvent: public live_music only", () => {
  assert.ok(isLiveMusicEvent({ category: "live_music", visibility: "public" }));
  assert.ok(
    !isLiveMusicEvent({ category: "live_music", visibility: "private" })
  );
  assert.ok(!isLiveMusicEvent({ category: "festival", visibility: "public" }));
  assert.ok(!isLiveMusicEvent({ category: "kids", visibility: "public" }));
});

test("parseLiveMusicLens: tonight/weekend stick; everything else is upcoming", () => {
  assert.equal(parseLiveMusicLens("tonight"), "tonight");
  assert.equal(parseLiveMusicLens("weekend"), "weekend");
  assert.equal(parseLiveMusicLens("upcoming"), "upcoming");
  assert.equal(parseLiveMusicLens(undefined), "upcoming");
  assert.equal(parseLiveMusicLens(null), "upcoming");
  assert.equal(parseLiveMusicLens("Tonight"), "upcoming");
  assert.equal(parseLiveMusicLens("tomorrow"), "upcoming");
});

test("liveMusicHref: upcoming is the clean path; lenses are query params", () => {
  assert.equal(liveMusicHref("upcoming"), LIVE_MUSIC_PATH);
  assert.equal(liveMusicHref("tonight"), "/live-music?when=tonight");
  assert.equal(liveMusicHref("weekend"), "/live-music?when=weekend");
});

test("tonight lens: same Pacific day, drops ended shows", () => {
  const stillOn = ev({ start_time: "19:00", end_time: "22:00" });
  const alreadyOver = ev({ start_time: "14:00", end_time: "16:00" });
  const tomorrow = ev({ date: "2026-09-13" });
  const yesterday = ev({ date: "2026-09-11" });
  const now = at(TODAY, "18:00");
  const out = select([stillOn, alreadyOver, tomorrow, yesterday], "tonight", now);
  assert.deepEqual(out, [stillOn]);
});

test("tonight lens: a show still live at 21:00 stays; after end it drops", () => {
  const show = ev({ start_time: "19:00", end_time: "22:00" });
  assert.equal(select([show], "tonight", at(TODAY, "21:00")).length, 1);
  assert.equal(select([show], "tonight", at(TODAY, "22:00")).length, 0);
});

test("tonight lens: timeless row stays until end of the Pacific day", () => {
  const allDay = ev({ start_time: null, end_time: null });
  assert.equal(select([allDay], "tonight", at(TODAY, "20:00")).length, 1);
  assert.equal(select([allDay], "tonight", at(TODAY, "23:59")).length, 0);
});

test("weekend lens: Friday–Sunday inclusive, including already-played nights", () => {
  const fri = ev({ date: "2026-09-11", start_time: "19:00", end_time: "22:00" });
  const sat = ev({ date: TODAY });
  const sun = ev({ date: "2026-09-13" });
  const mon = ev({ date: "2026-09-14" });
  const thu = ev({ date: "2026-09-10" });
  // Saturday 6pm: Friday's show has ended. Weekend still lists it.
  const out = select([fri, sat, sun, mon, thu], "weekend", at(TODAY, "18:00"));
  assert.deepEqual(
    out.map((e) => e.date),
    ["2026-09-11", TODAY, "2026-09-13"]
  );
});

test("upcoming lens: horizon window, drops today's ended, keeps future", () => {
  const endedToday = ev({ start_time: "12:00", end_time: "14:00" });
  const tonight = ev({ start_time: "19:00", end_time: "22:00" });
  const nextWeek = ev({ date: "2026-09-19" });
  const far = ev({ date: addDays(TODAY, LIVE_MUSIC_HORIZON_DAYS + 1) });
  const onHorizon = ev({ date: addDays(TODAY, LIVE_MUSIC_HORIZON_DAYS) });
  const out = select(
    [endedToday, tonight, nextWeek, far, onHorizon],
    "upcoming",
    at(TODAY, "18:00")
  );
  assert.deepEqual(
    out.map((e) => e.date + (e.start_time ?? "")),
    [
      TODAY + "19:00",
      "2026-09-19" + "19:00",
      addDays(TODAY, LIVE_MUSIC_HORIZON_DAYS) + "19:00",
    ]
  );
});

test("selectLiveMusic: private and non-music never qualify in any lens", () => {
  const privateShow = ev({ visibility: "private" });
  const festival = ev({ category: "festival" });
  for (const lens of ["tonight", "weekend", "upcoming"] as const) {
    assert.deepEqual(select([privateShow, festival], lens), []);
  }
});

test("liveMusicWindow: tonight is a single Pacific day", () => {
  const w = liveMusicWindow("tonight", { iso: TODAY, dow: 6 });
  assert.deepEqual(w, { start: TODAY, end: TODAY });
});

test("liveMusicWindow: upcoming spans LIVE_MUSIC_HORIZON_DAYS", () => {
  const w = liveMusicWindow("upcoming", { iso: TODAY, dow: 6 });
  assert.equal(w.start, TODAY);
  assert.equal(w.end, addDays(TODAY, LIVE_MUSIC_HORIZON_DAYS));
});

test("liveMusicWindow: Saturday uses the weekend in progress (Fri–Sun)", () => {
  const w = liveMusicWindow("weekend", { iso: TODAY, dow: 6 });
  assert.deepEqual(w, { start: "2026-09-11", end: "2026-09-13" });
});

test("configs are coherent (paths, lenses, copy wired)", () => {
  assert.equal(LIVE_MUSIC_PAGE.path, LIVE_MUSIC_PATH);
  assert.ok(LIVE_MUSIC_PAGE.windowDays > 0);
  assert.ok(LIVE_MUSIC_PAGE.editorial.length >= 1);
  assert.ok(LIVE_MUSIC_PAGE.qa.length >= 1);
  for (const cfg of Object.values(LIVE_MUSIC_LENSES)) {
    assert.ok(cfg.h1.length > 0, cfg.key);
    assert.ok(cfg.lead.length > 0, cfg.key);
    assert.ok(cfg.metaTitle.length > 0, cfg.key);
    assert.ok(cfg.metaDescription.length > 0, cfg.key);
  }
});

test("voice lock: no em dashes anywhere in the fixed copy", () => {
  const strings = [
    LIVE_MUSIC_PAGE.label,
    ...LIVE_MUSIC_PAGE.editorial,
    ...LIVE_MUSIC_PAGE.qa.flatMap((x) => [x.q, x.a]),
    ...Object.values(LIVE_MUSIC_LENSES).flatMap((c) => [
      c.h1,
      c.lead,
      c.metaTitle,
      c.metaDescription,
      c.empty,
      c.label,
    ]),
  ];
  for (const s of strings) {
    assert.ok(!s.includes("—"), `em dash: "${s.slice(0, 60)}"`);
  }
});

test("every Q&A answer resolves in its first sentence (liftable)", () => {
  for (const { q, a } of LIVE_MUSIC_PAGE.qa) {
    const first = a.split(". ")[0];
    assert.ok(
      first.length >= 20,
      `answer to "${q}" opens too thin: "${first}"`
    );
  }
});
