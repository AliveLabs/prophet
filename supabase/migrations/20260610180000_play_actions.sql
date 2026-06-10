-- Complete-picture · Batch 5: the acted-on loop. One row per (location, brief date,
-- play) holding the operator's latest action — saved / snoozed / dismissed. Read,
-- written, and undone (deleted) by org members; the brief renders cleared plays
-- compactly and counts the week's actions as momentum.

create table if not exists play_actions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  date_key date not null,
  play_key text not null,
  action text not null check (action in ('saved', 'snoozed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, date_key, play_key)
);

create index if not exists idx_play_actions_location_created on play_actions(location_id, created_at desc);

alter table play_actions enable row level security;

create policy "org members can read play_actions"
on play_actions for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = play_actions.location_id and m.user_id = auth.uid()
  )
);

create policy "org members can insert play_actions"
on play_actions for insert
with check (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = play_actions.location_id and m.user_id = auth.uid()
  )
);

create policy "org members can update play_actions"
on play_actions for update
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = play_actions.location_id and m.user_id = auth.uid()
  )
);

create policy "org members can delete play_actions"
on play_actions for delete
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = play_actions.location_id and m.user_id = auth.uid()
  )
);
