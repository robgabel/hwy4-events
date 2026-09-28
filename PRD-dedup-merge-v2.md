# PRD: Dedup v2. Identity that survives merges, a matcher that tolerates real-world noise, and merge-augment with authority

> **Status (2026-09-28):** Phase 0 done (see "Phase 0 outcome" under §5). 0.1 was executed in prod on 2026-09-28; 0.2 to 0.4 are built and tested on branch `claude/duplication-merge-augment-strategy-0gkzss` and take effect on the first scrape after merge. Phases 1 to 3 are still proposed. Diagnosis measured against prod (`uzediwokyshjbsymevtp`) and a matcher prototype validated on the full 4-month catalog.

Triggered by Rob's 2026-09-27 screenshot: two cards for the same Oct 17 event, "The Gathering on Murphys Main Street" (GoCalaveras, 11:00 AM–5:00 PM, Community) and "Murphys Gathering – A Celebration of All Things Magical" (Visit Murphys, 12:00 PM–5:00 PM, Festival).

---

## TL;DR

1. **The screenshot pair is invisible to every layer because a 60-minute start disagreement vetoes the match before identity is ever checked.** The organizer (Murphys Business Association, which runs visitmurphys.com) says 12:00–5:00 PM. GoCalaveras says 11. No dedup layer, and no audit check, can see this pair today.
2. **It is not alone.** 5 duplicate pairs are live right now (Gathering, Live Like Lilly, All Hallows Faire ×2, a Bear Valley trail-day re-insert). The 18:00 UTC audit the same day reported `same_event_duplicates: 0`.
3. **The deeper, systemic bug is in the merge, not the matcher.** A merged row keeps one `(source_name, source_event_id, dedup_key)` identity, so the absorbed source can never find it by key again and re-inserts on any off day. The documented "~7.5h transit window" is not what happens: merged-away duplicates lived a **median of 122 hours**, and one event was re-merged **5 times in a month** (a 6th copy is live today). ~49 recent rows carry another source's event ID where no lookup can ever use it.
4. **A validated fix for recall exists.** A prototype matcher (robust title tokens + cross-source window tolerance) catches 10 of 14 labeled duplicates with 0 false merges. Over the entire last-120-days + future catalog (1,554 rows, 7,194 same-day pairs) it adds 11 merges (**10 clear duplicates, 1 probable**) and **0 regressions**.
5. **Found a latent data-loss bug.** "Live Music - <Act>" titles count as placeholders. Next summer, reconcile would merge a Sequoia Woods concert into the hidden "Thursday Night Dinner" and delete the concert.

**Recommendation:** Phase 0 today (merge the 5 live pairs, fix the latent bug, stop degraded re-inserts), Phase 1 this week (matcher v2), then Phase 2 (golden record: source links + authority survivorship) as the real structural win, then Phase 3 (near-miss review loop) so the next new duplicate shape costs one click instead of a screenshot and a session.

---

## 1. The screenshot pair, root-caused

| | GoCalaveras row `2fd80754` | Visit Murphys row `7357b581` |
|---|---|---|
| Title | The Gathering on Murphys Main Street | Murphys Gathering – A Celebration of All Things Magical |
| Clock | 11:00–17:00 | 12:00–17:00 (matches the organizer's page) |
| Venue | Murphys Main Street, `venue_key` NULL, no address | Murphys Main Street, `venue_key` NULL |
| Category | civic | festival |
| Created | 2026-08-14 | 2026-09-17 |

Walking `isSameEvent` (`lib/event-identity.ts`):

1. Same date. Pass.
2. Venues: identical strings, so `venuesAgree`. Pass.
3. Town: Murphys both. Pass.
4. `timesAnchor`: 11:00 ≠ 12:00. The only start tolerance (`GENERIC_SERIES_START_TOLERANCE_MIN`, 2026-09-19) requires exactly one title to be a generic placeholder; neither is. **Returns false. The identity signals are never evaluated.**
5. **The clock is the entire failure.** Force GoCalaveras to 12:00 and today's matcher merges the pair on the spot (`sameExactWindow`: same venue, identical 12:00–17:00 window). The titles alone would never have carried it (similarity ≈0.3 vs a 0.85 bar; `titlesShareTokens` 0.17 vs 0.6), which is why Phase 1 needs a better title signal as well as clock tolerance: sibling pairs like Live Like Lilly and All Hallows don't share an end time either.

Every sensor is blind to it: `duplicates` needs identical names; `same_event_duplicates` runs the same predicate; `venue_slot_collisions` skips multi-tenant venues (a street) and needs starts ≤30 min apart; `timeless_near_dupes` needs a NULL start.

Merge-augment note: if these did merge, today's `pickSurvivor` would keep Visit Murphys by richness score **16 vs 15**. The right answer by one point, for the wrong reason (description length). A slightly longer GoCalaveras blurb would have shipped the wrong time with no warning.

---

## 2. How big is the problem (measured 2026-09-27)

| Measure | Value |
|---|---|
| Future rows / public live cards | 252 / 235 |
| Duplicate pairs live on the site | **5** (Gathering 10-17, Live Like Lilly 10-03, All Hallows 10-24 and 10-25, BVTS 10-10 re-insert) |
| What the audit reported the same day | `duplicates 0`, `same_event_duplicates 0`, `venue_slot_collisions 0`, `timeless_near_dupes 0` |
| `event_merge_log` rows (all time) | 89 (81 automatic) |
| Repeat merges of the *same* absorbed identity | 11, across 5 survivors |
| Merged-away row lifetime (created → merged) | median **122h**; 62 of 81 lived >24h, 43 >72h *(includes backlog merges unlocked by matcher upgrades, so it overstates the steady state, but the treadmill cases alone ran 26–194h)* |
| BVTS Trail Work Day (10-10) | GoCalaveras copy re-inserted and re-merged 08-29, 09-07, 09-10, 09-14, 09-26; a 6th copy created 09-27 13:29 UTC is live now |
| Cross-source merges whose absorbed identity survives only in merge-log snapshots | 57 (11 on future survivors) |
| Rows carrying another source's `source_event_id` (last 60 days + future) | ~49 (31 GoCalaveras rows carrying non-EventON IDs; Bistro Espresso 6, Irish Pub 4, Visit Murphys 3, others) |
| Facebook Discover rows with a `source_event_id` | 0 of 21 (the FB event ID sits unused in `event_url`) |
| Past 120 days: duplicate clusters today's matcher would *still* miss | 7 (Karaoke ×2 nights, Patriotic Car Cruise, 4th of July @ Murphys Hotel, Constitution matinee, Hermitfest West, Hit Collective) |

Every live duplicate is a festival or community event: the high-traffic cards people actually plan around.

---

## 3. Evaluation of the current system

The lineage is strong. One shared predicate, test-locked, conservative, every automated delete reversible via `event_merge_log`, and a history of adversarial review catching real defects. The problems are not sloppiness. They are structural choices that each made sense locally and compound together.

| Layer | What works | What fails |
|---|---|---|
| `isSameEvent` (the one predicate) | Precise. Single source of truth. Rich regression tests for every past incident. | **Clock is a hard veto evaluated before identity.** Title comparison is brittle (punctuation glued to tokens, no stopwords, "w/", FB decoration). Recall grows one hand-written signal per screenshot. Latent false merge on "Live Music - <Act>". |
| Write-time merge (`scripts/lib/dedup.ts`) | Null guards (HWY-29), name/venue steal guards, locks, one shared payload builder. | Weaker than reconcile: candidate filter still **hard-gates town** (a silent second copy of the rule softened 2026-07-28), the serial path never selects `venue_key` and the incoming row never carries one. **Overwrites `source_event_id` with the other source's ID without changing `source_name`.** |
| Reconcile (`lib/reconcile.ts`) | Covers every writer. Log-before-delete. Reversible. | **Deletes the loser's identity**, so its source re-inserts. `buildFill` copies a foreign ID onto the survivor where no lookup can use it. Survivor chosen by richness, not authority. Unpaginated select (latent at >1,000 future rows). |
| GoCalaveras LLM pre-dedup (`crossSourceDedup`) | Catches some paraphrases. | Unlisted among CLAUDE.md's dedup layers until this PR. Sees no times (can drop a real matinee). **Drops** instead of merging, so GoCalaveras data never augments the survivor. Nondeterministic run to run, so events flap between dropped and inserted. No audit trail. Fails open. |
| Audit (`/api/check-events`) | Predicate-independent checks exist (`duplicates`, `venue_slot_collisions`). | `same_event_duplicates` cannot see a miss by construction. The independent checks exclude exactly where festival duplicates live (multi-tenant venues, outdoor bases, starts >30 min apart). **Green while 5 pairs were live.** |

---

## 4. Root causes

**RC1. Identity is destroyed on merge (the treadmill).** One row, one `(source_name, source_event_id, dedup_key)`. When source B's listing merges into source A's row, B's keys are overwritten (write-time), orphaned under A's `source_name` (write-time and `buildFill`), or deleted with the loser (reconcile). B's next scrape cannot exact-match, so it depends on the fuzzy matcher every day. The first degraded scrape (GoCalaveras detail pages rate-limited: "Unknown Venue", no description) fails the fuzzy match and inserts a fresh duplicate, which then lives until a later scrape re-enriches it *and* reconcile runs. BVTS decoded: reconcile copied GoCalaveras's EventON ID `192106` onto the BVAC survivor, but lookups filter on `source_name = 'GoCalaveras.com'`, so the ID is dead weight and GoCalaveras re-inserts forever.

**RC2. The clock is a veto, not evidence.** For multi-hour festival and community events, sources routinely disagree on the start (gates open vs first act vs last year's hours): Gathering 11 vs 12, Lilly 17 vs 18, All Hallows 11 vs 12, Hermitfest 9 vs 12. The strongest identity evidence in the world cannot overcome a 60-minute difference today. The key measured asymmetry: over 4 months, **same-source** same-venue pairs at different starts number 374 (a source enumerating its own distinct programs: Big Trees walks, a cooking class's morning and evening sessions), while **cross-source** ones number 18, of which 9 are duplicates. Clock disagreement *within* a source is evidence of distinctness; *across* sources it is mostly noise.

**RC3. Title comparison is brittle.** `tokenSet` keeps punctuation attached ("gathering," / "hallow's"), counts stopwords ("at the"), has no abbreviation folding ("w/"), and cannot see through Facebook Discover's decoration ("Angels Camp, CALIFORNIA - All Hallows Faire (Oct 24-25)") or a trailing "18th Annual". Jaccard over all tokens is diluted by event-type words ("Fundraising Dinner" vs "Dinner and Dance" scored 0.57 against a 0.60 bar). The identity lives in the distinctive words: *lilly*, *hallows*, *gathering*, *hermitfest*, *patriotic car cruise*.

**RC4. Venue resolution gaps feed the venue veto.** The registry holds one address per venue; the fairgrounds has two entrances (101 Frogtown Rd and 2465 Gun Club Rd), so a source using Gun Club Rd never resolves. An organizer's name stuffed into the venue field ("All Hallows Fantasy Faire, Gary PooBar Britt and Lissa Britt") blocks resolution even when the row's own address is a registry address. Write-time matching never sees `venue_key` at all.

**RC5. No authority model, no conflict memory, no loop.** Survivorship is richness scoring. Field merges are last-writer-wins (prefer incoming when non-empty), so two sources ping-pong a row's content daily. A clock conflict between sources is resolved silently and never surfaced. And every new duplicate shape costs a screenshot, a session, and a new hand-written signal, because nothing turns a human judgment into a test.

**Latent P0: named acts treated as placeholders.** `isGenericTitle`'s live-music arm is prefix-anchored, so "Live Music - Neil Buettner" counts as a placeholder. Since the 2026-09-19 tolerance, that title merges with *any* other title at the same venue within 90 minutes, and the −12 richness penalty makes the other row survive. Verified with the real code: "Live Music - Neil Buettner" (18:00) vs "Thursday Night Dinner" (18:00, `is_routine`) merges and **keeps the dinner**, deleting the concert from the public site; two different named acts 30 min apart merge; a named act vs "Karaoke - Taylor Made" in the same slot merges. No victims yet (16 such titles in 4 months, all summer, none future; merge log checked). It returns with next summer's Sequoia lineup.

---

## 5. The plan

Three shifts, in order of how much they change the system:

1. **Clock as evidence, sources as the tiebreaker** (Phase 1). Same-source clocks are authoritative distinctness; cross-source clocks are noise to reconcile.
2. **One event, many source records** (Phase 2). Every source keeps a permanent key to the canonical row, and the row's fields are chosen by source authority, not by who scraped last.
3. **Every miss becomes a test** (Phase 3). A predicate-independent near-miss detector feeds a one-click review queue, and each human decision lands in the golden set.

### Phase 0: stop the bleeding (today, ~2 hours, mostly data)

- **0.1 Merge the 5 live pairs** with Appendix C (reversible; follows the 2026-09-04 wine-trail precedent of cancelling the aggregator copy so its key keeps resolving to a tombstone instead of re-inserting). Organizer times win: Gathering keeps Visit Murphys 12:00–17:00; All Hallows keeps GoCalaveras's hours, which match the organizer's own "Saturday 12pm-9pm Sunday 11am-6pm". Live Like Lilly has no organizer-tier source (17:00 vs 18:00), so it goes to `/admin/verification` with the other time pre-filled for a one-click "Use 6:00 (locks it)".
- **0.2 Registry: multi-address venues.** Add `addresses?: string[]` to `KnownVenue`, index every address in `venue-matcher.ts`, add 2465 Gun Club Road to `fairgrounds`, and let `resolveVenueKey` accept an address-anchored match even when `venue_name` is a non-generic string that resolves to nothing (the junk-organizer-name case). Re-run `backfill-venue-keys`.
- **0.3 Fix the latent P0.** One placeholder test for matching, `isPlaceholderForMatch(name)`: generic *and* not "generic prefix + separator + act" ("Live Music - X", "Music in the Square - X"). Use it in the XOR start tolerance and in the `venuesAgree && generic` identity signal. Tests: the three cases above must stay split; Brice Hilltop vs Greg Sutton, "Live Music @ The Lube Room" vs a named act, and "Patio Party #4 (TBD)" vs the named re-list must still merge.
- **0.4 Degraded-row hold.** GoCalaveras already computes a per-event enrichment outcome (`enrichEventDetails`) but only tallies it. Thread it onto the event; `upsertEvents` must not **insert a new** row whose enrichment failed and whose venue is generic with no description (log `DEGRADED_INSERT_HELD`). Exact-key updates still flow (already guarded by `keepStr` / `placeholderVenueSteal`). Tomorrow's enriched scrape inserts it properly. Kills the BVTS shape at the source for ~20 lines.

*Acceptance:* 0 live duplicate pairs in the near-miss SQL (Appendix B query); zero "Unknown Venue" GoCalaveras inserts for 7 days.

**Phase 0 outcome (2026-09-28).**

- **0.1, done in prod.** All 5 pairs cancelled-as-dup, each with a reversible `event_merge_log` snapshot (`signal` starts `manual:dedup-v2 phase0`), so every loser URL 301s to its survivor. Survivors: Gathering `7357b581` (Visit Murphys, 12:00 to 17:00), Live Like Lilly `204ae1b8` (17:00), All Hallows 10-24 `2171ef14` (junk venue string resolved to the fairgrounds, artists added), 10-25 `533bfca0`, BVTS `98110902`. One deviation: Live Like Lilly did not need `/admin/verification`, because the organizer's own ticket page (ticketstripe) states 17:00; the 18:00 was the Facebook copy. The BVTS loser `94b2a310` stays as a cancelled tombstone that keeps EventON 192106 resolvable, so GoCalaveras's next scrape updates it instead of inserting a sixth copy.
- **0.2, done in code.** `KnownVenue.addresses` holds secondary addresses (matching only; `address` stays the display address), and the fairgrounds carries its 2465 Gun Club Rd entrance. The planned `resolveVenueKey` change turned out unnecessary: the address layer already runs when `venue_name` is a non-generic junk string. No backfill either: every live Gun Club row already carried `fairgrounds`. Until this merges, a GoCalaveras re-scrape may put the junk venue string back on `2171ef14` (cosmetic; its duplicate is already tombstoned).
- **0.3, done in code.** `isPlaceholderForMatch` (`lib/event-identity.ts`): a generic title stays a placeholder only when the text after a "Live Music -" / "Music in the …" prefix is missing, TBD/TBA, the whole venue name, or filler ("Friday Night", "Upstairs"). Whole venue, not a shared word: Sequoia Woods books a band called "Sequoia Blue", and reading an act as a placeholder is the direction that deletes a concert. It now gates the XOR start tolerance, the `venuesAgree && placeholder` identity signal, and the survivor penalty in `lib/dedupe-events.ts`. Full-catalog dry run against the old predicate: exactly the 2 false merges from Appendix B dropped ("Wednesday Night Deli Special" / "Live Music - Neil Buettner", "Patio Party #4 … - The Hit Men" / "Live Music - Jamie Byous"), nothing else changed. Brice Hilltop vs Greg Sutton, "Live Music @ The Lube Room" vs a named act, and the Patio Party TBD re-list still merge.
- **0.4, done in code.** `scripts/lib/degraded-hold.ts`. GoCalaveras threads each event's final enrichment outcome onto it (`enrichment_failed`: 429, other non-2xx, transport error, or circuit-breaker skip; a page that loaded bare is not a failure). At the INSERT decision only, after exact-key and strong-match both miss, `upsertEvents` holds a row that failed enrichment and still has a generic venue and no description, logging `DEGRADED_INSERT_HELD` per row and counting `held` in `scrape_runs.source_results`. It never holds an event dated on the run day, so it can defer a listing but never lose one. Updates and merges are untouched. A source-level test pins that every `hwy4_events` insert site in `dedup.ts` consults the hold.
- Tests 898/898 (19 new); mutation checks run on the new locks.

### Phase 1: matcher v2, dedup recall (1–2 days including adversarial review)

Prototyped in this investigation (scratch harness over the real `lib/event-identity.ts`); numbers in Appendix B.

- **1.1 Distinctive-title identity.** New tokenizer: `normalizeForMatch`, strip FB "Town, CALIFORNIA - " prefix and parentheticals, strip "@ venue" tails, fold "w/", drop apostrophes, split on non-alphanumerics, drop stopwords. Distinctive tokens = those minus venue words *both* rows' venue names share, minus both towns, minus event-type words (festival, dinner, annual, live, music, celebration, …) and dates. Signal: the smaller distinctive set is ≥75% contained in the larger. Venue-gated, same-slot path; additive to today's signals.
- **1.2 Cross-source window tolerance.** When starts differ: allow only if the rows come from **different sources**, venues agree, windows **overlap** (unknown end = start + 2h), and starts are ≤180 min apart; then demand strong identity only (distinctive title, artist overlap, description ≥0.92, act named in the other). Never the placeholder or window-only signals.
- **1.3 Venue-only titles are placeholders** ("Murphys Creek Theatre" at Murphys Creek Theatre).
- **1.4 Write-time parity.** Add `source_name` to `EventIdentity`; stamp the incoming row's `venue_key` and `source_name` before matching; select `venue_key` on serial-path candidates; drop the write-time town hard-gate (the predicate owns the town rule, per the 2026-07-28 lesson about silent second copies).
- **1.5 Clustering safety.** Loosened pairwise rules make single-link chaining dangerous (an aggregator's all-day listing overlapping a venue's morning *and* evening sessions would chain them into one). Switch `clusterEvents` to union-find with a **cannot-link** rule: a cluster may never hold two rows from the same source at different starts. A merge that would violate it goes to the Phase 3 queue instead.
- **1.6 Lock it.** Commit the labeled corpus (Appendix A) as `scripts/test/dedup-golden.test.ts`, including every must-never-merge negative. Re-run the full-catalog dry run at ship time. Adversarial review is mandatory (matcher change).

*Acceptance:* golden set ≥10/14 duplicate recall and 0/9 false merges; full-catalog dry run shows 0 regressions and every new merge labeled genuine.

### Phase 2: the golden record. Identity that survives merges, merge-augment with authority (3–4 days)

This is the structural win. It turns "one row = one source identity" into "one event = many source records", the standard master-data pattern.

- **2.1 `hwy4_event_source_keys`** `(event_id, source_name, source_event_id, dedup_key, event_url, first_seen_at, last_seen_at, last_payload jsonb)`. **Plain** unique indexes on `(source_name, source_event_id)` and `(source_name, dedup_key)`: NULLs stay distinct, and PostgREST `onConflict` cannot target a partial index (the `seo_snapshots` / `growth_lessons` lesson). Service-role RLS.
  - *Why not a `status='merged'` tombstone:* 21 read paths filter `status <> 'cancelled'` and none filter `= 'confirmed'`, so a new status would leak merged rows into every one of them. A side table touches no read path.
- **2.2 Write path.** Exact lookup checks links first (sid, then dedup_key, then event_url), legacy row columns second. Every write upserts its own link; a fuzzy merge creates the incoming source's link on the survivor.
- **2.3 Reconcile** re-points the loser's links to the survivor before deleting, and records them in `event_merge_log` so a revert re-points them back.
- **2.4 Stop writing foreign IDs onto rows** (`buildStrongMatchUpdate`, `buildExactMatchUpdate`, `buildFill`); move the ~49 existing ones into links.
- **2.5 Backfill:** one link per existing row, plus one per merge-log snapshot whose survivor still exists. Restores 57 absorbed identities on day one, including GoCalaveras `192106` → BVTS.
- **2.6 Authority survivorship.** Source tiers are **region config** (never hardcoded; the 30A port has different sources): organizer/venue-own > curated local calendar > regional aggregator > social discovery > community. Promote a source to organizer tier for an event when `org_slug === venue_key` (the rule `namedActTakesPrecedence` already uses) or the event's organizer maps to the source's org (e.g. Visit Murphys for Murphys Business Association events). Survivor = highest tier, richness breaks ties. Per field: clock, title, price from the highest tier that states one; description the best substantive one; image organizer's over anyone's; artists the union minus placeholder leftovers (`mergeArtistLists`); locks always win. Until this lands, a write arriving through a secondary link is **fill-only**, which alone ends the rename/field ping-pong. Fill-only still has to respect tier on semantic fields: the Facebook All Hallows rows say price "Free" because the Harp Twins' *shows* are free to attendees, while the faire itself sells tickets. A social-tier "Free" must never become a ticketed event's admission.
- **2.7 Conflict memory.** `field_conflicts jsonb` when contributing sources disagree (clock by >15 min, price). An organizer-tier source present: it wins, conflict logged. None present: `verification_status = 'needs_verification'` with `verification_reason` and `verification_suggested_start`, reusing `/admin/verification`'s one-click lock. Blank beats wrong; nothing new on the public card.
- **2.8 Retire GoCalaveras's LLM pre-dedup.** Its job is covered deterministically by 1.x + 2.x, and it can't see times. (The review queue is where an LLM belongs.)
- **2.9 Stable keys everywhere.** FB scrapers stamp `source_event_id` from the FB event URL; the moose PDF route writes links (or routes through `upsertEvents`) so LLM naming drift ("Queen of Hearts & Dinner" / "Queen of Hearts Dinner") stops re-inserting weekly.
- **Later, free once links exist:** retraction becomes per-link, so an event dies only when its *last* source stops asserting it. That is exactly what `ownsGoCalaverasRow` approximates today with URL and ID heuristics.

*Acceptance:* 0 repeat merges of the same identity over 14 days; 0 foreign IDs on rows; merged-away lifetime under 8h (first sightings only, healed by that day's reconcile); the Gathering card shows the organizer's 12:00 regardless of scrape order.

### Phase 3: close the loop. Near-miss detector, one-click review, golden set (2–3 days)

- **3.1 `lib/dedup-candidates.ts`**: a scorer that deliberately does **not** reuse `isSameEvent`. Same date; same town or venue agreement; overlapping windows or ≤4h start delta; and any of distinctive-title containment ≥0.5, trigram title ≥0.35, description ≥0.5, or a shared organizer URL host. Excludes merged pairs and pairs in `event_distinct_pairs`.
- **3.2 Daily audit gets `near_miss_pairs`** (count + samples to Slack). On 2026-09-27 it would have read 5.
- **3.3 `/admin/actions` proposal type `merge_events`.** Approve runs a reversible reconcile-style merge of that pair (log-before-delete, links re-pointed). Reject writes `event_distinct_pairs`, which also acts as a cannot-link for reconcile, so it is never proposed again.
- **3.4 Optional Sonnet adjudicator** pre-labels each proposal (verdict, confidence, rationale, cached per pair), the same shape as submission triage. Graduate auto-merge of high-confidence verdicts through `agent_policy` after a clean canary, the existing guardrail.
- **3.5 Every decision exports to the golden set**, so each future matcher change is regression-tested against real human calls.

*Acceptance:* `near_miss_pairs` reviewed within 48h; a new duplicate shape costs one click, and that click becomes a test.

### Hardening (fold into the phases above)

- Reconcile: paginate the select. PostgREST caps an unranged select at ~1,000 rows; 252 future rows today, closer to 1,000 before the horizon cap, and a port or a busy summer gets there again.
- Annotate `same_event_duplicates` as predicate-dependent in the audit output and Slack line, so "0" stops reading as "clean".
- CLAUDE.md's "~7.5h transit window" claim is corrected in this PR with the measured numbers.

---

## 6. Rejected alternatives

- **LLM as the matcher.** Nondeterministic, unauditable, and the GoCalaveras pre-dedup already shows the failure mode (flapping, no times, silent drops). An LLM belongs in the gray zone with a human gate and cached verdicts (3.4).
- **Loosening the date gate.** Checked: adjacent-date cross-source pairs are multi-night runs where each source lists different nights (SPIRIT/SONG, An Act of God) and 2-day festivals. Not a duplicate class.
- **Bringing back the read-time collapse.** Fix it at rest. The render path stays clean.
- **Embeddings / pgvector now.** A few hundred rows a day; distinctive tokens handle every miss found. Revisit only if the review queue shows paraphrases tokens can't catch.
- **Rewrite into a probabilistic scorer now.** It is the likely end state if signals keep multiplying, but it needs calibration data. Phase 3's golden set is how that data gets made.

---

## 7. How we'll know (scoreboard)

| Metric | Baseline 2026-09-27 | Target |
|---|---|---|
| Live duplicate pairs (near-miss scan, human-confirmed) | 5 | 0 sustained |
| Audit's honest duplicate signal | none (`same_event_duplicates` blind) | `near_miss_pairs` daily |
| Repeat merges of the same identity | 11 all-time; BVTS 5× in 30 days | 0 |
| Merged-away row lifetime | median 122h | first sightings only, <8h |
| Rows with a foreign `source_event_id` | ~49 | 0 |
| Golden-set recall / false merges | 0/14 / 0/9 today | ≥10/14 / 0/9 after Phase 1 |
| False merges in prod | 0 known | 0 (every merge reversible; review "unmerge" count tracked) |

---

## 8. Decisions for Rob

1. ~~**Phase 0 runbook:** approve, and I run it via MCP, or you run Appendix C yourself.~~ Approved and run 2026-09-28.
2. **Authority tiers:** confirm Visit Murphys = organizer tier for Murphys Business Association events (Gathering, Irish Day, Day of the Dead, Open House) and curated-local otherwise.
3. **Unresolved clock conflicts:** flag to `/admin/verification` only (recommended; blank beats wrong), or also show a quiet "times vary by source" note on the card.
4. **LLM adjudicator in the review queue:** recommended yes (pennies a day at this volume), human-gated until a canary graduates it.

---

## Appendix A. Labeled seed corpus (future `dedup-golden` fixtures)

Row IDs are the first 8 hex chars of `hwy4_events.id`.

| Label | Pair | Why |
|---|---|---|
| dup | `2fd80754` ~ `7357b581` Murphys Gathering 10-17 | 11 vs 12 start is the only blocker (`sameExactWindow` merges it once clocks agree) |
| dup | `0274b193` ~ `204ae1b8` Live Like Lilly 10-03 | 18 vs 17; FB org-page venue name; street number anchors |
| dup | `2171ef14` ~ `22d34f21` All Hallows 10-24 | junk venue name; needs registry 2nd address |
| dup | `533bfca0` ~ `2c2a58ed` All Hallows 10-25 | 11 vs 12; FB title decoration |
| dup | `94b2a310` ~ `98110902` BVTS 10-10 | degraded re-insert (Phase 0.4 / Phase 2, not the matcher) |
| dup | `159f0c7e` ~ `94b96428` Karaoke @ vs at The Irish Pub 06-12 | "@" vs "at the" tokenization |
| dup | `76ad870f` ~ `86028654` Patriotic Car Cruise 07-03 | paraphrased titles |
| dup | `fb74d5d5` / `d2db6635` / `f7707fc1` Karaoke w/ Kim 07-10 (3 pairs) | "W/" vs "with"; community third copy |
| dup | `758422c9` ~ `7d5788e4` Hermitfest West 09-13 | 12–13:30 slot vs 9–14 festival |
| dup (queue) | `5f4d4748` ~ `551f2b7b` 4th of July @ Murphys Hotel | 4h clock conflict, no overlap; route to review |
| dup (queue) | `3782281d` ~ `91e6347e` Constitution matinee 08-12 | venue-only title; 2h conflict |
| dup (upstream) | `2296c258` ~ `be0865d0` Hit Collective 07-11 | +3h timezone bug in an early Sequoia scrape (fixed) |
| distinct | `436a6aa8` ~ `4575e863` An Act of God 12-19 | two real performances (Visit Murphys `/2/` permalink) |
| distinct | `017279df` ~ `4a6d29e1` Tapas morning vs evening | same source, two sessions |
| distinct | `3f25c6c3` / `1fda1aa3` ~ `6a662b75` BVAC clinic, pickleball vs BVTS | cross-source, overlapping windows, different events |
| distinct | `6cd0fdad` ~ `3bf13282`, `fe43e6e8` ~ `d09d006a` Irish Pub sets | different sets, non-overlapping |
| distinct | `e0812376` ~ `211ddc72` Ironstone concert vs Mimosa Sundays | same venue, different events |
| distinct | `b75743e8` ~ `edb35ad0` Lackler Kids Clay vs Making Smalls | same venue, same source |
| distinct | Big Trees 07-12 programs (5 rows, 10 pairs) | same park, overlapping windows, different programs |
| distinct | Bistro Espresso vs Cameo Plaza Saturday concerts | same town and slot, different venues and acts |

## Appendix B. Validation numbers (prototype, 2026-09-27)

Harness: a copy of `lib/event-identity.ts` with 1.1–1.3 applied, run beside the real module under `tsx`.

- **Labeled corpus:** current matcher 0/14 duplicates; prototype 9/14; prototype + fairgrounds second address 10/14. False merges 0/9 for all three. 0 unexpected merges across all 41 same-date pairs in the corpus. The 4 misses are the intended ones (two clock conflicts for the queue, the treadmill for Phase 0.4/2, a fixed upstream bug).
- **At-risk catalog pairs** (same date, venue agreement, different titles, clock not already disqualifying; 184 rows, 159 pairs): 0 regressions, 10 new merges, all genuine.
- **Exhaustive** (every same-date, same-visibility pair over the last 120 days + future: 1,554 rows, 7,194 pairs, descriptions omitted so both matchers can only under-merge): 0 regressions, **11 new merges: 10 clear duplicates, 1 probable** (Karaoke ×4 pairs, Gathering, Lilly, All Hallows 10-25, Hermitfest, Patriotic Car Cruise, Moose "Luau Party" / "Annual Luau - Whole Pig Roast"; one probable, the Moose "Dinner and Burger Night" / "Queen of Hearts and Burger Night" same-night pair).
- The same exhaustive run also surfaced the latent P0 (today's matcher pairs "Patio Party #4 featuring live music - The Hit Men" with "Live Music - Jamie Byous", and "Wednesday Night Deli Special" with "Live Music - Neil Buettner").

Near-miss scan used for Section 2 (predicate-independent, pg_trgm in the `extensions` schema):

```sql
with ev as (
  select id, name, date, start_time, end_time, town, venue_name, venue_key, description, source_name, visibility
  from hwy4_events where date >= current_date and status <> 'cancelled'
)
select a.date, a.name, b.name, a.source_name, b.source_name,
  round(extensions.similarity(lower(a.name), lower(b.name))::numeric, 2) as t_sim
from ev a join ev b on a.date = b.date and a.id < b.id
where extensions.similarity(lower(a.name), lower(b.name)) > 0.25
   or extensions.similarity(lower(coalesce(a.description,'')), lower(coalesce(b.description,''))) > 0.35
   or (a.venue_key is not null and a.venue_key = b.venue_key)
   or extensions.similarity(lower(coalesce(a.venue_name,'')), lower(coalesce(b.venue_name,''))) > 0.55
order by a.date;
```

## Appendix C. Phase 0 runbook (review, then run one pair per `execute_sql` call)

Pattern per pair: snapshot the loser to `event_merge_log` (so the stale-slug fallback 301s its URL to the survivor), back-fill the survivor, then **cancel** (not delete) the aggregator copy so its key keeps resolving and the next scrape updates the tombstone instead of re-inserting. Revert: set the loser's `status` back to `'confirmed'` and delete its log row.

**Executed 2026-09-28** as written, with two differences: B skipped the verification flag (the organizer's ticket page confirms 17:00), and A skipped the optional image borrow. Each executed `signal` string carries its reason.

```sql
-- A. Murphys Gathering 10-17: keep Visit Murphys (organizer, 12:00-17:00), cancel GoCalaveras.
begin;
insert into event_merge_log (survivor_id, merged_from_id, merged_snapshot, signal)
select '7357b581-f537-4cd5-9de8-dc88e787f17f', e.id, to_jsonb(e), 'manual:dedup-v2 phase0 cancel-as-dup (organizer time 12:00)'
from hwy4_events e where e.id = '2fd80754-25bf-4922-84c2-173600cbd000';
-- optional: borrow GoCalaveras's image (a 2018 Witch Walk graphic) until the organizer's header image is pinned
-- update hwy4_events s set image_url = l.image_url, updated_at = now() from hwy4_events l
--  where s.id = '7357b581-f537-4cd5-9de8-dc88e787f17f' and l.id = '2fd80754-25bf-4922-84c2-173600cbd000'
--  and s.image_url is null and not coalesce(s.poster_locked, false);
update hwy4_events set status = 'cancelled' where id = '2fd80754-25bf-4922-84c2-173600cbd000';
commit;

-- B. Live Like Lilly 10-03: keep GoCalaveras (full description, fairgrounds key), cancel FB,
--    and send the unresolved 17:00 vs 18:00 conflict to /admin/verification.
begin;
insert into event_merge_log (survivor_id, merged_from_id, merged_snapshot, signal)
select '204ae1b8-fbe5-43d1-86bc-c9605d41590b', e.id, to_jsonb(e), 'manual:dedup-v2 phase0 cancel-as-dup (clock conflict flagged)'
from hwy4_events e where e.id = '0274b193-5cc0-490d-94fe-8282e84326b2';
update hwy4_events set verification_status = 'needs_verification',
  verification_reason = 'cross_source_time_conflict: GoCalaveras 17:00 vs Facebook event 18:00',
  verification_suggested_start = '18:00', verification_checked_at = now()
where id = '204ae1b8-fbe5-43d1-86bc-c9605d41590b';
update hwy4_events set status = 'cancelled' where id = '0274b193-5cc0-490d-94fe-8282e84326b2';
commit;

-- C. All Hallows Faire 10-24: keep GoCalaveras (12:00-21:00 = organizer's "Saturday 12pm-9pm"),
--    resolve its junk venue string to the fairgrounds, cancel FB. (A GoCalaveras re-scrape may
--    rewrite the junk venue string until Phase 0.2 lands.)
begin;
insert into event_merge_log (survivor_id, merged_from_id, merged_snapshot, signal)
select '2171ef14-bb5d-4cfa-95bd-3edd8632977b', e.id, to_jsonb(e), 'manual:dedup-v2 phase0 cancel-as-dup'
from hwy4_events e where e.id = '22d34f21-39b2-43f8-b5e2-5f6002d2568b';
update hwy4_events set venue_name = 'Calaveras County Fairgrounds', venue_key = 'fairgrounds',
  artists = array['Harp Twins','Volfgang Twins','Celtica Nova'], updated_at = now()
where id = '2171ef14-bb5d-4cfa-95bd-3edd8632977b';
update hwy4_events set status = 'cancelled' where id = '22d34f21-39b2-43f8-b5e2-5f6002d2568b';
commit;

-- D. All Hallows Faire 10-25: keep GoCalaveras (11:00-18:00 = organizer's "Sunday 11am-6pm"), cancel FB.
begin;
insert into event_merge_log (survivor_id, merged_from_id, merged_snapshot, signal)
select '533bfca0-d78c-498c-8a67-599d46d86059', e.id, to_jsonb(e), 'manual:dedup-v2 phase0 cancel-as-dup'
from hwy4_events e where e.id = '2c2a58ed-36b1-4353-8bd2-66bffa9d3827';
update hwy4_events set artists = array['Harp Twins','Volfgang Twins','Celtica Nova'], updated_at = now()
where id = '533bfca0-d78c-498c-8a67-599d46d86059' and artists is null;
update hwy4_events set status = 'cancelled' where id = '2c2a58ed-36b1-4353-8bd2-66bffa9d3827';
commit;

-- E. BVTS Trail Work Day 10-10: cancel today's degraded GoCalaveras re-insert. Its EventON key
--    (192106) now resolves to this tombstone, so GoCalaveras stops re-inserting it.
begin;
insert into event_merge_log (survivor_id, merged_from_id, merged_snapshot, signal)
select '98110902-1cfc-4649-9d45-720ac7eb2cef', e.id, to_jsonb(e), 'manual:dedup-v2 phase0 cancel-as-dup (treadmill tombstone)'
from hwy4_events e where e.id = '94b2a310-e814-4536-a3e5-0a1035e62836';
update hwy4_events set status = 'cancelled' where id = '94b2a310-e814-4536-a3e5-0a1035e62836';
commit;
```
