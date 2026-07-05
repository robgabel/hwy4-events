# PLAN — Time-aware, guide-aware Rob's Picks

> **Status (2026-07-05):** Plan only, nothing built. Prompted by the July 5 screenshot: at 4:53 PM the
> homepage spotlight was still the 54th Annual Sierra Nevada Arts & Crafts Festival (10 AM – 4 PM, over
> for nearly an hour), and the Bear Valley Music Festival pick renders as a single night ("FRI · JUL 17")
> when the festival runs Jul 17 – Aug 2 and has its own guide page.

## The two root causes

**1. Picks selection is date-granular, not time-aware.**
`selectPicks` (lib/picks.ts) keeps any pick with `date >= todayIso`, so a pick dated today stays in the
"If you do one thing this week" slot until Pacific midnight, hours after it ended. The codebase already
has the correct predicate: `hasEventEnded` in lib/event-time.ts (end known → ended at end time; no end →
assume 4h from start; timeless all-day → runs to end of day; malformed → never hidden). It powers the
client-side "Up Next" logic today. Picks simply never consumes it.

**2. The festival is represented in picks by its umbrella event row, which is a single-date object.**
The "Bear Valley Music Festival 2026" umbrella row is dated opening day (Jul 17) with a NULL start.
Three consequences:
- The pick card shows one date ("FRI · JUL 17") for a 17-day festival. It reads as one night.
- On Jul 18 the row falls out of `getUpcomingEvents` entirely (`.gte("date", today)` in SQL), so the
  picks section stops highlighting the festival for its remaining 16 days, exactly the window when
  visitors are searching for it.
- If a nightly show ever gets `robs_pick=true`, the spotlight would feature that one night by name.

PR #204 already pointed the pick's *link* at the guide page (`/bear-valley-music-festival-2026`); the
representation and lifetime were left as-is. This plan finishes the thought.

## Design principle

`lib/picks.ts` stays the single, pure, test-locked selection core, and gains two inputs it was missing:
the **wall clock** (so ended picks drop) and the **festival-guide registry** (so a festival is highlighted
as a date range for its whole run, sourced from `FESTIVAL_GUIDES`, not from any event row's survival in
the upcoming feed). No schema change, no migration, no DB writes; the umbrella-row dedup design
(CLAUDE.md "Festival umbrella rows") is untouched.

## Steps

### Step 1 — Ended picks drop (time-aware selection)

- Widen `PickCandidate` with `start_time: string | null` and `end_time: string | null` (both already on
  every row the homepage passes in).
- `selectPicks(events, todayIso, nowMinutes)`: filter out candidates where
  `hasEventEnded(e.date, e.start_time, e.end_time, nowMinutes)` in addition to the existing
  `date >= todayIso` guard. Import from `lib/event-time.ts` (relative import so the scripts test runner
  can load it, same pattern as `lib/event-guides.ts`).
- `app/page.tsx` passes `nowPacificMinutes()` (already exported, server-safe, same Intl approach as
  `pacificToday()`).
- **Hardening while there (shared win with Up Next / LiveBadge):** in `hasEventEnded` /
  `getEventLiveStatus`, guard the cross-midnight case — when `end_time < start_time` (a 9 PM – 1 AM
  show), the end is currently computed on the event's own date, so the event reads as "ended" the moment
  it starts. Add a day (1440 min) to the end when it precedes the start.

### Step 2 — The guide registry gets a start date

- `FestivalGuide` (lib/event-guides.ts) gains `startDate: string` (BVMF: `"2026-07-17"`). `hideAfter`
  is already the closing day; document that `[startDate, hideAfter]` is the festival's run and picks
  treats it as such. No other consumer changes.

### Step 3 — Guide-driven festival picks (the systemic half)

- `selectPicks` gains a `guides: FestivalGuide[]` parameter and returns entries of two kinds:
  `{ kind: "event", event }` | `{ kind: "guide", guide }`.
- A live guide (`todayIso <= hideAfter`) becomes a candidate whose effective date range is
  `[startDate, hideAfter]`:
  - Sort key: `startDate` while upcoming; `todayIso` once in progress (an in-progress festival sorts as
    "now", ahead of everything later today only by date, stable within the day).
  - Spotlight eligibility: in progress, OR `startDate` within the existing 7-day window.
- **Absorption rule:** any event candidate matching a live guide via the existing
  `festivalGuideForEvent(e, todayIso)` is dropped — the guide card represents it. This covers the
  umbrella row today AND any future `robs_pick` nightly row, so "one night of it" can never be the
  highlight while a guide is live. The umbrella row keeps `robs_pick=true` in the DB (harmless here;
  still bypasses the 60-day homepage cap for the main list and still earns its sitemap boost).
- A guide surfaces even when **no** event row is a pick: the registry is the source of truth for
  "we are highlighting this festival", not curation flags on scraped rows.

### Step 4 — Rendering (components/RobsPicks.tsx)

- Guide spotlight/card: the date block renders a **range** ("JUL 17 – AUG 2"; once in progress, "NOW –
  AUG 2" in the block and "through Aug 2" in the meta line), meta shows town + "Festival guide", and the
  whole card links to `guide.path`. Event entries render exactly as today.
- `pickHref`'s guide redirect becomes unreachable for picks (absorption happens upstream) but stays as a
  safety net.
- Voice: prefer "through Aug 2" in prose; the date-chip range uses an en dash (the em-dash ban is about
  em dashes in copy, but run `voice-lint` and keep new strings clean either way). Server-rendered, no
  client JS — the section keeps its zero-hydration design.

### Step 5 — Tests (scripts/test/picks.test.ts, plus event-time coverage)

- Ended-today pick (end time passed) drops from spotlight and row; not-yet-ended today stays; no-end
  event drops 4h after start; timeless all-day event holds until midnight.
- Guide entries: upcoming-within-window → spotlight with range; mid-run (e.g. TODAY=2026-07-25) → still
  spotlighted; day after `hideAfter` → gone.
- Absorption: umbrella pick + live guide → one guide entry, no event card; a `big-white-tent` nightly
  pick is absorbed too; an event matching **no** guide is untouched.
- Cross-midnight `hasEventEnded` guard (new lock in an event-time test block).

### Step 6 — Freshness budget (caching)

The homepage is ISR (`revalidate = 3600`) over a 30-min-cached feed, so a spotlight can outlive an
event's end by up to an hour even after Step 1. Lower the homepage `revalidate` to `1800` to match the
feed cache — the render is cheap and the underlying fetch is shared. Minute-precision dropout would need
a small client wrapper (the LiveBadge pattern); **explicitly deferred** — a ≤30-min lag on a
recommendation module is acceptable, and no-client-JS is a stated design feature of this section.

### Step 7 — Docs

- CLAUDE.md "Curation layer" paragraph: selection is now time-aware (`hasEventEnded`) and guide-driven
  (festival highlighting comes from `FESTIVAL_GUIDES`, renders as a range, persists through the run).
- Comment in `lib/event-guides.ts`: next year's festival = one new registry entry with
  `startDate`/`hideAfter`; no robs_pick juggling, no seed-script changes.

## What this fixes, concretely

| Moment | Today | After |
| --- | --- | --- |
| Jul 5, 4:53 PM | Ended Arts & Crafts Festival still the spotlight | Dropped within one cache window of its 4 PM end; next eligible pick takes the slot |
| Jul 10–17 | Spotlight shows "FRI · JUL 17", single night | "Bear Valley Music Festival · Jul 17 – Aug 2" → guide page |
| Jul 18 – Aug 2 | Festival vanishes from picks entirely | Stays spotlighted as in progress, "through Aug 2" |
| A nightly show gets robs_pick | Spotlight features that one night | Absorbed into the guide card while the guide is live |
| Next festival (any year) | Re-derive the umbrella/pick dance | Add one `FESTIVAL_GUIDES` entry |

## Out of scope (deliberate, later increments)

- Hiding ended events from the main homepage "Today" group and temporal pages (they intentionally show
  the full day with "Happening Now" badges; hiding is a separate product call, but the shared
  `hasEventEnded` makes it a one-line adoption if wanted).
- Client-side minute-precision spotlight dropout.
- A general multi-day-event schema (`end_date`): the umbrella-row + guide-registry pattern is the chosen
  answer for the single-date schema.

## Touch list

`lib/picks.ts` · `lib/event-time.ts` · `lib/event-guides.ts` · `components/RobsPicks.tsx` ·
`app/page.tsx` · `scripts/test/picks.test.ts` · CLAUDE.md. No migrations. No DB writes.
