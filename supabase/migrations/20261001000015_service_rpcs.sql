-- =====================================================================
-- 5.16 Service-role RPCs (not in the original spec).
--      The `private` schema is deliberately NOT exposed through the API
--      (§5.1), so even the service role cannot reach it over PostgREST.
--      These narrow SECURITY DEFINER functions are the only bridge, and
--      only service_role may execute them — same pattern as
--      admin_activate_plan (§5.11). Ciphertext travels as base64 text;
--      encryption/decryption happens in Node (§4), never here.
-- =====================================================================

create or replace function public.svc_is_platform_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins a where a.user_id = p_user)
$$;

-- ---------- Broker credentials ----------
create or replace function public.svc_put_broker_credentials(
  p_connection uuid, p_ciphertext text, p_iv text, p_auth_tag text, p_key_version smallint
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into private.broker_credentials (connection_id, ciphertext, iv, auth_tag, key_version, updated_at)
  values (p_connection, decode(p_ciphertext, 'base64'), decode(p_iv, 'base64'),
          decode(p_auth_tag, 'base64'), p_key_version, now())
  on conflict (connection_id) do update
    set ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag,
        key_version = excluded.key_version, updated_at = now()
$$;

create or replace function public.svc_get_broker_credentials(p_connection uuid)
returns table (ciphertext text, iv text, auth_tag text, key_version smallint)
language sql stable security definer set search_path = '' as $$
  select encode(c.ciphertext, 'base64'), encode(c.iv, 'base64'), encode(c.auth_tag, 'base64'), c.key_version
  from private.broker_credentials c where c.connection_id = p_connection
$$;

-- ---------- BYOK AI key secrets ----------
create or replace function public.svc_put_ai_key_secret(
  p_key uuid, p_ciphertext text, p_iv text, p_auth_tag text, p_key_version smallint
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into private.ai_key_secrets (key_id, ciphertext, iv, auth_tag, key_version, updated_at)
  values (p_key, decode(p_ciphertext, 'base64'), decode(p_iv, 'base64'),
          decode(p_auth_tag, 'base64'), p_key_version, now())
  on conflict (key_id) do update
    set ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag,
        key_version = excluded.key_version, updated_at = now()
$$;

create or replace function public.svc_get_ai_key_secret(p_key uuid)
returns table (ciphertext text, iv text, auth_tag text, key_version smallint)
language sql stable security definer set search_path = '' as $$
  select encode(s.ciphertext, 'base64'), encode(s.iv, 'base64'), encode(s.auth_tag, 'base64'), s.key_version
  from private.ai_key_secrets s where s.key_id = p_key
$$;

-- ---------- Platform admin: user search (whitelisted columns only) ----------
create or replace function public.svc_admin_user_search(p_query text, p_limit integer default 25)
returns table (
  user_id         uuid,
  email           text,
  full_name       text,
  phone           text,
  tenant_id       uuid,
  tenant_name     text,
  tenant_type     public.tenant_type,
  plan            public.plan_code,
  plan_status     public.subscription_status,
  plan_expires_at timestamptz,
  created_at      timestamptz,
  last_sign_in_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, p.full_name, p.phone,
         t.id, t.name, t.type,
         ls.plan_code, ls.status, ls.current_period_end,
         u.created_at, u.last_sign_in_at
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  join public.tenant_members m on m.user_id = u.id
  join public.tenants t on t.id = m.tenant_id
  left join lateral (
    select s.plan_code, s.status, s.current_period_end
    from public.subscriptions s
    where s.user_id = u.id and s.tenant_id = t.id
    order by s.current_period_end desc limit 1
  ) ls on true
  where coalesce(p_query, '') = ''
     or u.email ilike '%' || p_query || '%'
     or p.full_name ilike '%' || p_query || '%'
     or p.phone like '%' || p_query || '%'
  order by u.created_at desc, t.type
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.svc_is_platform_admin(uuid)',
    'public.svc_put_broker_credentials(uuid, text, text, text, smallint)',
    'public.svc_get_broker_credentials(uuid)',
    'public.svc_put_ai_key_secret(uuid, text, text, text, smallint)',
    'public.svc_get_ai_key_secret(uuid)',
    'public.svc_admin_user_search(text, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
