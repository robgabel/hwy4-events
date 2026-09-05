---
name: pm-review
description: Weekly PM pass for Hwy4Events — conclude stale growth experiments so the growth-memo's lesson loop has something to learn from. Read-only on code, propose-nothing, reversible writes only.
---

# PM review (weekly)

## Why this exists

The agent fleet proposes well and never closes. Measured 2026-07-29:

| Signal | Value |
|---|---|
| Growth memos written | 11 |
| Tickets filed from them | 7 (5 shipped) |
| `growth_experiments` still `running` | 3, started Jun 7 / Jun 9 / Jun 27 |
| `growth_lessons` rows | **0** |

`lib/agent/growth-lessons.ts` (ticket HWY-5) only distills a lesson from a
**concluded** experiment. Nothing concluded any, so the store is empty and every
Friday memo reasons from scratch instead of compounding. This pass is the missing
closer: it renders a verdict on experiments that have run long enough to have one.

It runs as a Claude Code session, not a Vercel cron, for one reason: a verdict
needs to translate a prose `metric` field into SQL and sanity-check it against the
codebase. The cron reasoners have neither a repo nor a shell.

## Authority

**May:** conclude `growth_experiments` (status + result + concluded_on), write one
`agent_runs` audit row, post to Slack.

**May not:** touch `hwy4_events`, publish or send anything, merge or push code,
file or modify `hwy4_tasks` rows, disable RLS. Concluding an experiment is the only
state change in scope. PRD-ifying tickets and ranking the board are **later phases,
explicitly out of scope here** — do not do them even if they look easy.

Supabase project: `uzediwokyshjbsymevtp` (Supabase MCP `execute_sql`).

## The loop

### 1. Pull candidates

```sql
select id, name, hypothesis, metric, baseline, started_on,
       current_date - started_on as days_running
from growth_experiments
where status = 'running' and started_on <= current_date - 28
order by started_on;
```

28 days is the eligibility floor: shorter than that on a site this size and the
verdict is noise. Cap at **5 conclusions per run**; if more qualify, take the
oldest and say in Slack how many you left.

### 2. Turn each `metric` into a measurement

The `metric` field is prose a human wrote. Read it literally and measure exactly
what it names, not a proxy you find easier. Compare the window **since
`started_on`** against an **equal-length window immediately before it**. If the
pre-window predates the data (the beacon shipped 2026-06-08, `analytics_daily`
only reaches back to its own backfill), say so and treat the baseline as unknown.

**Aggregate in the DB.** PostgREST truncates row reads at ~1,000 and `.limit()`
does not override it, so never tally rows you fetched. Use `count(*)`/`sum()` in
SQL, as `lib/agent/growth-context.ts` does via its `growth_*` RPCs. Those RPCs are
fixed 7/14/30-day windows and will NOT fit an arbitrary experiment window — write
your own aggregate query instead of bending them.

Source map for the metric families in play:

- **Newsletter net adds** — `newsletter_subscribers` (confirmed vs unsubscribed
  over the window); `newsletter_drafts.sent_count` for the denominator.
- **Arrival channel (`src=host`, `src=qr`, `src=share`)** — `site_events.src`,
  first-touch per session. Filter `is_bot = false`.
- **Business referrals / directions** — `site_events` where `kind='outbound'`,
  split by `click_type` and `visitor_class`; join `event_id` → `hwy4_events` when
  the metric scopes to a category (e.g. live-music pages).
- **Sessions** — distinct `session_id` on `kind='view'`, `is_bot = false`, split by
  `visitor_class` for the local/visitor cut. `hub` is a third located class (a
  regional ISP hub city that mixes hub-routed locals with real visitors): report
  it on its own, never fold it into either side. Rows before 2026-09-04 carry it
  only if `scripts/reclassify-visitor-class.ts --apply` was run.
- **Search demand** — `seo_snapshots` (`dimension='date'` is the durable spine).

### 3. Render a verdict

`won` | `lost` | `inconclusive`. Never write `abandoned` — killing an experiment is
Rob's call, not yours.

**Default to `inconclusive` and mean it.** This site's weekly volumes are small
enough that most honest reads are inconclusive, and a flattering `won` poisons the
lesson store the Friday memo now trusts as ground truth. A wrong lesson is worse
than no lesson, the same contract the price extractor and the artist-blurb drafter
already follow: state only what the data states.

Write `inconclusive` when any of these hold:
- the metric's own numbers are single-digit in either window,
- the baseline window has no data (the instrumentation postdates it),
- the change is within what a single busy weekend would swing,
- the experiment's change shipped alongside something else that plausibly moved
  the same metric (check `git log` for the window — this is why the pass has a repo).

`result` is 1–3 sentences: the two numbers, the window, and the verdict's reason.
No hype, no emojis, **no em dashes**. It becomes a `growth_lessons` row that gets
injected into future prompts, so write it as a fact, not a pitch.

```sql
update growth_experiments
set status = '<won|lost|inconclusive>',
    result = '<1-3 sentences>',
    concluded_on = current_date,
    updated_at = now()
where id = '<uuid>';
```

### 4. Audit row

One row per run, whatever the outcome (including "nothing eligible"):

```sql
insert into agent_runs (run_type, status, model, digest)
values ('pm_review', 'ok', '<model id>', '<jsonb>'::jsonb);
```

Shape `digest` like the other reasoners (`lib/agent/types.ts`): a `summary`
string plus `needs_you` / `fyi` / `watching` arrays. Put a `won`/`lost` verdict in
`needs_you` (Rob should see a real result), `inconclusive` in `fyi`, and anything
you declined to judge with the reason in `watching`.

### 5. Hand off to the lesson loop, do not duplicate it

**Do not insert `growth_lessons` rows yourself.** The Friday growth memo calls
`captureLessonsFromConcludedExperiments` before it gathers context
([app/api/agent/growth-memo/route.ts:144](../../../app/api/agent/growth-memo/route.ts)),
dedups on the experiment id, and formats via the test-locked `experimentToLesson`.
Concluding the experiment is the whole trigger. Running this pass **Thursday** means
Friday's memo captures the lesson and reads it back in the same run.

### 6. Report

Post to Slack `#claude-updates`: how many were eligible, each verdict with its two
numbers in one line, and the revert SQL. Then stop. Do not open a PR.

## Revert

Every conclusion is one statement away from undone:

```sql
update growth_experiments
set status = 'running', result = null, concluded_on = null, updated_at = now()
where id = '<uuid>';
```

If the Friday memo already captured a lesson from it, drop that too:
`delete from growth_lessons where source = 'experiment' and source_ref = '<uuid>';`

## Guardrails

- Read-only on the repo. `git pull` and `git log` are fine; never commit, push, or merge.
- Never disable RLS. Never widen a policy.
- If an experiment's `metric` is too vague to measure, do not guess a proxy: leave
  it `running` and put the ambiguity in `watching` so Rob can sharpen the wording.
