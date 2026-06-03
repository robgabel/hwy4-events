# PRD: Community Submissions Review — Act on Them Inside `/admin`

> Neighbors submit events at `/submit`; they land in `event_submissions` as `pending`, and then nothing happens. There is no UI to act on them. The chief-of-staff digest now *surfaces* them ("2 pending community submissions"), but you cannot *do* anything from the cockpit, so they rot, one was dated the same day it finally got noticed. This builds the missing surface: an `/admin/submissions` page to **complete, publish, or dismiss** each submission, reusing the verification admin pattern and the one dedup-key definition.
>
> This is the **human-first half of the agent cockpit's Stage 1** (`PRD-agent-cockpit.md`). The review queue exists for a person first; later the agent *proposes* `publish_community_submission` / `flag_spam_submission` into this same surface, and a human still clicks Publish. Build the cockpit, then let the agent drive it.

## Context

- `/submit` → `app/api/submit-event/route.ts` writes `event_submissions` (status `pending`). Only `event_name`, `event_date`, `town` are required/validated; `venue_name`, `category`, `start_time`, `event_url`, `description`, submitter info are optional and **often missing** (the live "Aquanette" submission has no venue).
- CLAUDE.md documents the publish procedure by hand (insert `hwy4_events` with `community_sourced=true`, `source_name='Community Submission'`, a computed `dedup_key`, then set the submission `approved`), but there is **no code or UI** for it. Publishing today means raw SQL.
- Net effect: submissions are invisible to action. Two are pending right now; "Storytime with Miss Debbie" was dated the same day it surfaced in the digest.
- The admin area already has the exact pattern to copy: Basic-Auth `middleware.ts`, server-component pages + `actions.ts` server actions (`app/admin/verification/`), flash/error via query params, the shared admin design language.

## Goals / Non-Goals

**Goals**
- A `/admin/submissions` page listing `pending` submissions, each with the full submitted payload, submitter info, and a past/today-date warning.
- **Complete-then-publish:** an editable, pre-filled form (fix the missing venue, pick a category, add a time) → one click inserts a public `community_sourced` event and marks the submission `approved`.
- **Dismiss:** one click marks a submission `rejected` (spam / dupe / not a fit), no event created.
- Reuse **one** `generateDedupKey` definition (extract it to `lib/` so the app and the scrapers share one hash) and the verification action pattern.
- A "Submissions" nav tab with a pending count, mirroring the Verification badge.

**Non-Goals**
- **No auto-publish.** Publishing is an outward, public, editorial action; it stays human-approved (the same line the cockpit draws).
- No agent involvement yet (cockpit Stage 2 graduates only low-stakes *internal reversible* actions; publishing is neither).
- No changes to the `/submit` form.
- No bulk actions in v1 (one submission at a time).

## Approach

### Step 1 — One dedup-key definition (extract, don't duplicate)
The publish insert must compute `dedup_key` **identically** to the scrapers, or the unique key drifts and duplicates slip in. Today `generateDedupKey(name, date, town)` lives in `scripts/lib/dedup.ts` (not importable from the Next app), and it already depends on `normalizeName`/`normalizeTown` from `lib/event-identity.ts`. **Move `generateDedupKey` into `lib/event-identity.ts`** (beside the normalizers it already uses) and have `scripts/lib/dedup.ts` re-export it. The admin action then imports `generateDedupKey` from `@/lib/event-identity`, one definition, no drift, the same single-source-of-truth + test-lock arc as `isSameEvent`. Pin a known `(name,date,town) → key` case in `scripts/test/event-identity.test.ts`.

### Step 2 — The review page (`app/admin/submissions/page.tsx`)
Server component, `dynamic = "force-dynamic"`, service-role client (mirror `verification/page.tsx`). Loads `event_submissions WHERE status='pending' ORDER BY event_date`. Each submission is a card:
- The submitted payload (name, date, time, venue, town, category, description, url) + submitter (name/email, submitted date).
- A **past/today warning** when `event_date <= today` (the Storytime case).
- An **editable publish form** (pre-filled `<input>` / `<select>` / `<textarea>` for name, date, start_time, venue_name, town [TOWNS dropdown], category [the 8 `EventCategory` values via `CATEGORY_LABELS`], description, event_url) and a **Publish** button.
- A **Dismiss** button (optional reason field).
Match the admin visual language (pine `#2d5016`, `#faf9f6` / `#e8e4de`, amber accent), reusing the verification card / flash / banner styles.

### Step 3 — The actions (`app/admin/submissions/actions.ts`)
`"use server"`, mirror `verification/actions.ts` (`getServiceClient`, `requireId`, flash/error redirects):

- **`publishSubmission(formData)`** — read the (edited) fields. Validate name/date/town present, `town ∈ TOWNS`, `category ∈` the 8 values. Compute `dedup_key = generateDedupKey(name, date, town)`. Insert `hwy4_events`:
  - from the form: `name, date, start_time, end_time, venue_name, town, description, category, event_url`;
  - fixed: `status='confirmed'`, `visibility='public'`, `community_sourced=true`, `source_name='Community Submission'`, `source_url = ${SITE_URL}/submit`, `cost_tier='unknown'`, `verification_status='unchecked'`, `is_weekly=false`, `dedup_key`, `last_scraped_at=now()`.
  - On unique-violation (Postgres `23505` on `dedup_key`) → friendly error ("An event with this name/date/town already exists; it may already be published or scraped."), and do **not** mark the submission approved (no half-state).
  - On success → set `event_submissions.status='approved'`, `published_event_id=<new id>`, `reviewed_at=now()` (Step 5 columns); revalidate (Step 4); redirect with flash.
- **`dismissSubmission(formData)`** — set `status='rejected'`, `reviewed_at=now()`, optional `review_note`; revalidate the admin page; redirect with flash. No event created, no public revalidation.

### Step 4 — Make it appear publicly (revalidation)
A *new* row must enter the cached upcoming-events list, so `revalidatePath("/")` alone is not enough. After a publish: `revalidateTag(EVENTS_CACHE_TAG /* "events", from lib/events-data.ts */)` + `revalidatePath("/")` + `revalidatePath(\`/towns/${townSlug}\`)`. (Verification's action only toggles existing rows, so it gets away with `revalidatePath("/")`; publishing adds a row, hence the tag bust.)

### Step 5 — Audit columns on `event_submissions` (small migration, reversible)
The table already has RLS; this is a plain `ALTER` (no new RLS needed). Add `reviewed_at timestamptz`, `published_event_id uuid` (a pointer to the created `hwy4_events.id`), `review_note text`. Every decision becomes traceable, and a wrongly-published event is one lookup from its source submission (mirrors the cockpit's reversibility ethos). Migration `supabase/migrations/<date>_submission_review_columns.sql`.

### Step 6 — Nav + badge
Add a **Submissions** `NavLink` to `app/admin/layout.tsx` (beside Today / Verification) with a pending-count badge, reusing the verification `pending`-count pattern (a second `count` query on `event_submissions WHERE status='pending'`).

## Rejected Alternatives
- **A quick "approve as submitted" button only (no edit form).** Most submissions are incomplete (missing venue/category); publishing as-is creates bad public rows. The complete-then-publish form is the whole point. (A one-click "publish as-is" can be an *addition* when a submission is already complete, but the editable form is primary.)
- **Reimplement the dedup hash in the action.** Two copies drift; a drifted key defeats both the `dedup_key` unique constraint and the reconcile engine. Extract to one lib (Step 1).
- **Let the agent auto-publish "low-risk" submissions.** Publishing is outward/editorial, it never auto-runs (cockpit rule). The agent may *propose* into this queue later; a human always clicks Publish.
- **A status enum / DB check constraint.** `status` stays free text (`pending | approved | rejected`); the form enforces the values. Matches the existing table, no constraint churn.

## Critical Files
- **New:** `app/admin/submissions/page.tsx` (review + edit-publish form), `app/admin/submissions/actions.ts` (`publishSubmission`, `dismissSubmission`), `supabase/migrations/<date>_submission_review_columns.sql`.
- **Edit:** `lib/event-identity.ts` (host `generateDedupKey`), `scripts/lib/dedup.ts` (re-export it), `scripts/test/event-identity.test.ts` (pin a key), `app/admin/layout.tsx` (Submissions tab + badge), `CLAUDE.md` (replace the "publish by hand via SQL" note with "review at `/admin/submissions`"; add this PRD to the index).
- **Reuse, unchanged:** `middleware.ts` (Basic Auth covers `/admin/:path*`), `app/admin/verification/{page.tsx,actions.ts}` (the pattern), `lib/event-identity.ts` (`normalizeName`/`normalizeTown`), `lib/types.ts` (`EventCategory`, `CATEGORY_LABELS`, `TOWNS`, `Hwy4Event`), `lib/events-data.ts` (`EVENTS_CACHE_TAG`), `lib/constants.ts` (`SITE_URL`), `lib/slugs.ts`/`lib/towns.ts` (town slug).

## Verification
1. **Publish round-trip:** on a Supabase branch (or a seeded test submission), open `/admin/submissions`, complete a submission missing its venue, click Publish → a `hwy4_events` row exists with `community_sourced=true`, `source_name='Community Submission'`, `visibility='public'`, `status='confirmed'`, and a correct `dedup_key`; the submission flips to `approved` with `published_event_id` set; the event appears on `/` and its town page after revalidation; the pine "Community sourced" badge renders.
2. **Dedup parity:** the `dedup_key` the action computes equals `scripts/lib/dedup.ts`'s `generateDedupKey` for the same `(name,date,town)` (guaranteed by the shared import; pinned by the test).
3. **Collision handling:** publishing a submission whose `(name,date,town)` already exists shows the friendly "already exists" error and does **not** mark the submission approved.
4. **Dismiss:** flips status to `rejected`, writes `reviewed_at`, creates no event, drops it from the queue.
5. **Auth + queue:** `/admin/submissions` is behind Basic Auth (401 without); the nav badge shows the pending count; the list matches `event_submissions WHERE status='pending'`.
6. **Past-date warning:** a submission dated ≤ today shows the warning; publishing is still allowed (admin judgment).
7. **No regression:** `cd scripts && npm test` is green (the dedup-key extraction only changed where the function lives).

## Rollout
1. Ship **Step 1** (extract `generateDedupKey` + test) on its own, a pure refactor, no behavior change.
2. Ship the migration (audit columns), then the page + actions + nav badge.
3. **Clear the live backlog through the new UI:** publish or dismiss the two pending submissions (Aquanette, 6/27, Avery, needs a venue; Storytime with Miss Debbie, 6/3, likely already past, dismiss).
4. Update CLAUDE.md: publishing a submission is now a UI action, not raw SQL.
5. **(Later, cockpit Stage 1)** wire the agent's `flag_spam_submission` / `publish_community_submission` *proposals* into this same page, the human still clicks. Tracked in `PRD-agent-cockpit.md`.
