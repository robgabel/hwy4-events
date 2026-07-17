-- Persona QA daily rotation (PRD-persona-qa-daily.md): register the
-- `qa_fix_event` action type's autonomy policy.
--
-- The daily persona-QA routine files field-level fixes to hwy4_events rows as
-- agent_actions proposals; a human approves them in /admin/actions and the
-- executor (lib/agent/actions-executor.ts execQaFixEvent) snapshots the touched
-- columns before writing, so every fix is one-click revertible.
--
-- Ships propose-first per Rob (2026-07-17): auto_execute=false with a 2-week
-- canary. After 2 clean weeks of approvals with no rejects/reverts, flip
-- auto_execute=true and Stage-2 auto-run takes over (canAutoExecute still
-- vetoes anything not low-blast + reversible + internal). Idempotent.

insert into public.agent_policy (action_type, auto_execute, min_clean_weeks, notes) values
  ('qa_fix_event', false, 2, 'Persona-QA field fix to one hwy4_events row. Whitelisted columns only (lib/agent/qa-fix-event.ts), respects *_locked flags, snapshot-first revert. Propose-first canary: flip auto_execute after 2 clean weeks.')
on conflict (action_type) do nothing;
