-- Source: quantspulse_supabase_schema.md §5.11 Admin and Tenant Functions (RPC)
-- =====================================================================
-- 5.11 Atomic plan activation, member directory, feature usage, export
-- =====================================================================

-- Replaces POST /api/admin/users/{id}/activate-plan's multi-write logic with
-- ONE transaction. Callable only by service_role; the Node backend passes
-- p_actor from the verified JWT, and the function re-checks admin status.
create or replace function public.admin_activate_plan(
  p_actor        uuid,
  p_user         uuid,
  p_tenant       uuid,
  p_plan         public.plan_code,
  p_months       integer,
  p_amount_paise bigint,
  p_method       text,
  p_reference    text default null
) returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  v_sub public.subscriptions;
begin
  if not exists (select 1 from private.platform_admins a where a.user_id = p_actor) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenant_members m
                 where m.tenant_id = p_tenant and m.user_id = p_user) then
    raise exception 'USER_NOT_IN_TENANT';
  end if;
  if p_months not between 1 and 24 or p_amount_paise < 0 then
    raise exception 'INVALID_INPUT';
  end if;

  select * into v_sub
  from public.subscriptions s
  where s.user_id = p_user and s.tenant_id = p_tenant
    and s.status in ('trialing', 'active', 'past_due')
  for update;

  if found and v_sub.plan_code = p_plan and v_sub.status = 'active' then
    -- Same plan renewal: extend from the later of current end or now
    update public.subscriptions s
       set current_period_end = greatest(s.current_period_end, now()) + make_interval(months => p_months),
           source = 'manual'
     where s.id = v_sub.id
     returning * into v_sub;
  elsif found then
    -- Plan change or trial conversion: new period starts now
    update public.subscriptions s
       set plan_code = p_plan, status = 'active', source = 'manual',
           current_period_start = now(),
           current_period_end   = now() + make_interval(months => p_months)
     where s.id = v_sub.id
     returning * into v_sub;
  else
    insert into public.subscriptions
      (tenant_id, user_id, plan_code, status, source, current_period_start, current_period_end)
    values
      (p_tenant, p_user, p_plan, 'active', 'manual', now(), now() + make_interval(months => p_months))
    returning * into v_sub;
  end if;

  insert into public.payments
    (tenant_id, user_id, subscription_id, amount_paise, method, status, external_reference, recorded_by)
  values
    (p_tenant, p_user, v_sub.id, p_amount_paise, p_method, 'captured', p_reference, p_actor);

  insert into public.audit_log (tenant_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_tenant, p_actor, 'plan.activated', 'user', p_user::text,
          jsonb_build_object('plan', p_plan, 'months', p_months,
                             'amount_paise', p_amount_paise, 'method', p_method));
  return v_sub;
end $$;

revoke execute on function public.admin_activate_plan from public, anon, authenticated;
grant  execute on function public.admin_activate_plan to service_role;

-- Member directory for tenant owners/admins (and platform admins).
-- Returns a fixed whitelist of columns — never holdings or secrets.
create or replace function public.tenant_member_directory(p_tenant uuid)
returns table (
  user_id          uuid,
  email            text,
  full_name        text,
  phone            text,
  role             public.tenant_role,
  plan             public.plan_code,
  plan_status      public.subscription_status,
  plan_expires_at  timestamptz,
  total_paid_paise bigint,
  last_sign_in_at  timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (private.has_tenant_role(p_tenant, '{owner,admin}') or private.is_platform_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  select m.user_id,
         u.email::text,
         p.full_name,
         p.phone,
         m.role,
         ls.plan_code,
         ls.status,
         ls.current_period_end,
         coalesce((select sum(pay.amount_paise)
                     from public.payments pay
                    where pay.user_id = m.user_id
                      and pay.tenant_id = p_tenant
                      and pay.status = 'captured'), 0)::bigint,
         u.last_sign_in_at
  from public.tenant_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  left join lateral (
    select s2.plan_code, s2.status, s2.current_period_end
    from public.subscriptions s2
    where s2.user_id = m.user_id and s2.tenant_id = p_tenant
    order by s2.current_period_end desc
    limit 1
  ) ls on true
  where m.tenant_id = p_tenant;
end $$;

revoke execute on function public.tenant_member_directory(uuid) from public, anon;
grant  execute on function public.tenant_member_directory(uuid) to authenticated;

-- "User-wise feature usage" for admins: counts only, no symbols or content.
create or replace function public.tenant_feature_usage(
  p_tenant uuid, p_from timestamptz, p_to timestamptz
)
returns table (user_id uuid, event_type text, events bigint, last_used_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (private.has_tenant_role(p_tenant, '{owner,admin}') or private.is_platform_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  select e.user_id, e.event_type, count(*), max(e.created_at)
  from public.activity_events e
  where e.tenant_id = p_tenant
    and e.created_at >= p_from
    and e.created_at <  p_to
  group by e.user_id, e.event_type
  order by 3 desc;
end $$;

revoke execute on function public.tenant_feature_usage(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.tenant_feature_usage(uuid, timestamptz, timestamptz) to authenticated;

-- Data-access right: user exports their own data. SECURITY INVOKER, so RLS
-- scopes every sub-select to the caller's own rows in the active tenant.
create or replace function public.export_my_data() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'exported_at',        now(),
    'profile',            (select to_jsonb(p) from public.profiles p),
    'consents',           (select coalesce(jsonb_agg(c), '[]'::jsonb) from public.user_consents c),
    'portfolios',         (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.portfolios x),
    'holdings',           (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.holdings x),
    'watchlists',         (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.watchlists x),
    'watchlist_items',    (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.watchlist_items x),
    'price_alerts',       (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.price_alerts x),
    'subscriptions',      (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.subscriptions x),
    'payments',           (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.payments x),
    'broker_connections', (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.broker_connections x),
    'ai_provider_keys',   (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.ai_provider_keys x)
  )
$$;

revoke execute on function public.export_my_data() from public, anon;
grant  execute on function public.export_my_data() to authenticated;
