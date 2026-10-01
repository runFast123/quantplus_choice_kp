-- =====================================================================
-- 5.15 App support (not in the original spec; additive only).
--      Read models and narrow RPCs the web app needs, plus the §8
--      retention jobs. Nothing here widens access to user data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Latest quote per symbol from daily candles. security_invoker = true so
-- the caller's RLS on market_candles / rsi_events / trading_signals
-- applies (authenticated: read; anon: nothing).
-- ---------------------------------------------------------------------
create or replace view public.market_snapshot
with (security_invoker = true) as
select s.symbol,
       s.exchange,
       s.name,
       s.sector,
       last.ts                        as as_of,
       last.close                     as last_price,
       prev.close                     as prev_close,
       last.close - prev.close        as change,
       case when prev.close > 0
            then round((last.close - prev.close) / prev.close * 100, 2) end as change_pct,
       last.volume,
       yr.high_52w,
       yr.low_52w,
       rsi.rsi                        as rsi,
       sig.signal_type                as last_signal,
       sig.strategy                   as last_signal_strategy,
       sig.generated_at               as last_signal_at
from public.market_symbols s
left join lateral (
  select c.ts, c.close, c.volume
  from public.market_candles c
  where c.symbol = s.symbol and c.exchange = s.exchange and c.interval = '1d'
  order by c.ts desc limit 1
) last on true
left join lateral (
  select c.close
  from public.market_candles c
  where c.symbol = s.symbol and c.exchange = s.exchange and c.interval = '1d'
    and c.ts < last.ts
  order by c.ts desc limit 1
) prev on true
left join lateral (
  select max(c.high) as high_52w, min(c.low) as low_52w
  from public.market_candles c
  where c.symbol = s.symbol and c.exchange = s.exchange and c.interval = '1d'
    and c.ts > last.ts - interval '365 days'
) yr on true
left join lateral (
  select r.rsi from public.rsi_events r
  where r.symbol = s.symbol and r.exchange = s.exchange
  order by r.ts desc limit 1
) rsi on true
left join lateral (
  select t.signal_type, t.strategy, t.generated_at from public.trading_signals t
  where t.symbol = s.symbol and t.exchange = s.exchange
  order by t.generated_at desc limit 1
) sig on true
where s.is_active;

revoke all on public.market_snapshot from anon, public;
grant select on public.market_snapshot to authenticated;

-- ---------------------------------------------------------------------
-- my_entitlements(): one round-trip for the app shell — current plan,
-- features, limits and how many symbol slots are used. Scoped to the
-- caller in their active tenant; returns nothing if not a live member.
-- ---------------------------------------------------------------------
create or replace function public.my_entitlements()
returns table (
  tenant_id              uuid,
  plan_code              public.plan_code,
  plan_name              text,
  status                 public.subscription_status,
  source                 text,
  current_period_end     timestamptz,
  features               jsonb,
  max_watchlist_symbols  integer,
  max_portfolio_symbols  integer,
  watchlist_symbols_used integer,
  portfolio_symbols_used integer
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_user   uuid := (select auth.uid());
  v_tenant uuid := private.active_tenant_id();
begin
  if v_user is null or v_tenant is null or not private.is_tenant_member(v_tenant) then
    return;
  end if;

  return query
  select v_tenant,
         s.plan_code,
         p.name,
         s.status,
         s.source,
         s.current_period_end,
         -- Features only count while the plan is live; expired = no features.
         case when s.status in ('trialing', 'active') and s.current_period_end > now()
              then p.features else '{}'::jsonb end,
         p.max_watchlist_symbols,
         p.max_portfolio_symbols,
         (select count(distinct (w.symbol, w.exchange))::integer from public.watchlist_items w
           where w.user_id = v_user and w.tenant_id = v_tenant),
         (select count(distinct (h.symbol, h.exchange))::integer from public.holdings h
           where h.user_id = v_user and h.tenant_id = v_tenant)
  from public.subscriptions s
  join public.plans p on p.code = s.plan_code
  where s.user_id = v_user and s.tenant_id = v_tenant
  order by s.current_period_end desc
  limit 1;
end $$;

revoke execute on function public.my_entitlements() from public, anon;
grant  execute on function public.my_entitlements() to authenticated;

-- ---------------------------------------------------------------------
-- track_event(): lets the client record feature usage without a
-- service-role hop. Only an event_type (no symbols/free text, per §5.6),
-- only for the caller, only in a tenant they are a live member of.
-- ---------------------------------------------------------------------
create or replace function public.track_event(p_event_type text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user   uuid := (select auth.uid());
  v_tenant uuid := private.active_tenant_id();
begin
  if v_user is null or v_tenant is null or not private.is_tenant_member(v_tenant) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_event_type !~ '^[a-z_]{3,48}$' then
    raise exception 'INVALID_EVENT_TYPE' using errcode = '22023';
  end if;
  insert into public.activity_events (tenant_id, user_id, event_type)
  values (v_tenant, v_user, p_event_type);
end $$;

revoke execute on function public.track_event(text) from public, anon;
grant  execute on function public.track_event(text) to authenticated;

-- ---------------------------------------------------------------------
-- Realtime: in-app notifications and alert state changes. RLS still
-- filters what each subscriber receives.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
    alter publication supabase_realtime add table public.price_alerts;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- §8 Retention
-- ---------------------------------------------------------------------
select cron.schedule('retention-notifications', '15 2 * * *',
  $$ delete from public.notifications where created_at < now() - interval '90 days' $$);
select cron.schedule('retention-activity-events', '20 2 * * *',
  $$ delete from public.activity_events where created_at < now() - interval '12 months' $$);
select cron.schedule('retention-ai-usage', '25 2 * * *',
  $$ delete from public.ai_usage_logs where created_at < now() - interval '12 months' $$);
select cron.schedule('retention-expired-invitations', '30 2 * * *',
  $$ delete from public.tenant_invitations
      where accepted_at is null and expires_at < now() - interval '30 days' $$);
