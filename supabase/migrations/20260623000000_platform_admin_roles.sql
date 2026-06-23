-- Platform-admin roles / capabilities (admin-rebuild Phase 6a).
--   'super_admin' = full access (Bryan + Chris). Hard-delete of Customer orgs/users,
--                   billing conversion, manage-admins, reclassify->Customer.
--   'admin'       = day-to-day: view/edit, trial extend, magic-link/resend, impersonate,
--                   create+clear demo/test, deactivate. NOT the super-only actions above.
--   'read_only'   = view + export only.
--
-- Capability->role matrix lives in lib/auth/capabilities.ts; this column is the source
-- of truth the gate reads. See docs/admin-rebuild/phase-6-handoff.md (6a).
--
-- SAFETY: default 'super_admin' so EVERY existing admin row (Bryan + Chris) backfills to
-- full access on add — a partial/old row can never silently lose access. New invites are
-- assigned a role explicitly by the app (invitePlatformAdmin defaults them to 'admin').
-- The app's role read is also graceful (a missing/unknown role resolves to 'super_admin'),
-- so deploy order vs. this migration cannot lock anyone out.

alter table public.platform_admins
  add column if not exists role text not null default 'super_admin';

alter table public.platform_admins
  drop constraint if exists platform_admins_role_check;
alter table public.platform_admins
  add constraint platform_admins_role_check
  check (role in ('super_admin', 'admin', 'read_only'));

-- Backfill is covered by the column default, but assert it explicitly for any row that
-- somehow predates the default (idempotent, safe to re-run).
update public.platform_admins
  set role = 'super_admin'
  where role is null;

comment on column public.platform_admins.role is
  'super_admin|admin|read_only. Source of truth for the capability gate (lib/auth/capabilities.ts). Existing admins backfilled to super_admin; new invites default to admin.';
