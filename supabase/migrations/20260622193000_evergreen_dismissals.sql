-- Evergreen P7a — cross-day dismissal cooldown.
--
-- play_actions dismissals are keyed by (location_id, date_key, play_key), so a dismissal does NOT
-- carry to the next day's regenerated brief — the same play reappears tomorrow. This table records a
-- durable, cross-day cooldown: a dismissed playKey is suppressed from brief REBUILDS until expires_at
-- (default now + 14d), after which it may resurface if it's still relevant. Latest dismissal wins.

create table if not exists evergreen_dismissals (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  play_key text not null,
  dismissed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, play_key)
);

create index if not exists idx_evergreen_dismissals_location_expires
  on evergreen_dismissals(location_id, expires_at desc);

alter table evergreen_dismissals enable row level security;

-- Org-member RLS (mirrors play_actions). The brief-build path uses the service role, which bypasses RLS.
create policy "org members can read evergreen_dismissals"
  on evergreen_dismissals for select
  using (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = evergreen_dismissals.location_id and m.user_id = auth.uid()
  ));

create policy "org members can insert evergreen_dismissals"
  on evergreen_dismissals for insert
  with check (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = evergreen_dismissals.location_id and m.user_id = auth.uid()
  ));

create policy "org members can update evergreen_dismissals"
  on evergreen_dismissals for update
  using (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = evergreen_dismissals.location_id and m.user_id = auth.uid()
  ));

create policy "org members can delete evergreen_dismissals"
  on evergreen_dismissals for delete
  using (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = evergreen_dismissals.location_id and m.user_id = auth.uid()
  ));
