-- ---------------------------------------------------------------------------
-- Search Intelligence: schema changes for SEO visibility tracking
-- ---------------------------------------------------------------------------

-- 1. Add website column to locations for SEO domain queries
alter table locations add column if not exists website text;

-- 2. Add snapshot_type to snapshots table
alter table snapshots add column if not exists snapshot_type text not null default 'listing_daily';

-- Drop old unique constraint and add new one including snapshot_type
alter table snapshots drop constraint if exists snapshots_competitor_id_date_key_key;
alter table snapshots add constraint snapshots_competitor_date_type_key unique (competitor_id, date_key, snapshot_type);

-- Additional index for snapshot queries by type
create index if not exists idx_snapshots_date_type on snapshots(date_key, snapshot_type);

-- 3. Create tracked_keywords table
create table if not exists tracked_keywords (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  keyword text not null,
  source text not null default 'auto' check (source in ('auto','manual')),
  is_active boolean not null default true,
  tags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, keyword)
);

create index if not exists idx_tracked_keywords_location on tracked_keywords(location_id);

-- 4. RLS for tracked_keywords
alter table tracked_keywords enable row level security;

create policy "org members can read tracked keywords"
on tracked_keywords for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = tracked_keywords.location_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert tracked keywords"
on tracked_keywords for insert
with check (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = tracked_keywords.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can update tracked keywords"
on tracked_keywords for update
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = tracked_keywords.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can delete tracked keywords"
on tracked_keywords for delete
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = tracked_keywords.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);
