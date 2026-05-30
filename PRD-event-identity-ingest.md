# PRD: Self-Healing Event Identity — Make Duplicates Structurally Impossible at Rest

> Move 3 of the dedup work. Moves 1+2 (single-source the matcher + lock it with tests) shipped in `lib/event-identity.ts` + `scripts/test/event-identity.test.ts`. This is the deferred prize: **one event, one row** — so read-time collapse stops being a permanent per-render crutch.
>
> Musk-algorithm framing: **make the requirement less dumb → delete → simplify → accelerate → automate.** Moves 1+2 did delete/simplify on the *matcher*. This move does step 1 on the *system*: stop asking every writer to be smart; make the data self-heal so the duplicate can't survive at rest.

## Context

The same real-world event still lands as **two physical rows** in `hwy4_events` whenever two sources describe it differently. Read-time collapse (`dedupeEvents`) hides that on every render, but the rows persist forever in the DB. Three forces keep producing them:

1. **`dedup_key` is title-based.** `generateDedupKey(name, date, town)` only collides on byte-identical titles from the same source. Two sources, two titles, two rows.
2. **The write-time matcher only compares incoming-vs-existing.** `upsertEvents` (`scripts/lib/dedup.ts`) merges a *new* scrape into a resident row, but two rows that are *both already resident* never get re-compared. Nothing reconciles existing-vs-existing.
3. **Four heterogeneous writers, three of which bypass the matcher entirely:**
   - `scripts/lib/dedup.ts` `upsertEvents*` — runs the matcher (incoming-vs-existing only). Used by 6 scrapers + seed + facebook-events.
   - `scripts/scrapers/bistro-espresso.ts` — **raw `.insert()`**, only `generateDedupKey`, no fuzzy matcher.
   - `app/api/scrape-bls/route.ts` — **raw `.insert()`** (Blue Lake Springs Vision-AI flyers).
   - `app/api/scrape-moose-lodge/route.ts` — **raw `.insert()`** (Moose Lodge PDF calendar).

The lesson from #3: you cannot get to "one event, one row" by upgrading writers. There are four of them, they're wired differently (CLI via GitHub Actions, Vercel cron API routes), and a fifth will appear. **Fix the system, not the writers.** Run one reconciliation that operates on DB state — blind to who wrote the rows — and every present and future writer is covered.

**Outcome:** the DB stays physically de-duplicated continuously. Read-time collapse is demoted from load-bearing safety net to a thin, eventually-removable backstop. Every automated merge is logged and reversible.

## Goals / Non-Goals

**Goals**
- A single reconciliation engine that merges resident duplicates using the shared `isSameEvent` (no new identity logic — reuse the test-locked predicate).
- It runs automatically, covering **all** write paths including the three that bypass `upsertEvents`.
- Every merge is auditable and reversible (a merge log), because automated `DELETE` on a false positive is the one real risk.
- An evidence-gated path to deleting read-time `dedupeEvents`.

**Non-Goals**
- No new "same event" rule. The predicate is frozen in `lib/event-identity.ts`; this only changes *when/where* it runs.
- No blunt DB unique constraint (see *Rejected Alternatives*).
- No rewrite of the four writers' matchers (optional follow-up, not required — the reconcile covers them).
- Not deleting read-time collapse in this PRD — only earning the right to, later, with data.

## Approach

### Step 1 — Extract the reconcile engine (delete duplication, again)

`scripts/backfill-dedup.ts` already does exactly the existing-vs-existing reconcile: it pulls future rows, clusters with the shared `clusterEvents`, keeps the richest via `pickSurvivor`, back-fills the survivor from losers (description, image, url, address, price, source_event_id, union of artists), and deletes losers. **Lift that body into a reusable `scripts/lib/reconcile.ts`** exporting:

```
reconcileDuplicates(opts: { fromDate?: string; dryRun: boolean }):
  Promise<{ clusters: number; merged: MergeRecord[]; deleted: number }>
```

`backfill-dedup.ts` becomes a thin CLI wrapper over it (preserving `--execute`). The reconcile must, per merge, write a `MergeRecord` to the new audit table (Step 3) **before** deleting the loser. Same shared `clusterEvents`/`pickSurvivor` — so the engine, the backfill, the read-time collapse, and the audit all share one definition.

### Step 2 — Run it automatically over every writer (automate)

Add a Vercel cron route **`app/api/reconcile-dupes/route.ts`** (CRON_SECRET-gated, service-role client), calling `reconcileDuplicates({ dryRun: false })` over future events. Schedule it in `vercel.json` **after the scrape windows and before the daily audit**:

| Existing write window | |
|---|---|
| GitHub Actions scrape | 08:00 UTC |
| `/api/scrape-bls`, `/api/scrape-moose-lodge` | Mon 13:00 / 14:00 UTC |
| **→ `/api/reconcile-dupes` (NEW)** | **daily ~15:30 UTC** |
| `/api/check-events` audit | 18:00 UTC (now reports post-reconcile truth) |

One cron, run as service role, covers `upsertEvents` scrapers **and** the three raw-insert writers **and** any writer added later. This is the whole point: coverage is a property of running on DB state, not of each writer's code.

(Optional hardening, not required for this PRD: have each writer call `reconcileDuplicates({ fromDate: minDate })` scoped to its touched dates at the end of its run, shrinking the dirty window from ~a day to ~seconds. Defer unless the daily cadence proves too slow.)

### Step 3 — Make every merge reversible (the safety rail)

A scheduled job that `DELETE`s rows is only safe if mistakes are recoverable. Add migration **`supabase/migrations/<date>_event_merge_log.sql`**:

```
event_merge_log(
  id uuid pk default gen_random_uuid(),
  survivor_id uuid not null,
  merged_from_id uuid not null,      -- the deleted row's id
  merged_snapshot jsonb not null,    -- full deleted row, for restore
  signal text not null,              -- which isSameEvent branch fired
  merged_at timestamptz default now()
)
```

**RLS is mandatory and goes in the same migration** (project hard rule): enable RLS, add a policy (service-role full access; anon no access). The reconcile writes one row here per merge before deleting the loser, capturing the full row as `merged_snapshot` so any false merge is one `INSERT … SELECT` away from restoration. `/api/check-events` gains a line reporting merges in the last 24h.

### Step 4 — Earn the right to delete read-time collapse (evidence-gated)

Do **not** remove `dedupeEvents` now. Gate it on data: once `/api/check-events` reports **0 duplicate clusters and 0 surprising merges for N consecutive weeks** (recommend 4), downgrade read-time collapse to a dev-only assertion (`if (process.env.NODE_ENV !== 'production') assert(noDupes)`), then remove it a release later. Until then it's a free backstop (O(n) per render, already shipped). This step is a checklist item for a future session, not code now.

## Rejected Alternatives

- **DB unique constraint on a canonical key.** Tempting ("structurally impossible to insert a dupe"), but the identity predicate has five heterogeneous signals — title similarity, artist overlap, description similarity, venue+generic-title, venue+act-named-in-other — none reducible to a deterministic column. A constraint on `town|date|start` is unsafe: two *different* shows at *different* venues in the same town at 7pm share that key and would be wrongly rejected. `isSameEvent` deliberately requires a venue + signal match; SQL can't express it. **Identity stays procedural.** `dedup_key`'s existing unique constraint stays (it correctly blocks same-title re-scrapes); we add reconciliation, not a second key.
- **Fix each writer's matcher.** Four writers, three wired differently, a fifth inevitable. O(writers) work that decays; the reconcile is O(1) and covers all.
- **Synchronous existing-vs-existing pass inside `upsertEvents`.** Helps the 5 scrapers that call it, does nothing for the 3 raw-insert writers. The cron supersets it.

## Critical Files

- **New:** `scripts/lib/reconcile.ts` (engine), `app/api/reconcile-dupes/route.ts` (cron), `supabase/migrations/<date>_event_merge_log.sql` (table + RLS).
- **Edit:** `scripts/backfill-dedup.ts` (thin wrapper over the engine), `vercel.json` (cron entry), `app/api/check-events/route.ts` (report recent merges), `CLAUDE.md` (cron table + this PRD in the index).
- **Reuse, unchanged:** `lib/event-identity.ts` (`isSameEvent`), `lib/dedupe-events.ts` (`clusterEvents`, `pickSurvivor`) — the engine imports these; the definition does not fork.

## Verification

1. **Engine parity:** `reconcileDuplicates({ dryRun: true })` and the existing `backfill-dedup.ts` dry-run report the identical cluster set against prod (they must — same shared `clusterEvents`).
2. **Merge log round-trip:** run `--execute` on a seeded test dupe in a Supabase branch; confirm one `event_merge_log` row with a complete `merged_snapshot`, and that re-inserting from the snapshot fully restores the deleted row.
3. **Coverage proof:** insert a deliberate cross-source dupe via the **raw-insert** path (e.g., a scrape-bls-style row) that `upsertEvents` would never see; confirm the cron reconcile merges it. This is the test that the system-level fix actually closes the writer-bypass gap.
4. **Cron auth:** `curl -H "Authorization: Bearer $CRON_SECRET" .../api/reconcile-dupes` returns a merge summary; without the bearer it 401s.
5. **Audit reflects reality:** after a reconcile run, `/api/check-events` reports 0 same-event clusters and the 24h merge count.
6. **No regression to the predicate:** `cd scripts && npm test` stays green (the engine adds no new identity logic).

## Rollout

1. Ship the migration (table + RLS) and engine first, **dry-run/report only** — the cron logs what it *would* merge for one week. Watch `/api/check-events`.
2. Flip the cron to `--execute` once a week of dry-runs shows only genuine merges (the predicate is already test-locked, so this is a confidence check, not a gamble).
3. Start the N-week clean-streak clock for Step 4 (read-time removal), tracked as an open item in `CLAUDE.md`.

Risk is concentrated in one place — automated `DELETE` — and fully mitigated by the merge log (every deletion reversible), the canary week, the test-locked predicate, and the existing audit watchdog.
