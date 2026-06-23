-- Soft-delete for organizations (admin-rebuild Phase 6c).
-- deleteOrg now SOFT-deletes (sets deleted_at + hides the org everywhere) instead of an
-- irreversible cascade. A separate super_admin "purge" hard-removes soft-deleted rows via
-- the canonical cascade. Demo/test bulk-clear and the user sole-owner cascade still hard
-- delete (those are throwaway / already gated).

alter table public.organizations
  add column if not exists deleted_at timestamptz;

-- Partial index: the hot path is "live orgs" (deleted_at IS NULL), so index only the rare
-- soft-deleted rows for the purge/restore views.
create index if not exists organizations_deleted_at_idx
  on public.organizations (deleted_at) where deleted_at is not null;

comment on column public.organizations.deleted_at is
  'Soft-delete tombstone (Phase 6c). NOT NULL => hidden from all lists/counts/crons; a super_admin purge hard-removes it. NULL => live.';
