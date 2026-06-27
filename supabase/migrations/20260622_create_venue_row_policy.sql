-- Agent Cockpit Stage 1: register the `create_venue_row` action type's autonomy
-- policy (PRD-live-music-experience.md Phase 1A, HANDOFF-live-music-phases.md).
--
-- This proposer drains the "unregistered venue with >= N upcoming events" worklist
-- (lib/venue-gaps.ts) into the same agent_actions queue create_org_row uses. On
-- approve, the executor inserts the hwy4_venues row (which /api/sync-venue-facts
-- then auto-enriches) and emits a commit-ready scripts/lib/venues.ts snippet; a
-- human commits that snippet to link the venue's events durably (the matcher is
-- registry-driven, and code can't self-commit a checked-in TS file).
--
-- Internal + reversible (revert = delete the hwy4_venues row), but ships human-
-- gated like every other type: auto_execute=false until a canary holds. The
-- agent_actions / agent_policy tables already exist (20260531d_agent_cockpit_stage1.sql);
-- this only seeds the new policy row. Idempotent.

insert into public.agent_policy (action_type, auto_execute, min_clean_weeks, notes) values
  ('create_venue_row', false, 4, 'Register an unregistered venue: insert the hwy4_venues row + emit a venues.ts registry snippet to commit. Internal, reversible (delete the row).')
on conflict (action_type) do nothing;
