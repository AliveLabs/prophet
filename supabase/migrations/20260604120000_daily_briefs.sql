-- Engine rewrite: the precomputed daily/weekly brief the home reads.
-- One synthesized brief per (location, date_key); written by the precompute job
-- (service_role, bypasses RLS); read by org members (mirrors the insights policy).

create table if not exists daily_briefs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  date_key date not null,
  brief jsonb not null,
  fallback boolean not null default false,
  generated_at timestamptz not null default now(),
  unique (location_id, date_key)
);

create index if not exists idx_daily_briefs_location_date on daily_briefs(location_id, date_key desc);

alter table daily_briefs enable row level security;

create policy "org members can read daily_briefs"
on daily_briefs for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = daily_briefs.location_id and m.user_id = auth.uid()
  )
);

-- Restaurant voice for customer-facing copy (skill layer). Operator-capability
-- profile + tier caps land with the onboarding work; the dossier builder defaults
-- them until then.
alter table locations add column if not exists voice_tone text;

-- Brand-tolerance slider (0 = on-brand/tame .. 100 = every wild idea). Sets the
-- brand-fit reviewer's drop line per customer; self-tunes from feedback. Default 50.
alter table locations add column if not exists brand_tolerance int not null default 50;

-- Per-play feedback (good/bad) the brief surfaces; recalibrates brand_tolerance.
create table if not exists brief_feedback (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  date_key date not null,
  play_key text not null,
  verdict text not null check (verdict in ('good','bad')),
  severity int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_brief_feedback_location on brief_feedback(location_id, created_at desc);

alter table brief_feedback enable row level security;

create policy "org members can read brief_feedback"
on brief_feedback for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = brief_feedback.location_id and m.user_id = auth.uid()
  )
);

create policy "org members can insert brief_feedback"
on brief_feedback for insert
with check (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = brief_feedback.location_id and m.user_id = auth.uid()
  )
);
