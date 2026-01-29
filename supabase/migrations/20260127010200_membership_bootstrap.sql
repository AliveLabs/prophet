-- Allow the first organization member to bootstrap ownership.
create policy "org creator can add first membership"
on organization_members for insert
with check (
  user_id = auth.uid()
  and role = 'owner'
  and (
    select count(*)
    from organization_members m
    where m.organization_id = organization_members.organization_id
  ) = 0
);
