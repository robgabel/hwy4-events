# PRD: Bear Valley Adventure Co. (bvadventures.com) Event Source

> **Status (2026-07-07):** Plan — not yet built. Source analysis verified against a live Firecrawl scrape of the page. Predecessor context: `PRD-bear-valley-events.md` §"Future sources" flagged bvadventures.com as a Phase 4+ candidate.

## Overview

Add Bear Valley Adventure Co. (BVAC, [bvadventures.com/events](https://www.bvadventures.com/events)) as a scraped event source. BVAC is the Bear Valley village outfitter (boat/bike rentals, XC ski center, Reba's cafe) and runs or hosts a real events program: guided ranger hikes, trail work days, the Bjornloppet XC race weekend, kids' fishing day, pickleball/tennis lessons, MTB clinics, the July 4th pancake breakfast, and more. This deepens Bear Valley coverage (the thin end of the corridor) with first-party, machine-readable data.

## Source Analysis (verified 2026-07-07)

- **Platform:** Squarespace events collection. Direct `curl` fails (connection reset), but **Firecrawl fetches it cleanly** — same access path as every other config-driven source, no special handling needed.
- **Structure:** each event block carries a title, full date ("Saturday, July 11, 2026"), start/end times, venue name + a Google Maps address link, a 1–3 sentence description, a poster image, an ICS link, and a **durable per-event permalink** (`bvadventures.com/events/<slug>`). This is better-structured than most existing sources.
- **Volume:** ~49 event entries on the page, **including past events back to March 2025**. Future events at scrape time: roughly 20–25, spanning through October 2026.
- **Locations seen on the page:** 1 Bear Valley Road (BVAC / village entrance), 2280 State Route 207 (the ski resort), 39 No Name Road #34 (Big White Tent / Music Festival), and **two Markleeville, CA 96120 addresses** (Death Ride, Alpine County) — out of corridor.
- **Content mix — three flavors:**
  1. Real corridor events (most of the page): ranger hikes, trail work days, Bjornloppet, kids' fishing day, lessons, clinics, pancake breakfast, Hermitfest West, boat/bike sale.
  2. **Retail promos, not events:** "Season Pass Sale", "3rd Grader Season Pass", "$20/$25 Trail Pass Tuesdays", "Labor Day Weekend Store Sale". These are commerce announcements and should not become event rows (same philosophy as the `is_routine` work, but handled at extraction — the `is_routine` blast radius stays locked to sequoia-woods + moose-lodge per CLAUDE.md).
  3. **Out-of-corridor events:** the Death Ride (Markleeville). Drop at the corridor filter.

## Plan

### 1. One config entry (the core change)

Add to `scripts/scrapers/firecrawl-sources.ts`:

```ts
{
  slug: "bvac",
  name: "Bear Valley Adventure Co.",
  pageTitle: "Bear Valley Adventure Co. Events",
  url: "https://www.bvadventures.com/events",
  defaultVenue: "Bear Valley Adventure Company",
  defaultTown: "Bear Valley",
  defaultAddress: "1 Bear Valley Road, Bear Valley, CA 95223", // verify vs their /contact-us before shipping
  dumpOnEmpty: true,
}
```

The orchestrator (`scripts/scrape.ts`) auto-registers every `FIRECRAWL_SOURCES` entry, and the daily GitHub Action (`scrape.yml`) runs argless, so no dispatch or workflow change.

### 2. `hwy4_orgs` row (FK requirement)

`hwy4_events.org_slug` is FK'd to `hwy4_orgs` (the Red Cross precedent). Migration adds the `bvac` org row.

- **Leave `canonical_url` NULL** — same reasoning as red-cross: the per-event Squarespace permalinks are durable (`bvadventures.com` is not an unstable host), so the link resolver's stable-source path (#3) surfaces each event's own page, which beats one generic organizer URL. Can revisit + enroll `canonical_check_enabled` later if date drift ever shows up.

### 3. Shared extractor hardening (`scripts/lib/extract.ts`) — required, not optional

Two changes, both safe for every existing source:

- **Raise `max_tokens` 2048 → 8192.** The BVAC page yields ~49 events; at ~100 output tokens per event the JSON array blows the current 2048 cap, the truncated JSON fails `JSON.parse`, and the whole source silently extracts 0. This is the single biggest failure mode for this source.
- **Pass today's date into the prompt + a rule to skip already-past events.** The runner already filters `e.date >= today` post-hoc, but instructing the model not to emit the ~25 past entries halves output size (belt: prompt, suspenders: runner filter).

And one small config affordance:

- **Optional `extractHint?: string` on `FirecrawlSource`,** appended to the prompt's Rules block. BVAC's hint: *"Skip retail promotions (season pass sales, discounted trail-pass days, store sales) — they are not events. Many events here are NOT at the store: lift each event's own venue name and street address from its map link (Lake Alpine, the Big White Tent, Bear Valley Meadow, etc.)."* Per-source and surgical; other sources are untouched until they opt in.

### 4. Corridor filter: add Markleeville (`scripts/lib/corridor.ts`)

Add `"markleeville"` to `NON_CORRIDOR_CITIES` so the Death Ride entries (addresses say "Markleeville, CA, 96120") drop at upsert — the extract prompt hardcodes `town` to the source default, so the address/description checks are what will catch these. Also check whether the DB-layer backstop trigger (referenced in `isNonCorridorDescription`'s comment) enumerates cities; if so, mirror the addition there via a migration.

### 5. Manual-sources conflict: the `"lake alpine"` pattern (decision needed)

`scripts/lib/manual-sources.ts` blocklists the substring `"lake alpine"` (protecting the hand-seeded Lake Alpine Lodge music lineup). BVAC's **"Lake Alpine Kid's Fishing Day"** — a genuinely good kids event — matches by *event name* and would be silently skipped by every auto-scraper.

**Recommendation:** narrow the pattern to `"lake alpine lodge"`. First verify the seeded rows' `venue_name` is "Lake Alpine Lodge" (it is, per the seed script) and grep recent scrapes for aggregators listing lodge shows under a bare "Lake Alpine" venue. If that bare form shows up in the wild, keep the broad pattern and hand-seed the fishing day instead. Either way, decide deliberately — don't let the blocklist eat it by accident.

### 6. Venue registry entry

Add `bear-valley-adventure-co` to `scripts/lib/venues.ts` (canonical "Bear Valley Adventure Company"; aliases: "bear valley adventure company", "bear valley adventure co", "bvac", "bear valley adventures"; town Bear Valley; address verified from their site). Then the standard sequence: `npm run seed-venues` → `npm run backfill-venue-keys -- --apply`. Downstream self-heals per CLAUDE.md: daily `?only=new` Places sync fills `place_id`/facts, the blurb + address drafters queue into `/admin/venues`.

Note: `bear-valley-meadow` already holds "1 Bear Valley Road" (the Grizzly ballfield at the village entrance, and the existing home of the Hermitfest alias). BVAC the store sits at the same corner; registry entries are name-keyed so the shared address is fine, but confirm BVAC's exact street address rather than assuming.

### 7. Dedup expectations (no changes, just watch)

Several BVAC listings overlap existing coverage; the standard layers should absorb them, but eyeball the first run:

- **Bear Valley Music Festival:** BVAC lists it as one dated entry. The hand-seeded umbrella row is protected by design (NULL `start_time` + year-suffixed title, per CLAUDE.md), so no collision there; the BVAC row should merge with the GoCalaveras opening-night row via the generic-title signal (`isGenericTitle` covers umbrella titles) or get cleaned by the daily reconcile.
- **Hermitfest West, July 4th Pancake Breakfast & Parade, Tour de Bear Valley:** likely already present via GoCalaveras/bearvalley.com — write-time `isStrongEventMatch` + daily `/api/reconcile-dupes` are the net.
- After the first live run: check `/api/check-events` for same-event clusters and `merges_last_24h`.

### 8. Rollout

1. Land steps 1–6 (one PR: config entry + org migration + extractor changes + corridor + registry; the manual-sources decision from step 5 included or explicitly deferred).
2. Manual first run: `cd scripts && npx tsx scrape.ts --source bvac` (or the equivalent single-source invocation) with prod env; review the console extraction list before/after upsert — confirm promos skipped, Death Ride dropped, ~20 real events landed with per-event `event_url`s.
3. Verify a few detail pages: durable "Visit … ↗" CTA resolves to the Squarespace permalink, venue section renders once the registry lands, weather chip shows Bear Valley temps.
4. It then rides the daily 8am UTC scrape Action automatically. No watcher cron needed — unlike the Lube Room/Camp Connell image schedules, this page is machine-readable, so the scraper itself is the watcher.

## Non-goals

- No hand-seeding: the page is structured enough for the generic pipeline (the whole point of adding it as a config-driven source).
- No `is_routine` wiring for the promos — extraction-time skip only, preserving the two-venue blast-radius invariant.
- No canonical date-verification enrollment at launch (revisit if drift appears).

## Effort

Small. One config entry, one 2-line migration, ~15 lines across `extract.ts`/`corridor.ts`/`manual-sources.ts`, one registry entry, plus the manual first-run review.
