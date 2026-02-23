-- ---------------------------------------------------------------------------
-- refresh_jobs: Tracks real-time progress of long-running refresh pipelines
-- ---------------------------------------------------------------------------

create table public.refresh_jobs (
  id          uuid        primary key default gen_random_uuid(),
  organization_id uuid    not null references public.organizations(id) on delete cascade,
  location_id uuid        not null references public.locations(id) on delete cascade,
  job_type    text        not null check (job_type in ('content','visibility','events','insights')),
  status      text        not null default 'running' check (status in ('running','completed','failed')),
  total_steps integer     not null default 0,
  current_step integer    not null default 0,
  steps       jsonb       not null default '[]'::jsonb,
  result      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_refresh_jobs_org_status on public.refresh_jobs(organization_id, status);
create index idx_refresh_jobs_location   on public.refresh_jobs(location_id, status);

alter table public.refresh_jobs enable row level security;

-- SELECT: any org member can view their org's jobs
create policy "refresh_jobs_select" on public.refresh_jobs
  for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = refresh_jobs.organization_id
        and m.user_id = auth.uid()
    )
  );

-- INSERT: only admins/owners can start jobs
create policy "refresh_jobs_insert" on public.refresh_jobs
  for insert with check (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = refresh_jobs.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

-- UPDATE: only admins/owners can update jobs
create policy "refresh_jobs_update" on public.refresh_jobs
  for update using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = refresh_jobs.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

-- Auto-clean old completed/failed jobs after 7 days (keep table lean)
-- This can be triggered by pg_cron if desired
