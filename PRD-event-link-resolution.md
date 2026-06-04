# PRD: Event Link Resolution — Link to the Destination, Not the Provenance

> **Update 2026-06-03 — GoCalaveras fallback re-enabled.** The original implementation suppressed GoCalaveras links entirely (`AGGREGATOR_FALLBACK = false`) on the premise that their EventON permalinks churn and 404. Browser-grade verification (Firecrawl, June 2026) found that the current permalinks — including incrementing recurring slugs — return HTTP 200 with correct, current content. The 403 is only against server-side validators (our CI), not a real user's browser. The fallback is now enabled: a GoCalaveras event with no organizer/venue match renders its GoCalaveras link as a **non-durable** CTA. Organizer/venue canonical still wins (primary source first). Community submissions excluded. GoCalaveras links kept out of JSON-LD (`durable:false`). Priority order: organizer → venue → stable-source → GoCalaveras (non-durable) → none.

> The "external link" on an event page answers the wrong question. It stores **where the scraper found the event** and renders it as **where the user should go.** For ~69% of upcoming events those are the same aggregator URL. This is the fix: resolve the displayed link from event *identity* (organizer / venue), not scrape *provenance* — and fall back to the aggregator source link rather than showing nothing.
>
> Musk-algorithm framing: **make the requirement less dumb → delete → simplify → accelerate → automate.** The dumb requirement is "link to the page we scraped." Step 1 redefines it to "link to the most authoritative durable page for this event, and if there isn't one, show the source." Everything else follows.

## Context

The event detail page renders a single "Visit Event Page" button, sourced **only** from `event_url` ([app/events/[slug]/page.tsx:370](app/events/[slug]/page.tsx)). `event_url` is set by each scraper to whatever link it saw at scrape time. For the dominant source that link is an aggregator permalink, and three forces make it fail:

1. **Provenance is used as destination.** Nothing in the system ever asks "what is the authoritative page for this event?" It records where we *found* it. `source_url`/`source_name` are fetched by the detail-page query but never rendered, so they're dead weight in the UI path.

2. **Aggregator permalinks are ephemeral.** GoCalaveras is an EventON/WordPress calendar that mints a **new post per occurrence** and trashes the old one. The data proves it: the same logical event carries incrementing slugs across consecutive weeks (`creek-critters-big-trees-state-park`, `-2`, `-3`, `-4`; guided hikes `-49`, `-50`, `-51`). A link captured at scrape time is dead days later. Today's "Creek Critters" and "Arnold Rim Trail" pages already 404 in the browser.

3. **The validator is structurally blind to the source that rots most.** `validateEventUrls()` ([scripts/lib/validate-urls.ts](scripts/lib/validate-urls.ts)) nulls any `event_url` returning ≥400. But `gocalaveras.com` returns **403 to server-side fetches** (verified — even the calendar index 403s; it sits behind a bot wall), and the job runs at most once/day *after* the fact via the GitHub Actions scrape. So it can't tell a live GoCalaveras link from a dead one, and can't pre-empt next-day permalink churn. At best it converts "dead link" into "no link" — which is exactly the Big Trees North Grove case (`event_url = null`, last scraped weeks ago).

**The destination we want is already half-known and unwired.** `hwy4_orgs.canonical_url` exists and feeds date-verification ([app/api/verify-events/route.ts](app/api/verify-events/route.ts)) and the admin page, but the **public render path ignores it.** Specifically:
- `arnold-rim-trail` → `canonical_url = arnoldrimtrail.org/events/` (live, 200), `match_patterns = ["arnold rim trail"]`, check enabled. We already know the right link and already have the pattern to spot these events inside the GoCalaveras feed.
- `calaveras-big-trees-state-park` → org row **exists**, `canonical_url = null`. (`bigtrees.org/events/` is live, 200.) The "we must have crawled it somewhere" instinct is right; the org is there, the URL was never filled in.

**Sizing (934 upcoming events):** 648 (69%) come from GoCalaveras; 630 carry a fragile `gocalaveras.com` link, 18 are null. Visit Murphys (203), the library (14), Bistro (12) etc. all carry real organizer URLs and are healthy. **The rot is concentrated almost entirely in one source — fix the resolution layer once and it covers all of them.**

## Goals / Non-Goals

**Goals**
- A single pure resolver — `resolveEventLink(event, org?, venue?)` — that returns the most authoritative durable link, defined **once** and imported by every consumer (mirrors how `isSameEvent` is the one definition of identity).
- Never render a link we know is fragile or dead. An aggregator permalink is never the primary CTA.
- Surface the organizer/venue canonical we already have (Arnold Rim Trail) and close the data gaps we don't (Big Trees), so the felt bug disappears on ~630 pages.
- Keep provenance (`source_name`, `source_url`) as attribution/lineage, cleanly separated from destination.

**Non-Goals**
- No new scraper. This changes how we *resolve and render* links, not how we ingest.
- No schema migration in the first cut — resolution is a pure function at render/briefing time (the read-time-first pattern from the dedup work). Write-time caching is a later, evidence-gated optimization.
- Not deleting `validateEventUrls()` in this PRD — only narrowing what it checks (skip bot-walled hosts it can't see).
- Not redesigning community submissions (`/submit` lets a neighbor supply their own `event_url`; that's a trusted, human-entered destination and stays).

## Approach

### Step 1 — Make the requirement less dumb: define the destination (`lib/event-link.ts`)

A new pure module, the single source of truth for "where does this event's outbound link go":

```
type ResolvedLink = { href: string; label: string; kind: 'organizer'|'venue'|'source'|'none'; durable: boolean };
resolveEventLink(event, org?: Hwy4Org|null, venue?: KnownVenue|null): ResolvedLink
```

Priority order (first hit wins):
- **a. Organizer canonical** — `org.canonical_url`, where `org` is resolved by `org_slug` **or** `match_patterns` (reuse `matchEventToOrg` from verify-events). → arnoldrimtrail.org, bigtrees.org. `kind:'organizer'`, durable.
- **b. Venue canonical** — a new optional `url` on the venue registry (Step 3). `kind:'venue'`, durable.
- **c. Stable-source permalink** — `event_url` **only if** the host is on a `STABLE_SOURCE_HOSTS` allowlist (Visit Murphys, real venue sites, community submissions). `kind:'source'`, durable. **GoCalaveras is excluded by definition** — its permalinks are not durable.
- **d. None** — render no outbound CTA. The internal event page is the destination (also the AEO win: be the answer, don't bounce users to a 403).

One tunable constant, `AGGREGATOR_FALLBACK` (default **off**): when off, aggregator permalinks are never rendered. Flip it on only if we later add live, browser-grade validation for a specific aggregator. The recommendation is to leave it off and **be the destination.**

### Step 2 — Delete the part: stop trusting provenance as a link, everywhere at once

Wire every destination-consumer to `resolveEventLink`, deleting their direct `event_url` reads:
- [app/events/[slug]/page.tsx:370](app/events/[slug]/page.tsx) — the CTA. Render only when `resolved.kind !== 'none'`; label from `resolved.label` ("Visit organizer", "Arnold Rim Trail events", etc.).
- [app/events/[slug]/page.tsx:115](app/events/[slug]/page.tsx) — the JSON-LD `offer` url uses the resolved durable href (or our own page), so bad links stop leaking into structured data.
- [components/PatrioticEventDetail.tsx:287](components/PatrioticEventDetail.tsx) — same resolver (drop the hardcoded `|| arnoldparade.org`).
- Briefings + newsletter ([generate-briefing](app/api/generate-briefing/route.ts), [generate-weekend-briefing](app/api/generate-weekend-briefing/route.ts), [newsletter/send](app/api/newsletter/send/route.ts)) — resolve each event's link **before** building the LLM prompt, and pass only durable hrefs (or none). The LLM can't emit a 403 it was never handed.

`EventCard` already links internally (to `/events/[slug]`), not to `event_url`, so the list views need no change. The admin tool ([app/admin/verification/page.tsx](app/admin/verification/page.tsx)) keeps showing raw `event_url`/`source_url` — it's an internal diagnostic, provenance is the point there.

### Step 3 — Simplify: backfill the destination data we already half-have

Pure code is useless without the registry rows. Two small, reviewable data changes:
- **Org canonicals (SQL).** `UPDATE hwy4_orgs SET canonical_url='https://www.bigtrees.org/events/', match_patterns=ARRAY['big trees','calaveras big trees','aronld rim'], canonical_check_enabled=true WHERE slug='calaveras-big-trees-state-park';` plus a sweep of the other recurring GoCalaveras organizers. **Note:** match patterns must be normalized/fuzzy or include known misspellings — the source literally lists "**Aronld** Rim Trail." Fold a typo-tolerant normalize into `matchEventToOrg`, or enumerate the variants.
- **Venue URLs.** Add an optional `url?: string` to `KnownVenue` in [scripts/lib/venues.ts](scripts/lib/venues.ts) and populate the obvious ones (Calaveras Big Trees State Park, etc.), so venue-level resolution works even when no org row matches.

### Step 4 — Accelerate / automate: resolve continuously and stop validating the unseeable

- **Narrow the validator (delete work).** `validateEventUrls()` should **skip** hosts on a bot-wall list (gocalaveras.com) — it cannot see them and risks false-null on 403. Since we no longer render those links anyway, this is pure deletion. It keeps validating the stable-source allowlist, where a 404 is real signal.
- **Audit line (surface regressions).** Extend the daily [/api/check-events](app/api/check-events/route.ts) audit with: count of events whose only resolvable link is `kind:'none'` *and* that have a known organizer/venue with no canonical set (i.e. a closeable gap), plus count still carrying an aggregator `event_url`. This is how new ungap-able orgs get noticed instead of silently showing no link.
- **(Later, evidence-gated) write-time cache.** If render-time org lookups ever matter (they won't on a single detail page; they're already cheap), fold resolution into `normalizeEventLocation` ([scripts/lib/dedup.ts](scripts/lib/dedup.ts)) the same way it already fills registry addresses, storing the resolved durable href. Defer until there's a measured reason — read-time-first, exactly like `dedupeEvents`.

### Step 5 — Guard against drift

- **Lock the priority order with a test** — `scripts/test/event-link.test.ts`, mirroring `event-identity.test.ts`: organizer beats venue beats stable-source beats none; a GoCalaveras `event_url` with no org/venue match resolves to `none`; Arnold Rim Trail (even misspelled "Aronld") resolves to the canonical. The order can't silently regress.
- **One definition, many importers** — detail page, patriotic detail, JSON-LD, all three generators import `resolveEventLink`. No consumer reads `event_url` directly for a destination again.

## Rejected Alternatives

- **Just run `validateEventUrls` more often / harder.** It physically cannot see GoCalaveras (403 server-side), and even a perfect run can't stop a permalink that churns tomorrow. It treats the symptom (dead link in DB) and produces a new symptom (no link). The disease is using provenance as destination.
- **Scrape the GoCalaveras event detail page for an "external link" and store that.** The scraper already attempts detail enrichment ([gocalaveras.ts:654](scripts/scrapers/gocalaveras.ts)) and it 403s from CI too. Even when it works, most GoCalaveras listings have no outbound organizer link — the aggregator *is* the page. Resolving from our own org/venue registry is more reliable and fully under our control.
- **Add a `canonical_event_url` column and resolve at write time first.** Mutates provenance, goes stale when the registry changes, and needs a backfill job to refresh — all the costs the dedup work taught us to defer. Render-time pure function first; cache later only if measured.
- **DB-level link rules.** Resolution depends on fuzzy org/venue matching (misspellings, aliases, match_patterns) — not expressible as a column constraint. Stays procedural, like `isSameEvent`.

## Critical Files

- **New:** `lib/event-link.ts` (`resolveEventLink`, `STABLE_SOURCE_HOSTS`, `AGGREGATOR_FALLBACK`), `scripts/test/event-link.test.ts` (priority-order lock).
- **Edit:** `app/events/[slug]/page.tsx` (CTA + JSON-LD via resolver), `components/PatrioticEventDetail.tsx`, `app/api/generate-briefing/route.ts`, `app/api/generate-weekend-briefing/route.ts`, `app/api/newsletter/send/route.ts` (resolve before prompt), `scripts/lib/venues.ts` (`url?` field), `scripts/lib/validate-urls.ts` (skip bot-wall hosts), `app/api/check-events/route.ts` (gap audit), `CLAUDE.md` (document the resolver + this PRD in the index).
- **Reuse, unchanged:** `matchEventToOrg` (lift from verify-events into a shared spot if needed), `lib/event-identity.ts`, the `hwy4_orgs` schema (`canonical_url`, `match_patterns` already exist).
- **Data (SQL, no migration):** populate `calaveras-big-trees-state-park.canonical_url` + match_patterns and sweep the other recurring GoCalaveras organizers.

## Verification

1. **The three reported events resolve correctly.** Creek Critters / North Grove Hike → Big Trees organizer (`bigtrees.org/events/`); Arnold Rim Trail (incl. the "Aronld" misspelling) → `arnoldrimtrail.org/events/`. None render a `gocalaveras.com` link.
2. **No dead CTA anywhere.** With `AGGREGATOR_FALLBACK` off, no rendered outbound link points at `gocalaveras.com`. Spot-check 10 GoCalaveras-sourced detail pages: each shows either an organizer/venue link or no outbound CTA (never a 403).
3. **Briefings are clean.** A generated briefing contains zero `gocalaveras.com` links; any link it does emit resolves 200 in a browser.
4. **JSON-LD is clean.** The `offer.url` on a GoCalaveras-sourced event is the resolved durable href or our own page, never the dead permalink.
5. **Priority order is locked.** `cd scripts && npm test` includes `event-link.test.ts` and is green; flipping two registry rows in the test flips resolution as specified.
6. **Audit closes the loop.** `/api/check-events` reports the count of closeable link gaps (known org/venue, no canonical) so new ones surface in Slack instead of silently degrading.

## Rollout

1. Ship `lib/event-link.ts` + test + the venue-registry `url` field, **resolver wired but `AGGREGATOR_FALLBACK` off**. This alone removes every aggregator CTA.
2. Run the SQL backfill (Big Trees + sweep). Re-check the three reported events and 10 random GoCalaveras pages.
3. Wire the briefings/newsletter and JSON-LD; regenerate a briefing and confirm clean.
4. Narrow `validateEventUrls` (skip bot-wall hosts) and add the audit line.
5. Watch `/api/check-events` for a week; each closeable gap it reports is a one-row registry fix, not code.

The felt bug (Steps 1–2) is a small, high-leverage change across ~630 pages. The durable win is that "where should this link go" now has exactly one answer, in one file, that every surface reads — so it can't drift, and a fragile aggregator URL can never again masquerade as a destination.
