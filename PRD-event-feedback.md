# PRD — Event Feedback ("Suggest a fix")

**Status:** Phase 1 built 2026-06-04 (notes only). Phase 2 (poster upload) + Phase 3 (polish) pending.
**Origin:** Session 2026-06-04. The organizer claim/upload door from `PRD-event-poster-loop.md` (Phase 3) and the human half of the cockpit's Stage 1 (`PRD-agent-cockpit.md`), arriving early through a "report a problem" entry. A fourth review queue alongside Submissions and Verification.

## Problem

An organizer or visitor on an event page who spots an error (wrong time, changed lineup, bad address) or has a better poster had nowhere to tell us. Corrections happened only if someone emailed Rob.

## The loop

Event page → **"See something off? Suggest a fix"** → note (and, in Phase 2, a replacement poster) → Slack ping to **#hwy4** → review at **`/admin/feedback`** → **Mark resolved** or **Dismiss**. Nothing changes on the public site without a human click.

## Decisions (locked)

- **Email:** optional for visitors, encouraged for organizers. A typo report shouldn't need an account.
- **One entry point** with an "Are you the organizer?" toggle (organizer / visitor / prefer not to say). The role flows to Slack + admin.
- **Slack:** reuses the existing `SLACK_WEBHOOK_URL`, which posts to #hwy4.
- **Corrections are applied by hand** in Phase 1 (edit the event the usual way, then mark resolved). Structured one-click field edits are a Phase 3 idea.

## Phase 1 — shipped 2026-06-04 (notes only, zero new infra)

| Piece | File |
|---|---|
| Table `event_feedback` (+ RLS + policy, service-role only) | `supabase/migrations/20260604_event_feedback.sql` |
| Public submit API (validate, honeypot, resolve event_id, Slack) | `app/api/events/feedback/route.ts` |
| Report form (note + role + optional name/email + honeypot) | `components/ReportEventForm.tsx` |
| Report page (`/events/[slug]/report`, `noindex`) | `app/events/[slug]/report/page.tsx` |
| Entry-point link in the detail action area | `app/events/[slug]/page.tsx` |
| Admin review queue | `app/admin/feedback/page.tsx` |
| Approve / dismiss server actions | `app/admin/feedback/actions.ts` |
| Admin nav badge (pending count) | `app/admin/layout.tsx` |

Reused ~80%: the `/api/submit-event` route shape, the service-role client, admin Basic-Auth + layout + nav-badge pattern, the `submissions/actions.ts` approve/dismiss + `revalidatePath` pattern, and the `SLACK_WEBHOOK_URL` posting pattern.

## Phase 2 — poster upload (pending)

The only genuinely new infrastructure in the project: **Supabase Storage** (none today). Plan: a private `event-poster-candidates` bucket; the API route accepts multipart and uploads; the admin previews via a signed URL; **Approve poster** copies the file to a public `event-posters` bucket and writes `hwy4_events.image_url` (already priority-1 in `getEventImage`, treated as organizer-supplied = shown untouched, no lockup), then busts the `events` cache tag. Add the storage host to `next.config` `images.remotePatterns`. The table already has the `poster_path` column reserved.

## Phase 3 — polish (optional)

- Structured field corrections (suggest a new time/date/price → one-click apply in admin).
- Feed the pending-feedback count into `/api/check-events` and the chief-of-staff digest.
- Cloudflare Turnstile if spam appears; email-the-submitter on resolution.

## Resolved

- **`event_submissions` RLS (2026-06-04).** Flagged because the `20260320_add_event_submissions.sql` migration had no inline `enable row level security`. Verified after applying this migration: both tables report `rowsecurity = true` with a policy in place (`event_feedback` is service-role only; `event_submissions` carries its intentional public-insert policy). RLS was backfilled downstream. The post-migration security advisor flags nothing on `event_feedback`. No exposure.
