-- Ticket types collapse to owner-facing buckets (Roadmap board, 2026-07-22).
--
-- The five developer-shaped types (feature/bug/qa/growth/chore) made the board
-- hard for the owner to triage, and the filing agents misused them (SEO
-- improvements landed as 'qa': HWY-7/8/12). Rob is the approval gate, so `type`
-- now answers HIS question ("what kind of thing is this"):
--   bug         = something is broken or wrong right now
--   improvement = the site works; this makes it better
--   chore       = internal/maintenance work a visitor never sees
-- `source` still carries who filed it; `priority` how soon. The owner-readable
-- body template that ships with this lives in CLAUDE.md ("Roadmap tickets").
--
-- TRANSITIONAL CONSTRAINT: the legacy values stay valid until the matching app
-- deploy (the currently-deployed New-ticket form still submits 'feature'; a
-- tight constraint would error that form during the window). New code writes
-- only the three buckets; tighten to the three-value set in a later migration
-- once the deploy has been live for a while.

alter table hwy4_tasks drop constraint if exists hwy4_tasks_type_check;
alter table hwy4_tasks add constraint hwy4_tasks_type_check
  check (type in ('bug', 'improvement', 'chore', 'feature', 'qa', 'growth'));

alter table hwy4_tasks alter column type set default 'improvement';

update hwy4_tasks set type = 'improvement' where type in ('feature', 'qa', 'growth');
