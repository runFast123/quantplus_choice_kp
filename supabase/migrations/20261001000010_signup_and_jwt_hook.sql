-- Source: quantspulse_supabase_schema.md §5.10 Signup Trigger and Custom Access Token Hook
-- =====================================================================
-- 5.10 New-user bootstrap + JWT tenant claim
-- =====================================================================
-- Every new user gets: personal tenant, owner membership, profile,
-- and the Basic plan free for 3 months.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  insert into public.tenants (name, type)
    values ('Personal workspace', 'personal')
    returning id into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, new.id, 'owner');

  insert into public.profiles (user_id, default_tenant_id)
    values (new.id, v_tenant);

  insert into public.subscriptions
    (tenant_id, user_id, plan_code, status, source, current_period_start, current_period_end)
  values
    (v_tenant, new.id, 'basic', 'trialing', 'trial', now(), now() + interval '3 months');

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Custom Access Token Hook: adds app_tenant_id / app_tenant_role claims.
-- Enable in Dashboard → Authentication → Hooks.
-- Claims are for routing/UI convenience; RLS still re-checks membership.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_user   uuid := (event ->> 'user_id')::uuid;
  v_tenant uuid;
  v_role   text;
  v_claims jsonb := event -> 'claims';
begin
  -- Prefer the user's chosen tenant; fall back to their oldest membership
  select m.tenant_id, m.role::text
    into v_tenant, v_role
  from public.tenant_members m
  left join public.profiles p on p.user_id = m.user_id
  where m.user_id = v_user
  order by (m.tenant_id = p.default_tenant_id) desc nulls last, m.created_at
  limit 1;

  if v_tenant is not null then
    v_claims := jsonb_set(v_claims, '{app_tenant_id}',   to_jsonb(v_tenant::text));
    v_claims := jsonb_set(v_claims, '{app_tenant_role}', to_jsonb(v_role));
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.profiles, public.tenant_members to supabase_auth_admin;
create policy auth_admin_read_profiles on public.profiles
  for select to supabase_auth_admin using (true);
create policy auth_admin_read_members on public.tenant_members
  for select to supabase_auth_admin using (true);
