# PRD: Newsletter Click Tracking — Which Events Get Clicked, in the Growth Tab

> The weekly newsletter links every event to its page on hwy4events.com, but we have no idea which events people actually click. The links already carry UTM tags, yet Cloudflare RUM (the Growth tab's only data source) records the **path, not the query string**, and email clicks arrive with **no referer** — so newsletter clicks are invisible and unattributable per-event. The fix: route each newsletter event link through a **first-party redirect** that logs the click, then surface per-event clicks for each send in the Growth tab. First-party, $0, own the data — the same arc as building our own Cloudflare reader instead of eyeballing a dashboard.

## Context

- **Flow today.** Wed `/api/newsletter/prepare` drafts the body (LLM, markdown links to `${SITE_URL}/events/<slug>`) into `newsletter_drafts`; a human gets a ~24h veto window at `/admin/newsletter`; Thu `/api/newsletter/send` renders per-recipient HTML via `buildEmailHtml` → `markdownLinksToHtml` (which already appends `utm_content=<slug>`, `lib/newsletter.ts:257-285`) and ships via Resend (`resend.emails.send` per subscriber).
- **Why clicks are invisible.** Three independent reasons: (1) Cloudflare RUM's `requestPath` dimension is **path-only** (`lib/cloudflare-analytics.ts` `DIMENSIONS`), so the `utm_content` slug in the query string is dropped; (2) email clients send **no referer**, so RUM can't separate newsletter traffic from organic/direct on an event page; (3) **Resend click tracking is off** (`app/api/newsletter/send/route.ts` passes no tracking option). Net: the Growth tab can show which event *pages* are popular overall, never which were clicked *from the newsletter*.
- **Already in place to build on.** `newsletter_drafts` (one row per Thursday, has `id`, `target_send_date`, `sent_count`), the Growth tab (`app/admin/analytics/page.tsx`, a service-role server component reading a daily table), and the analytics-table conventions (RLS on, service-role-only, internal — `analytics_daily`).

## Goals / Non-Goals

**Goals**
- **Per-event, per-send click counts** for the newsletter, surfaced in the Growth tab.
- First-party (links stay on `hwy4events.com`), $0, owns the data.
- **Deterministic** link rewrite — no dependency on the LLM emitting exact tracking URLs.
- A **bot-filtered, directional** number, labeled honestly (same caveat as the AEO referral data).

**Non-Goals**
- **Open** tracking (needs a pixel). Clicks are the ask.
- Per-recipient identity / *who* clicked — aggregate only, **no PII in URLs** for v1.
- Replacing UTM or Cloudflare — those stay for overall traffic; this adds the newsletter-attribution layer.
- Routing links through Resend's tracking domain (see *Rejected / Secondary Alternatives*).

## Approach

### Step 1 — First-party redirect route
`app/r/n/[campaign]/[event]/route.ts` (GET): look up the event by id → its slug; **best-effort log** a `newsletter_clicks` row (try/catch — a logging failure must never block the click); then **302** to `${SITE_URL}/events/<slug>?utm_source=newsletter&utm_medium=email&utm_campaign=<campaign>` (preserve the existing UTM convention so downstream RUM still sees newsletter traffic). `Cache-Control: no-store`. Unknown event id → 302 to `SITE_URL` (never 404 a real email link). Flag `is_bot` via a small user-agent blocklist (Proofpoint / Mimecast / Barracuda / GoogleImageProxy / `bot` / `crawl` / `scan` / `curl` / `preview` …). Service-role client; no auth (it's a public email link that only writes to an internal analytics table).

### Step 2 — Rewrite event links to the tracker at render time
Extend `buildEmailHtml` / `markdownLinksToHtml` (`lib/newsletter.ts`) to accept `(campaignId, slugToEventId)`. When a rendered href is `${SITE_URL}/events/<slug>` **and** `<slug>` is in the map, rewrite it to `${SITE_URL}/r/n/<campaignId>/<eventId>`; otherwise leave it (still works, just untracked). Because this runs at **render time** and is deterministic: the **stored draft content and the public archive stay clean** (only the *sent email* carries tracking links), and there's **no LLM-URL-fidelity risk** — the model never has to emit a tracking URL, we rewrite the plain `/events/<slug>` it produced.

### Step 3 — Thread campaign + map through send
In `app/api/newsletter/send/route.ts`, before the subscriber loop: build `slugToEventId` from `getUpcomingEvents()` + `generateEventSlug`, and pass `draft.id` (the campaign) + the map into `buildEmailHtml`. The `?test_email=` and `?preview=1` paths pass a sentinel campaign (`"test"` / `"preview"`) so they render real tracking links you can click to verify, without polluting a real campaign's numbers. **No new cron** — the route is hit by recipients clicking.

### Step 4 — Surface it in the Growth tab
`app/admin/analytics/page.tsx`: add a **Newsletter clicks** panel. For the most recent sent campaign, query `newsletter_clicks` grouped by `event_id` (filter `is_bot=false`), join `hwy4_events` for names, and show: total clicks, per-event clicks (name + count, descending), and a rough **CTR** (total clicks ÷ `newsletter_drafts.sent_count`). Label it a *directional, bot-filtered* signal. Factor the query into `lib/newsletter-clicks.ts` if the page grows. (A campaign selector across past sends is a later nicety.)

## Data Model
`newsletter_clicks` — RLS enabled with a service-role-only policy **in the same migration** (internal data; mirrors `analytics_daily` / `event_merge_log`):

```
id          uuid pk default gen_random_uuid()
campaign_id text not null         -- the newsletter_drafts.id (or target_send_date) this link was sent under
event_id    uuid                  -- hwy4_events.id the link points to (null for non-event links if ever tracked)
slug        text                  -- the event slug (redirect target + a stable label if the event is later deleted)
clicked_at  timestamptz not null default now()
user_agent  text
is_bot      boolean not null default false
```
Indexes: `(campaign_id, event_id)` and `(clicked_at desc)`.

## Rejected / Secondary Alternatives
- **Resend click tracking + webhook.** Lower-effort (Resend rewrites links and emits `email.clicked`, and you'd get opens too). But it routes every link through **Resend's domain** (recipients hover a non-hwy4events host — a trust/deliverability cost), ties the data to a third party, and you *still* build a webhook receiver + signature check + per-event URL parsing to land it in the Growth tab. First-party is barely more code and keeps both the data and the links ours. Keep this as the fallback if maintaining a route ever feels heavy.
- **UTM + Cloudflare RUM (today's setup).** We already have the UTM tags; they cannot answer this — RUM drops query strings and email carries no referer, so newsletter clicks can't be isolated per-event. UTM/RUM stays useful for overall page popularity, not attribution.
- **Per-recipient tokens (who clicked).** Would enable unique-clicker counts and better bot dedup, but it puts recipient identity in URLs (PII) and adds complexity. Defer — aggregate + bot-filtered answers "which events get clicked."

## Critical Files
- **New:** `app/r/n/[campaign]/[event]/route.ts` (redirect + log), `supabase/migrations/<date>_newsletter_clicks.sql`, optional `lib/newsletter-clicks.ts` (the Growth query).
- **Edit:** `lib/newsletter.ts` (`buildEmailHtml` / `markdownLinksToHtml` take `campaignId` + `slugToEventId`, rewrite event hrefs), `app/api/newsletter/send/route.ts` (build the slug→id map, pass campaign), `app/admin/analytics/page.tsx` (Newsletter clicks panel), `CLAUDE.md`.
- **Reuse:** `generateEventSlug` (`lib/slugs`), `getUpcomingEvents` / `buildEmailHtml` (`lib/newsletter`), `SITE_URL` (`lib/constants`), the analytics/verification admin patterns, `newsletter_drafts.sent_count` for CTR.

## Verification
1. **Render:** a generated email's event links point to `/r/n/<campaign>/<eventId>`; non-event links (the "See all events" CTA, submit, footer) are unchanged; the **stored draft content + public archive still use plain `/events/<slug>`**.
2. **Redirect:** hitting `/r/n/<campaign>/<eventId>` 302s to the right `/events/<slug>?utm…` and writes exactly one `newsletter_clicks` row; an unknown event id redirects to `SITE_URL`; a forced DB failure still redirects (click never blocked).
3. **Bot filter:** a request with a scanner UA is flagged `is_bot=true` and excluded from Growth counts.
4. **Growth tab:** after a `?test_email=` send + a few self-clicks, the Newsletter clicks panel shows per-event counts + total + rough CTR for that campaign, bot-filtered.
5. **No regression:** the destination still carries UTM; `next build` is clean; the `/api/newsletter/send?preview=1` render is unchanged.

## Rollout
1. Ship the migration + redirect route + the render rewrite; verify end-to-end with `?test_email=` to yourself and click your own links.
2. First real Thursday send: confirm rows land and the Growth panel populates.
3. Watch the bot ratio over a couple of sends; tune the UA blocklist. Keep the "directional, bot-filtered" label.
4. Later (optional): a campaign selector across past sends, primary-CTA click tracking, and per-recipient unique-clicker if it ever earns its keep.
