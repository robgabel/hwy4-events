# Handoff — Newsletter send reconcile

**Status: EXECUTED 2026-07-03.** Ledger + Batch transport live: `lib/newsletter-send.ts` (`sendCampaign`), migration `20260703_newsletter_send_log.sql` (applied; adds `newsletter_send_log` + `newsletter_suppressions`), both GET cron and POST recovery rewired as thin wrappers, pure core locked by `scripts/test/newsletter-send.test.ts`. The veto gate is untouched. Kept below as the design record. **Created:** 2026-06-21.

## TL;DR / the decision to make

Three efforts have converged on the *same* problem — "send the weekly newsletter reliably, and never re-blast someone who already got it" — from three different angles:

1. **Rob #142** — check every `resend` result, throttle ~2/sec, retry once, and Slack-alert when `delivered < active` (in-memory, per run).
2. **Rob #143 / #145** — a `POST /api/newsletter/send` **recovery endpoint** that re-sends the most recent issue to an explicit `{ "targets": [...] }` list after the fact.
3. **Rob #146** — switch the transport to the **Resend Batch API** (throughput; up to 100 emails per call).
4. **Peter Hollens's Eugene fork** — a durable per-recipient **ledger** (`newsletter_send_log`) so a send can resume after a timeout/rate-limit **without re-blasting**, because the ledger structurally records who already received the message.

These are **complementary, not competing.** The recommended reconcile:

> **Adopt Peter's `newsletter_send_log` ledger as the durable backbone; keep Rob's Resend Batch API as the transport.** The ledger is the source of truth for "who got this campaign"; the Batch API is just the efficient pipe. Together you get idempotent resume + per-recipient audit + a suppression list **and** batch throughput. The recovery endpoint then collapses into "re-run the send — the ledger skips everyone already sent."

## The recommended architecture

One idempotent function, e.g. `sendCampaign(draftId)`:

1. Load active subscribers.
2. From `newsletter_send_log` for this `campaign_id`, **exclude** anyone already `status='sent'` (idempotent resume) or `'suppressed'` (bounces/unsubs).
3. Chunk the remaining recipients into batches of ≤100.
4. Send each batch via the **Resend Batch API**.
5. Write each per-recipient result back to the ledger — `sent` + `resend_id`, or `failed` + `error` — as an **upsert on `UNIQUE(campaign_id, email)`** (this is what makes a re-run safe).

Then:
- **Thursday auto-send** (the cron) and the **POST recovery** both become thin wrappers over `sendCampaign`. Recovery is no longer a special path: you just call `sendCampaign` again and the ledger dedups.
- The **24h veto gate stays untouched** (Wed `/api/newsletter/prepare` drafts → `/admin/newsletter` review → Thu `/api/newsletter/send` unless vetoed). It is the human safety on the one unsupervised outward action — do not weaken it.

## Peter's ledger (already designed, just needs adopting)

`supabase/migrations/20260619_newsletter_send_log.sql` on `eugene/codex/eugene-bootstrap`:

```
newsletter_send_log(
  id uuid pk,
  campaign_id uuid not null references newsletter_drafts(id) on delete cascade,
  email text not null,
  status text check (status in ('pending','sent','failed','suppressed')),
  resend_id text, error text,
  attempted_at timestamptz, sent_at timestamptz, created_at, updated_at,
  unique (campaign_id, email)
)  -- + index (campaign_id,status), index (email), RLS service-role only
```

The `UNIQUE(campaign_id, email)` + upsert is the whole point: re-blasting becomes structurally impossible, not just guarded-against.

## Steps

1. **Diff the two send paths** (the `eugene` remote is already configured):
   ```
   git fetch eugene
   git diff origin/main eugene/codex/eugene-bootstrap -- \
     app/api/newsletter/send/route.ts lib/newsletter-send.ts \
     supabase/migrations/20260619_newsletter_send_log.sql
   git show 'eugene/codex/eugene-bootstrap:lib/newsletter-send.ts'   # read his module in full
   ```
   ⚠️ Read **the current main** `app/api/newsletter/send/route.ts` carefully — **#146 already rewrote the send to the Batch API**, so reconcile against the post-#146 shape, not the #142–145 shape.
2. **Adopt the ledger schema.** Adapt the migration, apply to Supabase `uzediwokyshjbsymevtp` (RLS service-role only, no public read).
3. **Write `sendCampaign(draftId)`** as above (probably as `lib/newsletter-send.ts`, mirroring Peter's extraction). Keep the throttle/retry where the Batch API doesn't already cover it.
4. **Rewire** the Thu cron route + the POST recovery to call `sendCampaign`. Preserve `?preview=1`, `?test_email=…`, the `delivered < active` Slack shortfall alert, and the draft→`sent` + `site_config.latest_newsletter` archive.
5. **Past issues** have no ledger rows — fine, the ledger starts fresh. The recovery POST for *already-sent* past issues can keep its explicit-targets behavior or be deprecated once the ledger covers new sends.

## Test before any live Thursday

- `?test_email=…` smoke test (one address through the new path) → verify a ledger row appears with `sent` + a `resend_id`.
- **Re-run the same send → verify it sends nothing** (the idempotency proof).
- Then watch the next real Thursday send + the Slack shortfall alert.

## Guardrails

- The Thursday auto-send is the **one unsupervised outward action** on the whole site. Do not break it; test exhaustively. Keep the veto gate.
- Resend Batch API returns per-message results as an **array** — map each result back to its recipient (association/order) before writing the ledger, or the status rows will be wrong.
- `newsletter_send_log` is service-role only.

## Files / context

- **Current (main):** `app/api/newsletter/send/route.ts` (post-#146), `lib/newsletter.ts`, `supabase/migrations/20260602_add_newsletter_drafts.sql`; CLAUDE.md → "Newsletter email rendering" + the `/api/newsletter/send` cron row.
- **Peter (eugene remote):** `lib/newsletter-send.ts`, `supabase/migrations/20260619_newsletter_send_log.sql`, `app/api/newsletter/send/route.ts`.
- **Related:** `PRD-agent-cockpit.md` (the newsletter veto gate is the Stage-2 outward-action retrofit); PAOS memory `project_newsletter_reply_routing`; the `project-eugene-fork` memory (the upstream-core / downstream-instance model this reconcile lives inside).
