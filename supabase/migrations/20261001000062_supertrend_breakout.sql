-- SuperTrend breakout (ADR-061): the owner's AmiBroker rule ("200DMA LR SuperTrend NEXT OPEN ENTRY & EXIT"), the
-- seventh live rule. It did not pass the house check (research/strategies/supertrend_lr.py, supertrend_v2.py,
-- st_stock_level.py); the owner chose to add it, and its record is shown as it is.
--
-- The rule, as the AmiBroker formula (ported line by line in research/strategies/ab_check.py):
--   trend         the 25-day linear-regression slope of the 195-day simple average of closes is above 0.
--   SuperTrend    ATR 10 (Wilder: the first value is the mean of the first 10 true ranges), multiplier 3, on
--                 (high + low) / 2; the bands carry over as in the formula; the direction starts at 0 and, from the
--                 11th session, turns up when the close is above yesterday's upper band and down when it is below
--                 yesterday's lower band.
--   setup         SuperTrend turns from down to up while the slope is above 0 (not while in a trade, not on a sell day).
--   confirmation  a later close at or above the setup day's high + 0.05, before SuperTrend turns down (else cancelled).
--   buy           the next session's open.   sell   the next session's open after the first down day after the buy
--                 day. No safety stop, no target, no time limit. One trade per stock. The 500 largest companies.
-- Signals: the buy on the confirmation day (as every rule, signalled at the close for the next open); the exit on the
-- sale day, at that day's open (the message comes that evening).
-- Tested record (research/strategies/record_supertrend.py; each year's 300 most traded, 0.5 % cost): Jul 2019 – Oct
-- 2026, 3,158 trades, 41.0 % made money, +5.28 % a trade (2024-26: 1,258 trades, 33.5 %, +0.65 %; a random day on the
-- same side with the same exit: 32.4 %, +0.57 %).
-- Needs 220 sessions (195 for the average, 25 for the slope); the 500 largest keep 1,300 days, so it has back history.

-- ------------------------------------------------------------------ 1. the rule
create or replace function private.refresh_supertrend_breakout(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sym        record;
  v_ts       timestamptz[];
  v_o        numeric[];
  v_h        numeric[];
  v_l        numeric[];
  v_c        numeric[];
  v_slope    float8[];
  v_atr      float8[];
  v_ub       float8[];
  v_lb       float8[];
  v_uf       float8[];
  v_lf       float8[];
  v_d        integer[];
  n          integer;
  i          integer;
  t          integer;
  tr         float8;
  v_last_at  timestamptz;
  v_last_typ text;
  v_from     integer;
  v_waiting  boolean;
  v_rbuy     boolean;
  v_rsell    boolean;
  v_in       boolean;
  v_sold     boolean;
  v_setup    integer;
  v_conf     integer;
  v_xbar     integer;
  v_entry    integer;
  v_shigh    numeric;
  v_valid    boolean;
  g_type     text[];
  g_pay      jsonb[];
  g_at       timestamptz[];
  v_cnt      integer;
  n_sig      integer := 0;
begin
  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    select array_agg(y.ts order by y.ts), array_agg(y.open order by y.ts), array_agg(y.high order by y.ts),
           array_agg(y.low order by y.ts), array_agg(y.close order by y.ts), array_agg(y.slope order by y.ts)
      into v_ts, v_o, v_h, v_l, v_c, v_slope
      from (
        select x.ts, x.open, x.high, x.low, x.close,
               case when count(x.sma) over w25 = 25 then regr_slope(x.sma, x.rn) over w25 end as slope
        from (
          select c.ts, c.open, c.high, c.low, c.close, (row_number() over (order by c.ts))::float8 as rn,
                 case when count(*) over w195 = 195 then (avg(c.close) over w195)::float8 end as sma
          from private.trusted_candles c
          where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
          window w195 as (order by c.ts rows 194 preceding)
        ) x
        window w25 as (order by x.ts rows 24 preceding)
      ) y;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 221;                          -- 195 + 25 sessions for the slope, and a day to buy on

    -- SuperTrend, as the formula: Wilder ATR 10 seeded with the mean of the first 10 true ranges
    v_atr := array_fill(null::float8, array[n]);
    v_ub := array_fill(null::float8, array[n]); v_lb := array_fill(null::float8, array[n]);
    v_d := array_fill(0, array[n]);
    for t in 1..n loop
      if t = 1 then
        tr := (v_h[1] - v_l[1])::float8;
        v_atr[1] := tr;                             -- a running sum until the seed
      else
        tr := greatest(v_h[t] - v_l[t], abs(v_h[t] - v_c[t - 1]), abs(v_l[t] - v_c[t - 1]))::float8;
        if t <= 10 then v_atr[t] := v_atr[t - 1] + tr;
        else v_atr[t] := (v_atr[t - 1] * 9 + tr) / 10; end if;
      end if;
      if t = 10 then v_atr[10] := v_atr[10] / 10; end if;
    end loop;
    for t in 1..9 loop v_atr[t] := null; end loop;
    for t in 10..n loop
      v_ub[t] := (v_h[t] + v_l[t])::float8 / 2 + 3 * v_atr[t];
      v_lb[t] := (v_h[t] + v_l[t])::float8 / 2 - 3 * v_atr[t];
    end loop;
    v_uf := v_ub; v_lf := v_lb;
    for t in 11..n loop
      v_uf[t] := case when v_ub[t] < v_uf[t - 1] or v_c[t - 1]::float8 > v_uf[t - 1] then v_ub[t] else v_uf[t - 1] end;
      v_lf[t] := case when v_lb[t] > v_lf[t - 1] or v_c[t - 1]::float8 < v_lf[t - 1] then v_lb[t] else v_lf[t - 1] end;
      if v_d[t - 1] <= 0 then
        v_d[t] := case when v_c[t]::float8 > v_uf[t - 1] then 1 else -1 end;
      else
        v_d[t] := case when v_c[t]::float8 < v_lf[t - 1] then -1 else 1 end;
      end if;
    end loop;

    -- Continue from the last stored signal: after a sale, from the next session; after a buy, holding it.
    v_last_at := null; v_last_typ := null;
    select s.generated_at, s.signal_type into v_last_at, v_last_typ
      from public.trading_signals s
     where s.symbol = sym.symbol and s.exchange = sym.exchange and s.strategy = 'supertrend_breakout'
     order by s.generated_at desc limit 1;
    v_waiting := false; v_rbuy := false; v_rsell := false; v_in := false;
    v_setup := -1; v_conf := -1; v_xbar := -1; v_entry := -1; v_shigh := 0;
    v_from := 2;
    if v_last_at is not null then
      select count(*) into t from unnest(v_ts) as u(ts) where u.ts <= v_last_at;
      if t >= 1 and v_last_typ = 'buy' then
        v_rbuy := true; v_conf := t; v_from := t + 1;
      elsif t >= 1 then
        v_from := t + 1;
      end if;
    end if;

    g_type := '{}'; g_pay := '{}'; g_at := '{}';
    for i in v_from..n loop
      v_sold := false;
      if v_in then
        if v_rsell and i > v_xbar then
          g_type := g_type || 'exit'::text;
          g_pay := g_pay || jsonb_build_object(
            'action', 'exit', 'direction', 'buy', 'label', 'SuperTrend breakout: SuperTrend turned down',
            'close', v_o[i], 'exit_price', v_o[i], 'entry_fill', v_o[v_entry], 'result', 'ST_RED',
            'red_day', to_char(v_ts[v_xbar] at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
            'pnl_pct', round((v_o[i] / v_o[v_entry] - 1) * 100, 2), 'bars_held', i - v_entry + 1);
          g_at := g_at || (v_ts[i] + interval '15 minutes');
          v_in := false; v_rsell := false; v_sold := true;
        elsif not v_rsell and v_d[i] = -1 then
          v_rsell := true; v_xbar := i;
        end if;
      end if;

      if not v_in and not v_sold then
        if v_rbuy and i > v_conf then
          v_in := true; v_rbuy := false; v_entry := i;
        end if;
        v_valid := v_d[i] = 1 and v_d[i - 1] = -1 and coalesce(v_slope[i], 0) > 0;
        if not v_in and v_valid then
          v_waiting := true; v_rbuy := false; v_setup := i; v_shigh := v_h[i];
        end if;
        if v_waiting and v_d[i] <> 1 then
          v_waiting := false;
        end if;
        if v_waiting and i > v_setup and v_c[i]::float8 >= v_shigh::float8 + 0.05 then
          v_rbuy := true; v_conf := i; v_waiting := false;
          g_type := g_type || 'buy'::text;
          g_pay := g_pay || jsonb_build_object(
            'action', 'buy', 'direction', 'buy', 'label', 'SuperTrend breakout',
            'close', v_c[i], 'setup_day', to_char(v_ts[v_setup] at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
            'setup_high', v_shigh, 'trigger', v_shigh + 0.05,
            'supertrend', round(v_lf[i]::numeric, 2), 'slope', round(v_slope[v_setup]::numeric, 4),
            'exit_rule', 'supertrend_down');
          g_at := g_at || (v_ts[i] + interval '15 minutes');
        end if;
      end if;
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, 'supertrend_breakout', x.t, x.p, x.at
    from unnest(g_type, g_pay, g_at) as x(t, p, at)
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = 'supertrend_breakout'
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $$;
revoke all on function private.refresh_supertrend_breakout(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ 2. its name, and the lists of live rules
create or replace function private.rule_label(p_strategy text) returns text
language sql immutable set search_path = '' as $$
  select case p_strategy
    when 'strong_trend'        then 'Strong trend'
    when 'sma_trend'           then 'SMA 20/50 trend'
    when 'ma200_trend'         then '200-day trend'
    when 'secular_trend'       then 'Secular trend'
    when 'supertrend_breakout' then 'SuperTrend breakout'
    when 'rsi_dip'             then 'RSI dip'
    when 'kk_dip'              then 'KK dip'
    when 'sma_20_50_cross'     then 'SMA 20/50 cross (old rule)'
    when 'rsi_reversal'        then 'RSI reversal (old rule)'
    when 'kk_breakout'         then 'KK breakout (old rule)'
    else replace(p_strategy, '_', ' ') end
$$;
revoke all on function private.rule_label(text) from public, anon, authenticated;

-- Same view as migration 55 with the new rule in the list (rule health reads it).
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
  where t.strategy in ('strong_trend', 'rsi_dip', 'kk_dip', 'sma_trend', 'ma200_trend', 'secular_trend', 'supertrend_breakout')
  window w as (partition by t.strategy, t.symbol, t.exchange order by t.generated_at)
) x
where x.signal_type = 'buy';

-- Same view as migration 55 with the new rule in the list (your trades next to the rules' trades).
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
  and o.strategy in ('strong_trend', 'sma_trend', 'ma200_trend', 'secular_trend', 'supertrend_breakout', 'rsi_dip', 'kk_dip');
revoke all on public.rule_trades from anon, public;
grant select on public.rule_trades to authenticated;

-- Holders may choose it for messages about stocks they hold (off by default, like Secular trend).
alter table public.notification_prefs drop constraint if exists notification_prefs_exit_rules_check;
alter table public.notification_prefs add constraint notification_prefs_exit_rules_check
  check (exit_rules <@ array['strong_trend', 'sma_trend', 'ma200_trend', 'secular_trend', 'supertrend_breakout', 'rsi_dip', 'kk_dip']);

-- The tested record of the exact rule (research/strategies/record_supertrend.py), the yardstick for its health.
insert into public.rule_expectations (strategy, made_pct, avg_pct, period, trades) values
  ('supertrend_breakout', 41.0, 5.28, 'Jul 2019 – Oct 2026', 3158)
on conflict (strategy) do update set made_pct = excluded.made_pct, avg_pct = excluded.avg_pct,
                                     period = excluded.period, trades = excluded.trades;

-- ------------------------------------------------------------------ 3. the nightly run, the rebuild and the backstop
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
  v_out := v_out || jsonb_build_object('supertrend_breakout', private.refresh_supertrend_breakout(p_symbols));
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
  v_out := v_out || jsonb_build_object('supertrend_breakout', private.refresh_supertrend_breakout(p_symbols));
  v_out := v_out || jsonb_build_object('dips', private.refresh_dip_rules(p_symbols));
  v_out := v_out || jsonb_build_object('last_signal', private.refresh_last_signal(p_symbols));
  v_out := v_out || jsonb_build_object('graded', private.grade_signals(p_symbols));
  return v_out;
end $$;
revoke execute on function public.svc_refresh_market_analytics(integer, text[]) from public, anon, authenticated;
grant  execute on function public.svc_refresh_market_analytics(integer, text[]) to service_role;

-- Same backstop as migration 55 with the new rule after Secular trend.
select cron.schedule('market-analytics', '25 12 * * 1-5',
  $$ select private.refresh_market_analytics(10); select private.refresh_setups();
     select private.refresh_market_weather(); select private.refresh_strong_trend(); select private.refresh_sma_trend();
     select private.refresh_ma200_trend(); select private.refresh_secular_trend(); select private.refresh_supertrend_breakout();
     select private.refresh_dip_rules(); select private.refresh_last_signal(); select private.grade_signals();
     select public.svc_refresh_signal_checks(); select private.refresh_record_summaries(); $$);

-- ------------------------------------------------------------------ 4. start it on the stored days
select private.refresh_supertrend_breakout();
select private.refresh_last_signal();
select private.grade_signals(null, null);
select private.refresh_rule_health();
select private.refresh_record_summaries();
