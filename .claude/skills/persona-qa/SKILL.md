---
name: persona-qa
description: >
  Daily persona QA rotation for hwy4events.com. Each run: (1) become the
  persona-of-the-day (7 personas from docs/PERSONAS.md, keyed to day of week),
  walk their real journey on the live site and hunt for anything that would
  erode their trust; (2) run the fixed daily data sweep. Simple data errors are
  filed as qa_fix_event proposals into agent_actions (propose-first — Rob
  approves in /admin/actions). Structural problems needing a code push are
  filed as ready-for-dev PRD tickets in hwy4_tasks (/admin/roadmap). Trigger:
  "persona qa", "run today's QA", "/persona-qa", or the daily scheduled routine.
---

# Persona QA — Daily Rotation

You are running the daily QA pass for **hwy4events.com** (repo: `hwy4-events`,
Supabase project `uzediwokyshjbsymevtp`). This skill was distilled from Rob's
four manual "Persona N - QA" sessions (2026-07-16/17), which found real shipped
bugs (e.g. PR #216: range cards promising days the act doesn't play). Your job
is to find that class of bug every day without Rob in the loop.

**Mindset:** you are not a crawler. You are a specific person with a specific
job-to-be-done, a device, and a patience budget. The bug is anything that would
make *that person* trust the site less — a wrong time, a stale event, a card
that promises something the detail page doesn't deliver, a filter that lies.

## 0. Before you judge anything a bug — load context

1. Read the repo `CLAUDE.md` **fully**, especially: festival "umbrella" rows
   (intentional same-day duplicates — NOT a dedup bug), manually curated venues
   (`scripts/lib/manual-sources.ts` — hand-entered rows that scrapers skip),
   visibility/members-only semantics, and the read-time dedup bucket rules
   (`lib/dedupe-events.ts`).
2. Read `docs/PERSONAS.md` — the 7 canonical personas.
3. Check what's already filed so you never duplicate:
   - `SELECT id, title, payload->>'event_id' AS event_id FROM agent_actions
      WHERE type='qa_fix_event' AND status IN ('proposed','approved');`
   - `SELECT ref, title, status FROM hwy4_tasks
      WHERE source='qa_agent' AND status NOT IN ('done','wont_do');`

A "bug" that CLAUDE.md documents as intentional is a false positive. When
unsure whether something is deliberate, file it as a **question ticket**
(`hwy4_tasks`, `type='qa'`, `status='proposed'`, low priority) instead of a fix.

## 1. Persona of the day

Key off the **local (Pacific) day of week**:

| Day | Persona | Device framing | Entry point |
|---|---|---|---|
| Mon | **Gary** — plugged-in retiree, 68, Arnold | iPhone, mobile web, larger text | Bookmark → homepage |
| Tue | **Mia** — winery worker, 27, Murphys | Phone, fast thumbs, Instagram-calibrated taste | Homepage → Live Music / Tonight |
| Wed | **Dave** — Dorrington contractor, 45 | Phone, link his wife texted him | Direct event link + Saturday scan |
| Thu | **Rob** — Bay Area weekend visitor, power user | Desktop + phone | Homepage → This Weekend, briefing, Rob's Picks |
| Fri | **Karen** — absentee Airbnb owner, Walnut Creek | Laptop | Date-range for an upcoming guest stay |
| Sat | **Jen** — Blue Lake Springs mom, 38 | Sunday-planner laptop + phone | Week ahead, family-friendly lens |
| Sun | **Miguel** — Stockton day-tripper, 34 | Phone, arrived via Google | Google-style landing → "worth the drive?" |

### Journey protocol (every persona)

Browse the **production site** (https://hwy4events.com) with the browser tools.
Test mobile viewport (375×812) for phone personas, desktop for laptop personas.
Walk the persona's actual jobs-to-be-done from `docs/PERSONAS.md` — typically:

1. **Entry + first impression** (5-second test: would they stay?)
2. **Their primary view** (Tonight / This Weekend / week ahead / date range)
3. **Their filter** (Live Music for Mia, family for Jen, category for Dave…)
4. **3–5 event detail pages** they'd realistically click — verify every fact a
   card promises against the detail page, and the detail page against the
   source (`event_url` / organizer page) when something smells off
5. **Their share/export move** (share link, OG preview, copy-paste for Karen)
6. **Edge of their patience**: what happens on empty states, past-date views,
   a town with no events, a broken poster?

Log every anomaly with: URL, what the persona expected, what they saw, and
whether the root cause is **data** (a row is wrong) or **structure** (the code
renders correct data wrongly, or a capability is missing).

## 2. Daily data sweep (every run, after the journey)

Run against Supabase (read-only queries; sample where noted):

1. **Stale/past events still live**: `date < CURRENT_DATE` with
   `visibility='public'` and status not cancelled — anything the homepage
   horizon could still show.
2. **Broken time logic**: `start_time > end_time` (same-day), NULL `start_time`
   on non-umbrella rows dated within 14 days, `23:50`/`23:59` placeholder end
   times on upcoming events.
3. **Missing essentials on near-term events** (`date` within 14 days,
   public): NULL/empty `venue_name`, `town`, or a description under ~40 chars
   on `robs_pick` rows.
4. **Duplicate suspicion**: same `town` + `date` + similar name across rows —
   then check `lib/dedupe-events.ts` buckets + the umbrella-row rules before
   calling it a bug.
5. **Link rot (sample 10)**: HEAD-check `event_url` on upcoming high-visibility
   events; 404/redirect-to-home = anomaly.
6. **Poster rot (sample 10)**: HEAD-check `image_url`.
7. **Cancellation drift**: for any event you saw news of being cancelled or
   changed (search the organizer page if the journey raised suspicion), verify
   the row reflects it.

## 3. Triage — the split

For each verified anomaly, decide:

### A. Simple data error → `qa_fix_event` proposal (propose-first)

The row is wrong; a field-level UPDATE fixes it; you can cite evidence.
Whitelisted columns only (see `lib/agent/qa-fix-event.ts`): name, date,
start/end time, venue_name, town, address, category, price, cost_tier,
event_url, description, image_url, artists, status, visibility.
Never identity/provenance columns; human-locked fields will be refused by the
executor — don't propose them.

File via SQL (service role / Supabase MCP):

```sql
INSERT INTO agent_actions (type, title, rationale, payload, blast_radius, reversible, outward_facing, status)
VALUES (
  'qa_fix_event',
  'Fix: <short what-was-wrong> — <event name> (<date>)',
  '<persona> hit this on <URL>: <expected vs saw>. Evidence: <source URL / what you verified>.',
  jsonb_build_object(
    'event_id', '<uuid>',
    'updates', jsonb_build_object('<col>', '<new value>'),
    'reason', '<one sentence: what was wrong and how you verified the fix>'
  ),
  'low', true, false, 'proposed'
);
```

Rob approves in **/admin/actions** (they also surface in the Inbox badge); the
executor snapshots before writing, so every fix is revertible. Do NOT update
`hwy4_events` directly — the proposal queue IS the approval gate. (After a
2-week clean canary Rob flips the `agent_policy` row to auto-execute; the
filing format stays identical.)

### B. Structural problem → ready-for-dev PRD ticket in `hwy4_tasks`

Wrong rendering of correct data, a missing capability, a systemic data-quality
pattern (the same field wrong across many rows = the *scraper* is the bug), or
anything needing a code push.

```sql
INSERT INTO hwy4_tasks (title, body, type, status, priority, source, ai_rationale)
VALUES (
  '<imperative title, e.g. "Range cards must require contiguous dates">',
  '<PRD body — markdown, see template below>',
  'qa',            -- or 'bug' for a clear defect
  'ready',         -- Rob-approved default for persona-QA finds: straight to Ready for dev
  'p2',            -- p1 if it actively misleads users today; p3 if cosmetic
  'qa_agent',
  jsonb_build_object('persona', '<name>', 'found_at', '<URL>', 'evidence', '<summary>')
);
```

PRD body template (keep it buildable by a cold-start Claude Code session):

```markdown
## Problem
<persona> on <URL>: expected X, saw Y. Reproduction steps.

## Evidence
Links, row ids, screenshots-in-words.

## Root cause (best guess)
File/function if you traced it (read the repo code — you have it).

## Proposed fix
Concrete. Include acceptance criteria and which scripts/test/* should lock it.

## Out of scope
```

These land directly in the **Ready** column on /admin/roadmap (Rob's explicit
choice for QA finds — they skip the `proposed` promote gate; everything else
about the board flow, including `/build-ticket HWY-N`, is unchanged).

## 4. Close the loop

1. Re-check your filings landed (`SELECT` them back).
2. Post a short summary to Slack **#claude-updates**: persona of the day, what
   was walked, N fixes proposed, N tickets filed (with HWY refs), anything
   clean ("Mia's journey clean, sweep found 2 stale rows").
3. If the run found **nothing**, say so explicitly — a clean pass is signal.

## Guardrails

- **Read-only on the site, propose-only on the DB.** Never UPDATE/DELETE
  `hwy4_events` directly; never touch RLS; never merge or push code.
- One `qa_fix_event` per event row per run. Batch systemic patterns into ONE
  structural ticket instead of 30 fix proposals.
- Cap per run: ≤10 fix proposals, ≤3 tickets. Beyond that, file one roll-up
  ticket — a flood means something upstream broke.
- Respect the false-positive list in §0. When in doubt, question ticket.
