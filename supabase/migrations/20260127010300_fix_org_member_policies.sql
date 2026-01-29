-- Avoid recursive RLS by using SECURITY DEFINER helpers.
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  );
$$;

drop policy if exists "org members can read membership" on organization_members;
drop policy if exists "org owners/admins can manage membership" on organization_members;
drop policy if exists "org owners/admins can update membership" on organization_members;
drop policy if exists "org owners/admins can delete membership" on organization_members;

create policy "org members can read membership"
on organization_members for select
using (
  user_id = auth.uid()
  or public.is_org_admin(organization_members.organization_id)
);

create policy "org owners/admins can manage membership"
on organization_members for insert
with check (
  public.is_org_admin(organization_members.organization_id)
  or (
    user_id = auth.uid()
    and role = 'owner'
    and (
      select count(*)
      from organization_members m
      where m.organization_id = organization_members.organization_id
    ) = 0
  )
);

create policy "org owners/admins can update membership"
on organization_members for update
using (
  public.is_org_admin(organization_members.organization_id)
);

create policy "org owners/admins can delete membership"
on organization_members for delete
using (
  public.is_org_admin(organization_members.organization_id)
);
