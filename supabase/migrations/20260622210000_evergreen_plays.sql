-- Evergreen P7b — persisted "keep this" plays for relevance-based resurfacing.
--
-- When an operator SAVES a play, we persist it here. At brief-build time, a persisted play is
-- resurfaced into the candidate pool when its grounding signals re-fire today (relevance match) and
-- it isn't in dismissal cooldown or already produced — so good standing advice comes back when it
-- matters instead of being regenerated from scratch (or lost). One row per (location, play_key).

create table if not exists evergreen_plays (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  play_key text not null,
  play jsonb not null,                     -- the full EnrichedRecommendation, persisted as saved
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, play_key)
);

create index if not exists idx_evergreen_plays_location_saved
  on evergreen_plays(location_id, saved_at desc);

alter table evergreen_plays enable row level security;

-- Org-member RLS (mirrors play_actions / evergreen_dismissals). The brief-build path uses the
-- service role, which bypasses RLS.
create policy "org members can read evergreen_plays"
  on evergreen_plays for select
  using (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = evergreen_plays.location_id and m.user_id = auth.uid()
  ));

create policy "org members can insert evergreen_plays"
  on evergreen_plays for insert
  with check (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = evergreen_plays.location_id and m.user_id = auth.uid()
  ));

create policy "org members can update evergreen_plays"
  on evergreen_plays for update
  using (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = evergreen_plays.location_id and m.user_id = auth.uid()
  ));

create policy "org members can delete evergreen_plays"
  on evergreen_plays for delete
  using (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = evergreen_plays.location_id and m.user_id = auth.uid()
  ));
