-- Atomic org teardown (admin-rebuild Phase 6e). Ports the canonical multi-statement cascade
-- (lib/admin/cascade-cleanup.ts) into a SECURITY DEFINER plpgsql function so the whole teardown
-- runs in ONE transaction — all-or-nothing. Previously the TS version was idempotent but not
-- atomic (a mid-sequence failure could half-delete). Behavior is identical: the same explicit
-- polymorphic-social cleanup (no org FK) + the same DB FK ON DELETE CASCADE does the subtree.
--
--   p_keep_shell = false → FULL delete: drop polymorphic social, null the profiles RESTRICT
--                          pointer, delete the org row (cascades the whole subtree).
--   p_keep_shell = true  → CLEAR ALL DATA: drop polymorphic social, delete locations (cascades
--                          the location subtree) + the direct-org tables that don't hang off a
--                          location; keep the org row, members, billing, org_kind.
--
-- Returns the same shape lib/admin/cascade-cleanup.ts's CascadeDeleteResult expects.

create or replace function public.cascade_delete_organization(
  p_org_id uuid,
  p_keep_shell boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_name text;
  v_loc_ids uuid[];
  v_comp_ids uuid[];
  v_social int := 0;
  v_nulled int := 0;
  v_d int;
begin
  select name into v_org_name from organizations where id = p_org_id;

  select coalesce(array_agg(id), '{}') into v_loc_ids
    from locations where organization_id = p_org_id;

  select coalesce(array_agg(c.id), '{}') into v_comp_ids
    from competitors c where c.location_id = any(v_loc_ids);

  -- Polymorphic social_profiles have NO FK to org/location/competitor, so DB cascade never
  -- reaches them — delete explicitly (social_snapshots cascade via their FK to social_profiles).
  delete from social_profiles where entity_type = 'location' and entity_id = any(v_loc_ids);
  get diagnostics v_d = row_count; v_social := v_social + v_d;
  delete from social_profiles where entity_type = 'competitor' and entity_id = any(v_comp_ids);
  get diagnostics v_d = row_count; v_social := v_social + v_d;

  if p_keep_shell then
    delete from locations where organization_id = p_org_id; -- cascades the location subtree
    delete from refresh_jobs where organization_id = p_org_id;
    delete from signal_jobs where organization_id = p_org_id;
    delete from job_runs where organization_id = p_org_id;
    delete from insight_preferences where organization_id = p_org_id;
    delete from trial_reminder_sends where organization_id = p_org_id;
  else
    update profiles set current_organization_id = null where current_organization_id = p_org_id;
    get diagnostics v_nulled = row_count;
    delete from organizations where id = p_org_id; -- cascades the whole subtree
  end if;

  return jsonb_build_object(
    'orgId', p_org_id,
    'orgName', v_org_name,
    'keptShell', p_keep_shell,
    'locationsDeleted', coalesce(array_length(v_loc_ids, 1), 0),
    'competitorsDeleted', coalesce(array_length(v_comp_ids, 1), 0),
    'socialProfilesDeleted', v_social,
    'profilePointersNulled', v_nulled
  );
end;
$$;

-- Only the service role (the app) may invoke it; never anon/authenticated.
revoke all on function public.cascade_delete_organization(uuid, boolean) from public;
revoke all on function public.cascade_delete_organization(uuid, boolean) from anon;
revoke all on function public.cascade_delete_organization(uuid, boolean) from authenticated;
grant execute on function public.cascade_delete_organization(uuid, boolean) to service_role;
