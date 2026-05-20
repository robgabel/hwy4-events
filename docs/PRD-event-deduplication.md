# PRD: Event Deduplication — Identity Model, Merge Semantics, and DB Guarantees

**Author:** Rob Gabel + Claude
**Date:** 2026-05-20
**Status:** Draft
**Owner:** Rob
**Affected surfaces:** `hwy4_events` table, all `scripts/scrapers/*`, `scripts/lib/dedup.ts`, briefing generation, homepage event list, org pages

---

## Problem Statement

`hwy4events.com` currently shows duplicate event entries. Some duplicates carry more information than their siblings (full venue name, full street address), while the visible "winner" is the thinner record. Users see the same event listed two or three times — and the version they click is often the one missing the address.

### Magnitude (measured 2026-05-20)

| Metric | Value |
|---|---|
| Future events (date ≥ today, public, confirmed) | 553 |
| Duplicate groups (same name + date, ignoring town) | **72** |
| Rows belonging to a duplicate group | **146** (~26%) |
| Future rows with `venue_name = NULL` or `"Unknown Venue"` | 225 (~41%) |
| Future rows with `address = NULL` | 418 (~76%) |

A 26% duplicate rate is destroying trust in the listings and corrupting the daily briefing (Opus is summarizing duplicated events as two separate weekend activities). Every new scraper added makes this worse.

---

## Diagnosis: What's Actually Broken

The current dedup logic lives in [scripts/lib/dedup.ts](scripts/lib/dedup.ts) and is wired into every scraper via `upsertEvents()`. The migration that introduced it is [supabase/migrations/20260312_add_dedup_and_bear_valley_org.sql](supabase/migrations/20260312_add_dedup_and_bear_valley_org.sql).

### Bug #1 — Town is in the primary key, and town is unreliable

`dedup_key = sha256(normalizeName(name) | date | normalizeTown(town))` at [dedup.ts:48-55](scripts/lib/dedup.ts:48).

Calaveras Big Trees State Park sits at the junction of Arnold, Dorrington, White Pines, and Avery. GoCalaveras tags the **same** event under any of these four towns on different scrapes. Each variant produces a different hash → fresh insert. Same pattern for:

- Trails of 49 (Arnold ↔ Bear Valley)
- The Pour House (Copperopolis ↔ Murphys)
- Most Big Trees programs (4-way town drift)

`TOWN_ALIASES` only handles `white pines → arnold` and `hathaway pines → arnold`, which is the *wrong* fix — those are distinct towns, and aliasing them breaks events that actually happen at White Pines venues. The right anchor is the **venue**, not the town.

### Bug #2 — Hash drift (non-migratable dedup keys)

Two identical "Henry V – Matinee" rows in Murphys on 2026-06-14:
- Row A: created 2026-03-16, `dedup_key = 98710b99…`
- Row B: created 2026-03-20, `dedup_key = 202d44ed…`

Byte-identical `name`, same date, same town, same source, same `event_url`. The hash function changed in the 4-day window between inserts (likely the en-dash normalization or leading-`the` strip). Result: row A keeps its old hash, row B inserts with the new hash, no collision.

**Whenever `normalizeName()` is changed, the entire historical population is silently orphaned.** This will happen again every time we tune the normalizer.

### Bug #3 — Fuzzy fallback is gated by canonical town

[dedup.ts:151-160](scripts/lib/dedup.ts:151) requires `normalizeTown(c.town) === canonicalTown` before the 0.85-similarity Levenshtein check runs. Town drift (the most common dup pattern here) **defeats the fuzzy fallback by design**. The fuzzy path almost never fires in production.

### Bug #4 — Field-merge overwrites richer data with thinner data

[dedup.ts:127-139](scripts/lib/dedup.ts:127) unconditionally `UPDATE`s `venue_name`, `description`, `address`, `start_time`, `end_time`, `price`, `event_url` with the incoming values whenever any field changed. If today's scrape returns `venue_name = "Unknown Venue"` / `address = NULL` and the existing row had `"Calaveras Big Trees State Park"` / `"1170 East Highway 4, Arnold, CA 95223"`, the **richer data is clobbered**. This is why the visible duplicate is so often the thinner one.

### Bug #5 — Fuzzy re-key has no collision check

[dedup.ts:163-173](scripts/lib/dedup.ts:163) rewrites the existing row's `dedup_key` to the new computed key but never checks whether that new key already exists. The `UNIQUE` constraint will reject it; the code swallows the error and continues. Silent data loss path.

### Bug #6 — The strongest signals aren't used

Address (when present) is exact, machine-readable text. Venue normalizes well (low cardinality vocabulary in this corridor). Neither participates in the dedup key or the fallback. Yet *both* would resolve the Big Trees / Trails of 49 / Pour House cases trivially.

### Bug #7 — Cross-source name drift

"Coffee & Cars Car Show" (GoCalaveras) vs "Free Coffee & Cars Car Show at the Lodge" (FB Discover) on 2026-07-05, both at Meadowmont Lodge in Arnold. Levenshtein similarity ≈ 0.55, below the 0.85 cutoff. Two scrapers, two names for the same event, never reconciled. As we add scrapers, this class of dupe will grow.

### Bug #8 — Multi-day events get split

`"Bear Valley Music Festival (through Aug 2)"` (Bear Valley Resort) vs `"Bear Valley Music Festival"` (GoCalaveras), same venue, overlapping dates but different "start" dates. The exact-date `eq("date", event.date)` fuzzy lookup at [dedup.ts:153](scripts/lib/dedup.ts:153) misses this entirely.

### Bug #9 — `INSERT` errors are partially swallowed

[dedup.ts:200-203](scripts/lib/dedup.ts:200) logs a `console.error` on insert failure but the scraper continues and counts the event as failed-silently rather than as a merge signal. Unique-violation errors should trigger the merge path, not be discarded.

---

## Design Principles

1. **Stable identity over hash convenience.** A dedup key derived from mutable text fields will drift. Identity must anchor to a stable place (venue) and a stable time window.
2. **Merge, don't overwrite.** Richer data always wins, regardless of arrival order. The system gets *better* over time, not worse.
3. **DB enforces, code orchestrates.** Unique constraints at the database level make regressions visible and prevent silent dupes. The code's job is to resolve conflicts gracefully.
4. **Multi-source is a first-class signal, not a bug.** Two sources reporting the same event is *evidence of accuracy*. Surface it.
5. **Observable.** Every merge, every fuzzy candidate, every constraint violation lands in a queryable log. We must be able to answer "did dedup get better last week?" in one SQL query.

---

## Proposed Architecture

Six layers, sequenced from highest-leverage to lowest. The first two (Phase 1) alone should eliminate ~80% of current duplicates with minimal schema work. The remaining four (Phase 2) are the architectural fix.

### Layer 1 — `hwy4_venues` table (stable place identity)

Resolve every incoming event to a `venue_id` before keying it. This is the single most important change — it kills Bug #1 and Bug #6 in one move.

```sql
CREATE TABLE hwy4_venues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  text NOT NULL,         -- "Calaveras Big Trees State Park"
  slug            text UNIQUE NOT NULL,  -- "calaveras-big-trees-state-park"
  aliases         text[] DEFAULT '{}',   -- ["Big Trees State Park", "CBTSP", "Big Trees"]
  town            text NOT NULL,         -- canonical town for display
  address         text,
  lat             numeric,
  lng             numeric,
  fb_place_id     text,                  -- when known
  org_slug        text REFERENCES hwy4_orgs(slug),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX hwy4_venues_aliases_gin ON hwy4_venues USING gin (aliases);
CREATE INDEX hwy4_venues_canonical_trgm ON hwy4_venues USING gin (canonical_name gin_trgm_ops);

ALTER TABLE hwy4_events ADD COLUMN venue_id uuid REFERENCES hwy4_venues(id);
CREATE INDEX hwy4_events_venue_id ON hwy4_events (venue_id);
```

**Resolution order at scrape time** (`resolveVenue(name, address, town, fb_place_id)`):

1. Exact `fb_place_id` match → done.
2. Exact normalized address match → done.
3. Exact alias match (`venue_name` normalized → `aliases` array) → done.
4. Trigram similarity ≥ 0.85 on canonical_name with same town → done.
5. No match → create new venue (canonical_name = scraped venue_name, town = scraped town, address = scraped address).

Seed initial venues from existing data using a one-shot consolidation script that groups by `(normalized venue_name, address)` and picks the longest/richest representative.

### Layer 2 — Layered identity keys

Replace the single `dedup_key` with **three** keys, applied in order:

| Key | Formula | Purpose |
|---|---|---|
| `source_key` | `hash(source_name, source_event_id ?? event_url)` | Same scraper revisiting the same URL — instant match, no fuzzy needed |
| `identity_key` | `hash(slugify(name_root), date_range_start, venue_id)` | Cross-source identity. `name_root` strips trailing noise; `venue_id` is stable across town drift; `date_range_start` handles multi-day events |
| `fuzzy_candidate` | Trigram on `name` + same venue_id + date within ±1 day | Seeds the manual review queue. Only auto-merges above 0.95; below that, flags for review |

```sql
ALTER TABLE hwy4_events
  ADD COLUMN source_event_id text,
  ADD COLUMN source_key text,
  ADD COLUMN identity_key text,
  ADD COLUMN date_range_start date,
  ADD COLUMN date_range_end   date;

CREATE UNIQUE INDEX hwy4_events_source_key_uniq
  ON hwy4_events (source_key)
  WHERE source_key IS NOT NULL;

CREATE UNIQUE INDEX hwy4_events_identity_key_uniq
  ON hwy4_events (identity_key)
  WHERE identity_key IS NOT NULL;
```

Why three keys not one: hash drift becomes **recoverable**. Change the `name_root` rules and you can recompute `identity_key` for the whole table in a single migration; the `source_key` chain stays intact and gives you an idempotent way to re-resolve every row.

#### `name_root` normalization (deterministic, versioned)

```ts
function nameRoot(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')                       // Unicode canonical form
    .replace(/[‐-―−]/g, '-') // en/em-dash → hyphen
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\s*\([^)]*\)\s*$/g, '')        // strip trailing "(through Aug 2)"
    .replace(/\s+(at|@)\s+.*$/i, '')         // strip trailing "at the Lodge"
    .replace(/^(free|the)\s+/, '')           // strip leading "Free", "The"
    .replace(/[^\w\s-]/g, '')                // strip remaining punctuation
    .replace(/\s+/g, ' ')
    .trim();
}
```

Bump a `NAME_ROOT_VERSION` constant alongside this function. The migration script reads the version and only rebuilds `identity_key` for rows below the current version. This makes future normalizer tweaks safe.

### Layer 3 — Merge, don't overwrite

Replace the unconditional update in `upsertEvents` with a **field-by-field merge** in a new `mergeEvent()` helper:

| Field | Merge rule |
|---|---|
| `venue_name`, `address`, `description` | Keep existing if new is null/empty/`"Unknown Venue"`; else prefer longest non-empty value from a trusted source |
| `start_time`, `end_time`, `price`, `event_url` | Overwrite with newest non-null |
| `name` | Keep existing canonical; append alternates to new `name_variants[]` column |
| `town`, `venue_id` | Keep existing (already resolved via Layer 1) |
| `sources` | Append `{source_name, source_url, source_event_id, last_seen_at}` to a new `sources` jsonb array |
| `last_scraped_at`, `updated_at` | Always update |

This solves "the duplicate has more info" **by design** — richer data wins regardless of arrival order. It also enables a small UX win: display "Seen on GoCalaveras + Facebook" as a trust signal on the event card.

```sql
ALTER TABLE hwy4_events
  ADD COLUMN name_variants text[] DEFAULT '{}',
  ADD COLUMN sources jsonb DEFAULT '[]'::jsonb;
```

### Layer 4 — DB-level guarantees + `pg_trgm`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX hwy4_events_name_trgm ON hwy4_events USING gin (name gin_trgm_ops);

-- Unique constraints are already declared above in Layer 2.
-- Surface insert errors as merge signals, not silent failures.
```

`upsertEvents` should catch unique-violation errors (`23505`) and route them to `mergeEvent()` rather than swallowing them.

### Layer 5 — Duplicate review queue

For fuzzy candidates below the 0.95 auto-merge threshold:

```sql
CREATE TABLE hwy4_duplicate_candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_a_id      uuid NOT NULL REFERENCES hwy4_events(id) ON DELETE CASCADE,
  event_b_id      uuid NOT NULL REFERENCES hwy4_events(id) ON DELETE CASCADE,
  similarity      numeric NOT NULL,           -- 0.0–1.0
  reason          text NOT NULL,              -- 'name_fuzzy', 'cross_source', 'date_window'
  status          text NOT NULL DEFAULT 'pending',  -- pending | merged | rejected | ignored
  resolved_by     text,                       -- 'auto' | 'rob' | future user id
  resolved_at     timestamptz,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (event_a_id, event_b_id)
);
```

Lightweight Next.js admin page at `/admin/duplicates` (gated by `CRON_SECRET` or simple env-var auth) showing pending candidates side-by-side with one-click "Merge" / "Reject" actions. Manual review only kicks in for the long tail; auto-merge handles the bulk.

### Layer 6 — Observability

Add a daily cron summary posted to `#claude-updates` Slack (or a `hwy4_dedup_health` table queried by an existing cron):

```
Hwy4 dedup health · 2026-05-21
  Future events: 553 (-3 from yesterday)
  Active duplicate groups: 4 (-68 from yesterday) ✓
  Auto-merges last 24h: 12
  Review queue: 2 pending
  Rows with NULL venue_id: 0
  Rows with NULL address: 89 (-329 from yesterday) ✓
  Per-scraper field richness (avg fields populated):
    GoCalaveras:        7.2 / 10
    FB Discover Arnold: 8.1 / 10
    Bear Valley Resort: 6.4 / 10  ⚠ (-1.2 from 7d avg)
```

The field-richness metric flags upstream scraper regressions early — if a scraper starts emitting `"Unknown Venue"` more often, the merge logic protects historical data but the metric makes the regression visible.

---

## One-Time Cleanup Migration

For the 146 existing duplicate rows:

1. **Backfill `venue_id`** for all rows by running the Layer 1 venue resolver in bulk. Persist resolved venues; review any with confidence < 0.9.
2. **Compute `identity_key`** for every row using the new `name_root` + `venue_id` formula.
3. **Group by `identity_key`** and reduce each group:
   - Pick the row with the most non-null important fields (venue_name, address, description, start_time, price, event_url). Tie-break: oldest `created_at`.
   - Apply the Layer 3 merge rules to fold sibling field data into the winner.
   - Append every sibling's source metadata into the winner's `sources` jsonb.
   - Delete the siblings.
4. **Log every action** to a one-shot `hwy4_dedup_cleanup_log` table for auditability.

Implement as a Node script under `scripts/maintenance/dedup-cleanup.ts` with a `--dry-run` flag. Expected outcome: 146 dup rows → 72 merged rows; richer field population across the board.

---

## Implementation Phases

### Phase 1 — Stop the bleed (target: 3 days, ~half-day of work)

Minimal changes to halt new duplicates and stop clobbering richer data.

- [ ] **P1.1** Add field-merge logic to [dedup.ts:127](scripts/lib/dedup.ts:127) — never overwrite a non-null field with null/`"Unknown Venue"`/empty. Prefer the longer non-empty string for `venue_name`, `address`, `description`.
- [ ] **P1.2** Drop `town` from `generateDedupKey()`. Replace with the first non-null of `(normalize(address) || normalize(venue_name) || normalize(town))`.
- [ ] **P1.3** Rehash all rows (`dedup_key` recompute migration). Use `ON CONFLICT` to collapse collisions via the new merge logic.
- [ ] **P1.4** Add the `NAME_ROOT_VERSION` constant + tests for `normalizeName` / `nameRoot` so future tweaks don't silently orphan rows.
- [ ] **P1.5** Surface insert errors (`23505`) as merge signals instead of `console.error`.

**Estimated dup reduction: ~80% of current 72 groups → ~14 remaining groups.**

### Phase 2 — Architectural fix (target: 2 weeks)

- [ ] **P2.1** Build `hwy4_venues` schema + seed from existing data + `resolveVenue()` helper.
- [ ] **P2.2** Add `venue_id`, `source_key`, `identity_key`, `date_range_start/end`, `name_variants`, `sources` columns. Backfill.
- [ ] **P2.3** Refactor `upsertEvents` to use three-key cascade (`source_key` → `identity_key` → fuzzy candidate).
- [ ] **P2.4** Run one-time cleanup migration (the 146 dup rows).
- [ ] **P2.5** Update all 11 scrapers to pass `address` and `fb_place_id` (where available) into `resolveVenue()`.

### Phase 3 — Observability + review queue (target: 1 week, can run in parallel with Phase 2 tail)

- [ ] **P3.1** Build `hwy4_duplicate_candidates` review queue table.
- [ ] **P3.2** Build `/admin/duplicates` Next.js page (gated, simple list view + merge/reject buttons).
- [ ] **P3.3** Build daily dedup health cron + Slack summary.
- [ ] **P3.4** Add per-scraper field-richness metric to detect upstream regressions.

### Phase 4 — Display upgrades (optional, after Phases 1-3 are stable)

- [ ] **P4.1** Surface "Seen on GoCalaveras + Facebook" multi-source badge on `EventCard` when `sources.length > 1`.
- [ ] **P4.2** Org pages aggregate by `venue_id`, not by source — venue pages get all events at that venue regardless of which scraper found them.

---

## Schema Summary (after all phases)

```sql
-- New table
hwy4_venues (id, canonical_name, slug, aliases[], town, address, lat, lng, fb_place_id, org_slug)

-- New table
hwy4_duplicate_candidates (id, event_a_id, event_b_id, similarity, reason, status, resolved_by, resolved_at)

-- Optional analytics table
hwy4_dedup_cleanup_log (id, event_id, action, before_state jsonb, after_state jsonb, created_at)

-- New columns on hwy4_events
+ venue_id           uuid REFERENCES hwy4_venues(id)
+ source_event_id    text
+ source_key         text   UNIQUE (partial)
+ identity_key       text   UNIQUE (partial)
+ date_range_start   date
+ date_range_end     date
+ name_variants      text[]
+ sources            jsonb DEFAULT '[]'

-- Deprecate (keep column, stop writing to it)
~ dedup_key  -- frozen for one release cycle, then dropped
```

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Venue resolver creates phantom duplicates (same physical venue → two `hwy4_venues` rows) | Medium | Review queue catches it; venue admin page allows merge. Seed venues conservatively from existing data first. |
| Cleanup migration deletes a row Rob wanted to keep | Low | `--dry-run` flag + full audit log + soft-delete pattern (set `status = 'merged_into:<id>'` instead of `DELETE`) for first run |
| `name_root` strips meaningful suffix (e.g., "Henry V – Matinee" vs "Henry V – Evening Show") | Medium | Keep the matinee/evening/PM/AM distinguishers explicitly. Add regression tests with known-distinct events. |
| FB Discover scraper's town inference is wrong, venue resolver picks bad venue | Medium | Address > town in resolution order. FB place ID is the highest-priority signal. Review queue catches misroutes. |
| Performance regression from trigram indexes on growing table | Low | Table is small (<10k rows for years to come); GIN indexes handle this trivially. Re-evaluate at 100k rows. |

---

## Success Metrics

| Metric | Baseline (2026-05-20) | Phase 1 target | Phase 2 target | Steady state |
|---|---|---|---|---|
| Duplicate groups (future events) | 72 | ≤ 15 | 0 | 0 |
| Rows with NULL address | 418 (76%) | 350 | 200 | <100 |
| Rows with NULL/Unknown venue | 225 (41%) | 150 | 50 | <20 |
| `venue_id` coverage | — | — | 100% | 100% |
| Review queue resolution SLA | — | — | <72h | <24h |

---

## Non-Goals

- **Cross-corridor venue resolution** (e.g., reconciling a Hwy 4 venue with a venue in another database). Out of scope; we only dedupe within `hwy4_events`.
- **Past event cleanup.** This PRD targets `date >= CURRENT_DATE`. Historical dupes are tolerable.
- **Replacing the scraper architecture.** Scrapers continue to call `upsertEvents()`; the change is internal to that function.
- **Soft delete + undo UI for end users.** Admin-only for now.

---

## Open Questions

- [ ] Should `event_url` participate in `source_key` even when `source_event_id` is present? (Edge case: GoCalaveras restructures URLs.)
- [ ] When two sources disagree on `start_time` for the same `identity_key`, which wins? Proposed: latest `last_scraped_at`. Confirm with Rob.
- [ ] Should `hwy4_venues` be exposed publicly (e.g., `/venues/calaveras-big-trees-state-park`)? Out of scope here but worth a follow-up PRD.
- [ ] Do we want a `confidence` score on auto-merges so the admin can spot-check the 0.95+ band? Probably yes, low cost.
- [ ] Should `is_weekly: true` events bypass the date-based identity_key entirely (since they recur)? Likely yes — for weekly events the identity_key should drop the date component.

---

## Appendix A — Examples of Current Duplicates (Live as of 2026-05-20)

| Pattern | Example | Bug # |
|---|---|---|
| Town drift, same scraper | `Big Trees State Park – North Grove Guided Hike` on 2026-06-20: Arnold (venue: Unknown) + Arnold (venue: Calaveras Big Trees) | #1, #4 |
| 4-way town drift | `Bird Walk @ Big Trees State Park` across Arnold / Dorrington / White Pines / Avery | #1 |
| Hash drift | Two `Henry V – Matinee` rows in Murphys on 2026-06-14, byte-identical name, different hashes | #2 |
| Cross-source name drift | `Coffee & Cars Car Show` (GoCalaveras) vs `Free Coffee & Cars Car Show at the Lodge` (FB Discover) | #3, #7 |
| Multi-day festival split | `Bear Valley Music Festival (through Aug 2)` vs `Bear Valley Music Festival` | #8 |
| Field clobber | Same event present twice, one with full address, one with NULL | #4 |

---

## Appendix B — Files Touched

- [scripts/lib/dedup.ts](scripts/lib/dedup.ts) — primary rewrite
- [scripts/lib/extract.ts](scripts/lib/extract.ts) — add `source_event_id` to `ExtractedEvent`
- All 11 [scripts/scrapers/*.ts](scripts/scrapers/) — pass `source_event_id` and `fb_place_id` where available
- New: `scripts/lib/venues.ts` — venue resolution
- New: `scripts/lib/merge.ts` — field-merge rules
- New: `scripts/maintenance/dedup-cleanup.ts` — one-shot cleanup
- New: `supabase/migrations/20260521_hwy4_venues_and_identity_keys.sql`
- New: `supabase/migrations/20260522_hwy4_duplicate_candidates.sql`
- New: `app/admin/duplicates/page.tsx` — review queue UI
- New: `app/api/admin/duplicates/route.ts` — merge/reject endpoints
- Possibly: `components/EventCard.tsx` — multi-source badge (Phase 4)
