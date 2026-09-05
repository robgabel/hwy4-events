# REGIONS.md — the engine/instance boundary

> **Status:** living doc. Lands with the region-seam PR and is updated by each
> subsequent region-parameterization PR (prompts/voice → content packs →
> pipeline). FORKING.md remains the step-by-step fork playbook; this doc is the
> contract it relies on.

The architecture of record (docs/INFRA-AUDIT-2026-07.md §6, BUSINESS-PLAN §6):
**one repo → N deployments, config per region; one Supabase project per
region; no multi-tenant runtime; forks only for partners.** A Rob-operated
second region (30A, Los Gatos) is a second Vercel project + second Supabase
off the same `main`, selected by env. A partner region (Eugene) is a fork that
merges engine changes from upstream.

## How region selection works

- `regions/<slug>/` holds one region's config: `core.ts` (client-safe brand +
  geo + timezone) and `ops.ts` (server-only emails/SEO/schema/newsletter
  chrome). Registries: `regions/index.ts` (core) + `regions/ops.ts` (ops).
- The env var picks the active region: `NEXT_PUBLIC_REGION` (app) /
  `REGION` (scripts, GitHub Actions). **Unset resolves to `calaveras`**, so
  the live deployment needs no env change. Unknown slugs throw at build/boot.
- Engine code imports exactly two accessors: `lib/region.ts` (core) and
  `lib/region-ops.ts` (ops). **Never import `lib/region-ops.ts` from a client
  component** — it must stay out of public bundles (grep `"use client"` files
  for `region-ops` in review).
- Region modules are **pure data with zero runtime imports** and relative
  import paths only — they must load in client bundles, the edge runtime
  (middleware, `/og`), and the scripts tsx runner alike.

## The boundary inventory

**Engine (edit upstream only; forks pull):** `lib/` logic modules,
`scripts/lib/` functions, `components/` machinery, `app/` route handlers and
page shells, `regions/types.ts` + `regions/resolve.ts` + the registries,
workflow logic in `.github/workflows/`, tests in `scripts/test/`.

**Instance (each region/fork owns; never flows upstream):**
- `regions/<slug>/**` — the region config (this PR) and, as later PRs land,
  its content packs (`content/`) and scraper source lists (`sources/`).
- `content/VOICE.md` (the persona layer; the engine voice rules split out in
  the prompts PR), `docs/LOCAL-KNOWLEDGE-BASE.md`, `docs/PERSONAS.md`,
  `app/towns/town-content.ts` (until it moves under `regions/`), `app/about/*`,
  `public/llms.txt`, mascot/brand assets in `public/`.
- Region-specific route folders (`app/arnold-4th-of-july/`,
  `app/murphys-4th-of-july/`, `app/bear-valley-music-festival-2026/`), the
  one-off event features (`lib/featured-events.ts` + the Patriotic/TwoFifty/
  AdoptAPet/ClassicRock banners — keyed to event UUIDs, naturally inert in any
  other region's database), seed scripts (`scripts/seed-*.ts`), the watcher
  cron routes, `scripts/scrapers/*` source entries.
- `vercel.json`, `next.config.ts`, `middleware.ts` (admin realm/username),
  `.github/workflows/*` secrets/env, `supabase/migrations/` history
  (fresh regions bootstrap from `supabase/bootstrap/00_schema.sql`).

**Interface (stable; changes get a changelog entry here + a fork heads-up):**
the `RegionCore` / `RegionOps` shapes in `regions/types.ts`.

## Flow rules

1. Engine fixes flow **upstream → fork** via merge. Instance content never
   flows upstream.
2. Exception process (the newsletter-reconcile pattern, 2026-07-03): an engine
   improvement born in a fork comes upstream as an engine-only PR, stripped of
   instance values.
3. Upstream promises, frozen: `hwy4_*` table names, the `Hwy4Event` /
   `Hwy4Org` / `Hwy4Venue` type names, the `robs_pick` column (relabel in
   config, never rename), and additive-only evolution of the region
   interfaces.

## Merge protocol for forks

Merge upstream **per-PR, not batched**. Per file class when conflicts appear:
- Engine file conflict → take upstream, re-apply your local engine patches.
- A hardcode you rebranded that upstream moved into region config → take
  upstream's structure, move your value into your `regions/<slug>/` module.
- Instance files → keep yours (upstream should not be touching them; if it
  did, that's a boundary bug — flag it).
After every merge: `cd scripts && npm test`, plus your own snapshot fixtures
(re-capture them once after adopting the region layer — from then on they
protect *your* bytes the same way ours protect ours).

## What zero-drift means

Every region-parameterization PR is data movement, never behavior change:
- Old paths become re-export shims; no file deletions, no identifier renames,
  no copy edits (not even typos) in the same PR as a move.
- One config field per distinct string — near-duplicates (manifest name vs
  site name) stay distinct fields.
- Proof, per PR: full scripts suite green untouched; `tsc` clean in both
  packages; `npm run build` green; rendered-HTML diff of the key routes
  against the pre-PR base (normalized for build ids); the email snapshot test
  (`scripts/test/email-snapshot.test.ts`) and, once the prompts PR lands, the
  prompt snapshot test byte-identical.

## Planned follow-ups (tracked in the region-parameterization program)

- **Prompts + voice split**: hoist the LLM system prompts into `lib/prompts.ts`
  composed from region/persona atoms; split `content/VOICE.md` into engine
  rules + persona layer with a successor sync test.
- **Content packs**: town/intent/holiday/faq/about/llms.txt prose moves under
  `regions/calaveras/content/` behind shims.
- **Pipeline**: `scripts/lib` venue registry / manual-source blocklist /
  corridor arrays / notability org slugs move behind shims;
  `REGION: calaveras` env lands in the scrape + blurb workflows.
- **Out of scope for the program**: `lib/tables.ts` (separate hygiene PR),
  watcher-cron collapse and BLS/Moose orchestrator moves (INFRA items 6–7),
  the Supabase project move (INFRA item 11), any table/type/column rename.

## Interface changelog

Additive-only, per the flow rules. Each entry names what a fork does on merge.

- **2026-09-04 — `RegionGeo.hubIpCities?: readonly string[]` (optional).**
  Lowercased regional ISP hub cities for the Gate 0 classifier (`lib/geo.ts`):
  an in-state IP city in this list is classified `hub`, a mix of hub-routed
  residents and genuine regional visitors that is counted apart from both
  `local` and `visitor` (and is checked before the bounding box, because a hub
  city inside the box still carries the hub's coordinates). Omit the field and
  behavior is unchanged: every located non-local request stays `visitor`.
  Ships with migration `20260904_visitor_class_hub.sql` (a widened CHECK on
  `site_events` / `newsletter_subscribers` plus the three `*_stats` RPCs
  counting `hub`), which the engine's write routes need **before** they deploy.
  **Fork action:** run `cd scripts && npx tsx reclassify-visitor-class.ts`
  (dry-run) and read the top IP cities in your `visitor` bucket; list the ones
  that are ISP hubs for your rural readers, and widen `localIpCities` to the
  towns you actually serve. Calaveras shipped Sacramento, Stockton, Lodi,
  Modesto and Sonora after Rob's own Arnold connection resolved to Lodi.
