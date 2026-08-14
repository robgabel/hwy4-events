// Locks scripts/lib/gocalaveras-sweep.ts — the AGGREGATOR ownership + window
// rules for the stale sweep (HWY-21). The organizer sweeps retract one venue's
// bookings; this one runs against every venue in the corridor, so each rule
// removed from here is a corridor-wide deletion risk. Read stale-sweep.test.ts
// first: it locks the primitive these rules feed.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectShortcodeCap,
  goCalaverasPresenceKeys,
  goCalaverasRowKeys,
  goCalaverasSlug,
  goCalaverasSweepWindows,
  isGoCalaverasUrl,
  MIN_EVENTS_PER_MONTH,
  MIN_PLAUSIBLE_CAP,
  ownsGoCalaverasRow,
  provenMonthLabel,
  slugExtractionHealthy,
  type MonthEnumeration,
} from "../lib/gocalaveras-sweep.js";
import { inAnyWindow, selectStaleRows, type SweepRow } from "../lib/stale-sweep.js";

let seq = 0;
const row = (partial: Partial<SweepRow>): SweepRow => ({
  id: `id-${++seq}`,
  name: "Live Music at the Winery",
  date: "2026-08-20",
  source_event_id: null,
  event_url: null,
  ...partial,
});

const GOC = (slug: string) => `https://www.gocalaveras.com/events/${slug}/`;

// ---------- host + slug ----------

test("isGoCalaverasUrl matches only gocalaveras.com over http(s)", () => {
  assert.equal(isGoCalaverasUrl(GOC("hot-copper-car-show")), true);
  assert.equal(isGoCalaverasUrl("http://gocalaveras.com/events/x/"), true);
  // A lookalike host must not read as ours.
  assert.equal(isGoCalaverasUrl("https://gocalaveras.com.example.net/events/x/"), false);
  assert.equal(isGoCalaverasUrl("https://www.bricestation.com/products/wolf-jett"), false);
  assert.equal(isGoCalaverasUrl("javascript://gocalaveras.com/%0aalert(1)"), false);
  assert.equal(isGoCalaverasUrl("not a url"), false);
  assert.equal(isGoCalaverasUrl(null), false);
});

test("goCalaverasSlug takes the permalink slug, never a foreign host's", () => {
  assert.equal(goCalaverasSlug(GOC("hot-copper-car-show-show")), "hot-copper-car-show-show");
  // Query strings (EventON instance params) are not part of the identity.
  assert.equal(goCalaverasSlug(GOC("open-mic-night") + "?ri=3"), "open-mic-night");
  // The listing index is not an event.
  assert.equal(goCalaverasSlug("https://www.gocalaveras.com/events/"), null);
  assert.equal(goCalaverasSlug("https://www.murphysirishpubca.com/event-details/blue-monday"), null);
  assert.equal(goCalaverasSlug(null), null);
});

// The live shape that makes "last path segment" wrong. EventON appends an
// occurrence tail to a recurring series permalink; four Ironstone rows carry
// one in production. Keying on the tail invents a key the feed never emits
// (the row reads as retracted while plainly still listed) AND collides across
// unrelated series that share an occurrence index.
test("goCalaverasSlug anchors to /events/<slug> and ignores the occurrence tail", () => {
  assert.equal(
    goCalaverasSlug("https://www.gocalaveras.com/events/mimosa-sundays-at-ironstone-vineyards/var/ri-13.l-L1"),
    "mimosa-sundays-at-ironstone-vineyards"
  );
  // Same tail, different event: the keys must NOT collide.
  const a = goCalaverasSlug("https://www.gocalaveras.com/events/mimosa-sundays-at-ironstone-vineyards/var/ri-13.l-L1");
  const b = goCalaverasSlug("https://www.gocalaveras.com/events/trivia-night-at-the-pourhouse/var/ri-13.l-L1");
  assert.notEqual(a, b);
  assert.equal(b, "trivia-night-at-the-pourhouse");
  // A resident row's tailed URL and the feed's plain permalink meet on one key.
  assert.equal(
    goCalaverasSlug("https://www.gocalaveras.com/events/mimosa-sundays-at-ironstone-vineyards/var/ri-2.l-L1"),
    goCalaverasSlug(GOC("mimosa-sundays-at-ironstone-vineyards"))
  );
  // Not an event page at all.
  assert.equal(goCalaverasSlug("https://www.gocalaveras.com/things-to-do/wineries/"), null);
  assert.equal(goCalaverasSlug("https://www.gocalaveras.com/"), null);
});

// ---------- ownership (the aggregator's narrow test) ----------

/** A run whose permalink extraction worked / didn't. */
const SAW_SLUGS = { slugs: true };
const NO_SLUGS = { slugs: false };

test("ownsGoCalaverasRow: a plain EventON row is ours, keyed by id and/or slug", () => {
  assert.equal(
    ownsGoCalaverasRow(row({ source_event_id: "191902", event_url: GOC("x") }), SAW_SLUGS),
    true
  );
  // URL extraction fails on some listings; a bare numeric id still keys the row.
  assert.equal(ownsGoCalaverasRow(row({ source_event_id: "191902" }), SAW_SLUGS), true);
  // Pre-source_event_id legacy row: keyable by its permalink slug alone.
  assert.equal(ownsGoCalaverasRow(row({ event_url: GOC("legacy-listing") }), SAW_SLUGS), true);
});

test("ownsGoCalaverasRow: a row an organizer scraper merged into is untouchable", () => {
  // buildStrongMatchUpdate overwrites source_event_id + event_url on a merge but
  // never org_slug, so these rows still answer the executor's org_slug filter.
  // They are maintained by the organizer now — GoCalaveras dropping its own
  // listing says nothing about whether the event is happening.
  assert.equal(
    ownsGoCalaverasRow(
      row({
        source_event_id: "murphys-irish-pub|blue-monday-band-5",
        event_url: "https://www.murphysirishpubca.com/event-details/blue-monday-band-5",
      }),
      SAW_SLUGS
    ),
    false
  );
  assert.equal(
    ownsGoCalaverasRow(row({ source_event_id: "sequoia-woods|2026-08-20|patio-party" }), SAW_SLUGS),
    false
  );
  // Foreign URL alone is enough, even with our own id still on the row (also the
  // shape of an EventON listing whose only link is the organizer's `_evcal_exlink`).
  assert.equal(
    ownsGoCalaverasRow(
      row({
        source_event_id: "191902",
        event_url: "https://www.bricestation.com/products/wolf-jett",
      }),
      SAW_SLUGS
    ),
    false
  );
});

test("ownsGoCalaverasRow: an unkeyed row is never ours", () => {
  // Nothing to match against the feed, so a presence test can only ever say
  // "absent" — an aggregator sweep would select it every run, forever.
  assert.equal(ownsGoCalaverasRow(row({}), SAW_SLUGS), false);
  // A non-numeric, non-prefixed id is still not an EventON id.
  assert.equal(ownsGoCalaverasRow(row({ source_event_id: "wolf-jett-july-25" }), SAW_SLUGS), false);
  assert.equal(ownsGoCalaverasRow(row({ source_event_id: "  " }), SAW_SLUGS), false);
  // "On our host" is NOT the test — the URL must actually yield a key, or the
  // row is owned with zero keys, which is the shape this rule exists to reject.
  assert.equal(
    ownsGoCalaverasRow(row({ event_url: "https://www.gocalaveras.com/events/" }), SAW_SLUGS),
    false
  );
  assert.equal(
    ownsGoCalaverasRow(
      row({ event_url: "https://www.gocalaveras.com/things-to-do/wineries/" }),
      SAW_SLUGS
    ),
    false
  );
});

// Slug keys come out of the response HTML by regex; ids come out of the JSON.
// When the HTML shape changes, every slug-only row would read as retracted at
// once — so that whole class sits out the run.
test("ownsGoCalaverasRow: slug-only rows sit out a run with no permalinks", () => {
  const slugOnly = row({ event_url: GOC("legacy-listing") });
  assert.equal(ownsGoCalaverasRow(slugOnly, SAW_SLUGS), true);
  assert.equal(ownsGoCalaverasRow(slugOnly, NO_SLUGS), false);
  // An id-carrying row is unaffected: its key class came off the JSON.
  assert.equal(
    ownsGoCalaverasRow(row({ source_event_id: "191902", event_url: GOC("x") }), NO_SLUGS),
    true
  );
});

test("slugExtractionHealthy tracks whether permalinks were readable this run", () => {
  const listing = (id: number, slug: string | null) => ({
    id,
    url: slug ? GOC(slug) : null,
  });
  assert.equal(
    slugExtractionHealthy([listing(1, "a"), listing(2, "b"), listing(3, null)]),
    true
  );
  assert.equal(
    slugExtractionHealthy([listing(1, "a"), listing(2, null), listing(3, null)]),
    false
  );
  assert.equal(slugExtractionHealthy([]), false);
});

test("ownsGoCalaverasRow: manually-managed venues stay out of reach", () => {
  // The scraper drops these before upsert, so their ids never enter the
  // presence set — a legacy row at one would look permanently retracted.
  assert.equal(
    ownsGoCalaverasRow(
      row({
        name: "Live Music @ The Lube Room",
        venue_name: "The Lube Room Saloon",
        source_event_id: "191902",
        event_url: GOC("live-music-the-lube-room"),
      }),
      SAW_SLUGS
    ),
    false
  );
  // Blocklisted by event NAME, not venue (the hand-corrected Hot Copper row).
  assert.equal(
    ownsGoCalaverasRow(
      row({
        name: "Hot Copper Car Show Show",
        venue_name: "Copperopolis Town Square",
        source_event_id: "191903",
      }),
      SAW_SLUGS
    ),
    false
  );
  // The other event at that same square still scrapes — and stays sweepable.
  assert.equal(
    ownsGoCalaverasRow(
      row({
        name: "Stars & Stripes",
        venue_name: "Copperopolis Town Square",
        source_event_id: "191904",
      }),
      SAW_SLUGS
    ),
    true
  );
});

// ---------- keys + presence ----------

test("row keys and presence keys meet on the id and on the slug", () => {
  assert.deepEqual(goCalaverasRowKeys(row({ source_event_id: "191902", event_url: GOC("car-show") })), [
    "191902",
    "car-show",
  ]);
  // A foreign id/URL contributes no key at all (belt to ownsGoCalaverasRow's braces).
  assert.deepEqual(
    goCalaverasRowKeys(
      row({ source_event_id: "murphys-irish-pub|x", event_url: "https://www.murphysirishpubca.com/event-details/x" })
    ),
    [null, null]
  );
  const present = goCalaverasPresenceKeys([
    { id: 191902, url: GOC("car-show") },
    { id: 191903, url: null },
  ]);
  assert.deepEqual([...present].sort(), ["191902", "191903", "car-show"]);
});

// ---------- month completeness proof ----------

/** `count` dates spread across the given month, as a live payload would carry. */
const datesIn = (yearMonth: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${yearMonth}-${String((i % 28) + 1).padStart(2, "0")}`);

const august = (over: Partial<MonthEnumeration> = {}): MonthEnumeration => ({
  requested: "August 2026",
  ok: true,
  dates: datesIn("2026-08", 20),
  ...over,
});

test("provenMonthLabel: a healthy in-month payload proves its month", () => {
  assert.equal(provenMonthLabel(august()), "August 2026");
  // A focus range legitimately catches a multi-day event that started earlier.
  assert.equal(
    provenMonthLabel(august({ dates: ["2026-07-30", "2026-08-11", "2026-08-20"] })),
    "August 2026"
  );
});

test("provenMonthLabel: a payload for the wrong month proves nothing", () => {
  // The failure that would strand every row in five months at once: EventON
  // ignores fixed_month/focus_range and echoes the current month, so months +1
  // to +5 all "cover" windows they never read.
  assert.equal(
    provenMonthLabel(august({ dates: [...datesIn("2026-09", 18), "2026-08-31"] })),
    null
  );
});

test("provenMonthLabel: failed, empty, and capped payloads prove nothing", () => {
  assert.equal(provenMonthLabel(august({ ok: false })), null);
  assert.equal(provenMonthLabel(august({ dates: [] })), null);
  // Truncated at the shortcode's display cap: the missing tail is not a retraction.
  assert.equal(provenMonthLabel(august({ cap: 4 })), null);
  // Landing EXACTLY on the cap is truncation too (>= not >): the fixture has
  // 20 dates, so cap 20 must refuse the month.
  assert.equal(provenMonthLabel(august({ cap: 20 })), null);
  assert.equal(provenMonthLabel(august({ cap: 50 })), "August 2026");
  assert.equal(provenMonthLabel(august({ cap: 0 })), "August 2026");
  assert.equal(provenMonthLabel(august({ requested: "(unresolved)" })), null);
});

test("detectShortcodeCap reads a cap off the live shortcode, ignoring non-caps", () => {
  assert.deepEqual(
    detectShortcodeCap({ cal_id: "1", event_count: "50", number_of_months: "1" }),
    { key: "event_count", value: 50 }
  );
  // EventON's own "0" means unlimited; non-numeric attributes are not caps.
  assert.equal(detectShortcodeCap({ event_count: "0", show_limit: "yes" }), null);
  // The live 2026-08-11 false positive: show_limit_paged is a 0/1 pagination
  // TOGGLE, and reading its "1" as a display cap made every month "reach" it —
  // zero windows proved, sweep silently inert. Toggle-scale values are not caps.
  assert.equal(detectShortcodeCap({ show_limit_paged: "1" }), null);
  assert.deepEqual(
    detectShortcodeCap({ show_limit_paged: "1", event_count: "50" }),
    { key: "event_count", value: 50 }
  );
  assert.equal(detectShortcodeCap({}), null);
  assert.equal(detectShortcodeCap(null), null);
  // The invariant that makes the floor SAFE: a genuine cap of 1..4 goes
  // undetected here, and the month floor is what still refuses those months
  // (a truly C-capped month returns <= C < MIN_EVENTS_PER_MONTH events). If
  // the month floor is ever lowered below the cap floor, that band reopens
  // and a tiny-capped month could prove a full-month window — this assertion
  // is the tripwire.
  assert.ok(MIN_PLAUSIBLE_CAP <= MIN_EVENTS_PER_MONTH);
  // Exactly-at-cap is truncation (>= not >): the smallest detectable cap with
  // a payload that just reaches it must refuse the month.
  assert.equal(
    provenMonthLabel({
      requested: "August 2026",
      ok: true,
      dates: datesIn("2026-08", MIN_PLAUSIBLE_CAP),
      cap: MIN_PLAUSIBLE_CAP,
    }),
    null
  );
  // Two caps: the tighter one governs.
  assert.deepEqual(detectShortcodeCap({ event_count: "50", evc_limit: "25" }), {
    key: "evc_limit",
    value: 25,
  });
});

test("detectShortcodeCap: jumper_* keys are UI settings, never display caps", () => {
  // The live 2026-08-12..14 false positive, the sequel to show_limit_paged:
  // EventON's jumper_count (month-jumper dropdown size) sits at exactly
  // MIN_PLAUSIBLE_CAP on the real page, so it cleared the toggle floor, read
  // as a display cap of 5, and every real month "reached" it — zero windows
  // proved for three straight runs. The key is navigation chrome, not a limit.
  assert.equal(detectShortcodeCap({ jumper_count: "5" }), null);
  // Denylist is by name, not value — a differently-configured jumper is still
  // not a cap.
  assert.equal(detectShortcodeCap({ jumper_count: "12" }), null);
  // The denylist only removes the known UI key; a real cap beside it still
  // governs (this is the live shortcode's shape plus a genuine event_count).
  assert.deepEqual(
    detectShortcodeCap({ jumper_count: "5", show_limit_paged: "1", event_count: "20" }),
    { key: "event_count", value: 20 }
  );
  // Pins the PREFIX, not the one key: NON_CAP_KEYS is /^jumper_/, and this is
  // the assertion that fails if it's ever narrowed to /^jumper_count$/.
  // (jumper_limit is hypothetical — EventON's real jumper_offset never reaches
  // the denylist because "offset" isn't cap-shaped — but the plugin's keys are
  // its own to change, and the denylist claims the namespace.)
  assert.equal(detectShortcodeCap({ jumper_limit: "10" }), null);
  // Both cap-shaped keys observed in prod logs as of 2026-08-14 (the live
  // data-sc carries many more keys; these are the two CAP_KEY sees), no
  // genuine cap — months must prove on the agreement + floor rules alone.
  assert.equal(
    detectShortcodeCap({ jumper_count: "5", show_limit_paged: "1" }),
    null
  );
});

test("goCalaverasSweepWindows: only proven months, clamped to today", () => {
  const today = "2026-08-11";
  const windows = goCalaverasSweepWindows(
    [
      august(), // healthy → clamped to today
      { requested: "September 2026", ok: false, dates: [] }, // AJAX failed
      // Echoed August again instead of October: proves nothing about October.
      { requested: "October 2026", ok: true, dates: datesIn("2026-08", 20) },
      { requested: "November 2026", ok: true, dates: datesIn("2026-11", 16) },
      // Thin payload — below the aggregator floor.
      { requested: "December 2026", ok: true, dates: datesIn("2026-12", 4) },
    ],
    today
  );
  assert.deepEqual(windows, [
    { from: "2026-08-11", to: "2026-08-31" },
    { from: "2026-11-01", to: "2026-11-30" },
  ]);
  assert.equal(inAnyWindow("2026-09-15", windows), false);
  assert.equal(inAnyWindow("2026-10-15", windows), false);
  assert.equal(inAnyWindow("2026-12-15", windows), false);
  assert.equal(inAnyWindow("2026-08-05", windows), false); // before today
});

// The floor is county-feed calibration, not the primitive's single-venue 3.
// Live months run 136/114/60/13/16/4: a 4-listing far-future month is exactly
// where "truncated payload" and "quiet month" are indistinguishable, so it
// intentionally contributes nothing until it fills in.
test("goCalaverasSweepWindows: the thin far-future tail contributes no window", () => {
  assert.equal(MIN_EVENTS_PER_MONTH, 15);
  const thin = (n: number) =>
    goCalaverasSweepWindows(
      [{ requested: "January 2027", ok: true, dates: datesIn("2027-01", n) }],
      "2026-08-11"
    );
  assert.deepEqual(thin(4), []);
  assert.deepEqual(thin(13), []);
  assert.deepEqual(thin(14), []);
  assert.deepEqual(thin(15), [{ from: "2027-01-01", to: "2027-01-31" }]);
});

// ---------- end to end through the shared selection ----------

test("selection: only a genuinely-dropped GoCalaveras listing is selected", () => {
  const windows = goCalaverasSweepWindows([august()], "2026-08-11");
  const stillListed = row({ date: "2026-08-20", source_event_id: "191902", event_url: GOC("car-show") });
  // Its EventON id was re-issued, but the series permalink is still in the feed.
  const reissued = row({ date: "2026-08-21", source_event_id: "777777", event_url: GOC("car-show") });
  const mergedToOrganizer = row({
    date: "2026-08-22",
    source_event_id: "murphys-irish-pub|blue-monday-band-5",
    event_url: "https://www.murphysirishpubca.com/event-details/blue-monday-band-5",
  });
  const unkeyed = row({ date: "2026-08-23" });
  const curated = row({ date: "2026-08-24", source_event_id: "191910", robs_pick: true });
  const dropped = row({ date: "2026-08-25", source_event_id: "191911", event_url: GOC("gone-listing") });
  const nextMonth = row({ date: "2026-09-05", source_event_id: "191912" });

  const { stale, protectedRows } = selectStaleRows(
    [stillListed, reissued, mergedToOrganizer, unkeyed, curated, dropped, nextMonth],
    {
      windows,
      presentKeys: goCalaverasPresenceKeys([{ id: 191902, url: GOC("car-show") }]),
      keysOf: goCalaverasRowKeys,
      ownRow: (r) => ownsGoCalaverasRow(r, { slugs: true }),
    }
  );

  assert.deepEqual(stale.map((r) => r.id), [dropped.id]);
  assert.deepEqual(
    protectedRows.map((p) => p.reason),
    ["robs_pick"]
  );
});
