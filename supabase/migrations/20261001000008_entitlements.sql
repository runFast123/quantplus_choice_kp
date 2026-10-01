-- Source: quantspulse_supabase_schema.md §5.8 Entitlements and Plan Limits (enforced in the database)
-- =====================================================================
-- 5.8 Plan resolution, feature gates, symbol limits
-- =====================================================================
create or replace function private.effective_plan(p_user uuid, p_tenant uuid)
returns public.plan_code
language sql stable security definer set search_path = '' as $$
  select s.plan_code
  from public.subscriptions s
  where s.user_id = p_user
    and s.tenant_id = p_tenant
    and s.status in ('trialing', 'active')
    and s.current_period_end > now()
  order by s.current_period_end desc
  limit 1
$$;

-- Used inside RLS INSERT policies to gate features by plan
create or replace function private.plan_has_feature(p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (p.features ->> p_feature)::boolean
    from public.plans p
    where p.code = private.effective_plan((select auth.uid()), private.active_tenant_id())
  ), false)
$$;

-- Symbol-count limits per plan (watchlist and portfolio)
create or replace function private.enforce_symbol_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_plan  public.plan_code;
  v_limit integer;
  v_count integer;
begin
  -- Serialize concurrent inserts for this user+table so limits can't be raced
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || TG_TABLE_NAME, 0));

  v_plan := private.effective_plan(new.user_id, new.tenant_id);
  if v_plan is null then
    raise exception 'NO_ACTIVE_PLAN' using errcode = 'P0001';
  end if;

  -- [QP change] Limits count DISTINCT symbols. A symbol the user already tracks
  -- (another watchlist / portfolio, or an upsert of an existing row) does not
  -- consume a new slot, so it is always allowed.
  if TG_TABLE_NAME = 'watchlist_items' then
    if exists (select 1 from public.watchlist_items w
               where w.user_id = new.user_id and w.tenant_id = new.tenant_id
                 and w.symbol = new.symbol and w.exchange = new.exchange) then
      return new;
    end if;
    select p.max_watchlist_symbols into v_limit from public.plans p where p.code = v_plan;
    select count(distinct (w.symbol, w.exchange)) into v_count
      from public.watchlist_items w
      where w.user_id = new.user_id and w.tenant_id = new.tenant_id;
  else
    if exists (select 1 from public.holdings h
               where h.user_id = new.user_id and h.tenant_id = new.tenant_id
                 and h.symbol = new.symbol and h.exchange = new.exchange) then
      return new;
    end if;
    select p.max_portfolio_symbols into v_limit from public.plans p where p.code = v_plan;
    select count(distinct (h.symbol, h.exchange)) into v_count
      from public.holdings h
      where h.user_id = new.user_id and h.tenant_id = new.tenant_id;
  end if;

  if v_limit is not null and v_count >= v_limit then
    raise exception 'PLAN_LIMIT_REACHED: plan % allows % symbols', v_plan, v_limit
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger trg_watchlist_limit before insert on public.watchlist_items
  for each row execute function private.enforce_symbol_limit();
create trigger trg_holdings_limit before insert on public.holdings
  for each row execute function private.enforce_symbol_limit();

-- Mark expired subscriptions (cosmetic: effective_plan already checks the date)
-- Requires the pg_cron extension (enabled in 5.1).
select cron.schedule(
  'expire-subscriptions', '*/15 * * * *',
  $$ update public.subscriptions
       set status = 'expired', updated_at = now()
     where status in ('trialing', 'active') and current_period_end <= now() $$
);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['profiles', 'subscriptions', 'broker_connections', 'portfolios',
                           'holdings', 'price_alerts', 'ai_provider_keys'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      'trg_' || t || '_updated_at', t);
  end loop;
end $$;
