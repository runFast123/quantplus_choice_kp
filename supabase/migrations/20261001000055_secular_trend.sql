-- Secular trend (ADR-051): the owner's sixth rule, from Pring's Special K, live from today.
--
-- Secular trend = Pring's Special K (TradingView ta.specialK): the sum of 12 rates of change of the close, each smoothed
-- by a simple average and weighted 1 to 4:
--     ROC  10 15 20 30 | 40 65 75 100 | 195 265 390 530        ROC_r = 100 x (close / close r sessions ago - 1)
--     SMA  10 10 10 15 | 50 65 75 100 | 130 130 130 195
--     w     1  2  3  4 |  1  2  3   4 |   1   2   3   4
-- signal line = SMA 50 of (SMA 50 of Secular trend), the owner's lengths.
--   secular_trend  Secular trend closes above its signal line after closing at or under it the session before, while it
--                  is not lower than 5 sessions ago (flat or rising) and is below -150 (the owner's line).
--   plan           entry at the next open; safety stop = close - 4 x ATR14 (simple 14-day average true range); out at
--                  the stop (or the open, if it gaps under), otherwise the close of the 60th session. One trade per
--                  stock. The same plan as the other trend rules; the 500 largest companies.
-- Research (research/strategies/specialk.py, secular_trend.py, record_secular.py; ADR-049): the tested record of this
-- exact rule, Jul 2019 – Oct 2026, 450 trades, 52.9 % made money, +6.83 % a trade after a 0.5 % cost (2024-26: 84
-- trades, 39.3 %, +1.42 %). Most of 2019-23's trades came in the 2020 rebound.
--
-- It needs 823 sessions before the signal line has a value. The 500 largest keep 1,250 days (about 843 sessions,
-- ADR-041), so it is worked out from the last stored days only and starts live now, with no back history in the app;
-- 1,300 days are kept from here on (about 35 sessions more, ~3 MB), so a few missing days don't stop it.

-- ------------------------------------------------------------------ 1. the rule
create or replace function private.refresh_secular_trend(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sym     record;
  v_ts    timestamptz[];
  v_o     numeric[];
  v_l     numeric[];
  v_c     numeric[];
  v_k     float8[];
  v_sig   float8[];
  v_atr   numeric[];
  v_natr  integer[];
  n       integer;
  i       integer;
  j       integer;
  k       integer;
  m       integer;
  busy    integer;
  v_stop  numeric;
  v_px    numeric;
  v_how   text;
  g_type  text[];
  g_pay   jsonb[];
  g_at    timestamptz[];
  v_cnt   integer;
  n_sig   integer := 0;
begin
  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    select array_agg(q.ts order by q.ts), array_agg(q.open order by q.ts), array_agg(q.low order by q.ts),
           array_agg(q.close order by q.ts), array_agg(q.sk order by q.ts), array_agg(q.sig order by q.ts),
           array_agg(q.atr14 order by q.ts), array_agg(q.natr order by q.ts)
      into v_ts, v_o, v_l, v_c, v_k, v_sig, v_atr, v_natr
      from (
        select z.*, case when count(z.k1) over w50 = 50 then avg(z.k1) over w50 end as sig
        from (
          select y.*, case when count(y.sk) over w50 = 50 then avg(y.sk) over w50 end as k1
          from (
            select x.ts, x.open, x.low, x.close, x.atr14, x.natr,
                   case when count(x.r10) over w10 = 10 and count(x.r15) over w10 = 10 and count(x.r20) over w10 = 10
                         and count(x.r30) over w15 = 15 and count(x.r40) over w50 = 50 and count(x.r65) over w65 = 65
                         and count(x.r75) over w75 = 75 and count(x.r100) over w100 = 100
                         and count(x.r195) over w130 = 130 and count(x.r265) over w130 = 130
                         and count(x.r390) over w130 = 130 and count(x.r530) over w195 = 195 then
                          1 * avg(x.r10) over w10  + 2 * avg(x.r15) over w10  + 3 * avg(x.r20) over w10  + 4 * avg(x.r30) over w15
                        + 1 * avg(x.r40) over w50  + 2 * avg(x.r65) over w65  + 3 * avg(x.r75) over w75  + 4 * avg(x.r100) over w100
                        + 1 * avg(x.r195) over w130 + 2 * avg(x.r265) over w130 + 3 * avg(x.r390) over w130 + 4 * avg(x.r530) over w195
                   end as sk
            from (
              select t.ts, t.open, t.low, t.close,
                     (100 * (t.close / nullif(lag(t.close, 10)  over o, 0) - 1))::float8 as r10,
                     (100 * (t.close / nullif(lag(t.close, 15)  over o, 0) - 1))::float8 as r15,
                     (100 * (t.close / nullif(lag(t.close, 20)  over o, 0) - 1))::float8 as r20,
                     (100 * (t.close / nullif(lag(t.close, 30)  over o, 0) - 1))::float8 as r30,
                     (100 * (t.close / nullif(lag(t.close, 40)  over o, 0) - 1))::float8 as r40,
                     (100 * (t.close / nullif(lag(t.close, 65)  over o, 0) - 1))::float8 as r65,
                     (100 * (t.close / nullif(lag(t.close, 75)  over o, 0) - 1))::float8 as r75,
                     (100 * (t.close / nullif(lag(t.close, 100) over o, 0) - 1))::float8 as r100,
                     (100 * (t.close / nullif(lag(t.close, 195) over o, 0) - 1))::float8 as r195,
                     (100 * (t.close / nullif(lag(t.close, 265) over o, 0) - 1))::float8 as r265,
                     (100 * (t.close / nullif(lag(t.close, 390) over o, 0) - 1))::float8 as r390,
                     (100 * (t.close / nullif(lag(t.close, 530) over o, 0) - 1))::float8 as r530,
                     avg(t.tr) over w14 as atr14, count(t.tr) over w14 as natr
              from (
                select c.ts, c.open, c.low, c.close,
                       greatest(c.high - c.low, abs(c.high - lag(c.close) over o), abs(c.low - lag(c.close) over o)) as tr
                from public.market_candles c
                where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
                window o as (order by c.ts)
              ) t
              window o as (order by t.ts), w14 as (order by t.ts rows 13 preceding)
            ) x
            window w10 as (order by x.ts rows 9 preceding), w15 as (order by x.ts rows 14 preceding),
                   w50 as (order by x.ts rows 49 preceding), w65 as (order by x.ts rows 64 preceding),
                   w75 as (order by x.ts rows 74 preceding), w100 as (order by x.ts rows 99 preceding),
                   w130 as (order by x.ts rows 129 preceding), w195 as (order by x.ts rows 194 preceding)
          ) y
          window w50 as (order by y.ts rows 49 preceding)
        ) z
        window w50 as (order by z.ts rows 49 preceding)
      ) q;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 824;                          -- the signal line needs 823 sessions, the cross one more

    g_type := '{}'; g_pay := '{}'; g_at := '{}';
    busy := private.rule_resume(sym.symbol, sym.exchange, 'secular_trend', v_ts, 1);
    for i in 6..n loop
      if v_k[i] is not null and v_sig[i] is not null and v_k[i - 1] is not null and v_sig[i - 1] is not null
         and v_k[i - 5] is not null
         and v_k[i] > v_sig[i] and v_k[i - 1] <= v_sig[i - 1]    -- crosses above its signal line
         and v_k[i] >= v_k[i - 5]                                -- flat or rising
         and v_k[i] < -150                                       -- under the owner's line
         and i > busy and v_natr[i] >= 14 then
        v_stop := round(v_c[i] - 4 * v_atr[i], 2);
        if v_stop > 0 then
          g_type := g_type || 'buy'::text;
          g_pay := g_pay || jsonb_build_object(
            'action', 'buy', 'direction', 'buy', 'label', 'Secular trend',
            'close', v_c[i], 'stop', v_stop, 'atr14', round(v_atr[i], 2),
            'secular', round(v_k[i]::numeric, 1), 'secular_signal', round(v_sig[i]::numeric, 1), 'line', -150,
            'review_sessions', 60);
          g_at := g_at || (v_ts[i] + interval '15 minutes');

          j := i + 1;                               -- entry: the next session's open
          if j > n then
            busy := n;
          else
            k := null;
            for m in j..least(j + 59, n) loop
              if v_l[m] <= v_stop then
                k := m; v_px := least(v_o[m], v_stop); v_how := 'STOP_HIT';
                exit;
              end if;
            end loop;
            if k is null and j + 59 > n then
              busy := n;                            -- still open
            else
              if k is null then k := j + 59; v_px := v_c[k]; v_how := 'REVIEW_60'; end if;
              busy := k;
              g_type := g_type || 'exit'::text;
              g_pay := g_pay || jsonb_build_object(
                'action', 'exit', 'direction', 'buy',
                'label', case v_how when 'STOP_HIT' then 'Secular trend: safety stop' else 'Secular trend: 60-session review' end,
                'close', v_px, 'exit_price', v_px, 'entry_fill', v_o[j], 'result', v_how,
                'pnl_pct', round((v_px / v_o[j] - 1) * 100, 2), 'bars_held', k - j + 1);
              g_at := g_at || (v_ts[k] + interval '15 minutes');
            end if;
          end if;
        end if;
      end if;
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, 'secular_trend', x.t, x.p, x.at
    from unnest(g_type, g_pay, g_at) as x(t, p, at)
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = 'secular_trend'
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $$;
revoke all on function private.refresh_secular_trend(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ 2. its name, and the lists of live rules
create or replace function private.rule_label(p_strategy text) returns text
language sql immutable set search_path = '' as $$
  select case p_strategy
    when 'strong_trend'    then 'Strong trend'
    when 'sma_trend'       then 'SMA 20/50 trend'
    when 'ma200_trend'     then '200-day trend'
    when 'secular_trend'   then 'Secular trend'
    when 'rsi_dip'         then 'RSI dip'
    when 'kk_dip'          then 'KK dip'
    when 'sma_20_50_cross' then 'SMA 20/50 cross (old rule)'
    when 'rsi_reversal'    then 'RSI reversal (old rule)'
    when 'kk_breakout'     then 'KK breakout (old rule)'
    else replace(p_strategy, '_', ' ') end
$$;
revoke all on function private.rule_label(text) from public, anon, authenticated;

-- Same view as migration 41 with the new rule in the list (rule health reads it).
create or replace view public.signal_trades
with (security_invoker = true) as
select x.strategy, x.symbol, x.exchange, x.signal_day,
       case when x.next_type = 'exit' and x.next_pnl ~ '^-?[0-9]+(\.[0-9]+)?$' then x.next_pnl::numeric end as result_pct,
       case when x.next_type = 'exit' then x.next_day end as exit_day,
       case when x.next_type = 'exit' then x.next_result end as exit_reason
from (
  select t.strategy, t.symbol, t.exchange, t.signal_type,
         coalesce(case when t.payload->>'signal_day' ~ '^\d{4}-\d{2}-\d{2}$' then (t.payload->>'signal_day')::date end,
                  (t.generated_at at time zone 'Asia/Kolkata')::date) as signal_day,
         lead(t.signal_type) over w as next_type,
         lead(t.payload->>'pnl_pct') over w as next_pnl,
         ((lead(t.generated_at) over w) at time zone 'Asia/Kolkata')::date as next_day,
         lead(t.payload->>'result') over w as next_result
  from public.trading_signals t
  where t.strategy in ('strong_trend', 'rsi_dip', 'kk_dip', 'sma_trend', 'ma200_trend', 'secular_trend')
  window w as (partition by t.strategy, t.symbol, t.exchange order by t.generated_at)
) x
where x.signal_type = 'buy';

-- Same view as migration 54 with the new rule in the list (your trades next to the rules' trades).
create or replace view public.rule_trades
with (security_invoker = true) as
select o.signal_id,
       o.strategy,
       o.symbol,
       o.exchange,
       o.signal_day,
       o.entry_day,
       o.entry_price,
       x.exit_day,
       x.exit_price,
       x.exit_entry_fill,
       x.result,
       x.label as exit_label
from public.signal_outcomes o
join public.trading_signals b on b.id = o.signal_id
left join lateral (
  select (t.generated_at at time zone 'Asia/Kolkata')::date as exit_day,
         case when t.payload->>'exit_price' ~ '^[0-9]+(\.[0-9]+)?$' then (t.payload->>'exit_price')::numeric end as exit_price,
         case when t.payload->>'entry_fill' ~ '^[0-9]+(\.[0-9]+)?$' then (t.payload->>'entry_fill')::numeric end as exit_entry_fill,
         t.payload->>'result' as result,
         t.payload->>'label' as label
  from public.trading_signals t
  where t.symbol = o.symbol and t.exchange = o.exchange and t.strategy = o.strategy
    and t.signal_type = 'exit' and t.generated_at > b.generated_at
    and not exists (
      select 1 from public.trading_signals n
      where n.symbol = o.symbol and n.exchange = o.exchange and n.strategy = o.strategy
        and n.signal_type = 'buy' and n.generated_at > b.generated_at and n.generated_at < t.generated_at
    )
  order by t.generated_at
  limit 1
) x on true
where o.side = 'long'
  and o.strategy in ('strong_trend', 'sma_trend', 'ma200_trend', 'secular_trend', 'rsi_dip', 'kk_dip');
revoke all on public.rule_trades from anon, public;
grant select on public.rule_trades to authenticated;

-- Holders may choose it for messages about stocks they hold (not on by default, like the dip rules).
alter table public.notification_prefs drop constraint if exists notification_prefs_exit_rules_check;
alter table public.notification_prefs add constraint notification_prefs_exit_rules_check
  check (exit_rules <@ array['strong_trend', 'sma_trend', 'ma200_trend', 'secular_trend', 'rsi_dip', 'kk_dip']);

-- The tested record of the exact rule (research/strategies/record_secular.py), the yardstick for its health.
insert into public.rule_expectations (strategy, made_pct, avg_pct, period, trades) values
  ('secular_trend', 52.9, 6.83, 'Jul 2019 – Oct 2026', 450)
on conflict (strategy) do update set made_pct = excluded.made_pct, avg_pct = excluded.avg_pct,
                                     period = excluded.period, trades = excluded.trades;

-- ------------------------------------------------------------------ 3. history: 1,300 days for the 500 largest
create or replace function private.history_for_rank()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.mcap_rank is not null and new.mcap_rank <= 500 and new.history_days < 1300 then
    new.history_days := 1300;
  end if;
  return new;
end $$;
revoke all on function private.history_for_rank() from public, anon, authenticated;

update public.market_symbols
   set history_days = 1300
 where (mcap_rank <= 500 or symbol in ('NIFTY', 'NIFTY500', 'INDIAVIX')) and history_days < 1300;

-- ------------------------------------------------------------------ 4. the nightly run, the rebuild and the backstop
create or replace function private.rebuild_rule_signals(p_symbols text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_del  integer;
  v_kept integer;
  v_out  jsonb;
begin
  if p_symbols is null or cardinality(p_symbols) = 0 then
    raise exception 'rebuild_rule_signals needs a list of symbols';
  end if;
  drop table if exists pg_temp.rebuild_old;
  create temporary table rebuild_old on commit drop as
    select t.id, t.symbol, t.exchange, t.strategy, t.signal_type, t.generated_at
    from public.trading_signals t
    where t.symbol = any(p_symbols) and t.strategy in (select e.strategy from public.rule_expectations e);
  delete from public.trading_signals t using pg_temp.rebuild_old o where t.id = o.id;
  get diagnostics v_del = row_count;
  v_out := jsonb_build_object('deleted', v_del);
  v_out := v_out || jsonb_build_object('strong_trend', private.refresh_strong_trend(p_symbols));
  v_out := v_out || jsonb_build_object('sma_trend', private.refresh_sma_trend(p_symbols));
  v_out := v_out || jsonb_build_object('ma200_trend', private.refresh_ma200_trend(p_symbols));
  v_out := v_out || jsonb_build_object('secular_trend', private.refresh_secular_trend(p_symbols));
  v_out := v_out || jsonb_build_object('dips', private.refresh_dip_rules(p_symbols));

  -- Written again: the same row under its old id.
  drop table if exists pg_temp.rebuild_same;
  create temporary table rebuild_same on commit drop as
    select o.id as old_id, n.id as new_id, n.symbol, n.exchange, n.strategy, n.signal_type, n.payload, n.generated_at
    from public.trading_signals n
    join pg_temp.rebuild_old o
      on o.symbol = n.symbol and o.exchange = n.exchange and o.strategy = n.strategy
     and o.signal_type = n.signal_type and o.generated_at = n.generated_at
    where n.symbol = any(p_symbols);
  delete from public.trading_signals t using pg_temp.rebuild_same s where t.id = s.new_id;
  insert into public.trading_signals (id, symbol, exchange, strategy, signal_type, payload, generated_at)
  overriding system value
  select s.old_id, s.symbol, s.exchange, s.strategy, s.signal_type, s.payload, s.generated_at from pg_temp.rebuild_same s;
  get diagnostics v_kept = row_count;
  v_out := v_out || jsonb_build_object('same_id', v_kept);
  v_out := v_out || jsonb_build_object('last_signal', private.refresh_last_signal(p_symbols));
  v_out := v_out || jsonb_build_object('graded', private.grade_signals(p_symbols, null));
  return v_out;
end $$;
revoke all on function private.rebuild_rule_signals(text[]) from public, anon, authenticated;

create or replace function public.svc_refresh_market_analytics(p_days integer default 10, p_symbols text[] default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  v_out := private.refresh_market_analytics(p_days, p_symbols);
  v_out := v_out || jsonb_build_object('setups', private.refresh_setups(p_symbols));
  v_out := v_out || jsonb_build_object('weather', private.refresh_market_weather());
  v_out := v_out || jsonb_build_object('strong_trend', private.refresh_strong_trend(p_symbols));
  v_out := v_out || jsonb_build_object('sma_trend', private.refresh_sma_trend(p_symbols));
  v_out := v_out || jsonb_build_object('ma200_trend', private.refresh_ma200_trend(p_symbols));
  v_out := v_out || jsonb_build_object('secular_trend', private.refresh_secular_trend(p_symbols));
  v_out := v_out || jsonb_build_object('dips', private.refresh_dip_rules(p_symbols));
  v_out := v_out || jsonb_build_object('last_signal', private.refresh_last_signal(p_symbols));
  v_out := v_out || jsonb_build_object('graded', private.grade_signals(p_symbols));
  return v_out;
end $$;
revoke execute on function public.svc_refresh_market_analytics(integer, text[]) from public, anon, authenticated;
grant  execute on function public.svc_refresh_market_analytics(integer, text[]) to service_role;

-- Same backstop as migration 49 with the new rule after the 200-day trend.
select cron.schedule('market-analytics', '25 12 * * 1-5',
  $$ select private.refresh_market_analytics(10); select private.refresh_setups();
     select private.refresh_market_weather(); select private.refresh_strong_trend(); select private.refresh_sma_trend();
     select private.refresh_ma200_trend(); select private.refresh_secular_trend(); select private.refresh_dip_rules();
     select private.refresh_last_signal(); select private.grade_signals(); select public.svc_refresh_signal_checks();
     select private.refresh_record_summaries(); $$);

-- ------------------------------------------------------------------ 5. start it on the stored days
select private.refresh_secular_trend();
select private.refresh_last_signal();
select private.grade_signals(null, null);
select private.refresh_rule_health();
select private.refresh_record_summaries();
