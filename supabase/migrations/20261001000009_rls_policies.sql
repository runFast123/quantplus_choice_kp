-- Source: quantspulse_supabase_schema.md §5.9 Row Level Security Policies
-- =====================================================================
-- 5.9 RLS
-- =====================================================================

-- ---------- Tenancy ----------
alter table public.tenants enable row level security;
create policy tenants_select_member on public.tenants
  for select to authenticated
  using (private.is_tenant_member(id));
create policy tenants_update_owner on public.tenants
  for update to authenticated
  using (private.has_tenant_role(id, '{owner}'))
  with check (private.has_tenant_role(id, '{owner}'));
-- Owners may rename only; status/type are platform-controlled.
revoke update on public.tenants from authenticated;
grant update (name, slug) on public.tenants to authenticated;

alter table public.tenant_members enable row level security;
-- Regular members see only their own membership; admins see the roster.
create policy members_select on public.tenant_members
  for select to authenticated
  using (user_id = (select auth.uid())
         or private.has_tenant_role(tenant_id, '{owner,admin}'));
create policy members_remove_by_admin on public.tenant_members
  for delete to authenticated
  using (private.has_tenant_role(tenant_id, '{owner,admin}') and role <> 'owner');
create policy members_leave on public.tenant_members
  for delete to authenticated
  using (user_id = (select auth.uid()) and role <> 'owner');
-- Inserts and role changes go through the backend (service role) so the
-- escalation rules (who may grant admin, last-owner protection) live in one place.
revoke insert, update on public.tenant_members from authenticated;

alter table public.tenant_invitations enable row level security;
create policy invitations_admin_select on public.tenant_invitations
  for select to authenticated
  using (private.has_tenant_role(tenant_id, '{owner,admin}'));
create policy invitations_admin_delete on public.tenant_invitations
  for delete to authenticated
  using (private.has_tenant_role(tenant_id, '{owner,admin}'));
revoke insert, update on public.tenant_invitations from authenticated;

-- ---------- Profiles (user-level, not tenant-scoped) ----------
alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- Column-level: default_tenant_id is changed only via the backend switch endpoint.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

alter table public.user_devices enable row level security;
create policy devices_select_own on public.user_devices
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.user_devices from authenticated;

alter table public.user_consents enable row level security;
create policy consents_select_own on public.user_consents
  for select to authenticated using (user_id = (select auth.uid()));
create policy consents_insert_own on public.user_consents
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy consents_withdraw_own on public.user_consents
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.user_consents from authenticated;
grant update (withdrawn_at) on public.user_consents to authenticated;

-- ---------- Plan catalog (public pricing page can read it) ----------
alter table public.plans enable row level security;
grant select on public.plans to anon;
create policy plans_read on public.plans
  for select to anon, authenticated using (is_active);
revoke insert, update, delete on public.plans from authenticated;

-- ---------- User data with full CRUD + plan feature gate on insert ----------
do $$
declare
  r   record;
  own text := '(user_id = (select auth.uid())'
           || ' and tenant_id = (select private.active_tenant_id())'
           || ' and (select private.is_tenant_member(private.active_tenant_id())))';
begin
  for r in
    select key as tbl, value as feature
    from jsonb_each_text('{
      "portfolios":      "portfolio",
      "holdings":        "portfolio",
      "watchlists":      "watchlist",
      "watchlist_items": "watchlist",
      "price_alerts":    "alerts"
    }'::jsonb)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using %s',
                   r.tbl || '_select_own', r.tbl, own);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s and (select private.plan_has_feature(%L)))',
                   r.tbl || '_insert_own', r.tbl, own, r.feature);
    execute format('create policy %I on public.%I for update to authenticated using %s with check %s',
                   r.tbl || '_update_own', r.tbl, own, own);
    execute format('create policy %I on public.%I for delete to authenticated using %s',
                   r.tbl || '_delete_own', r.tbl, own);
  end loop;
end $$;

-- ---------- User data the client may only read (writes = backend) ----------
do $$
declare
  t   text;
  own text := '(user_id = (select auth.uid())'
           || ' and tenant_id = (select private.active_tenant_id())'
           || ' and (select private.is_tenant_member(private.active_tenant_id())))';
begin
  foreach t in array array['subscriptions', 'payments', 'notifications', 'broker_connections',
                           'ai_provider_keys', 'ai_usage_logs', 'contract_note_imports',
                           'activity_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using %s',
                   t || '_select_own', t, own);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;

  -- Users may disconnect a broker, delete an AI key, or clear notifications
  foreach t in array array['notifications', 'broker_connections', 'ai_provider_keys'] loop
    execute format('grant delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for delete to authenticated using %s',
                   t || '_delete_own', t, own);
  end loop;

  -- Mark notifications read
  execute 'grant update (read_at) on public.notifications to authenticated';
  execute format('create policy notifications_mark_read on public.notifications for update to authenticated using %s with check %s', own, own);
end $$;

-- ---------- Audit log ----------
alter table public.audit_log enable row level security;
create policy audit_log_tenant_admin_read on public.audit_log
  for select to authenticated
  using (private.has_tenant_role(tenant_id, '{owner,admin}'));
revoke insert, update, delete on public.audit_log from authenticated;

-- ---------- Shared market data: read-only for every signed-in user ----------
do $$
declare t text;
begin
  foreach t in array array['market_symbols', 'market_candles', 'backtest_ledgers',
                           'trading_signals', 'rsi_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
                   t || '_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;
-- Partitions are queried via the parent; block direct access to children.
alter table public.market_candles_default enable row level security;

-- ---------- Private schema: RLS on, no policies (service role only) ----------
alter table private.platform_admins    enable row level security;
alter table private.broker_credentials enable row level security;
alter table private.ai_key_secrets     enable row level security;
revoke all on all tables in schema private from anon, authenticated;
