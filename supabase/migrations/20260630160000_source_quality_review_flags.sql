-- ALT-246 — upgrade the read-only Source Quality review queue (ALT-172) into a triageable
-- workqueue: an admin can mark a flag "reviewed/resolved" (and undo it), with audit fields
-- for who and when.
--
-- Two flag sources, two tables:
--   • play_actions where reason='looks_wrong' (the brief "this looks wrong" dismissal)
--   • insights where status='inaccurate'
-- Both get the SAME three columns so the admin mutation + UI treat them uniformly:
--   reviewed_status  text, CHECK IN ('open','resolved'), NOT NULL DEFAULT 'open'
--   reviewed_by      uuid, nullable, references auth.users (the admin who last changed it)
--   reviewed_at      timestamptz, nullable (when it was last changed)
-- Existing rows default to open/null/null — nothing is retroactively "resolved".
--
-- HARD CONSTRAINT (unchanged from ALT-172, restated here since this migration is the surface
-- most likely to tempt a future shortcut): these columns are TRIAGE STATE ONLY. They must
-- NEVER be read by lib/skills/feedback-rollup.ts and must NEVER feed the band/ranking weights
-- in lib/skills/feedback-signals.ts. Resolving a flag says "a human looked at the source data";
-- it is not a verdict on the play/insight and carries zero model-learning weight. Enforced by
-- tests/unit/skills/source-quality.test.ts (import-isolation + no-write guard on the existing
-- read-only surface) and tests/unit/skills/source-quality-review.test.ts (pure transition policy).
--
-- Additive + nullable/defaulted ⇒ FAIL-SOFT: existing rows are unaffected, and the read path
-- degrades to an empty/pre-migration queue (unchanged from ALT-172) if this hasn't run yet.
-- RLS is inherited from each table's existing policies — these are plain admin-facing columns,
-- not queried by RLS predicates, and are only ever written via the platform-admin service-role
-- client (createAdminSupabaseClient), same as every other admin mutation in app/actions/*.

alter table play_actions
  add column if not exists reviewed_status text not null default 'open',
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'play_actions_reviewed_status_check'
  ) then
    alter table play_actions
      add constraint play_actions_reviewed_status_check
      check (reviewed_status in ('open', 'resolved'));
  end if;
end $$;

comment on column play_actions.reviewed_status is
  'ALT-246 triage state for a source-quality flag (reason=looks_wrong rows only, in practice) — open|resolved. Data-quality audit trail ONLY: never read by lib/skills/feedback-rollup.ts, never feeds the band weights in lib/skills/feedback-signals.ts.';
comment on column play_actions.reviewed_by is
  'ALT-246 — auth.users.id of the platform admin who last set reviewed_status. NULL until first triaged.';
comment on column play_actions.reviewed_at is
  'ALT-246 — when reviewed_status was last changed. NULL until first triaged.';

-- Filter by (reviewed_status) then order by recency (updated_at is when the looks_wrong
-- dismissal itself landed — the same column the ALT-172 read path already windows/orders by).
create index if not exists idx_play_actions_reviewed_status_updated_at
  on play_actions (reviewed_status, updated_at desc);

alter table insights
  add column if not exists reviewed_status text not null default 'open',
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'insights_reviewed_status_check'
  ) then
    alter table insights
      add constraint insights_reviewed_status_check
      check (reviewed_status in ('open', 'resolved'));
  end if;
end $$;

comment on column insights.reviewed_status is
  'ALT-246 triage state for a source-quality flag (status=inaccurate rows only, in practice) — open|resolved. Data-quality audit trail ONLY: never read by lib/skills/feedback-rollup.ts, never feeds the band weights in lib/skills/feedback-signals.ts.';
comment on column insights.reviewed_by is
  'ALT-246 — auth.users.id of the platform admin who last set reviewed_status. NULL until first triaged.';
comment on column insights.reviewed_at is
  'ALT-246 — when reviewed_status was last changed. NULL until first triaged.';

-- insights has no updated_at column; feedback_at is the equivalent "when this flag state last
-- changed" timestamp the ALT-172 read path already windows/orders by (falling back to
-- created_at when null) — mirror that here for the triage-queue filter/sort.
create index if not exists idx_insights_reviewed_status_feedback_at
  on insights (reviewed_status, feedback_at desc);
