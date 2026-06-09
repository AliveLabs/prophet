-- Spine rewrite · Phase 3 — durable orchestration queue (additive, leads-safe).
--
-- Replaces the fire-and-forget refresh_all (8 pipelines sequentially in one 300s
-- function → times out mid-run). The daily cron now enqueues one job per
-- (location, pipeline); a cron-driven worker claims and runs them with retries and
-- honest pipeline_runs outcomes. No single invocation must finish everything.

create table if not exists signal_jobs (
  id              uuid        primary key default gen_random_uuid(),
  run_id          uuid        not null,                 -- groups one daily orchestration pass
  organization_id uuid        not null references organizations(id) on delete cascade,
  location_id     uuid        not null references locations(id) on delete cascade,
  pipeline        text        not null,                 -- content | visibility | events | photos | busy_times | weather | social | insights
  status          text        not null default 'queued'
                    check (status in ('queued','running','done','failed')),
  attempts        int         not null default 0,
  max_attempts    int         not null default 3,
  cursor          jsonb,                                -- resumable progress (e.g. social: remaining profile ids)
  scheduled_for   timestamptz not null default now(),   -- retry backoff gate
  claimed_at      timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_signal_jobs_claim on signal_jobs(status, scheduled_for) where status = 'queued';
create index if not exists idx_signal_jobs_run   on signal_jobs(run_id);
create index if not exists idx_signal_jobs_loc   on signal_jobs(location_id, created_at desc);

alter table signal_jobs enable row level security;

drop policy if exists "org members can read signal_jobs" on signal_jobs;
create policy "org members can read signal_jobs"
on signal_jobs for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = signal_jobs.location_id and m.user_id = auth.uid()
  )
);
-- Writes are service_role only (the worker), bypassing RLS.

-- Concurrency-safe claim: atomically flip up to `batch` due queued jobs to running and
-- return them. FOR UPDATE SKIP LOCKED lets multiple worker invocations run without
-- double-claiming. Security definer so the service_role worker can call it via rpc.
create or replace function claim_signal_jobs(batch int)
returns setof signal_jobs
language sql
security definer
as $$
  update signal_jobs j
     set status = 'running', claimed_at = now(), attempts = attempts + 1, updated_at = now()
   where j.id in (
     select id from signal_jobs
      where status = 'queued' and scheduled_for <= now()
      order by created_at
      limit greatest(batch, 0)
      for update skip locked
   )
  returning j.*;
$$;
