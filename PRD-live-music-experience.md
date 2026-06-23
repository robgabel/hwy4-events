# PRD — Live Music Experience

**Status:** Phase 0 shipped 2026-06-21 · Phases 1–3 roadmap
**Origin:** `/brain shiva-rajaraman` session (2026-06-21), prompted by venues (Indian Rock, Camp Connell) "lacking venue details."

## Thesis

Live music is the site's **#1 category — 259 upcoming public events**, nearly 2× the next (kids, 187), and it touches 5 of 7 personas (Mia, Miguel, Gary, Karen, Jen). It's the right surface to obsess over. Through Shiva Rajaraman's lens: the blanks aren't missing *fields*, they're broken *trust-moments* — the instant someone taps a show and gets a bare page gives them no reason to commit to the drive. Filling venue facts buys **tolerance**; composing the *night* (band + venue vibe + weather + practical signals + poster) is the **love** that converts browsers.

## The accuracy contract (governs every "fill the blanks")

A confident wrong answer is a personal violation, not a technical one. On a hyperlocal trust site a hallucinated detail is **worse than a blank**. So every fill is tiered by confidence:

- **Tier A — verified, auto-fill:** address/geocode, Google Places rating/hours/phone/website, `places_attributes` (dogs/kids/patio/parking/live-music). Third-party, attributed to Google. Automatic via `/api/sync-venue-facts` (weekly).
- **Tier B — local voice, human-reviewed, never auto-published:** the blurb. Drafted by `scripts/draft-venue-blurbs.ts` (Opus, grounded in Tier-A attributes + live review snippets + `docs/LOCAL-KNOWLEDGE-BASE.md`), voice-linted, refuses hard voice violations. A human approves at `/admin/venues`.
- **Tier C — graceful blank:** when genuinely unknown, punt like a neighbor ("newer to me — here's their site"); never invent hours/cadence/names. `VenueInfo` renders nothing rather than an empty shell.

Review-sourced specifics (owner names from Google reviews) are the lowest-confidence Tier-B content and must be human-verified before publish.

## Phase 0 — Close the visible blanks ✅ SHIPPED 2026-06-21

The venue-facts gap was narrow (246/259 already linked) but concentrated in real venues missing from the registry, whose event pages rendered **no venue section at all**.

- **Registered 7 venues** in `scripts/lib/venues.ts` (verified addresses; Places resolved each to the correct listing): Val Du Vino, Indian Rock Vineyards, Prospect 772, The Golf Club at Copper Valley, The Stitch Lounge, Native Sons Hall, and **restored `make-and-partake`** (it had 41 keyed events but had fallen out of the registry — a `backfill-venue-keys` run would have stripped those links; caught in dry-run). Aliased the `White Pines Lake Part` scraper typo. (PR #151)
- **Ran the pipeline against the shared DB:** `seed-venues` → `backfill-venue-keys --apply` (923 events linked, 0 cleared) → `sync-venue-facts` (6 new venues, facts + attributes) → **published 7 voice blurbs** (Tier B, reviewed in chat).
- **Merged a GoCalaveras "Beer Garden" duplicate** at Camp Connell that dodged auto-dedup on a start-time mismatch (reversible snapshot in `event_merge_log`). The General Store itself was already fully enriched — its "missing details" was the bare duplicate + no posters.
- **Built `/admin/venues`** (PR #154): the durable Tier-B review surface — lists every venue (missing-blurb first) with synced Google facts + attribute chips as context, inline edit/save/clear via server action, nav badge for missing blurbs. Replaces eyeballing `draft-venue-blurbs` CLI output.

**Result:** live-music events with a venue section **246 → 257 / 258**; ratings **241 → 252**; unlinked music venues **~9 → 1**. Verified live on prod (Indian Rock now shows ★4.7 + website + blurb).

## Phase 1 — Make blanks self-healing (roadmap)

Friction at a seam is a structural boundary, not a surface bug. Indian Rock was blank because of the gap between the **scraper write-path** and the **venue registry**; hand-editing rows forever treats the symptom.

- **`create_venue_row` proposer** — mirror the Agent Cockpit's `propose-link-gaps.ts` / `create_org_row` loop: drain a "unregistered venue with ≥N upcoming events" worklist into `/admin/actions`, pre-filled with the geocoded address (Tier-A research), for one-click human approval. A new winery hosting music gets *proposed* within a week instead of rendering bare for months. (`/api/check-events` already reports unresolved venues — wire that worklist in.)
- **Auto-queue blurb drafts into `/admin/venues`** ✅ **SHIPPED 2026-06-21** — `draft-venue-blurbs.ts --queue` writes a Tier-B draft to the new pending `blurb_draft` column (migration `20260621c_add_venue_blurb_draft.sql`) for any venue missing one; the weekly `Weekly Venue Blurb Drafts` GitHub Action (`.github/workflows/draft-blurbs.yml`, Mondays after the Places sync) runs it. `/admin/venues` surfaces the draft pre-filled with an "AI draft, not yet published" banner: **Save** publishes + clears the draft, **Discard** clears the text but keeps `blurb_draft_at` so it isn't re-proposed. Idempotent, self-limiting, never auto-published — a human Save is the only path to the live `blurb`.

## Phase 2 — Compose the live-music *night* (roadmap)

The leap from tolerance to love. Every ingredient already exists; they're just not composed into one anticipation-building moment on the detail page, above the fold:

- the **band** (`artists`), the **venue vibe** (blurb), the **weather chip** (per-town, event-hour — built for an outdoor winery show), the **practical signals** (`places_attributes`: dog/kids/patio/parking), the **poster**, and one-tap **directions + calendar + share**.

Answer, at a glance: *who's playing, what's the place like, what's the weather at showtime, can I bring the kids/dog, how do I get there.* This is where Mia ("show me the vibe") and Jen ("can I bring a 4-year-old?") convert.

**Shipped so far (2026-06-21): the practical-signals badges.** `practicalBadges` in [components/VenueInfo.tsx](components/VenueInfo.tsx) renders the decision-driving `places_attributes` (dog-friendly / kid-friendly / patio / good for groups / parking) as a quiet badge row under the venue facts strip on every event detail page (Tier A, attributed to Google). Curated on purpose — the few that change a go/no-go, not an attribute dump (the Jobs/Shiva discipline). This was the single highest-value, lowest-risk add for Jen/Mia. **Still roadmap:** the full above-the-fold *composed* "night" block (band + weather + badges + actions arranged as one anticipation moment), gated on `category='live_music'`.

## Phase 3 — Bets (validate with behavior first)

- **Artist link layer** — for live music the deepest blank is "who is this band, what do they sound like?" Accurate fill (Tier-A discipline): **link** the artist to their own site / Spotify / Bandcamp when discoverable, never *describe* their sound from thin air. Same `resolveEventLink` philosophy. Bonus: linking out helps the band → earns their cooperation (schedules, posters).
- **`/live-music` hub / "Tonight's music"** — 259 events is 2× the homepage horizon; a dedicated surface for Mia + Miguel. Phase-appropriate: ship 0–2, watch behavior, then build if the usage asks for it. Conviction, not a committee feature.

## Open items

- **Camp Connell Beer Garden posters** — the 11-show series has no images; needs the actual season poster (the `check-camp-connell-schedule` watcher + `seed-camp-connell-beer-garden-2026.ts` flow).
- **1 remaining unlinked music venue** — an oddball ("Meet Me in Murphys" / a private-address event) not worth a registry row; revisit if it recurs.
- **Verify review-sourced blurb names** — Jim (Indian Rock), Mona (Make and parTake), Francis & Laura (Prospect 772), Deb & Ken (Val Du Vino), and Make and parTake's "Big Trees Market complex" location. Edit at `/admin/venues` if any are off.

## Persona payoff

| Persona | Unblocked by | Phase |
|---|---|---|
| Mia (winery, IG-native) | posters + venue vibe + the composed night | 0, 2 |
| Miguel (day-tripper) | venue facts + map + weather to anchor the trip | 0, 2 |
| Jen (BLS mom) | `places_attributes` kids/dog/patio signals | 2 |
| Karen (Airbnb) | accurate, reliable "Thursday music" to forward | 0, 1 |
| Gary (retiree) | accuracy + no bare/duplicate rows | 0, 1 |
