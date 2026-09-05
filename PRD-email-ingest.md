# PRD: Email-to-Event Ingestion

> **Status (2026-09-05):** Built, dormant. Code + migration shipped June 2026 and Phase 4 **Step 2 is done** — the managed `.resend.app` receiving address exists (it was free on the current plan, so no fallback needed). Remaining: Steps 3-6 (webhook + signing secret, the two Vercel env vars, smoke test, live test). Zero rows have ever arrived: every `event_submissions` row is still `source='form'`, because both gates fail closed.
>
> **The receiving address is deliberately NOT written down in this repo** — it is public, and Resend stores every message it receives even when the allowlist drops it, so a committed address just invites junk into the Receiving log. It lives in the Resend dashboard and (implicitly) in the Vercel env.

**Status:** Built 2026-06 as a thin **front door** on top of the shipped Agent Cockpit Stage 1 submission engine. Phase 4 (Resend go-live) pending.

## Problem

Getting an event onto the site means the scrapers find it or a neighbor fills out the `/submit` form. There's no path for the fastest, most natural curator input: **forward an email with a flyer** ("Brice Station summer concert, here's the poster") and let the system structure it. The flyer's details often live only in an image, which the form can't read.

## Solution

A curator emails (or forwards) unstructured event info, with or without a poster, to a dedicated address. [`/api/inbound-email`](app/api/inbound-email/route.ts) reads the email **and the poster** (Sonnet) into a structured event and lands a `source='email'` **pending** `event_submissions` row. From there it **rides the existing engine unchanged**:

- the same **`triageSubmissionById`** that runs on form submissions analyzes it (dup-check via the shared `isSameEvent` + web research → verdict + matched event + suggested fills),
- the same **`/admin/submissions`** UI reviews it (now with an "Email" badge + an "Original email" view; the poster thumbnail already rendered),
- the same **publish / reversible-merge** actions decide it (publish pins the poster via `image_url` + `poster_locked`; merge writes a `merge_snapshot`).

**Nothing publishes automatically.** This is the "agent proposes, human clicks" posture, now reached through email.

### Decisions

- **Senders:** curators only, gated by `INBOUND_EMAIL_ALLOWLIST`. The route **fails closed** — unset = no one is allowed.
- **Transport:** Resend's **free managed `*.resend.app` receiving domain** (no $20/mo Pro, no DNS changes). The webhook is signature-verified (Standard Webhooks / Svix); the provider shape is normalized in one function (`parseWebhook`) so Postmark or Cloudflare Email Routing could swap in.
- **Reuse, don't rebuild:** the dedup/verdict/merge/triage/UI all already exist (Agent Cockpit Stage 1). Email adds only the front door + poster reading.

### Why this rides `event_submissions`

The triage engine, the `/admin/submissions` page, and the publish/merge actions all operate on `event_submissions`. Landing email events there means they inherit the agent's dup-check, the review UI, the reversible merge, and the reply-draft loop **for free** — email is just a new `source`.

## Flow

```
millie@…  → (Resend Inbound MX → managed .resend.app domain)
  → POST /api/inbound-email   [signed, METADATA-ONLY webhook]
      1. verify Svix signature (RESEND_INBOUND_WEBHOOK_SECRET); 401 on fail
      2. parse webhook metadata: email_id, from, subject, message_id
      3. allowlist the sender (INBOUND_EMAIL_ALLOWLIST); ignore if not listed
      4. idempotency: skip if this email_id was already processed
      5. FETCH-BACK (webhook has no body/bytes): RESEND_API_KEY →
           resend.emails.receiving.get(email_id)                → text/html body
           resend.emails.receiving.attachments.list({emailId})  → download_urls (1h)
      6. upload the largest qualifying image to the event-posters bucket → public URL
      7. one Sonnet multimodal call: email text + poster image (+ PDF) → JSON array of events
      8. INSERT pending event_submissions row(s): source='email', poster_url, raw_email, source_message_id
      9. fire triageSubmissionById(id) via after()   ← the SHIPPED engine takes over
     10. Slack ping → /admin/submissions
  → agent triages → /admin/today digest + /admin/submissions review → human Publish / Merge
```

**Resend webhooks are metadata-only by design.** The webhook gives sender/subject/`email_id` + attachment metadata; the route calls back with `RESEND_API_KEY` for the body (`receiving.get`) and the attachment bytes (`receiving.attachments.list` → 1-hour `download_url`). Allowlist + idempotency run on the metadata *before* any fetch-back, so untrusted mail costs nothing.

## Implementation

| File | Role |
|---|---|
| `supabase/migrations/20260604b_email_submissions.sql` | Adds `source`, `poster_url`, `raw_email`, `source_message_id` (unique) to `event_submissions`. (`poster_url` is shared with the form's flyer upload.) Applied to `uzediwokyshjbsymevtp`. |
| `lib/inbound-email.ts` | **Pure, unit-tested core.** Extraction prompt, JSON-array parse (fence-strip), field normalization, Svix `verifyWebhookSignature` / `signWebhook`, `extractEmailAddress`. **No dedup** — the triage engine owns that. |
| `scripts/test/inbound-email.test.ts` | Locks the core: parse, normalize, town canonicalization, email-address, signature round-trip. |
| `app/api/inbound-email/route.ts` | The webhook front door. Signature → parse metadata → allowlist → idempotency → Resend fetch-back → poster upload → Sonnet extraction → insert pending `source='email'` row(s) → fire `triageSubmissionById` → Slack. |
| `app/admin/submissions/page.tsx` | Small additions: an "Email" badge and an "Original email" (raw-email) view on email cards. Everything else (verdict banner, poster thumbnail, publish/merge) already existed. |

### Reused as-is (the shipped engine)

`lib/agent/submission-triage.ts` (`triageSubmissionById`: dup-check via `isSameEvent`/`generateDedupKey` + web research → verdict); `app/admin/submissions/actions.ts` (`publishSubmission` pins+locks the poster; `mergeSubmission` with reversible `merge_snapshot`; reply drafting); the `event-posters` service-role upload; the Sonnet vision pattern (`scrape-bls`) + PDF document block (`scrape-moose-lodge`); Basic-Auth `/admin` via `middleware.ts`.

### Dedup posture

Email never bypasses dedup. It lands a pending submission, and the **same triage that runs on form submissions** dup-checks it with the shared `isSameEvent` (+ web research) and recommends publish-new / duplicate / duplicate-needs-update. A human clicks Publish (new row gets a `dedup_key`) or Merge (reversible field-fill into the matched row).

## Phase 4 — go-live runbook (not yet done)

Verified against Resend's current docs (resend.com/docs/dashboard/receiving, June 2026). **Chosen path: Resend's free managed `*.resend.app` receiving domain** — no $20/mo, no DNS changes, no subdomain. (Resend free = 1 custom domain, already spent on `hwy4events.com` sending; the managed `.resend.app` receiving address is separate from that limit and sidesteps the root MX, which is ImprovMX — `mx1/mx2.improvmx.com` — leave it.)

### Step 1 — ship the code
Merge the PR to `main`; Vercel auto-deploys. Until deployed, `https://hwy4events.com/api/inbound-email` 404s, so do this first.

### Step 2 — get the free `.resend.app` receiving address
1. Resend dashboard → **Emails** → **Receiving** tab.
2. Click the **⋯** → **Receiving address**.
3. Copy `<something>@<your-id>.resend.app` — what curators forward flyers to. **Do not commit it**: this repo is public and Resend stores everything it receives, allowlisted or not.
- If this shows an **upgrade wall**, stop; the managed domain isn't free on your plan — use a fallback (Cloudflare Email Routing or Gmail/`gws`).

### Step 3 — create the webhook + copy the signing secret
1. Resend → **Webhooks** → **Add Webhook**.
2. URL: `https://hwy4events.com/api/inbound-email`.
3. Event type: **`email.received`** (only).
4. Save, copy the **Signing Secret** (`whsec_…`).

### Step 4 — set Vercel env (Production) + redeploy
- `RESEND_INBOUND_WEBHOOK_SECRET` = the `whsec_…`.
- `INBOUND_EMAIL_ALLOWLIST` = `robgabel@gmail.com` (comma-separate more). Fails closed.
- `RESEND_API_KEY` — confirm set (newsletter uses it; the fetch-back needs it). Already present: `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SLACK_WEBHOOK_URL`.

### Step 5 — smoke-test
Resend Webhooks → **Send test event**. An unsigned/forged request `401`s; a properly signed `email.received` from a non-allowlisted sender `200`s with `{"ignored":"sender not allowlisted"}` and writes nothing. (Forge a signed request with the exported `signWebhook`.)

### Step 6 — real end-to-end test
1. From an allowlisted address, email a flyer (image + a date in the body) to the `.resend.app` address.
2. Slack ping ("1 event queued … Poster attached.") within ~30s.
3. `/admin/submissions` shows the **Email** badge, poster thumbnail, "Original email" view, and the agent's verdict + Publish / Merge.
4. Publish (or Merge); confirm the event renders on `/` and its town page, poster locked: `select image_url, poster_locked from hwy4_events where id='<id>'`.
5. Confirm it's in the digest: `curl -H "Authorization: Bearer $CRON_SECRET" https://hwy4events.com/api/agent/chief-of-staff`, then `/admin/today`.

### Optional polish — a pretty address
ImprovMX owns the root MX, so add an alias `millie@hwy4events.com` → forward to the `.resend.app` address. **Test it** — some forwarders rewrite the `From:` the allowlist checks.

### Fallbacks (if `.resend.app` isn't free)
- **Cloudflare Email Routing + a small Email Worker** — free; needs DNS Vercel→Cloudflare + a Worker that POSTs the inline email (drops the fetch-back; only `parseWebhook` + the two fetch-back calls change).
- **Gmail + `gws`** — forward to a dedicated Gmail; a PAOS task reads them and calls an admin endpoint.

### Gotchas
- **Retries:** Resend stores the email and retries if the route is down; idempotency (on `email_id`) makes retries safe.
- **`download_url`s expire after 1 hour** — the route downloads immediately.

## Verification (done so far)

- Migrations applied; redundant early columns dropped; schema confirmed by SQL.
- `cd scripts && npx tsx --test test/inbound-email.test.ts` — 8 cases green (parse, normalize, town, email-address, signature). Full suite green.
- `npx tsc --noEmit` clean across the new route, helpers, and the submissions-page additions.
- Browser / live-webhook e2e is Phase 4 (needs env; the path makes a billed AI call and writes to the shared prod DB).

## Non-goals / future

- **No auto-publish.** A future Stage 2 could auto-publish high-confidence, allowlisted-sender events behind a per-type `agent_policy` flag with a reversible snapshot. Deferred.
- Multi-event emails store only the largest image as the poster (a season lineup's image is a reading aid only); a human can swap posters later via `/admin/posters`.
- The webhook fires triage via `after()`; if a large multi-attachment email risks the webhook timeout, the response already returns before triage runs.
