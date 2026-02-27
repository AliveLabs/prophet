-- Visual Intelligence, Busy Times & Weather Signals

create table if not exists competitor_photos (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid,
  competitor_id uuid not null references competitors(id) on delete cascade,
  place_photo_name text not null,
  image_hash text not null,
  image_url text,
  width_px integer,
  height_px integer,
  author_attribution jsonb default '[]'::jsonb,
  analysis_result jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_competitor_photos_competitor on competitor_photos(competitor_id);
create index if not exists idx_competitor_photos_hash on competitor_photos(image_hash);
create index if not exists idx_competitor_photos_snapshot on competitor_photos(snapshot_id);

create table if not exists busy_times (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid,
  competitor_id uuid not null references competitors(id) on delete cascade,
  day_of_week integer not null check (day_of_week >= 0 and day_of_week <= 6),
  hourly_scores integer[] not null,
  peak_hour integer,
  peak_score integer,
  slow_hours integer[],
  typical_time_spent text,
  current_popularity integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_busy_times_competitor on busy_times(competitor_id);
create index if not exists idx_busy_times_snapshot on busy_times(snapshot_id);

create table if not exists location_weather (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  date date not null,
  temp_high_f decimal,
  temp_low_f decimal,
  feels_like_high_f decimal,
  humidity_avg integer,
  wind_speed_max_mph decimal,
  weather_condition text,
  weather_description text,
  weather_icon text,
  precipitation_in decimal default 0,
  is_severe boolean not null default false,
  created_at timestamptz not null default now(),
  unique (location_id, date)
);

create index if not exists idx_location_weather_location_date on location_weather(location_id, date);

alter table refresh_jobs drop constraint if exists refresh_jobs_job_type_check;
alter table refresh_jobs add constraint refresh_jobs_job_type_check
  check (job_type in ('content','visibility','events','insights','photos','busy_times','weather'));

alter table competitor_photos enable row level security;
alter table busy_times enable row level security;
alter table location_weather enable row level security;

create policy "org members can read competitor photos"
on competitor_photos for select
using (
  exists (
    select 1 from competitors c
    join locations l on l.id = c.location_id
    join organization_members m on m.organization_id = l.organization_id
    where c.id = competitor_photos.competitor_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert competitor photos"
on competitor_photos for insert
with check (
  exists (
    select 1 from competitors c
    join locations l on l.id = c.location_id
    join organization_members m on m.organization_id = l.organization_id
    where c.id = competitor_photos.competitor_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can update competitor photos"
on competitor_photos for update
using (
  exists (
    select 1 from competitors c
    join locations l on l.id = c.location_id
    join organization_members m on m.organization_id = l.organization_id
    where c.id = competitor_photos.competitor_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can delete competitor photos"
on competitor_photos for delete
using (
  exists (
    select 1 from competitors c
    join locations l on l.id = c.location_id
    join organization_members m on m.organization_id = l.organization_id
    where c.id = competitor_photos.competitor_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org members can read busy times"
on busy_times for select
using (
  exists (
    select 1 from competitors c
    join locations l on l.id = c.location_id
    join organization_members m on m.organization_id = l.organization_id
    where c.id = busy_times.competitor_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert busy times"
on busy_times for insert
with check (
  exists (
    select 1 from competitors c
    join locations l on l.id = c.location_id
    join organization_members m on m.organization_id = l.organization_id
    where c.id = busy_times.competitor_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can delete busy times"
on busy_times for delete
using (
  exists (
    select 1 from competitors c
    join locations l on l.id = c.location_id
    join organization_members m on m.organization_id = l.organization_id
    where c.id = busy_times.competitor_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org members can read location weather"
on location_weather for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_weather.location_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert location weather"
on location_weather for insert
with check (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_weather.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can delete location weather"
on location_weather for delete
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_weather.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- Storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('competitor-photos', 'competitor-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
