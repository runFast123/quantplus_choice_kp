-- =====================================================================
-- 5.22 Hardening from the code review (2026-10-01). Every fix here was
--      found by review + PGlite probes; tests in supabase/tests/04_hardening.sql.
-- =====================================================================

-- Safe numeric cast: a malformed payload must never abort a batch job.
create or replace function private.try_numeric(p text) returns numeric
language sql immutable set search_path = '' as $$
  select case when p ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then p::numeric end
$$;

-- Dedupe ledger for system notifications. Users may delete their
-- notifications; that must not make the system send them again.
create table if not exists private.notification_ledger (
  user_id   uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind      text not null,
  ref       text not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, tenant_id, kind, ref)
);
alter table private.notification_ledger enable row level security;
revoke all on private.notification_ledger from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Symbol limits could be bypassed by UPDATE-ing a row's symbol.
--    The app never changes a row's symbol: remove that ability.
-- ---------------------------------------------------------------------
revoke update on public.watchlist_items from authenticated;
revoke update on public.holdings from authenticated;
grant update (quantity, avg_price) on public.holdings to authenticated;

-- ---------------------------------------------------------------------
-- 6. Alerts: re-arming/editing requires the alerts feature (pausing is
--    always allowed).
-- ---------------------------------------------------------------------
drop policy if exists price_alerts_update_own on public.price_alerts;
create policy price_alerts_update_own on public.price_alerts
  for update to authenticated
  using (user_id = (select auth.uid())
         and tenant_id = (select private.active_tenant_id())
         and (select private.is_tenant_member(private.active_tenant_id())))
  with check (user_id = (select auth.uid())
              and tenant_id = (select private.active_tenant_id())
              and (select private.is_tenant_member(private.active_tenant_id()))
              and (status = 'disabled' or (select private.plan_has_feature('alerts'))));

-- ---------------------------------------------------------------------
-- Admins may remove members; only the owner may remove an admin
-- (same rule as role changes in server/privileged/tenants.ts).
-- ---------------------------------------------------------------------
drop policy if exists members_remove_by_admin on public.tenant_members;
create policy members_remove_by_admin on public.tenant_members
  for delete to authenticated
  using (private.has_tenant_role(tenant_id, '{owner,admin}')
         and role <> 'owner'
         and (role = 'member' or private.has_tenant_role(tenant_id, '{owner}')));

-- ---------------------------------------------------------------------
-- 9. Supabase grants ALL by default; TRUNCATE bypasses RLS and the
--    audit_log row trigger. Clients never need TRUNCATE/REFERENCES/TRIGGER.
-- ---------------------------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- ---------------------------------------------------------------------
-- Single active device: one transaction + advisory lock (concurrent
-- sign-ins used to violate user_devices_one_active).
-- ---------------------------------------------------------------------
create or replace function public.svc_register_device(p_user uuid, p_hash text, p_label text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('device:' || p_user::text, 0));
  update public.user_devices set is_active = false
   where user_id = p_user and is_active and device_hash <> p_hash;
  insert into public.user_devices (user_id, device_hash, label, is_active, last_seen_at)
  values (p_user, p_hash, left(coalesce(p_label, ''), 80), true, now())
  on conflict (user_id, device_hash) do update
    set is_active = true, label = excluded.label, last_seen_at = now();
end $$;
revoke execute on function public.svc_register_device(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.svc_register_device(uuid, text, text) to service_role;
-- ---------------------------------------------------------------------
-- 7. Entitlements/directory/admin search: live subscription first.
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
  order by (s.status in ('trialing', 'active') and s.current_period_end > now()) desc, s.current_period_end desc
  limit 1;
end $$;

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
    order by (s2.status in ('trialing', 'active') and s2.current_period_end > now()) desc, s2.current_period_end desc
    limit 1
  ) ls on true
  where m.tenant_id = p_tenant;
end $$;

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
    order by (s.status in ('trialing', 'active') and s.current_period_end > now()) desc, s.current_period_end desc limit 1
  ) ls on true
  where coalesce(p_query, '') = ''
     or u.email ilike '%' || p_query || '%'
     or p.full_name ilike '%' || p_query || '%'
     or p.phone like '%' || p_query || '%'
  order by u.created_at desc, t.type
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

-- ---------------------------------------------------------------------
-- 8. Access-token hook ignores suspended tenants (falls back to another
--    active membership instead of a tenant every RLS check would reject).
-- ---------------------------------------------------------------------
grant select on public.tenants to supabase_auth_admin;
drop policy if exists auth_admin_read_tenants on public.tenants;
create policy auth_admin_read_tenants on public.tenants for select to supabase_auth_admin using (true);
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
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
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

-- ---------------------------------------------------------------------
-- EOD notifier, rewritten:
--  * each section isolated: one bad row can't cancel the others (3)
--  * alerts only count prices after the alert was set/edited: the session
--    must have opened (close − 6h15m = 09:15 IST) after updated_at (5)
--  * alerts need a live plan with the alerts feature (6)
--  * exit-signal window 4 days (covers weekends) (2)
--  * plan-expiry: anything ending within 7 days, once per period (2)
--  * dedupe in private.notification_ledger, not in user-deletable rows (2)
-- Assumes daily candles are stamped at the session close (15:30 IST).
-- ---------------------------------------------------------------------
create or replace function private.run_eod_notifier() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_alerts  integer := 0;
  v_signals integer := 0;
  v_expiry  integer := 0;
  v_errors  text[]  := '{}';
begin
  begin
    with latest as (
      select distinct on (c.symbol, c.exchange) c.symbol, c.exchange, c.high, c.low, c.close, c.ts
      from public.market_candles c
      where c.interval = '1d' and c.ts > now() - interval '7 days'
      order by c.symbol, c.exchange, c.ts desc
    ),
    hit as (
      update public.price_alerts a
         set status = 'triggered',
             triggered_at = now(),
             triggered_price = case when a.condition = 'above' then greatest(a.trigger_price, l.close)
                                    else least(a.trigger_price, l.close) end
        from latest l
       where a.status = 'armed'
         and l.symbol = a.symbol and l.exchange = a.exchange
         and l.ts - interval '6 hours 15 minutes' > a.updated_at
         and ((a.condition = 'above' and l.high >= a.trigger_price)
           or (a.condition = 'below' and l.low  <= a.trigger_price))
         and coalesce((select (p.features ->> 'alerts')::boolean from public.plans p
                        where p.code = private.effective_plan(a.user_id, a.tenant_id)), false)
      returning a.id, a.tenant_id, a.user_id, a.symbol, a.condition, a.trigger_price, l.close
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select h.tenant_id, h.user_id, 'price_alert',
             h.symbol || ' crossed ' || case when h.condition = 'above' then 'above ' else 'below ' end
               || '₹' || to_char(h.trigger_price, 'FM999G99G99G990D00'),
             'Closed at ₹' || to_char(h.close, 'FM999G99G99G990D00') || '. The alert is now off; set a new level if you still care.',
             jsonb_build_object('alert_id', h.id, 'symbol', h.symbol)
      from hit h
      returning 1
    )
    select count(*) into v_alerts from ins;
  exception when others then
    v_errors := v_errors || ('price_alerts: ' || sqlerrm);
  end;

  begin
    with recent as (
      select s.id, s.symbol, s.exchange, s.strategy, private.try_numeric(s.payload ->> 'close') as at
      from public.trading_signals s
      where s.signal_type = 'exit' and s.generated_at > now() - interval '4 days'
    ),
    holders as (
      select distinct h.tenant_id, h.user_id, r.id as signal_id, r.symbol, r.strategy, r.at
      from recent r
      join public.holdings h on h.symbol = r.symbol and h.exchange = r.exchange and h.quantity > 0
    ),
    fresh as (
      insert into private.notification_ledger (user_id, tenant_id, kind, ref)
      select x.user_id, x.tenant_id, 'exit_signal', x.signal_id::text from holders x
      on conflict do nothing
      returning user_id, tenant_id, ref
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select x.tenant_id, x.user_id, 'exit_signal',
             'Exit signal on ' || x.symbol,
             case x.strategy when 'sma_20_50_cross' then 'The 20-day average closed below the 50-day'
                             when 'rsi_reversal'   then 'RSI turned down from overbought'
                             else replace(x.strategy, '_', ' ') end
               || coalesce(' at ₹' || to_char(x.at, 'FM999G99G99G990D00'), '') || '. You hold this stock.',
             jsonb_build_object('signal_id', x.signal_id, 'symbol', x.symbol)
      from holders x
      join fresh f on f.user_id = x.user_id and f.tenant_id = x.tenant_id and f.ref = x.signal_id::text
      returning 1
    )
    select count(*) into v_signals from ins;
  exception when others then
    v_errors := v_errors || ('exit_signals: ' || sqlerrm);
  end;

  begin
    with due as (
      select s.tenant_id, s.user_id, s.id, s.status, s.current_period_end
      from public.subscriptions s
      where s.status in ('trialing', 'active')
        and s.current_period_end > now()
        and s.current_period_end <= now() + interval '7 days'
    ),
    fresh as (
      insert into private.notification_ledger (user_id, tenant_id, kind, ref)
      select d.user_id, d.tenant_id, 'plan_expiry', d.id::text || ':' || d.current_period_end::text from due d
      on conflict do nothing
      returning user_id, tenant_id, ref
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select d.tenant_id, d.user_id, 'plan_expiry',
             case when d.status = 'trialing' then 'Your trial ends soon' else 'Your plan ends soon' end,
             'It ends on ' || to_char(d.current_period_end at time zone 'Asia/Kolkata', 'DD Mon YYYY')
               || '. Renew from Plan & billing to keep your radar, alerts and portfolio running.',
             jsonb_build_object('subscription_id', d.id, 'period_end', d.current_period_end)
      from due d
      join fresh f on f.user_id = d.user_id and f.tenant_id = d.tenant_id
                  and f.ref = d.id::text || ':' || d.current_period_end::text
      returning 1
    )
    select count(*) into v_expiry from ins;
  exception when others then
    v_errors := v_errors || ('plan_expiry: ' || sqlerrm);
  end;

  return jsonb_build_object('price_alerts', v_alerts, 'exit_signals', v_signals, 'plan_expiry', v_expiry, 'errors', to_jsonb(v_errors));
end $$;
revoke all on function private.run_eod_notifier() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Research refresh: active symbols only (a candle for an unknown symbol
--    used to abort the run via the FK), no division by zero, safe casts,
--    ledger-deduped stance notifications.
-- ---------------------------------------------------------------------
create or replace function private.refresh_research_notes() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  with daily as (
    select c.symbol, c.exchange, c.ts, c.close, c.high, c.low,
           row_number() over (partition by c.symbol, c.exchange order by c.ts desc) as rn
    from public.market_candles c
    where c.interval = '1d' and c.ts > now() - interval '420 days'
  ),
  tech as (
    select d.symbol, d.exchange,
           max(d.ts)    filter (where d.rn = 1)    as last_ts,
           max(d.close) filter (where d.rn = 1)    as last_close,
           max(d.close) filter (where d.rn = 22)   as close_1m,
           avg(d.close) filter (where d.rn <= 50)  as sma50,
           avg(d.close) filter (where d.rn <= 200) as sma200,
           count(*)     filter (where d.rn <= 200) as n200,
           max(d.high)  filter (where d.rn <= 250) as hi52,
           min(d.low)   filter (where d.rn <= 250) as lo52
    from daily d
    join public.market_symbols ms on ms.symbol = d.symbol and ms.exchange = d.exchange and ms.is_active
    group by d.symbol, d.exchange
    having count(*) >= 50
  ),
  rsi as (
    select distinct on (r.symbol, r.exchange) r.symbol, r.exchange, r.rsi
    from public.rsi_events r
    order by r.symbol, r.exchange, r.ts desc
  ),
  sig as (
    select distinct on (s.symbol, s.exchange) s.symbol, s.exchange, s.signal_type, s.strategy, s.generated_at,
           private.try_numeric(s.payload ->> 'close') as at_price
    from public.trading_signals s
    order by s.symbol, s.exchange, s.generated_at desc
  ),
  news as (
    select l.symbol, l.exchange,
           count(*) filter (where not a.is_filing) as n_news,
           count(*) filter (where a.is_filing)     as n_filings,
           sum(a.tone * exp(-extract(epoch from now() - a.published_at) / 86400.0 / 5))
             filter (where not a.is_filing and a.tone is not null)
           / nullif(sum(exp(-extract(epoch from now() - a.published_at) / 86400.0 / 5))
             filter (where not a.is_filing and a.tone is not null), 0) as tone,
           (array_agg(a.title order by a.published_at desc) filter (where not a.is_filing))[1] as top_title,
           (array_agg(coalesce(a.category, a.title) order by a.published_at desc) filter (where a.is_filing))[1] as last_filing
    from public.news_article_symbols l
    join public.news_articles a on a.id = l.article_id
    where a.published_at > now() - interval '14 days'
    group by l.symbol, l.exchange
  ),
  scored as (
    select t.*, r.rsi, g.signal_type, g.strategy, g.generated_at as signal_at, g.at_price,
           coalesce(n.n_news, 0) as n_news, coalesce(n.n_filings, 0) as n_filings, n.tone, n.top_title, n.last_filing,
           -- trend
           case when t.n200 >= 150 then
                  (case when t.last_close > t.sma200 then 1 else -1 end)
                + (case when t.sma50 > t.sma200 then 1 else -1 end)
                else (case when t.last_close > t.sma50 then 1 else -1 end) end::numeric as s_trend,
           -- momentum
           greatest(-2, least(2,
             (case when r.rsi is null then 0
                   when r.rsi >= 70 then 0.5
                   when r.rsi >= 55 then 1.5
                   when r.rsi >= 45 then 0
                   when r.rsi >= 30 then -1
                   else -1.5 end)
           + (case when t.close_1m is null then 0
                   when t.last_close / nullif(t.close_1m, 0) - 1 >  0.05 then 0.5
                   when t.last_close / nullif(t.close_1m, 0) - 1 < -0.05 then -0.5
                   else 0 end)))::numeric as s_momentum,
           -- 52-week range position
           (case when t.hi52 is null or t.hi52 <= t.lo52 then 0
                 when (t.last_close - t.lo52) / (t.hi52 - t.lo52) >= 0.85 then 1
                 when (t.last_close - t.lo52) / (t.hi52 - t.lo52) >= 0.60 then 0.5
                 when (t.last_close - t.lo52) / (t.hi52 - t.lo52) <= 0.15 then -1
                 when (t.last_close - t.lo52) / (t.hi52 - t.lo52) <= 0.40 then -0.5
                 else 0 end)::numeric as s_range,
           -- latest signal within 30 days
           (case when g.generated_at is null or g.generated_at < t.last_ts - interval '30 days' then 0
                 when g.signal_type = 'buy'  then 1.5 + (case when g.at_price > 0 and t.last_close > g.at_price then 0.5 else 0 end)
                 else -1.5 - (case when g.at_price > 0 and t.last_close < g.at_price then 0.5 else 0 end) end)::numeric as s_signal,
           -- news tone (damped when thin)
           greatest(-2, least(2, coalesce(n.tone, 0) * 2 * least(1, coalesce(n.n_news, 0) / 3.0)))::numeric as s_news
    from tech t
    left join rsi  r on r.symbol = t.symbol and r.exchange = t.exchange
    left join sig  g on g.symbol = t.symbol and g.exchange = t.exchange
    left join news n on n.symbol = t.symbol and n.exchange = t.exchange
  ),
  composed as (
    select s.*,
           round((0.30 * s_trend + 0.20 * s_momentum + 0.10 * s_range + 0.15 * s_signal + 0.25 * s_news) / 2 * 100, 1) as score,
           (s.last_ts at time zone 'Asia/Kolkata')::date as as_of
    from scored s
  ),
  final as (
    select c.*,
           case when c.score >= 25 then 'constructive' when c.score <= -25 then 'cautious' else 'neutral' end as stance,
           (select rn.stance from public.research_notes rn
             where rn.symbol = c.symbol and rn.exchange = c.exchange and rn.as_of < c.as_of
             order by rn.as_of desc limit 1) as prev_stance
    from composed c
  )
  insert into public.research_notes
    (symbol, exchange, as_of, score, stance, prev_stance, headline, factors, news_count, filing_count, generated_at)
  select f.symbol, f.exchange, f.as_of, f.score, f.stance, f.prev_stance,
         -- headline: trend phrase; momentum phrase; news phrase
         (case when f.s_trend >= 2 then 'Uptrend intact'
               when f.s_trend <= -2 then 'Downtrend in force'
               when f.s_trend > 0 then 'Trend turning up'
               else 'Trend turning down' end)
         || ', ' ||
         (case when f.rsi is null then 'momentum unclear'
               when f.rsi >= 70 then 'momentum stretched'
               when f.rsi >= 55 then 'momentum firm'
               when f.rsi >= 45 then 'momentum flat'
               when f.rsi >= 30 then 'momentum soft'
               else 'deeply oversold' end)
         || '; ' ||
         (case when f.n_news = 0 then 'no recent news'
               when f.tone >= 0.2 then 'news flow positive'
               when f.tone <= -0.2 then 'news flow negative'
               else 'news flow mixed' end)
         || '.',
         jsonb_build_array(
           jsonb_build_object('key', 'trend', 'label', 'Trend', 'weight', 0.30, 'score', f.s_trend,
             'detail', case when f.n200 >= 150 then
               format('Close %s%% %s the 200-day average; 50-day %s the 200-day.',
                      to_char(abs(f.last_close / nullif(f.sma200, 0) - 1) * 100, 'FM990.0'),
                      case when f.last_close >= f.sma200 then 'above' else 'below' end,
                      case when f.sma50 >= f.sma200 then 'above' else 'below' end)
               else format('Under 150 sessions of history; close is %s the 50-day average.',
                      case when f.last_close >= f.sma50 then 'above' else 'below' end) end),
           jsonb_build_object('key', 'momentum', 'label', 'Momentum', 'weight', 0.20, 'score', f.s_momentum,
             'detail', format('RSI(14) %s; %s over the last month.',
               coalesce(to_char(f.rsi, 'FM990.0'), 'n/a'),
               case when f.close_1m is null then 'no one-month history'
                    else (case when f.last_close >= f.close_1m then '+' else '−' end)
                         || to_char(abs(f.last_close / nullif(f.close_1m, 0) - 1) * 100, 'FM990.0') || '%' end)),
           jsonb_build_object('key', 'range', 'label', '52-week range', 'weight', 0.10, 'score', f.s_range,
             'detail', case when f.hi52 > f.lo52 then
               format('At %s%% of the 52-week range (₹%s – ₹%s).',
                 to_char((f.last_close - f.lo52) / (f.hi52 - f.lo52) * 100, 'FM990'),
                 to_char(f.lo52, 'FM9999990.00'), to_char(f.hi52, 'FM9999990.00'))
               else 'Range not available.' end),
           jsonb_build_object('key', 'signal', 'label', 'Signals', 'weight', 0.15, 'score', f.s_signal,
             'detail', case when f.s_signal = 0 then 'No rule signal in the last 30 sessions.'
               else format('%s on %s (%s) at ₹%s; now %s.',
                 upper(f.signal_type), to_char(f.signal_at at time zone 'Asia/Kolkata', 'DD Mon'),
                 replace(f.strategy, '_', ' '), to_char(f.at_price, 'FM9999990.00'),
                 case when f.last_close >= f.at_price then 'above' else 'below' end) end),
           jsonb_build_object('key', 'news', 'label', 'News tone', 'weight', 0.25, 'score', f.s_news,
             'detail', case when f.n_news = 0 then 'No headlines matched in 14 days.'
               else format('%s headline%s in 14 days, recency-weighted tone %s%s.',
                 f.n_news, case when f.n_news = 1 then '' else 's' end,
                 case when f.tone >= 0 then '+' else '−' end || to_char(abs(f.tone), 'FM0.00'),
                 case when f.n_news < 3 then ' (damped: thin coverage)' else '' end) end,
             'top_headline', f.top_title),
           jsonb_build_object('key', 'filings', 'label', 'Exchange filings', 'weight', 0, 'score', 0,
             'detail', case when f.n_filings = 0 then 'No NSE filings in 14 days.'
               else format('%s filing%s in 14 days; latest: %s.', f.n_filings,
                 case when f.n_filings = 1 then '' else 's' end, f.last_filing) end)
         ),
         f.n_news, f.n_filings, now()
  from final f
  on conflict (symbol, exchange, as_of) do update
    set score = excluded.score, stance = excluded.stance, prev_stance = excluded.prev_stance,
        headline = excluded.headline, factors = excluded.factors,
        news_count = excluded.news_count, filing_count = excluded.filing_count, generated_at = now();
  get diagnostics v_rows = row_count;

  -- Tell people who watch or hold a symbol when its stance changes (once per
  -- symbol per session, deduped in the ledger so deleting a notification
  -- doesn't bring it back).
  with changed as (
    select rn.symbol, rn.exchange, rn.as_of, rn.stance, rn.prev_stance, rn.score, rn.headline
    from public.research_notes rn
    where rn.as_of = (select max(x.as_of) from public.research_notes x where x.symbol = rn.symbol and x.exchange = rn.exchange)
      and rn.prev_stance is not null and rn.prev_stance <> rn.stance
  ),
  watchers as (
    select distinct w.tenant_id, w.user_id, c.*
    from changed c
    join (
      select wi.tenant_id, wi.user_id, wi.symbol, wi.exchange from public.watchlist_items wi
      union
      select h.tenant_id, h.user_id, h.symbol, h.exchange from public.holdings h where h.quantity > 0
    ) w on w.symbol = c.symbol and w.exchange = c.exchange
  ),
  fresh as (
    insert into private.notification_ledger (user_id, tenant_id, kind, ref)
    select x.user_id, x.tenant_id, 'research_stance', x.symbol || ':' || x.as_of::text from watchers x
    on conflict do nothing
    returning user_id, tenant_id, ref
  )
  insert into public.notifications (tenant_id, user_id, type, title, body, data)
  select x.tenant_id, x.user_id, 'research_stance',
         x.symbol || ' research turned ' || x.stance,
         x.headline || ' Score ' || to_char(x.score, 'FMS990') || ' (was ' || x.prev_stance || ').',
         jsonb_build_object('symbol', x.symbol, 'as_of', x.as_of, 'stance', x.stance)
  from watchers x
  join fresh f on f.user_id = x.user_id and f.tenant_id = x.tenant_id and f.ref = x.symbol || ':' || x.as_of::text;

  return v_rows;
end $$;
revoke all on function private.refresh_research_notes() from public, anon, authenticated;
