# PRD — Event Poster Loop

**Status:** Phase 1 + generator (2026-06-03) and the organizer poster-swap / claim-upload (§10, 2026-06-04) shipped — see Implementation status below.
**Owner:** Rob
**Origin:** `/brain scott-belsky` working session + `/predict` cascade, 2026-06-02.

**One-liner:** Turn every Hwy4Events detail page into a beautiful, on-brand, shareable *poster* — the canonical artifact organizers reach for instead of a Facebook-only JPEG — so that sharing the event is also marketing us. An organizer-led viral growth loop that closes through both a digital door (shared link) and a physical door (printed flyer + QR).

---

## Implementation status (2026-06-03) — built + verified locally

Production build passes; the poster renders live from the database (verified on "Storytime with Miss Debbie", Arnold).

- **Generated poster route** — [app/events/[slug]/poster/route.tsx](app/events/[slug]/poster/route.tsx) (`next/og` + Satori, Node runtime, `revalidate=86400`). Renders the screenprint from event data: constant Sierra backdrop + per-category motif, "Free" seal driven by `cost_tier`, Bitter/DM Sans (the live site fonts, served from `public/fonts/` and fetched from the request origin), Millie coin + "Poster by hwy4events.com," and a QR. **Supplied posters (`image_url`) redirect to the organizer's image untouched** — the branding rule.
- **Detail page** — [app/events/[slug]/page.tsx](app/events/[slug]/page.tsx) rebuilt around the poster hero + an action rail (Share · Download poster · Add to calendar · Directions). OG/Twitter card now points at the poster image.
- **Attribution** — `supabase/migrations/20260603_add_share_hits.sql` (RLS + service-role policy), [app/api/track-share/route.ts](app/api/track-share/route.ts) (service-role insert), [components/ShareTracker.tsx](components/ShareTracker.tsx) (ISR-safe client beacon reading `?src`), and `ShareButton` now tags shares `?src=share`.
- **Shared helpers** — [lib/poster.ts](lib/poster.ts) (supplied-vs-generated + `?src` helper) and [lib/events.ts](lib/events.ts) (shared slug→event fetch, now including `image_url`).

**To go live:** (1) apply `20260603_add_share_hits.sql` to the Hwy4Events Supabase; (2) commit + merge the branch → Vercel auto-deploys (`SUPABASE_SERVICE_ROLE_KEY` already set; fonts committed under `public/fonts/`).

**Follow-ups (not blocking):** swap the styled-placeholder QR for a real encoder; finish the 8-category motif set (frog / chess / mic / bee / wine glass / Big-Tree fallback exist today); download-click attribution; the detail-page rail still prints "Community Submission" as the source label (already suppressed on the poster itself).

### Organizer poster-swap / claim-upload (§10) — built + verified 2026-06-04

The last workstream of the loop: an organizer swaps in their own poster, a human approves it, and the poster system shows their art untouched (`posterKind → "supplied"`). A "swap" is just setting `hwy4_events.image_url`.

- **Data + storage** — `supabase/migrations/20260604_poster_submissions.sql`: `poster_submissions` table (RLS + service-role-only policy in the same migration) and a **public `event-posters` Storage bucket** (public read, 8 MB + image-MIME backstop). Uploads go through the API route as service-role, never anon-direct.
- **Submit path** — an unobtrusive "Organizer? Swap in your own poster" link on the detail page → `app/events/[slug]/submit-poster/page.tsx` (shows the current poster next to an upload form, [components/SubmitPosterForm.tsx](components/SubmitPosterForm.tsx)) → [app/api/submit-poster/route.ts](app/api/submit-poster/route.ts) validates (type + ≤4 MB; the Vercel 4.5 MB body cap, since D1 routes the upload through the function), uploads to `event-posters`, inserts a `pending` row, and pings Slack `#hwy4events` with a `/admin/posters` link.
- **Review path** — [app/admin/posters/page.tsx](app/admin/posters/page.tsx) + [actions.ts](app/admin/posters/actions.ts) behind the existing Basic Auth (nav badge with pending count). Shows the current poster next to the submitted one. **Approve** sets `image_url` + `poster_locked=true` on **every upcoming row of the event series** (matched via the shared `isSameEvent` with the date stripped, so a weekly event's many rows all get the art), marks the submission `approved`, and busts the `events` cache tag + affected detail paths. **Dismiss** marks it `rejected` and removes the orphaned upload.
- **Verified locally:** production build (53 static pages); detail-page link + submit page render (generated poster shown as the "current" art); admin page renders behind auth (401 without); API route validation 400s with no side effects; the date-stripped `isSameEvent` proven to match recurring rows and reject different events.

**To go live:** the migration is already applied to the shared Supabase (`uzediwokyshjbsymevtp`) and the bucket exists; just merge → Vercel auto-deploys (`SUPABASE_SERVICE_ROLE_KEY` + `SLACK_WEBHOOK_URL` already set). **v1 scope:** one-off submission per event, no organizer accounts; recurring events re-lock per new future row over time (same caveat as `poster_locked`).

---

## 1. Problem / why now

The detail page today ([app/events/[slug]/page.tsx](app/events/[slug]/page.tsx)) is a clinical `<dl>` (date, time, venue, price, a map) with **zero image**. Organizers, meanwhile, pour all the emotion into a poster (the RE/MAX Easter celebration, the Jr. Frog Jump, the Free 2 Bee market) that has two failures:

1. **No digital home.** The poster lives on a Facebook post and dies there. It can't be a clean, shareable link with the facts a stranger needs.
2. **Uneven info and design skill.** Some posters are gorgeous, some are AI-slop, many omit the real address, end time, or cost.

And the fact that reframes the whole thing: **most events have no poster at all**, and recurring ones often share *one* season poster across many dates (the Camp Connell Beer Garden makes one poster for the whole summer, not one per band). Per-event posters mostly will not exist. Whoever *manufactures* the artifact owns the layer.

## 2. Thesis

> **The page is the poster; the poster is the billboard.**

One artifact, two organizer types, both served:

- **"I love my poster"** → we give them **digital reach** (share the link; their art is the hero).
- **"I never made a poster"** → we give them **a free poster** (download it, print it, post it). They don't have to design anything. *This is the aha.*

Every copy carries the Millie + `hwy4events.com` lockup and a tracked link, so the loop closes through **two doors**: a digital door (shared link carries our brand and attribution) and a physical door (printed flyer carries our URL + a QR). Most "viral loops" only have the digital door. This is the post-office corkboard, restored at corridor scale.

## 3. Strategic context — why this is defensible (and where it bites back)

From the `/predict` cascade:

- **Interface controls value.** Whoever owns the trusted share artifact captures the relationship downstream, regardless of who originated the event data. The poster is the interface; we own it.
- **Attribution is the moat.** The web is broken at attribution; a poster screenshotted off Facebook destroys the link home. Fixing attribution is the Behance move, applied to a mountain corridor.
- **The behavioral graph, not the listings, is the asset.** GoCalaveras has the listings too (~69% of our table is sourced from it). What it can't have is the graph of which organizers post, which venues pull, who shares, who shows up. That graph is the durable advantage.
- **Agent-legibility is the long game.** When someone asks an AI "what's happening in Murphys this weekend," it pulls from the most structured, attributed, trusted source. Rich structured data on these pages (ties to `PLAN-seo-aeo.md`) positions us as that source while SEO-aggregator models erode.

Two strategic risks this initiative *creates* (both must be designed around, not discovered later):

- **R1 — The dependency trap.** Winning the interface war makes us *more* dependent on the supplier we're disintermediating. We demote GoCalaveras to a feed, but still drink 69% of our supply from it, and it already 403s us. Reducing GoCalaveras supply dependence is a parallel workstream, not an afterthought (see Risks).
- **R2 — Homogenization.** Our own templated poster can become the "shared aesthetic that belongs to no one." Beating slop with nicer slop is still losing. Distinctiveness (Millie, local motifs, real local voice) has to be genuinely earned. This becomes a hard acceptance criterion on the generator (§9).

## 4. Goals

1. An organizer-led growth loop that **closes** — a recipient becomes the next sharer or lists their own event.
2. Every upcoming event has a share-worthy, on-brand artifact: **web hero + OG link-preview + downloadable poster**, from one render definition.
3. **Attribution:** know which events (and, after claim, which organizers) drive traffic, by channel.
4. **Brand recognition** — locals start to recognize "that's a Hwy4Events flyer."

## 5. Non-goals (the source of advantage — what we are deliberately bad at)

- **No RSVP / ticketing.** Link out to the organizer's own if they have one. Never build a ticketing flow.
- **Not a general listings site.** We are the curated, beautiful *home for the corridor's flyers*, not Eventbrite.
- **Not a design tool / not Canva.** We generate the poster; organizers accept it or upload their own. The instant we ship an editor, we've lost.
- **No bespoke per-event AI illustration.** Consistency is the billboard; freeform image generation is slop (§9).

## 6. Who shares — the persona map

The loop introduces an actor not in [docs/PERSONAS.md](docs/PERSONAS.md): the **Organizer** (the business/person running the event). Two sub-types, both served by one artifact:

| Node | Who | Why they share | What they get |
|---|---|---|---|
| **Organizer (proud poster)** | RE/MAX Easter, Free 2 Bee Farm | Wants attendance; proud of the art | Digital reach for a poster that was trapped on Facebook |
| **Organizer (no poster)** | Calaveras Community Band, the chess social | Dreads making a flyer | A free, finished poster to print and post |
| **Amplifiers (existing personas)** | Gary → his buddy; **Karen → Airbnb guests** (recurring, high-value); Mia → tasting-room guests; Jen → BLS Facebook groups; Miguel arrives via a shared link / Google and re-shares | Looks in-the-know; helps someone | A clean link that makes *them* look plugged in |

The organizer is the high-leverage node (one share hits their whole following). Amplifiers close and widen the loop.

## 7. The loop

1. **We manufacture the artifact.** Every event gets a poster: web hero + OG link-preview + downloadable file. Source poster becomes the hero when it exists; auto-generated when it doesn't. Millie + `hwy4events.com` lockup baked into the share image and the download.
2. **Organizer discovers it** (ignition, §13). It beats their Facebook post *and* carries the facts their poster lacked.
3. **They spread it, two doors:** *have a poster* → share the **link**; *no poster* → download the **poster** and use it.
4. **Every copy carries our brand + a tracked link.** Printed flyer → `hwy4events.com` + QR on the corkboard. Shared link → Millie preview + a `?src=` param.
5. **Recipients become new nodes:** other organizers think "I want that for mine" → claim/submit (new supply); attendees explore and re-share (amplification).
6. **We read attribution, double down on the best-sharing organizers,** and new supply mints more artifacts. Flywheel turns.

**Where it dies:** ignition (organizers never discover their page) and craft (the generated poster looks like slop, inverting the billboard logic). Both are first-class risks (§16).

## 8. The two organizers — value prop & the season-poster case

- **Proud-poster organizer** → we hero their art and hand them a link + a lockup'd share image. We add the reliable facts layer beneath (map, real hours, cost) that their poster lacked.
- **No-poster organizer** → we generate a finished poster they can download and use. The reason they pick us over Canva: zero effort, already accurate, already local.
- **Season poster → many events:** one uploaded poster attaches to many dated rows via the umbrella-series / `isGenericTitle` machinery already built for Camp Connell ([lib/event-identity.ts](lib/event-identity.ts)). The beer garden uploads one summer poster; it heros every dated row in the series.

## 9. The poster system (Decision D1)

**Principle: let AI art-direct, never illustrate.** Encode our taste as constraints; let AI choose *inside* them. AI is the art director picking from our system, not the illustrator. **Consistency is the billboard.**

**One flexible template:**
- **Type-first.** Confident display type (`font-display`) carries it. With no image, the event name is the hero. (This is why the Memorial Day band poster works: restraint reads in one second on a phone.)
- **8 category skins.** The existing categories (Live Music, Festival, Community, Hike & Walk, Kids, Wine, Games, Other) drive palette + a *local* motif (pine, Big Trees, grapes, snow — our own iconography, never generic clip-art) + a Millie pose. One template, eight outfits.
- **Millie + `hwy4events.com` lockup**, bottom corner — the tasteful "powered by" watermark (mirrors the Arts Center credit on real-world flyers).
- **QR code** to `/events/<slug>?src=qr` — the offline door of the loop and the printed-path attribution.
- **Facts + a "Free!" badge** pulled from `cost_tier`. Small `robs_pick` / `community_sourced` flourishes where those flags are set.
- **Optional hero zone** for a source poster/photo when present.

**Where AI helps (constrained, non-generative):**
- An LLM reads metadata → chooses config (theme, accent, Millie pose, motif on/off) and writes a one-line local-voice tagline **through the SOUL voice guardrails** (no em dashes, named entities, conference-dinner gut check; reuse the banned-phrase/em-dash check from the existing draft scripts).
- When a source poster exists, a Vision call *extracts its dominant color* so the lockup/QR strip harmonizes instead of clashing. Reading the image to fit our system, not painting a new one.

**Deliberately bad at:** bespoke illustration. The shared visual DNA is the moat.

**Anti-homogenization acceptance criteria (from R2):** a generated poster ships only if it (a) clears a human taste gate — the generator refuses to auto-publish anything that trips a voice/quality rule, mirroring [scripts/draft-venue-blurbs.ts](scripts/draft-venue-blurbs.ts); (b) reads as a *Hwy4Events* flyer, not a Canva-default — i.e., the Millie + local-motif + voice are load-bearing, not decorative. If a sample of generated posters is indistinguishable from a generic template, the generator is not done.

**Render pipeline:** one template definition → three surfaces (web hero, OG link-preview, downloadable poster), built on the existing `app/og/` generation. *Build notes:* OG link-preview is landscape (1200×630); the downloadable/printable poster is portrait (e.g., 1080×1350 for social, a print-res variant later). Compositing the lockup onto a *source* poster is most robust with `sharp` (already a dependency, used by [lib/static-map.ts](lib/static-map.ts)); fully *generated* posters can render via Satori/`@vercel/og`. Confirm Satori can load remote images and express the template before committing.

**Branding rule — never deface the organizer's art.** The Millie coin, the "Poster by hwy4events.com" lockup (bottom-left, bottom-aligned with the QR), and the QR are applied **only to posters we generate** (the no-poster case). When an organizer supplies their own poster, we display it **untouched** — no QR, no mascot, no "Poster by" stamped on their artwork. For supplied posters, sharing and attribution run through the page UI (the Share button, the page's own link/QR), not the image itself. Trade-off: we forgo stamping every shared pixel in exchange for respecting creators' work — and the branded-artifact volume comes from the generated posters anyway, which are the majority since most events have no poster.

## 10. Claim / upload (do-show-explain)

- **v1: auto-build, zero organizer effort.** The page is share-worthy before they lift a finger.
- **Then a one-tap "Is this your event? Make it shine"** → reuse `event_submissions` + the `/admin` moderation queue ([reuse the `verification/actions.ts` server-action pattern]). Organizer uploads a better poster, fixes facts, adds a ticket link.
- **Community can also submit a poster**, extending the existing `community_sourced` + `/submit` path.
- **The taste gate stays:** uploads are moderated before they publish, so slop can't leak onto the site.

## 11. Attribution (Decision D3)

- **v1 — event + channel level.** Shareable URLs carry `?src=<share|qr|pdf|link>`. The event is identified by the path slug (no redundant id needed). A tiny client beacon fires once on mount, POSTing to a new `/api/track-share` route that inserts into a `share_hits` table (Cloudflare Web Analytics can't slice per-event/per-channel). [components/ShareButton.tsx](components/ShareButton.tsx) appends `?src=share`; the QR encodes `?src=qr`; the download button stamps `?src=pdf`.
- **post-claim — organizer level.** Claimed organizers get a `?via=<orgcode>` code so we see *who* shares, not just which event.
- **ISR-safe:** the page stays `revalidate=3600`; tracking is a client beacon, not a dynamic render. The beacon component is ~20 lines, no heavy deps (respects the hydration-budget rule).

**Proposed migration (`supabase/migrations/20260602_share_hits.sql`)** — RLS enabled + policy in the same migration, service-role writes only (per the HARD RULES; never disable RLS):

```sql
create table if not exists share_hits (
  id          uuid primary key default gen_random_uuid(),
  event_slug  text not null,
  event_id    uuid references hwy4_events(id) on delete set null,
  src         text not null check (src in ('share','qr','pdf','link','download')),
  via         text,                       -- organizer code, post-claim
  referrer    text,
  created_at  timestamptz not null default now()
);
alter table share_hits enable row level security;
create policy "service role full access" on share_hits
  for all to service_role using (true) with check (true);
create index share_hits_event_idx on share_hits (event_slug, created_at desc);
create index share_hits_src_idx   on share_hits (src, created_at desc);
```

`/api/track-share` inserts with the service-role client (bypasses RLS without disabling it). Admin reads via service role on a future `/admin/shares` view.

## 12. Ignition (Decision D2) — the riskiest assumption

- **Semi-automated outreach.** For the best upcoming events, draft a friendly "here's a free poster for your event" message with the link + downloadable poster. Reuse the chief-of-staff agent pattern ([app/api/agent/*](app/api/agent)): propose → human approves → send. Manual send in v1; the agent only drafts.
- **SEO** (`PLAN-seo-aeo.md`) is the compounding long-game that gets organizers to their page over time, but it is not the spark.
- **Open:** does outreach scale past a handful of events/week? This is the assumption most likely to break the loop — stress-test before over-investing (`/debate`).

## 13. Success metrics (the closing test)

- **Leading (the heartbeat):** shares + QR scans + poster downloads per event, from `share_hits`.
- **Closing (is the loop real?):** (a) new sessions arriving from shared/QR/download links; (b) **new events from organizers who arrived via a shared link or claimed after seeing their page.** The loop is only "real" when the closing metrics move, not just the leading ones.

## 14. Staged rollout (dry-run → canary → reversible, the house arc)

### Phase 1 — validate the loop cheaply (no generator) ← **start here**
Tests the entire thesis using only events that *already have a source poster*. If a beautiful, branded artifact gets shared and `share_hits` lights up, Phase 2 is justified. Concrete scope:
1. **Detail page:** hero the source poster image at the top of [app/events/[slug]/page.tsx](app/events/[slug]/page.tsx) when one exists. (Requires a column/source for the poster image URL — confirm where the scraped poster image lives or add `hwy4_events.poster_url`.)
2. **Lockup render:** a route/util that composites the Millie + `hwy4events.com` lockup onto a copy of the source poster via `sharp`, served as (a) the OG link-preview and (b) the downloadable image.
3. **Share + download:** wire `?src=share` into [components/ShareButton.tsx](components/ShareButton.tsx); add a "Download poster" button serving the lockup'd image with `?src=pdf`.
4. **Attribution:** ship the `share_hits` migration + `/api/track-share` + the client beacon component.
5. **Watch** for a canary period; read `share_hits` by event and channel.

### Phase 2 — the generator (the hard craft bet)
Build the templated poster system + 8 category skins + LLM art-direction + QR for poster-less events. **Gate:** must clear the §9 anti-homogenization acceptance criteria behind a human taste gate before it ships.

### Phase 3 — claim + organizer attribution
Claim flow via `event_submissions`; per-org `?via=` codes; season-poster attach via the umbrella-series machinery.

### Phase 4 — ignition at scale
Semi-automated outreach via the agent pattern.

Gate each phase on evidence from the last, same as the reconcile and agent-cockpit rollouts.

## 15. Risks / open items

- [ ] **R1 — Dependency trap (strategic).** Winning increases reliance on GoCalaveras supply (69% of rows; already 403s us). Parallel workstream: grow non-GoCalaveras supply (the poster loop itself adds organizer-submitted events; plus direct venue/org feeds) so the interface win doesn't leave us hostage to the feed. Track GoCalaveras share-of-supply as a KPI; it should fall over time.
- [ ] **R2 — Homogenization (craft).** If generated posters read as Canva-default, the billboard logic inverts. Enforced by the §9 acceptance criteria + human taste gate on Phase 2.
- [ ] **Ignition may not scale** (D2). Validate outreach throughput before betting on it.
- [ ] **Source-poster slop.** Even hero'd posters can be AI-sloppy; decide the bar for hero-ing vs. demoting a source poster (a quality/hide toggle, like `places_locked`).
- [ ] **Poster image availability.** Confirm where the source poster image URL lives today (BLS Vision-scraped flyers, community submissions) or add `hwy4_events.poster_url`.
- [ ] **Print/PDF feasibility** from the same template definition (resolution, fonts, bleed) — deferred past Phase 1 (Phase 1 ships a downloadable image, not a print PDF).
- [ ] **AI tagline voice** must pass SOUL guardrails every time (automated banned-phrase + em-dash check, like the existing draft scripts).

## 16. Reused infrastructure

| Piece | Reused for |
|---|---|
| `app/og/` (OG image generation) | the render pipeline foundation |
| `lib/static-map.ts` + `sharp` | compositing the lockup onto source posters |
| `components/ShareButton.tsx` | attribution params on shared links |
| `event_submissions` + `/admin` + `verification/actions.ts` | claim/upload moderation queue |
| `community_sourced` flag + `/submit` | community poster submission, "neighbor" precedent |
| `lib/event-identity.ts` (`isGenericTitle`, umbrella-series) | one season poster → many dated rows |
| `cost_tier`, `robs_pick`, `community_sourced` | "Free!" badge + poster flourishes |
| `/public` Millie line-art | the lockup asset |
| `app/api/agent/*` chief-of-staff pattern | ignition outreach (propose → approve → send) |
| `PLAN-seo-aeo.md` structured data | agent-legibility (strategic context §3) |

---

*Drafted with the Scott Belsky brain. Core bets: the first mile is the share preview; craft survives abundance (consistency = brand, but not at the cost of distinctiveness); do-for-the-user (auto-build before we ask anyone to claim); restore something ancient at greater scale (the corkboard). Strategic cautions from `/predict`: don't let winning the interface make you hostage to the feed you're disintermediating (R1), and don't beat slop with nicer slop (R2).*
