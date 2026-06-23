# HANDOFF — Live Music Experience, Phases 1–3

**For:** a fresh session picking up the live-music work after Phase 0 shipped (2026-06-21).
**Read first:** [`PRD-live-music-experience.md`](PRD-live-music-experience.md) — the *why*, the persona map, and the **Tier A/B/C accuracy contract** that governs every "fill the blank." This doc is the *how*: concrete steps, files, patterns to clone, and guardrails so you can execute without re-deriving anything.

## State of play (what Phase 0 already did)

- 7 venues registered in `scripts/lib/venues.ts` (incl. `make-and-partake` restored); `backfill-venue-keys` linked 923 events; `sync-venue-facts` populated Google facts + `places_attributes`; 7 voice blurbs published.
- **`/admin/venues`** (`app/admin/venues/{page.tsx,actions.ts}`) is the human review surface for Tier-B blurbs (list, edit, save, clear; nav badge counts missing blurbs via `countMissing` in `lib/admin/db.ts`).
- Live-music venue-section coverage: **257/258**. Detail page (`app/events/[slug]/page.tsx`) already renders `VenueInfo` (blurb + facts), `WeatherChip`, and `artists`.

**Orientation — the files you'll reuse most:**
- Venue registry + matcher: `scripts/lib/venues.ts`, `scripts/lib/venue-matcher.ts` (`resolveVenueKey`), `scripts/backfill-venue-keys.ts`, `scripts/draft-venue-blurbs.ts`, `app/api/sync-venue-facts/route.ts`.
- Agent Cockpit (the propose→approve→execute→revert loop to clone): `lib/agent/propose-link-gaps.ts`, `lib/link-gaps.ts` (shared worklist), `lib/agent/policy.ts` (`canAutoExecute`), `lib/agent/actions-executor.ts`, `lib/agent/research-org.ts`, `lib/agent/auto-runner.ts`, `lib/agent/types.ts`, `app/api/agent/propose-actions/route.ts`, `app/admin/actions/{page.tsx,actions.ts}`. Tables: `agent_actions`, `agent_policy` (RLS service-role only).
- Admin kit: `lib/admin/db.ts`, `lib/admin/flash.ts`, `components/admin/ui.tsx`, `components/admin/AdminNav.tsx`, Basic Auth in `middleware.ts`.
- Detail page + surfaces: `app/events/[slug]/page.tsx`, `components/VenueInfo.tsx`, `components/WeatherChip.tsx`, `lib/weather.ts` (`getForecast`, `resolveEventWeather`; `getForecastsByTown` for multi-town lists), `lib/event-link.ts` (`resolveEventLink`).
- Voice: `content/VOICE.md`, `lib/voice.ts` (`withVoice()`), `scripts/voice-lint.ts`.

> **DB project id:** `uzediwokyshjbsymevtp` (shared rob-ai/PAOS project). Apply migrations via the Supabase MCP. Never disable RLS; new tables ship with RLS + a policy in the same migration.

---

## Phase 1A — Self-healing venue-gap proposer ✅ SHIPPED 2026-06-22

**Decisions made (the Open decisions below, resolved by Rob):** executor is **row + snippet only** (Open #1 → option B); threshold **N=3** (Open #2). Built: migration `20260622_create_venue_row_policy.sql` (policy row, human-gated); worklist `lib/venue-gaps.ts` (`venue_key IS NULL` + real non-generic name not already a registered canonical, ≥3 upcoming public events; pure core locked by `scripts/test/venue-gaps.test.ts`); Tier-A address research `lib/agent/research-venue.ts`; proposer `lib/agent/propose-venue-rows.ts` folded into `/api/agent/propose-actions` + the `/admin/actions` "Scan" button; `create_venue_row` executor + revert in `lib/agent/actions-executor.ts`; the `create_venue_row` card (research-prefilled fields + copyable `venues.ts` snippet) in `app/admin/actions/page.tsx`. On approve: insert the `hwy4_venues` row (venue section + weekly Places facts light up immediately; reversible = delete the row) **and** commit the emitted `scripts/lib/venues.ts` snippet to link events durably (the matcher re-nulls an unregistered venue's `venue_key` on re-scrape, so the registry commit is load-bearing). Verified: 145 scripts tests pass, `tsc` clean, full `next build` clean, executor insert validated against the live `hwy4_venues` schema. The live worklist surfaces real gaps today (Murphys Volunteer Library ×11, Gateway Hotel Pool ×4, …). The original plan follows for reference.

**Goal:** a new venue that starts hosting events gets *proposed* into the registry within a week instead of rendering bare for months. Today the only signal is `/api/check-events` reporting unresolved venues to Slack; nobody actions it systematically.

**Clone this exactly:** the link-gap loop. `lib/link-gaps.ts` defines the worklist; `lib/agent/propose-link-gaps.ts` + `app/api/agent/propose-actions/route.ts` stage `agent_actions` rows; `app/admin/actions` disposes them; `lib/agent/actions-executor.ts` executes on approve and supports revert. Mirror it for venues.

**Steps:**
1. **Worklist** — add a `venueGaps()` to a shared lib (extend `lib/link-gaps.ts` or a sibling `lib/venue-gaps.ts`): venue *names* appearing on ≥N upcoming public events with `venue_key IS NULL`, excluding generic/junk names (reuse `GENERIC_VENUE_NAMES` from `scripts/lib/venues.ts`) and anything `resolveVenueKey` already resolves. Use this same function in `/api/check-events` so the audit and the proposer can't drift (the link-gap precedent).
2. **Action type** — add `create_venue_row` to the `agent_actions` flavors in `lib/agent/types.ts`. Payload: `{ venue_key (kebab proposal), canonical, town, address }`.
3. **Proposer** — `lib/agent/propose-venue-rows.ts` + wire into `app/api/agent/propose-actions/route.ts` (or a new `/api/agent/propose-venues`, cron weekly). Pre-fill the address via web research like `lib/agent/research-org.ts` (Sonnet + `web_search`; reject social/aggregator hosts), so the human just verifies + approves.
4. **Executor** — extend `lib/agent/actions-executor.ts`: on approve, append the venue to `scripts/lib/venues.ts` **and** upsert the `hwy4_venues` row, then run the equivalent of `seed-venues` + a scoped `backfill-venue-keys` for that venue. **Reversibility:** snapshot is "remove the registry entry + delete the venue row" (record enough in the action's `before_snapshot`). ⚠️ A clean approach: the proposer writes the row to `hwy4_venues` directly (revertible: delete row), and separately emits the `scripts/lib/venues.ts` diff for a human to commit (code can't self-edit the deployed registry). Decide which (see Open decisions).
5. **Policy/guardrail** — `lib/agent/policy.ts` `canAutoExecute` already enforces low-blast + reversible + internal + policy-flag. Keep `agent_policy.auto_execute=false` for `create_venue_row` until a canary holds (the existing graduation pattern). A human approves at `/admin/actions`.

**Verify:** seed a fake unregistered venue with ≥N events → run the proposer → it appears at `/admin/actions` with a researched address → approve → venue row created + events linked → revert → row gone, events back to null.

**Guardrails:** registry address is Tier A (verified). The proposer proposes; a human always approves. Keep it region-agnostic (no Calaveras hardcoding — see `BUSINESS-PLAN.md` moat).

---

## Phase 1B — Auto-queue blurb drafts into `/admin/venues`

**Goal:** after the weekly Places sync, any venue missing a blurb gets a *drafted* Tier-B blurb waiting for one-click approval — hands-off to draft, never auto-published.

**Steps:**
1. After `/api/sync-venue-facts` runs (or a sibling weekly cron), for each venue with `blurb IS NULL` + a resolved `place_id`, generate a draft with the **same engine** `scripts/draft-venue-blurbs.ts` uses (extract its core into a `lib/` function callable from a route; it already grounds in `places_attributes` + live review snippets + `docs/LOCAL-KNOWLEDGE-BASE.md`, runs `withVoice()`, and refuses hard voice violations).
2. Store the draft in a **pending** field, *not* `blurb` — e.g. add `hwy4_venues.blurb_draft` + `blurb_draft_at` (migration, RLS already on the table). Do **not** write `blurb` (that's the published, human-approved field).
3. Surface the draft on `app/admin/venues/page.tsx`: when `blurb_draft` exists and `blurb` is empty, show it in the textarea (pre-filled) with an "AI draft — review before publish" note; **Save** publishes it to `blurb` (existing `saveBlurb` action), clearing `blurb_draft`. Add a "Discard draft" action.
4. Flag review-sourced specifics (names) as lower-confidence in the UI (the PRD's open-item list shows why).

**Verify:** null a venue's blurb → run the draft cron → the draft shows on `/admin/venues` → Save publishes it; the public detail page renders it.

**Guardrail:** this is the crux of the accuracy contract — a machine may *draft* but never *publish* voice copy. `blurb` is only ever written by a human Save.

---

## Phase 2 — Compose the live-music *night* (the "awesome" leap)

**Key insight:** the ingredients are already on the detail page (`app/events/[slug]/page.tsx` imports `getForecast`/`resolveEventWeather`/`WeatherChip`/`VenueInfo` and renders `artists`). Phase 2 is **arrangement + surfacing**, not new data.

**Goal:** above the fold, a live-music event answers at a glance — *who's playing, what's the place like, what's the weather at showtime, can I bring kids/dog, how do I get there.* The reliable emotional state is **anticipation**.

**Steps:**
1. **Surface practical signals** — `places_attributes` (dog-friendly, kids, patio, parking) already syncs but isn't shown on the public page. Add a compact, factual badge row to `components/VenueInfo.tsx` (or a sibling) — Tier A, so safe. This is the single highest-value add for Jen/Mia.
2. **Compose, for live-music category only** — a tight "the night" block near the top of the detail page: band name(s) + the weather chip + 2–3 practical badges + the one-tap actions (directions/calendar/share already exist in the action rail). Don't build a new layout system; assemble existing components.
3. **Design discipline (Jobs/Shiva lens):** the spread/signal is the evidence, the verb is the product. No hour-by-hour weather strip; no attribute dump — show the 2–3 that matter. Mobile-first; keep the client tree shallow (see CLAUDE.md UI Standards / `WeeklyBriefing` pattern).

**Verify:** a winery live-music event detail page shows band + showtime weather + dog/patio + directions above the fold on mobile; a non-music event is unchanged (gate on `category`).

**Guardrails:** weather is already per-town/event-hour (don't regress that). Keep it category-scoped so it doesn't bloat every event.

---

## Phase 3 — Bets (validate with behavior before building big)

**3A — Artist link layer.** Today `artists` is a `string[]` of names. The accurate fill (Tier A discipline): **link** an artist to their own site / Spotify / Bandcamp when discoverable — never *describe* their sound from thin air.
- Pattern: a resolver like `lib/event-link.ts`'s `resolveEventLink` but for artists; or a small `artist_links` table (name → url, human/curated or research-verified). Render artist names as links on the detail page (`app/events/[slug]/page.tsx` ~line 550) and optionally in JSON-LD `performer`.
- Bonus (Shiva: creators + platform grow together): linking out helps the band → earns cooperation (they send schedules/posters).

**3B — `/live-music` hub / "Tonight's music".** 259 events is ~2× the homepage horizon; a dedicated surface for Mia + Miguel. **Phase-appropriate:** ship 1–2 first, watch behavior (instrument via the existing `site_events` / `OutboundTracker`), then build only if usage asks. Reuse `getUpcomingEvents` + the category filter; don't fork the feed-shaping in `lib/events-data.ts`.

---

## Cross-cutting guardrails (apply to every phase)

- **Accuracy contract (PRD Tier A/B/C):** verified facts auto-fill; voice copy is human-approved; unknown punts gracefully. A confident wrong answer is worse than a blank.
- **Voice:** any new LLM generator must inject `withVoice()` and pass `scripts/voice-lint.ts`; any new public copy surface too. No em dashes; no invented hours/cadence/names; no internal-tooling references (`content/VOICE.md`).
- **Reversibility + dry-run-first:** mutations snapshot before they change/delete (mirror `event_merge_log` / `agent_actions.before_snapshot`); ship report-only, then canary, then live (the `RECONCILE_EXECUTE` / `agent_policy.auto_execute` precedent).
- **Region-parameterized:** no Calaveras hardcoding — the portability of the engine is the monetization moat (`BUSINESS-PLAN.md`).
- **Migrations:** RLS + policy in the same migration; service-role-only for agent/internal tables.

## Open decisions for Rob

1. ~~**Phase 1A executor**~~ — **RESOLVED (2026-06-22): row + snippet only.** Approve writes the `hwy4_venues` row (revertible) and emits a `scripts/lib/venues.ts` snippet for a human to commit; the executor does NOT set `venue_key` on events (that would decay on the next re-scrape until the registry commit lands — and we chose no silent-decay state). Events link durably via the committed registry + the normal backfill/scrape.
2. ~~**Phase 1A threshold `N`**~~ — **RESOLVED (2026-06-22): N=3** (`VENUE_GAP_THRESHOLD` in `lib/venue-gaps.ts`). Lower than link-gap's ≥5 to catch smaller real series (a bare venue page is a bigger hole than an aggregator link).
3. **Phase 2 scope:** badges-only first (cheap, high value), or the full composed "night" block in one pass?
4. **Phase 3A artist links:** curated table vs. web-research resolver vs. skip until an organizer asks.

## Verify-before-push reminders (this codebase bit us twice)
- Worktrees sit on a **stale base** — `git fetch` + check HEAD vs `origin/main` before pushing (a competing PR shipped the same weather fix mid-session).
- Prod `ADMIN_PASSWORD` ≠ local `.env.local`, and middleware 401s all `/admin/*` before routing — verify admin-route deploys via the Vercel **Production** deployment status, not an authed curl.
