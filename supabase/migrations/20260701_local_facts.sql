-- local_facts: a provenance-carrying store of durable, human-vetted local
-- knowledge — the structured companion to the prose docs/LOCAL-KNOWLEDGE-BASE.md
-- (the two-layer "markdown for humans, Supabase for agents" pattern PAOS uses for
-- travel + the knowledge graph).
--
-- v1 captures the single highest-trust signal in the system: a human approving
-- (or correcting) a venue blurb at /admin/venues. When the human edits the AI
-- draft, the draft is stored as prior_value and was_edited=true — the correction
-- signal. The blurb drafter reads active facts back in to ground regenerations.
-- Future sources (submission-triage new_info, manual entry) plug into the same
-- table without schema change.
create table if not exists public.local_facts (
  id            uuid primary key default gen_random_uuid(),
  subject_type  text not null,                  -- 'venue' (extensible: 'org', 'town')
  subject_key   text not null,                  -- e.g. hwy4_venues.venue_key
  kind          text not null default 'blurb',  -- what the fact is: blurb | amenity | history | ...
  fact          text not null,                  -- the human-vetted text
  prior_value   text,                           -- the AI draft this replaced, if any (the correction signal)
  was_edited    boolean,                        -- did the human change the AI draft? null when no draft existed
  source        text not null,                  -- 'blurb_review' | 'submission_triage' | 'manual'
  source_url    text,
  confidence    text not null default 'human',  -- 'human' | 'high' | 'medium' | 'low'
  status        text not null default 'active', -- 'active' | 'superseded'
  captured_by   text,                           -- who approved it (e.g. 'admin')
  captured_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- One active fact per (subject, kind) is the common read; index the active slice.
create index if not exists local_facts_subject_idx
  on public.local_facts (subject_type, subject_key) where status = 'active';

-- RLS: service-role only, mirroring agent_actions/agent_policy. The /admin tree
-- is Basic-Auth gated in middleware.ts, and the drafter scripts/routes use the
-- service role. No public/anon access — this is internal knowledge plumbing.
alter table public.local_facts enable row level security;
drop policy if exists "service role full access" on public.local_facts;
create policy "service role full access" on public.local_facts
  for all to service_role using (true) with check (true);

comment on table public.local_facts is
  'Provenance-carrying store of human-vetted local knowledge (Tier B). v1 source: a human approving/editing a venue blurb at /admin/venues (the AI-draft -> saved-blurb delta is the correction signal, in prior_value/was_edited). Read back into scripts/draft-venue-blurbs.ts to ground regenerations. Structured companion to docs/LOCAL-KNOWLEDGE-BASE.md. Service-role only.';
