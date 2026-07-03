# Infrastructure Audit — July 2026

*Lens: Musk's five-step algorithm (make the requirements less dumb → delete the part → simplify → accelerate cycle time → automate last), applied against BUSINESS-PLAN.md and docs/PERSONAS.md. Grounded in a live sweep of the repo (25 Vercel crons, 38 API routes, 22 LLM call sites) and the production Supabase project.*

---

## Verdict

The engine is real and mostly well-built. The data pipeline (scrape → dedupe → identity → verify → enrich) is the moat the business plan describes, and it genuinely runs a 974-upcoming-event corpus with near-zero staff. Model tiering is sane (Opus for editorial voice, Sonnet for reasoning, Haiku for extraction). The accuracy contract (machine drafts, human publishes) is the right shape for the personas, whose #1 requirement is trust.

Three structural problems, in priority order:

1. **The production site lives inside Rob's personal database.** hwy4 is ~10 MB of a 419 MB shared Supabase project with 127 public tables (knowledge graph, 26 brain packs, travel, LinkedIn) and 5 active PAOS pg_cron jobs. One bad migration in a PAOS session touches prod. This also blocks the engine story: Calaveras should be "region instance #1" with its own project, the template every port clones.
2. **The fork model is already producing drift.** The Eugene fork diverged on newsletter sending within weeks (Peter's ledger vs main's Batch API, three converging efforts, reconcile HANDOFF unexecuted since June 21). Forks multiply Rob's attention per region; the plan's monetization depends on the opposite.
3. **Things get built fast but never flipped on.** `RECONCILE_EXECUTE` has been unset since June 9 (14 manual merges ever, none in 10 days, the canary clock never started). The GSC collector has no-oped daily since May 31 because one env var was never set. Decision latency, not build latency, is the cycle-time problem.

Cash cost is fine (~$50–80/mo, see §7). The scaling constraint is Rob's attention: 25 crons + 4 GitHub workflows + 14 admin surfaces, and the fork model multiplies that surface per region.

---

## 1. Make the requirements less dumb

What the business plan actually requires of the infrastructure:

| Requirement | Source | Infra grade |
|---|---|---|
| Accuracy + completeness with zero staff (the trust moat) | Personas: Gary/Karen bounce on stale data | **A.** The dedup/verify/watcher stack earns its complexity. |
| Solo-operable | Gate 3 risk table (bus factor) | **B-.** Works, but 25 crons and multi-runtime watchdogs are more surface than one operator needs. |
| Near-zero cost until gates unlock | §9 traction gates | **A-.** ~$50–80/mo. Firecrawl/Apify are the unverified lines. |
| Region-portable engine | §6 "the highest-stakes call" | **C+.** Structure honored (~65–70% engine), practice leaking (1,448 region strings, voice/persona baked into 5 generators, email domain hardcoded in 8 routes, zero table-name constants across 335 `.from()` call sites). |

Requirements that crept in without justification:

- "Every hand-curated venue gets its own watcher cron + route." The real requirement is "notice when a watched page changes." That is one route + a config array. There are now **4** watcher routes (Lube Room, Big Trees, Camp Connell, Murphys Senior Center — the 4th isn't even in CLAUDE.md's cron table), each with its own copy-pasted UA string. O(n) routes for an O(1) job.
- "The daily briefing needs three watchdog firings across two runtimes." Vercel cron `check-briefing` at 17:00 UTC plus GitHub Action `briefing-watchdog.yml` at 17:30 and 23:30 calling the same endpoint. The requirement is one check.
- "Homepage payloads carry a resolved outbound link per event." The card stopped rendering it on 2026-06-22 but `lib/events-data.ts:155` still resolves and serializes it for every event. The requirement was deleted; the part stayed.
- "The cockpit needs Stage-2 autonomy plumbing" (agent_policy, auto-runner) before Gate 1 traction exists. Fine as R&D and LinkedIn material; label it that and freeze expansion.
- Row-per-occurrence recurring events (dated to 2028) created the dedup load, sitemap trimming, and payload capping downstream. The mitigations all work; but if anything gets rebuilt for the port, model series natively (Tier 2 of PRD-search-indexing already points there).

---

## 2. Delete

Each item is reversible via git or a snapshot.

1. **`outboundLink` dead field** — computed in `lib/events-data.ts:155` and returned at `:230`, rendered nowhere. Delete the computation; it also shrinks the homepage payload the June work fought to slim.
2. **2 of 3 briefing watchdogs** — keep the Vercel `check-briefing` cron, delete `briefing-watchdog.yml` (or the inverse; one watchdog, one runtime).
3. **`/api/agent/collect-seo` as a dormant cron** — it has returned no-op daily for a month. Either set `GOOGLE_SEARCH_CONSOLE_SA_JSON` this week (10 minutes in GCP, and the growth memo finally gets SEO data) or pull the cron until ready. A part that never acts is a fake part.
4. **Read-time `dedupeEvents`** — already scheduled for deletion in CLAUDE.md, gated on 4 clean canary weeks. The blocker is item 1 in §4: the canary never started.
5. **CLAUDE.md drift** — it documents `lib/is-outdoor-event.ts` and `WeatherStrip.tsx` as "kept in place"; **neither file exists anymore**. The cron table is missing `check-murphys-senior-center-schedule`. `APIFY_API_TOKEN` is referenced in code but absent from the env-var docs. `PRD-event-identity-ingest.md` is listed twice with contradictory statuses. Stale docs cost every future session.
6. **`aeo-audit-reminder`** — if the manual 13-query ritual isn't actually being run monthly, delete the cron; a reminder for a ritual nobody performs is noise. (Open question below.)
7. **Dependency drift in `scripts/`** — `@anthropic-ai/sdk` ^0.52 vs root ^0.78, `firecrawl-js` ^1.15 vs ^4.16. Two copies of the same dependency at different majors is a latent bug; align them.

---

## 3. Simplify

1. **One watcher engine.** Collapse the 4 fingerprint crons into `/api/check-watched-sources` driven by a `WATCHED_SOURCES` config array (slug, url, extraction mode, Slack label, site_config key). Adding a venue watcher becomes a config row. This is also the portability move: 30A's watchers become data, not routes.
2. **One ingestion runtime.** `scrape-bls` and `scrape-moose-lodge` run as Vercel crons while every other scraper runs in the GitHub Action orchestrator. Move both into `scripts/scrape.ts` (the Action already holds the Anthropic key and has no serverless duration limits for vision/PDF work). Result: ingestion lives in exactly one place; Vercel crons only serve and derive.
3. **One send path.** Execute HANDOFF-newsletter-reconcile: Peter's `newsletter_send_log` ledger as backbone, the Batch API as transport, both cron and recovery as thin wrappers over one idempotent `sendCampaign`. This structurally ends the silent-miscount class of incident (30/72 on Jun 4, 81/56 on Jun 18) and doubles as the first real upstream-merge exercise for the engine model.
4. **One region seam.** Create `config/region.ts` exporting a single region object: name, domain, description strings, towns, corridor exclusion lists, email From address, mascot asset paths, watched sources, voice persona path. The seams mostly exist (towns.ts, venues.ts, corridor.ts, firecrawl-sources.ts are clean data arrays); this consolidates the leaks: `SITE_DESCRIPTION` in constants, the `newsletter@hwy4events.com` From hardcoded in 8 routes, 4 copy-pasted UA strings, region context inside agent prompts.
5. **Split VOICE.md into engine + persona.** ~70% of the voice constitution is region-agnostic craft rules (no em dashes, verify cadence claims, named entities, Q&A blocks). The rest is Rob-on-Thunderbolt-since-2015 and Sierra Hills sandwiches. Two files: `VOICE-ENGINE.md` (ships with the engine, never forked) + `voice-persona.md` (per region). A new region then writes a persona, not a constitution.
6. **Central table names.** 335 `.from()` call sites across 94 files, 13 tables, zero constants. Add `lib/tables.ts` and do the mechanical sweep. Do **not** rename the `hwy4_` tables: they are frozen engine identifiers now (Eugene runs the same names), and renaming prod tables is risk with no user value. Centralize, don't rebrand.
7. **Model refresh pass.** Every call site is one generation behind (Opus 4.7 / Sonnet 4.6 / Haiku 4.5 vs the current Claude 5 family, Opus 4.8, Sonnet 5). Rob's own rule (SOUL.md: review at 30+ days) last ran 2026-03-11. While in there: A/B the daily briefing on a Sonnet-class model for a week; the voice constitution does the heavy lifting, and the briefing is the single largest recurring Opus line. Small dollars either way; this is hygiene, not savings.

---

## 4. Accelerate cycle time

The pattern across the repo: shipping is fast, *flipping* is slow. Receipts:

- `RECONCILE_EXECUTE` unset since the engine shipped June 9. `event_merge_log` shows 14 merges ever (May 31–Jun 21, all manual/one-off), none in the last 10 days. The 4-week canary that unlocks deleting a whole dedup layer never started.
- GSC collector dormant since May 31 for want of one service-account JSON.
- The newsletter reconcile HANDOFF has sat since June 21 while both send paths keep diverging.
- The ImprovMX alias (full From-identity) has been pending for weeks.

Fixes are cultural + one mechanism:

- **Flip-by dates.** Every dark launch ships with a date in CLAUDE.md by which it's either live or deleted.
- **Make the daily audit nag.** `/api/check-events` already reports data quality; teach it to report dormant flags ("RECONCILE_EXECUTE unset for N days", "GSC env missing") so un-flipped switches surface in Slack instead of in docs.
- **This week:** set `RECONCILE_EXECUTE=true`. Every merge writes a reversible snapshot first, and three other dedup layers still stand; worst case is behavior you already ran manually 14 times.

---

## 5. Automate last (and where to stop)

The data-layer automation is justified: it *is* the product, and each piece is advisory-with-human-gate or snapshot-reversible. The meta-layer (daily chief-of-staff digest, weekly growth memo, experiments registry, Stage-2 auto-runner) is automation ahead of traction: 36 agent runs, 9 proposals, and no Gate 1 yet. Keep it as deliberate R&D and content for the credibility flywheel, but freeze new cockpit stages until Gate 1 is green, exactly as the business plan's gates prescribe. The one automation worth *adding* is the flip-nag in §4. Nothing outward-facing should get more autonomous than the newsletter's veto gate; that boundary is correct.

---

## 6. The engine architecture call (scalability)

**Recommendation: one repo → N deployments, config per region; one Supabase project per region; no multi-tenant runtime; forks only for partners.**

- **Step 0 — give hwy4 its own Supabase project.** Today prod shares a 419 MB, 127-table database with the PAOS knowledge graph, 26 brain packs, travel, and 5 active personal pg_cron jobs; the entire site is ~10 MB of it. Isolation ends the blast-radius risk (LESSONS.md records four RLS near-misses in this shared project), removes noisy-neighbor coupling, and produces the clean per-region template. A free-tier project fits with room to spare (daily crons keep it from pausing). Migration = pg_dump ~17 tables + the `event-posters` bucket + env swap + re-point GSC/Places/Resend secrets: an afternoon with a checklist and a low-traffic window. One workflow change to note: PAOS-side Supabase MCP sessions would need the new project added to reach hwy4 data.
- **Rob-operated regions (30A, Los Gatos) = deployments, not forks.** Second Vercel project + second Supabase project off the same `main`, differing only in env + `config/region.ts` + venues/content. Every engine fix ships to all regions on merge. Multi-tenant runtime (one deploy serving N domains) buys nothing at N≤3 and adds cron fan-out and routing complexity; revisit only past ~5 regions.
- **Partner-operated regions (Eugene) = franchises.** Peter forks because he must own his deploy. That's fine *if* the engine/instance boundary is written down: engine files he never edits and pulls from upstream; instance files (config, content, seeds, voice persona) that never flow upstream. Write REGIONS.md defining that boundary, and prove the model by executing the newsletter reconcile (his ledger merges upstream into core; that's the flow working as designed).
- **Sequencing guard:** the plan gates the port on Gates 1–3. Don't port now. Do the two structural moves that keep the port cheap (own Supabase project, region config seam) as part of normal work, so "port 30A" stays a config + data exercise instead of the rewrite that kills the thesis.

Portability today, measured: ~65–70% of lib/ + app/ is engine-clean; the instance surface is copy (~15 pages), prompts (5 generators), the voice file, email domain, and seed scripts. A 30A stand-up is ~4–6 weeks dominated by *content*, not code. The two worst frictions are the voice/persona embedding and the scattered table names; §3.5 and §3.6 fix both.

---

## 7. Cost snapshot (monthly, estimates)

| Line | ~Cost | Note |
|---|---|---|
| Vercel Pro | $20 | Required (25 crons; Hobby caps at 2). Well under Pro's 40-cron limit. |
| Supabase | $0 marginal | Shared project today. Own free-tier project also ~$0. |
| Anthropic API | ~$10–30 | 22 call sites; daily Opus briefing is the largest single line; Haiku classification is pennies. Verify in console. |
| Firecrawl | **unverified** | 20+ config sources daily + Red Cross = 600+ scrapes/mo minimum. Plausibly the largest bill. Check the dashboard. |
| Apify (FB scraper) | **unverified** | Referenced in code, undocumented in CLAUDE.md. Check usage. |
| Google Places / Resend / Cloudflare / GHA | ~$0 | All designed inside free tiers (80 active subs ≈ 350 emails/mo). |

Cash total ≈ **$50–80/mo**: not the problem. The real scaling cost is operator attention, and the punch list above is mostly attention-surface reduction: 25 crons → ~19, 4 workflows → 3, two send paths → one, four dedup layers → three now and two after the canary.

---

## 8. Punch list

**This week (flips + deletes, ~half a day):** *(all four executed 2026-07-01)*
1. ~~Set `RECONCILE_EXECUTE=true`; canary clock starts.~~ **Done 2026-07-01** — set in Vercel production via CLI; applies on the next deploy, so the 15:30 UTC reconcile runs live from then. Canary window ends ~2026-07-29.
2. ~~Set `GOOGLE_SEARCH_CONSOLE_SA_JSON` (or pull the collect-seo cron).~~ **Done (cron pulled) 2026-07-01** — the GCP service-account + GSC-property steps need a human in two consoles, so the dormant cron was removed from vercel.json instead. The route survives; when the env is set, re-add `{ "path": "/api/agent/collect-seo", "schedule": "0 11 * * *" }`.
3. ~~Delete the `outboundLink` computation; delete `briefing-watchdog.yml`; fix the CLAUDE.md drift list (§2.5).~~ **Done 2026-07-01** — also removed `loadLinkContext()` (the `hwy4_orgs` + `hwy4_venues` queries that existed only to feed it) and the `ListOutboundLink` type.
4. ~~Align `scripts/` dependency versions with root.~~ **Done 2026-07-01** — scripts `@anthropic-ai/sdk` ^0.52 → ^0.78 (matches root; 164/164 tests pass). Root's `@mendable/firecrawl-js` ^4.16 turned out to have **zero importers** and was deleted instead of aligned; scripts (the only Firecrawl consumer) stays deliberately on 1.x — a 1.x→4.x migration of six scrapers is risk with no payoff.

**This month (structure):**
5. ~~Newsletter reconcile per the HANDOFF (ledger + batch; also the Eugene merge rehearsal).~~ **Done 2026-07-03** — `sendCampaign` in `lib/newsletter-send.ts` (Peter's ledger + our Batch transport), migration applied, both cron + recovery rewired, veto gate untouched. The first upstream merge from a downstream fork, proving the engine-core flow.
6. Collapse the 4 watcher crons into one config-driven route.
7. Move BLS + Moose Lodge scrapes into the GitHub Action orchestrator.
8. Add `lib/tables.ts` and sweep the 335 call sites.
9. Extract `config/region.ts`; env the newsletter From; split VOICE.md engine/persona.
10. Model refresh pass (3.5 months past Rob's own review rule); A/B the briefing model.
11. Move hwy4 to its own Supabase project (the keystone; schedule a window).

**At port time (gated on Gates 1–3):**
12. Clone the template: new Supabase + Vercel projects, region config, venue registry, voice persona, seeds.
13. If rebuilding event storage for the port, model recurring series natively instead of row-per-occurrence.

---

## Remaining Questions

- [ ] Is the monthly AEO prompt-audit ritual actually being run? (Determines whether `aeo-audit-reminder` lives or dies.)
- [ ] What are the actual Firecrawl and Apify monthly bills/credit burn? (The two unverified cost lines.)
- [ ] Briefing model A/B: does a Sonnet-class briefing pass the conference-dinner gut check for a week?
- [ ] When is the maintenance window for the Supabase cutover, and should the new project be `hwy4events` under the same org?
- [ ] Does Peter agree to the REGIONS.md engine/instance boundary, and will Eugene pull engine updates from upstream `main`?
