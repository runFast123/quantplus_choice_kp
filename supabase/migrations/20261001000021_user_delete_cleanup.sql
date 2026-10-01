-- =====================================================================
-- 5.21 Deleting a user deletes their personal workspace.
--      Spec §7 orders this in the backend, but users can also be deleted
--      from the Supabase dashboard or the Auth admin API, which used to
--      leave orphaned personal tenants (and their tenant-scoped rows).
--      Organisation tenants are untouched.
-- =====================================================================
create or replace function private.handle_user_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.tenants t
  where t.type = 'personal'
    and exists (select 1 from public.tenant_members m
                where m.tenant_id = t.id and m.user_id = old.id and m.role = 'owner')
    and not exists (select 1 from public.tenant_members m
                    where m.tenant_id = t.id and m.user_id <> old.id);
  return old;
end $$;

create trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute function private.handle_user_deleted();

-- One-off: remove personal tenants already orphaned (no members left).
delete from public.tenants t
where t.type = 'personal'
  and not exists (select 1 from public.tenant_members m where m.tenant_id = t.id);
