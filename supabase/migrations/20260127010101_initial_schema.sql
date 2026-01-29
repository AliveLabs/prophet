-- Prophet initial schema and RLS policies
create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  subscription_tier text not null default 'free' check (subscription_tier in ('free','starter','pro','agency')),
  stripe_customer_id text,
  stripe_subscription_id text,
  billing_email text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  current_organization_id uuid references organizations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text default 'US',
  geo_lat double precision,
  geo_lng double precision,
  timezone text not null default 'America/New_York',
  primary_place_id text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_locations_org on locations(organization_id);

create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  provider text not null default 'dataforseo',
  provider_entity_id text not null,
  name text,
  category text,
  address text,
  phone text,
  website text,
  relevance_score numeric,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_entity_id, location_id)
);

create index if not exists idx_competitors_location on competitors(location_id);
create index if not exists idx_competitors_active on competitors(is_active);

create table if not exists snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  captured_at timestamptz not null,
  date_key date not null,
  provider text not null,
  raw_data jsonb not null,
  diff_hash text not null,
  created_at timestamptz not null default now(),
  unique (competitor_id, date_key)
);

create index if not exists idx_snapshots_competitor_date on snapshots(competitor_id, date_key);

create table if not exists insights (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  competitor_id uuid references competitors(id) on delete set null,
  date_key date not null,
  insight_type text not null,
  title text not null,
  summary text not null,
  confidence text not null check (confidence in ('high','medium','low')),
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  evidence jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new','read','dismissed')),
  created_at timestamptz not null default now(),
  unique (location_id, competitor_id, date_key, insight_type)
);

create index if not exists idx_insights_location_date on insights(location_id, date_key);

create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  attempt integer not null default 1,
  trace_id uuid,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_runs_org on job_runs(organization_id);

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table organization_members enable row level security;
alter table locations enable row level security;
alter table competitors enable row level security;
alter table snapshots enable row level security;
alter table insights enable row level security;
alter table job_runs enable row level security;

create policy "org members can read org"
on organizations for select
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = organizations.id and m.user_id = auth.uid()
  )
);

create policy "authenticated can create org"
on organizations for insert
with check (auth.uid() is not null);

create policy "org owners/admins can update org"
on organizations for update
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = organizations.id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "users can read own profile"
on profiles for select
using (id = auth.uid());

create policy "users can insert own profile"
on profiles for insert
with check (id = auth.uid());

create policy "users can update own profile"
on profiles for update
using (id = auth.uid());

create policy "org members can read membership"
on organization_members for select
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = organization_members.organization_id
      and m.user_id = auth.uid()
  )
);

create policy "org owners/admins can manage membership"
on organization_members for insert
with check (
  exists (
    select 1 from organization_members m
    where m.organization_id = organization_members.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org owners/admins can update membership"
on organization_members for update
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = organization_members.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org owners/admins can delete membership"
on organization_members for delete
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = organization_members.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org members can read locations"
on locations for select
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = locations.organization_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert locations"
on locations for insert
with check (
  exists (
    select 1 from organization_members m
    where m.organization_id = locations.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can update locations"
on locations for update
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = locations.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can delete locations"
on locations for delete
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = locations.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org members can read competitors"
on competitors for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = competitors.location_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert competitors"
on competitors for insert
with check (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = competitors.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can update competitors"
on competitors for update
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = competitors.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can delete competitors"
on competitors for delete
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = competitors.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org members can read snapshots"
on snapshots for select
using (
  exists (
    select 1 from competitors c
    join locations l on l.id = c.location_id
    join organization_members m on m.organization_id = l.organization_id
    where c.id = snapshots.competitor_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert snapshots"
on snapshots for insert
with check (
  exists (
    select 1 from competitors c
    join locations l on l.id = c.location_id
    join organization_members m on m.organization_id = l.organization_id
    where c.id = snapshots.competitor_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org members can read insights"
on insights for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = insights.location_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert insights"
on insights for insert
with check (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = insights.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org members can update insights"
on insights for update
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = insights.location_id and m.user_id = auth.uid()
  )
);

create policy "org members can read job runs"
on job_runs for select
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = job_runs.organization_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert job runs"
on job_runs for insert
with check (
  exists (
    select 1 from organization_members m
    where m.organization_id = job_runs.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);
