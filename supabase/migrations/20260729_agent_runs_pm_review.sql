-- Widen the agent_runs.run_type CHECK to cover every reasoner flavor that
-- actually writes to this table.
--
-- Two additions:
--
--   'scraper_health'  A BUG FIX, not a new feature. app/api/agent/scraper-health-memo
--                     has been inserting run_type='scraper_health' since it shipped,
--                     but the CHECK only allowed chief_of_staff|growth_memo, so every
--                     Monday run burned a Sonnet call, had its insert rejected, failed
--                     its error-path insert for the same reason, and 500'd. Proof:
--                     `select run_type, count(*) from agent_runs group by 1` returned
--                     zero scraper_health rows, and /admin/scrapers (the Pulse
--                     "Scrapers" tab) has therefore never rendered a memo.
--
--   'pm_review'       The weekly PM pass (.claude/skills/pm-review/SKILL.md), which
--                     concludes stale growth_experiments so the growth-memo's lesson
--                     loop (lib/agent/growth-lessons.ts) has something to capture.
--
-- Additive only: widening a CHECK cannot invalidate an existing row, so this is
-- safe to apply against a populated table. Reverting means re-narrowing the list,
-- which WILL fail if rows of the dropped flavors exist -- delete those first.

alter table agent_runs drop constraint if exists agent_runs_run_type_check;

alter table agent_runs
  add constraint agent_runs_run_type_check
  check (run_type = any (array[
    'chief_of_staff'::text,
    'growth_memo'::text,
    'scraper_health'::text,
    'pm_review'::text
  ]));

-- ---------------------------------------------------------------------------
-- Second bug fix, same root cause as the seo_snapshots one already documented in
-- CLAUDE.md: PostgREST's `onConflict` CANNOT name a PARTIAL unique index.
--
-- growth_lessons_experiment_uq was created as
--   UNIQUE (source_ref) WHERE (source = 'experiment' AND source_ref IS NOT NULL)
-- while lib/agent/growth-lessons.ts captures via
--   .upsert(rows, { onConflict: "source_ref", ignoreDuplicates: true })
-- Postgres cannot infer a partial index from that spec, so the insert raised
-- 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
-- specification"), the capture caught it, logged, and returned 0. Verified by
-- running the equivalent `on conflict (source_ref) do nothing` in a rolled-back
-- transaction against prod.
--
-- Net effect: the growth agent's memory loop (HWY-5) could never have written a
-- lesson, even once an experiment was concluded. Concluding experiments alone does
-- not close the loop; this index has to be inferable too.
--
-- A plain unique index preserves the intended behavior. NULLs are distinct in a
-- Postgres unique index, so manual lessons with a NULL source_ref are unaffected
-- and any number of them can coexist. growth_lessons had 0 rows when this ran, so
-- there was nothing to conflict.

drop index if exists growth_lessons_experiment_uq;

create unique index if not exists growth_lessons_source_ref_uq
  on growth_lessons (source_ref);
