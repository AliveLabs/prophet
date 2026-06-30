-- Own-listing photo intelligence (ALT-160)
-- ---------------------------------------------------------------------------
-- The photo pipeline has been competitor-only (competitor_photos, keyed on
-- competitor_id). This adds the OWN side: the photos on the operator's own
-- Google Business listing — owner-uploaded AND customer/review photos — so the
-- Listing Check + Shelf modules can grade the operator's own storefront and
-- compare it against the competitor set. Structure mirrors competitor_photos
-- exactly, keyed on location_id instead of competitor_id.

create table if not exists location_photos (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid,
  location_id uuid not null references locations(id) on delete cascade,
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

create index if not exists idx_location_photos_location on location_photos(location_id);
create index if not exists idx_location_photos_hash on location_photos(image_hash);
create index if not exists idx_location_photos_snapshot on location_photos(snapshot_id);

alter table location_photos enable row level security;

create policy "org members can read location photos"
on location_photos for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_photos.location_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert location photos"
on location_photos for insert
with check (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_photos.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can update location photos"
on location_photos for update
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_photos.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

create policy "org admins can delete location photos"
on location_photos for delete
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_photos.location_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- Storage bucket (public, mirrors competitor-photos)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('location-photos', 'location-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
