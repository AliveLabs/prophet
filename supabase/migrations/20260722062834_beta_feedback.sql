-- ALT-371: in-app beta feedback.
-- Beta users get a "Share feedback" affordance in the left-nav footer so they can flag
-- "this was good, but…" feedback in context, without keeping a list or writing an email.
-- Each submission is captured here (source of truth, queryable for the beta-learning loop)
-- and also emailed to ops best-effort by the server action.
--
-- Immutable from the client: only an INSERT (as yourself, in an org you belong to) and a
-- SELECT (your org's feedback) are exposed. No update/delete policies — feedback is a record,
-- not editable content; ops reads/curates via the service-role client. Follows the
-- play_actions RLS shape (locations/org_members -> auth.uid()).

create table if not exists beta_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- The location the operator was viewing when they sent it (context), if any.
  location_id uuid references locations(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Optional quick tag; validated server-side to a known set, else stored null. No DB check so
  -- new tags never break a write (same forward-compatible stance as dismiss-reason codes).
  category text,
  message text not null,
  -- The route the operator was on when they opened the form — in-context signal, captured
  -- automatically so they don't have to describe where they were.
  page_path text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists beta_feedback_org_created_idx
  on beta_feedback (organization_id, created_at desc);

alter table beta_feedback enable row level security;

-- Insert: an authenticated org member, writing a row attributed to themselves.
create policy beta_feedback_insert on beta_feedback
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from organization_members m
      where m.organization_id = beta_feedback.organization_id
        and m.user_id = auth.uid()
    )
  );

-- Select: org members may read their own org's feedback (harmless; ops reads via service role).
create policy beta_feedback_select on beta_feedback
  for select to authenticated
  using (
    exists (
      select 1 from organization_members m
      where m.organization_id = beta_feedback.organization_id
        and m.user_id = auth.uid()
    )
  );
