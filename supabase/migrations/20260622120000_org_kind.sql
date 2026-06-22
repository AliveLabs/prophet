-- org_kind: provenance/classification of an organization (admin-rebuild Phase 1).
--   'real'  = created via the normal signup/onboarding/waitlist-approve path (the default).
--             UI label: "Customer".
--   'demo'  = sales/marketing demo org, admin-created, long-dated trial.
--   'test'  = QA/dev throwaway org, admin-created, safe to bulk-clear.
--
-- Demo/test orgs are created ONLY from the admin panel. They MUST be excludable
-- from real product metrics / MRR / churn (analytics filter on org_kind = 'real')
-- and are the only orgs the clear-test tooling may delete (fail-closed on 'real').
-- See docs/admin-rebuild/ticket-admin-rebuild-plan.md and lib/admin/cascade-cleanup.ts.

alter table public.organizations
  add column if not exists org_kind text not null default 'real';

alter table public.organizations
  drop constraint if exists organizations_org_kind_check;
alter table public.organizations
  add constraint organizations_org_kind_check
  check (org_kind in ('real', 'demo', 'test'));

-- 'real' is the hot path (analytics/billing rollups filter it out); index only the rest.
create index if not exists organizations_org_kind_idx
  on public.organizations (org_kind) where org_kind <> 'real';

comment on column public.organizations.org_kind is
  'real|demo|test. real=Customer (normal signup, default). demo/test=admin-created, excluded from real metrics/billing, only orgs clear-test may delete.';

-- NOTE: tagging the two surviving internal orgs (Bush''s Chicken, Raising Cane''s)
-- as 'demo' is a separate, reviewed data statement — intentionally NOT bundled here.
-- Run when applying, or via the admin Manage UI once it ships:
--   update public.organizations set org_kind = 'demo'
--   where slug in ('bush-s-chicken', 'raising-cane-s-chicken-fingers');
