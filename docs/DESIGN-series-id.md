# DESIGN: `series_id` — one honest handle for recurring happenings

> **Status (2026-08-11):** design only — no code, no migration. Written as punch item 6
> of the ingest-quality program (HWY-22). The build/no-build call is Rob's; every
> phase below is independently shippable and independently reversible.

## The problem, stated as cost already paid

The schema models one row = one dated occurrence, with no first-class notion of
"these rows are the same happening repeating." That single missing handle is why
**six separate subsystems** exist to re-derive or route around series identity:

1. **Festival umbrella rows + `series_umbrella`** — a hand-seeded duplicative row
   (plus a column, migration `20260727`) because a multi-week festival has no row
   that can say "I am the whole thing."
2. **`collapseEventList` heuristics** ([lib/collapse-events.ts](../lib/collapse-events.ts)) —
   base-name+town grouping with cadence inference, clock-aware re-anchoring, and
   "Times vary" logic, all reverse-engineering series membership at render time.
3. **Ingest horizon cap** (`capSeriesHorizon`) — detects series by name+venue batch
   grouping to stop 2028 instances flooding in. (Its *accuracy* rationale — nobody
   confirmed a 2028 trivia time — stands regardless of this design; the cap stays.)
4. **Sitemap series-trimming** ([lib/sitemap.ts](../lib/sitemap.ts)) — collapses
   recurring instances to the soonest 2 per `(title, town)`, another independent
   name-based grouper.
5. **`is_weekly`** — a boolean that asserts cadence without identifying *which*
   series a row belongs to; the UI collapse can't use it for grouping.
6. **`scripts/lib/recurrence.ts`** — the seed scripts' expansion engine; correct,
   but its output rows lose their shared identity the moment they're inserted.

Each grouper has its own bugs and its own drift (the collapse's grouping and the
sitemap's grouping already disagree subtly: base-name+town vs title+town). The
2026-08-09 phantom investigation added the operational cost: cross-date identity
is exactly what no dedup layer can see, and series membership is cross-date
identity.

## Proposal (deliberately minimal)

One nullable column, no new table, no RRULE:

```sql
alter table hwy4_events add column series_id text;          -- null = not part of a series
create index hwy4_events_series_idx on hwy4_events (series_id) where series_id is not null;
```

`series_id` is an opaque, stable, human-legible handle: `"{org-or-venue-slug}:{normalized-base-name}"`
(e.g. `murphys-irish-pub:open-mic-night`, `bigtrees:junior-rangers`,
`bear-valley-music-festival:2026`). Writers stamp it; readers group by it exactly
instead of heuristically. **It is not a foreign key** — no series table until a
proven need (a registry row adds nothing the handle doesn't until we want
series-level editorial copy, which is a later, separate decision).

### Who writes it, in adoption order

| Phase | Writer | Mechanism | Risk / reversal |
|---|---|---|---|
| 1 | Migration + backfill script | Group resident rows with the SAME grouper `collapseEventList` uses today (base-name+town, extracted to a shared pure helper so UI and backfill cannot disagree); dry-run report first, `--commit` to stamp | Additive column; `UPDATE … SET series_id = NULL` reverts wholesale |
| 2 | Seed scripts + `recurrence.ts` | Expansion stamps the handle on every emitted row — the highest-trust series knowledge in the system, currently thrown away at insert | Same reversal |
| 3 | Scrapers via `upsertEvents` pre-pass | `capSeriesHorizon` already computes name+venue groups per batch; stamp its groups of ≥3 as `series_id` (below the horizon-drop threshold on purpose — stamping is cheap and safe where dropping is not) | Same reversal |
| 4 | Readers switch, one per release | `collapseEventList` groups by `series_id ?? heuristic` (fallback keeps un-stamped rows working); then the sitemap trimmer; then `is_weekly` becomes derived (`count(*) over series` + cadence) and is retired | Each reader keeps its heuristic as fallback for one release — flipping back is a one-line revert per reader |
| 5 | Umbrella rows | The umbrella row carries the same `series_id` as its nightlies; detail pages can link "part of: Bear Valley Music Festival" without title matching. `series_umbrella` (the do-not-merge marker) **stays** — it protects merge semantics, which is a different job than grouping | No change to dedup behavior at any phase |

### What this must NOT touch (hard constraints)

- **`dedup_key` stays byte-stable.** Series identity never enters the hash — key
  stability is test-locked and re-keying would re-duplicate the catalog.
- **`isSameEvent` is unchanged.** Occurrence identity (same night) and series
  identity (same happening across nights) are different predicates; blurring them
  is how you merge two different Fridays. The matcher never reads `series_id`.
- **The horizon cap stays.** Fewer far-future assertions is an accuracy position,
  not a storage optimization.
- **Out of scope, explicitly:** RRULE/recurrence grammar in the DB, an
  `end_date` semantic change, any table/column rename (the region program's
  exclusion list), and a series registry table.

## What retires, what it's worth

End state after phase 4: the collapse's grouping heuristics shrink to a fallback
path, the sitemap trimmer becomes exact, `is_weekly` is gone as a stored
assertion, and two current classes of subtle bug become impossible (collapse and
sitemap disagreeing about what a series is; a renamed series splitting its own
history). Estimated build cost: phases 1–2 ≈ a day including the backfill
dry-run; phases 3–4 ≈ a day spread across releases; phase 5 is an afternoon.

The honest counter-argument: the heuristics **currently work** (534→154 collapse
shipped and holds), the column adds a second source of truth that can itself go
stale (a scraper that stops stamping strands new instances outside their series
— mitigated by the phase-4 fallback semantics `series_id ?? heuristic`, which
degrades to today's behavior, never below it), and none of the six subsystems is
presently on fire. This is a **consolidation** investment, not a fire: the right
time is either now-ish (before the 30A port multiplies every heuristic by N
regions) or explicitly never — the worst version is half-adopted.

## Decision requested

- **Build phases 1–2 now** (column + backfill + seeds stamp; zero reader changes,
  zero visible behavior change, unblocks the rest whenever wanted), or
- **Shelve entirely** (this doc freezes to a record; the heuristics remain the
  system of record for series identity).

Recommendation: phases 1–2 now, phase 3+ only after the first fallback-drift
report shows up in practice or the 30A port is scheduled, whichever first.
