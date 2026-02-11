-- Local Events Intelligence tables

-- 1. location_snapshots: location-level snapshots (events are location-scoped, not competitor-scoped)
create table if not exists location_snapshots (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  provider text not null,
  date_key date not null,
  captured_at timestamptz not null,
  raw_data jsonb not null,
  diff_hash text not null,
  created_at timestamptz not null default now(),
  unique (location_id, provider, date_key)
);

create index if not exists idx_location_snapshots_loc_date
  on location_snapshots(location_id, date_key);

-- 2. event_matches: explainable mapping between events and competitors
create table if not exists event_matches (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  competitor_id uuid references competitors(id) on delete set null,
  date_key date not null,
  event_uid text not null,
  match_type text not null,
  confidence text not null check (confidence in ('high','medium','low')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (location_id, competitor_id, date_key, event_uid, match_type)
);

-- 3. Enable RLS
alter table location_snapshots enable row level security;
alter table event_matches enable row level security;

-- 4. RLS policies for location_snapshots

create policy "org members can read location_snapshots"
on location_snapshots for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_snapshots.location_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert location_snapshots"
on location_snapshots for insert
with check (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_snapshots.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can update location_snapshots"
on location_snapshots for update
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_snapshots.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can delete location_snapshots"
on location_snapshots for delete
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_snapshots.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- 5. RLS policies for event_matches

create policy "org members can read event_matches"
on event_matches for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = event_matches.location_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert event_matches"
on event_matches for insert
with check (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = event_matches.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can update event_matches"
on event_matches for update
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = event_matches.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can delete event_matches"
on event_matches for delete
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = event_matches.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);
