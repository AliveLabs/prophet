-- Complete-picture · Batch 2: Ask Ticket persistence.
-- Every Q/A saved per location — user asks AND the morning standing-question run.
-- Written server-side only (service_role, bypasses RLS; mirrors daily_briefs);
-- read by org members.

create table if not exists ask_history (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  question text not null,
  answer text not null,
  confidence text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  sources jsonb not null default '[]'::jsonb,
  grounded boolean not null default false,
  source text not null default 'user' check (source in ('user', 'standing')),
  asked_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_history_location_created on ask_history(location_id, created_at desc);

alter table ask_history enable row level security;

create policy "org members can read ask_history"
on ask_history for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = ask_history.location_id and m.user_id = auth.uid()
  )
);

-- The pinned standing question (null = none). The 08:00 build-brief cron re-runs it
-- after each location's brief precompute; the answer lands in ask_history with
-- source='standing' and surfaces on /ask + the brief rail.
alter table locations add column if not exists standing_question text;
