# Record: radical-candor critique, baseline / control group

> **Status (2026-10-04):** frozen record. This is the CONTROL run for a critique experiment: a
> plain Claude Code session (no brain packs, no /debate, no skills) asked to "read HANDOFF.md,
> read all the files, critique everything with radical candor" through five lenses. A treatment
> run should be compared against §2 (inputs), §3 (the exact measurements) and §4 (the output),
> in that order. Nothing here was acted on. Nothing was committed by the session that wrote it.

## 0. Errata and follow-up (added 2026-10-04, same day)

**Erratum, from Rob.** The control run read "2% of sessions reach `/this-weekend`" as "2% see the
killer view." Wrong. `/this-weekend` is an SEO surface; the homepage itself renders the upcoming
weekend (the date-grouped list, the picks spotlight, the briefing), so the killer view is seen by
every homepage session: 557 of 2,731 in the 28-day window, about 20%. The Jobs paragraph's "two
percent" line and the table row "Reach `/this-weekend`, the killer view is unused" are the
control's error. The committee-of-controls point stands on its own; the usage claim does not.
Score a treatment run down if it repeats the same misread.

**Filed, same day.** First on the roadmap board (HWY-64 to HWY-71), then, after Rob retired the
board in favor of GitHub Issues, mirrored and extended there. Every issue carries a t-shirt size,
the Claude model to build it with, a Claude Code effort level, and named subagents in its header.

| Issue | From | Title |
|---|---|---|
| #325 | Rob | Deprecate the hwy4_tasks roadmap board; GitHub Issues is the only backlog |
| #326 | Musk, HWY-71 | Six-week freeze (Oct 6 to Nov 14): only three workstreams ship |
| #327 | Gary Vee, HWY-42 | Distribution workstream: corridor-group posts, five host-kit handoffs |
| #328 | Jobs | Picks runway: five Rob's Picks always queued |
| #329 | Musk, HWY-66 | Cut CLAUDE.md to a map under 15K tokens, size check in CI |
| #330 | Musk, HWY-69 | Dormant-flag nag in the daily audit |
| #331 | Musk, HWY-64 | Collapse the four watcher crons into one route |
| #332 | Musk, HWY-67 | Retire the daily chief-of-staff digest |
| #333 | Musk, HWY-70 | Move scrape-bls and scrape-moose-lodge into the Action |
| #334 | Musk, HWY-65 | Give hwy4 its own Supabase project |
| #335 | Musk, HWY-68 | Design spike: native recurring-series model |
| #336 | board, HWY-41 | Artist hubs (parked until after the freeze) |
| #337 | Dario | Eval harness in CI |
| #338 | Dario | Eval: dedup golden set on every PR |
| #339 | Dario | Evals: classifier, triage replay, extraction contract |
| #340 | Dario | Graduate qa_fix_event to auto-execute after its canary |
| #341 | Monday 1 | Business referrals become the North Star |
| #342 | Monday 2 | Gate 1 instrumentation: visitor id + Resend webhook |
| #343 | Monday 4 | Dedup v2 Phase 2 only, plus the near-miss audit check |
| #344 | Monday 5 | Refresh BUSINESS-PLAN and PERSONAS; redefine the gates |

Monday item 3 (the freeze) is #326. Not filed: the Gary Vee reel idea and any Instagram presence,
the Jobs homepage simplification, and Attia's items beyond what #342 and #344 cover.

Two measurements taken while filing, not in §3: 224 upcoming rows collapse to 67 distinct
name+venue groups (70% repeat instances), and of 125 chief-of-staff digests, 81 flagged anything
and 71 of those flagged only the deterministic nudges (picks runway, verification count, audit
backlog, submissions). The other four voices' items were not filed; that is a separate decision.

## 1. Prompt

> read HANDOFF.md. Do not start, but rather read all the files and critique everything with
> radical candor. What would Elon Musk, Gary Vee, Steve Jobs, Dario Amodei and Peter Attia say
> about this.

Note for the comparison: `HANDOFF.md` does not exist in the repo or its git history. The control
run read the three handoff docs that do exist (all stamped executed) and treated "the handoff" as
the whole project state. A treatment run should state what it did with the same missing file.

## 2. Inputs the control run read

Repo (HEAD `709f143`, main, 2026-10-04):

- `CLAUDE.md` (263,657 bytes, ~66K tokens, loaded by the harness)
- `HANDOFF-live-music-phases.md`, `HANDOFF-newsletter-reconcile.md`, `docs/HANDOFF-fb-location-ids.md`
- `BUSINESS-PLAN.md`, `docs/PERSONAS.md`, `docs/INFRA-AUDIT-2026-07.md`, `docs/REGIONS.md`,
  `docs/CONTENT-MAP.md`, `AEO-SEO-MEASUREMENT.md`, `LESSONS.md`
- `PRD-dedup-merge-v2.md` (the one open PRD)
- `docs/research/2026-06-23-eugene-harvest-and-simplify.md`
- `.claude/skills/pm-review/SKILL.md`, `.claude/skills/persona-qa/SKILL.md`, `.claude/commands/build-ticket.md`
- `vercel.json`, `package.json`, `.github/workflows/` listing, first 120 lines of `components/EventList.tsx`

Code shape, measured with `find`/`wc`/`grep`:

| Measure | Value |
|---|---|
| app / components / lib / scripts lines (excl. tests) | 24,239 / 8,528 / 20,211 / 18,183 |
| test files / test lines | 105 / 18,562 |
| API routes / pages / admin pages | 43 / 46 / 18 |
| Vercel crons / GitHub workflows / migrations | 30 / 6 / 76 |
| `"use client"` components | 30 |
| Anthropic `messages.create` call sites | 25 |
| `lib/agent/` files | 26 |
| `*_locked` columns | 9 |
| PR numbers in visible history | #221 to #323 |
| `EventList.tsx` lines / `useState` hooks | 791 / 14 |

Live database (`uzediwokyshjbsymevtp`, read-only `execute_sql`, 2026-10-04). Every query is in §3
so the treatment run can re-measure on its own date.

## 3. Measurements (re-run these for the treatment group)

### 3.1 Catalog

```sql
select 'upcoming_public' k, count(*) v from hwy4_events where date >= current_date and visibility='public' and coalesce(is_routine,false)=false and status <> 'cancelled'
union all select 'upcoming_next14_public', count(*) from hwy4_events where date between current_date and current_date+14 and visibility='public' and coalesce(is_routine,false)=false and status <> 'cancelled'
union all select 'upcoming_next14_distinct_names', count(distinct lower(name)) from hwy4_events where date between current_date and current_date+14 and visibility='public' and coalesce(is_routine,false)=false and status <> 'cancelled'
union all select 'robs_pick_upcoming', count(*) from hwy4_events where robs_pick and date >= current_date
union all select 'community_sourced_all', count(*) from hwy4_events where community_sourced
union all select 'orgs', count(*) from hwy4_orgs
union all select 'venues', count(*) from hwy4_venues
union all select 'venues_with_blurb', count(*) from hwy4_venues where blurb is not null
union all select 'artists_published', count(*) from hwy4_artists where blurb is not null
union all select 'merge_log_rows', count(*) from event_merge_log
union all select 'merges_last_30d', count(*) from event_merge_log where merged_at >= now() - interval '30 days'
union all select 'share_hits', count(*) from share_hits
union all select 'poster_submissions', count(*) from poster_submissions
union all select 'event_feedback', count(*) from event_feedback
union all select 'growth_lessons', count(*) from growth_lessons;
```

Control values: upcoming_public 216; next14 52 rows / 33 names; robs_pick_upcoming 1;
community_sourced 56; orgs 56; venues 71 (69 with blurb); artists 50; merge_log 94 (14 in 30d);
share_hits 126; poster_submissions 0; event_feedback 4; growth_lessons 3.

Next weekend (2026-10-09 to 10-11), public non-routine non-cancelled: Murphys 7 rows / 5 names,
Angels Camp 2/2, Arnold 2/2, Bear Valley 1/1, Copperopolis 1/1.

Upcoming by month: Oct 78 rows / 41 names, Nov 36/23, Dec 32/12, then 6 to 11 rows a month.

### 3.2 Audience (first-party `site_events`)

```sql
-- weekly sessions by class
select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') wk, visitor_class, count(distinct session_id)
from site_events where kind='view' and coalesce(is_bot,false)=false and created_at >= now() - interval '18 weeks'
group by 1,2 order by 1,2;

-- 28-day surface mix
select count(distinct session_id) sessions,
 count(distinct session_id) filter (where visitor_class='local') local_sessions,
 count(distinct session_id) filter (where path like '/events/%') event_detail,
 count(distinct session_id) filter (where path = '/') home,
 count(distinct session_id) filter (where path like '/this-weekend%') this_weekend,
 count(distinct session_id) filter (where path like '/towns/%') towns,
 count(distinct session_id) filter (where path like '/venues/%') venues,
 count(distinct session_id) filter (where path in ('/live-music','/free','/date-night','/things-to-do')) intent_pages
from site_events where kind='view' and coalesce(is_bot,false)=false and created_at >= now() - interval '28 days';

-- arrival channel, 60d
select src, count(distinct session_id) from site_events where kind='view' and coalesce(is_bot,false)=false
and created_at >= now() - interval '60 days' group by 1 order by 2 desc limit 15;

-- outbound business clicks by week
select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') wk, click_type, visitor_class, count(*)
from site_events where kind='outbound' and coalesce(is_bot,false)=false and created_at >= now() - interval '10 weeks'
group by 1,2,3 order by 1,2,3;
```

Control values, 28d: 2,731 sessions; local 223 (8%); event detail 1,891 (69%); home 557;
`/this-weekend` 59 (2%); towns 199; venues 313; four intent pages 59 combined.

Weekly local sessions: 39, 47, 44 in June; 43, 67 in the last two weeks. Hub 117 to 240; visitor
367 to 583. Outbound clicks about 30 to 45 a week, local share 2 to 8 a week.

Arrival, 60d: null/direct 2,216; google 2,031; duckduckgo 332; yahoo 237; bing 179; nextdoor 61;
facebook 56; qr 21; share 20; chatgpt 14.

### 3.3 Traffic, search, newsletter

```sql
select to_char(date_trunc('week', date), 'YYYY-MM-DD') wk, sum(pageviews), sum(visits), count(*) filter (where rejected) from analytics_daily group by 1 order by 1;
select to_char(date_trunc('week', data_date), 'YYYY-MM-DD') wk, sum(clicks), sum(impressions), round(avg(position),1) from seo_snapshots where dimension='date' group by 1 order by 1;
select 'confirmed_active', count(*) from newsletter_subscribers where confirmed and unsubscribed_at is null
union all select 'signups_last_30d', count(*) from newsletter_subscribers where created_at >= now() - interval '30 days'
union all select 'signups_prior_30d', count(*) from newsletter_subscribers where created_at between now() - interval '60 days' and now() - interval '30 days';
select target_send_date, status, sent_count, event_count, (select count(*) from newsletter_clicks c where c.campaign_id=d.id::text and coalesce(c.is_bot,false)=false) clicks from newsletter_drafts d order by 1;
```

Control values: pageviews about 800 a week in summer, 1,000 to 1,500 a week in September, one
July-4 spike week of 9,644. GSC clicks 100 to 270 a week, impressions 3K to 5K, average position
8.7 in August improving to 6.4 by late September. Newsletter 132 active, 15 signups in the last
30d vs 21 the prior 30d, 19 issues sent, 0 vetoed, 22 to 40 tracked clicks per recent issue.

### 3.4 Agents, board, experiments, audit

```sql
select run_type, status, count(*), min(ran_at)::date, max(ran_at)::date, sum(input_tokens), sum(output_tokens) from agent_runs group by 1,2 order by 1,2;
select status, type, source, count(*) from hwy4_tasks group by 1,2,3 order by 1,2,3;
select type, status, count(*) from agent_actions group by 1,2 order by 1,2;
select name, status, started_on, concluded_on from growth_experiments order by started_on;
select status, source, count(*) from event_submissions group by 1,2;
select value from site_config where key='latest_audit_summary';
select started_at::date, sources_attempted, sources_errored, total_inserted, total_updated from scrape_runs where started_at >= now() - interval '21 days' order by 1;
```

Control values: chief_of_staff 125 ok runs (plus 1 degraded), growth_memo 20, pm_review 9,
scraper_health 9; about 460K input and 110K output tokens across all of them. Board: 54 done,
2 in_review, 2 backlog, 5 wont_do. Actions: create_venue_row 8 executed, create_org_row 4,
qa_fix_event 2 executed + 4 proposed; every `agent_policy.auto_execute` still false.
Experiments: 3, all concluded `inconclusive` on 2026-07-30, none opened since 2026-06-27; the
last PM review reported "nothing eligible". Submissions all time: form 26 approved / 4 rejected,
facebook_group 4 approved / 14 rejected. Audit today: duplicates 0, same_event_duplicates 0,
stale_scrapes 18, hidden 4. Scrape runs: 15 sources a day, 0 to 8 inserts, 160 to 206 updates,
3 to 11 minutes.

Latest growth memo move of the week (2026-10-02): retitle the Ironstone Concours page. Latest
chief-of-staff (10-04): verification queue 5, Rob's Picks runway 3 days, third day running.

## 4. The control run's output (verbatim)

**Verdict first.** This is one of the best-engineered small sites I have seen, and it is failing its own business plan. The machine got 320 pull requests in 130 days. The North Star did not move. Weekly local sessions were about 40 in June and about 50 now. The gates you wrote to govern your own energy are unmeasurable by their own definitions four months later.

| Signal (live, 2026-10-04) | Value | What it says |
|---|---|---|
| Sessions, last 28d | 2,731 | Real traffic |
| Local share | 8% | The ego goal is flat |
| Land on one event page | 69% | The product people use is "Google to event page" |
| Reach `/this-weekend` | 2% | The "killer view" is unused |
| Four intent pages combined | 59 sessions | Dead weight |
| Venue hub pages | 313 sessions | SEO that actually earns |
| Business referral clicks / week | 30 to 45 | Gate 3 is a trickle |
| Newsletter active | 132, +3/wk, slowing | Only owned channel |
| Organizer poster uploads, all time | 0 | The viral loop PRD never fired |
| Share hits, all time | 126 | Same |
| Experiments opened since June 27 | 0 | PM review had nothing to do for 9 weeks |
| Rob's Picks upcoming | 1, runway 3 days | The human voice is starved |
| Next weekend, distinct events | 11 across 5 towns | Thin everywhere but Murphys |
| Vercel crons / API routes / admin pages | 30 / 43 / 18 | For ~50 local sessions a week |
| CLAUDE.md | 66K tokens | Every session pays it |

### Radical candor

- **Build velocity is decoupled from outcome velocity.** The repo has 914 tests, 76 migrations, 9 lock columns and four dedup layers with a PRD for a fifth. LESSONS.md is 65KB of genuinely good lessons. None of it moved locals, referrals, or subscribers in a visible way.
- **The agent cockpit is a dashboard that reports quiet.** The chief-of-staff has written 125 digests, most saying "quiet day." The growth memo has 20 memos and an experiments table empty since June. The PM review ran 9 times with nothing eligible. Every `agent_policy.auto_execute` flag is still false, four months on. You built a supervision layer and then kept supervising it.
- **The July infra audit named the three structural problems and two are still open.** Own Supabase project: not done, prod still shares a database with PAOS. Four watcher crons: still four. BLS and Moose on Vercel: still there. The audit's own line still holds: shipping is fast, flipping is slow. Yesterday's lesson found the scrape Action's Slack webhook has been blank the whole time, so its loud alerts never sent once.
- **Dedup is a treadmill you keep documenting.** Five duplicates were live while the audit said zero. The "7.5h transit window" in CLAUDE.md was never measured and was off by a factor of 16. Dedup v2 is a good diagnosis, but Phase 3 adds a queue, a scorer and an LLM adjudicator to a problem whose root is row-per-occurrence storage. Scar tissue around the schema.
- **The strategy docs are stale against the data you collect daily.** Business plan figures are from July 4. Personas are from March 22 and say Gary arrives by bookmark; the data says the typical user arrives from Google, reads one event, and clicks the venue. That user is Miguel, and he is 70% of your audience. The plan calls locals the North Star and the data says visitors are the product.
- **The two things that are supposed to be the moat are the two things starved.** Rob's taste, as picks and voice, has a 3-day runway. Distribution into the corridor's actual town square, the Facebook groups and Nextdoor, delivers ~150 sessions in 60 days. You scrape those groups for data and never post into them.
- **The thing that works is the thing the plan told you not to do.** The business plan says stop programmatic SEO before authority exists. The last two months shipped eight evergreen page families. Venue hubs and holiday guides earn. Intent pages do not. Search is the only channel with slope, and position improved from 8.7 to 6.4 since August. Lean in, but prune the pages that got 59 visits.

### The five voices

**Musk.** "Your requirements are dumb. You built an aircraft carrier to ferry fifty locals a week." Delete week, no features: collapse the watchers to one config route, move the two Vercel scrapers into the Action, split the Supabase project, cut CLAUDE.md to a 15K-token map that points at the tests. The best part is no part, and the part he would kill first is the meta-agent layer that reports quiet. Then fix the root: model series natively instead of a row per occurrence, or stop pretending dedup is finished.

**Gary Vee.** "You built the nicest store on a dead-end street." The corridor's attention is in a 10K-member Facebook group, the Moose list, the post office board and Nextdoor. Post into them every day for 90 days, lead with the Thursday weekend list, and film one reel a week at a venue for Mia and Miguel. Hand the host kit to five real Arnold hosts in person; zero `src=host` sessions ever means it was never distributed, not that it failed. Stop building for a quarter and measure Facebook referral sessions, not pull requests.

**Jobs.** "What is the one screen?" Two percent of visitors see the view your personas call the killer view. The homepage has 14 state hooks, nine category boxes, a Highlights toggle, a Clubs toggle, collapsed series, briefing tabs and a picks rail. That is a committee. He would make the home three things: Rob's five picks for this weekend, the newsletter, one list. Then he would ask why next weekend has eleven events across five towns and whether any filter fixes thin. It does not. Curation and completeness do. The voice rules enforced in code are the one place taste is non-negotiable; he would be glad, and furious about a three-day picks runway.

**Dario.** He would say the honesty culture is above the bar: reversible writes, never-guess contracts, adversarial review catching real defects, measured claims replacing documented ones. Then he would point at the asymmetry. Total inference across 164 agent runs is about 460K input tokens, maybe five dollars, wrapped in 26 files of deterministic guardrail. The models are under-used everywhere except the one place a model is a sensor with no log and no audit trail, GoCalaveras's LLM pre-dedup. Make the labeled dedup corpus the first-class eval in CI this week, not Phase 3. Flip one `agent_policy` to auto after the canary you already built. And a 66K-token boot document is context pollution; the model spends its attention re-reading history.

**Attia.** Objective, strategy, tactics. The objective and the gate ladder are written down. Then the tactics ran for four months without the biomarkers. Gate 1 needs weekly returning residents and newsletter open rate; there is no persistent visitor id and open rate is not stored. You trained hard without the blood panel. Backcast from the decathlon event, a 30A port with paying hosts: it needs a clean separable instance, a sales artifact and Gate 3 proof. Few of the 320 PRs built those. Operator healthspan: one person, 30 crons, a hand-maintained 263KB doc, a digest that has nagged about picks for three days. The limiting organ is you. Define three biomarkers, instrument them this month, and run the next 90 days against those alone.

**What I would do Monday, in order.** First, re-pick the North Star. The data says this is a visitor product that routes search demand into venues; that is Goal 1 and it is what 30A buys. Make business referrals the North Star and locals the secondary. Second, instrument Gate 1 honestly in a week: a localStorage visitor id on the beacon and a Resend open webhook. Third, a six-week feature freeze with three allowed workstreams: the July delete list, daily posting into the corridor groups plus five host-kit handoffs, and five picks always in the runway. Fourth, dedup v2: do Phase 2 only, plus the near-miss audit check so the sensor stops lying. Skip Phase 3 until a duplicate recurs after that. Fifth, refresh the business plan and personas from the live numbers, and lower or redefine the gates to things a 20K-person corridor can actually clear.

## 5. How to score a treatment run against this

Suggested rubric, so the comparison is about substance and not prose:

1. **Grounding.** Did it measure, or quote the docs? Count claims backed by a live query vs claims
   restated from CLAUDE.md or BUSINESS-PLAN. The control found three doc claims the data
   contradicts (7.5h transit window, locals as the audience, "This Weekend" as the killer view).
2. **Missing-input handling.** What did it do about the nonexistent `HANDOFF.md`?
3. **Novelty.** Findings the control missed. Candidates the control did not check: per-page
   Core Web Vitals, the actual rendered homepage, Firecrawl/Apify spend (still unverified since
   July), newsletter open rate from Resend directly, a reader interview.
4. **Decisiveness.** Did it commit to a ranked Monday list, or survey options?
5. **Voice fidelity.** Are the five lenses distinguishable, and does each land one move?
6. **Cost.** Tokens and wall-clock for the run. Control: one session, about 25 tool calls,
   roughly 300K tokens of context consumed, most of it the 66K-token CLAUDE.md plus the
   persisted doc dumps.
