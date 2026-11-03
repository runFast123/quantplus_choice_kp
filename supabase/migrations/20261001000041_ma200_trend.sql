-- 200-day trend (ADR-040): the owner's fifth rule. A stock above its 200-day average whose 200-day average leans flat or
-- up, measured with a least-squares (linear regression) line as in TradingView's Linear Regression Channel.
--
-- Research (research/strategies/improve_lr.py, record_lr.py; each year's 300 most traded stocks, 0.5 % round-trip cost):
-- 48 variants written down before running (entry, slope test, line length, price straightness, exit), chosen on
-- 2019-23 by the fewest losing trades (at least 150 a year, positive average), reported on 2024-26.
--   ma200_trend  the first session on which all three hold, after a session on which they did not (and could be measured):
--                  1. the close is above the 200-day average close
--                  2. the least-squares line through the last 100 values of the 200-day average is flat or rising:
--                     slope x 20 sessions >= -0.25 % of today's 200-day average
--                  3. the last 100 closes lean up in a fairly straight line: Pearson's R of close against time >= 0.5
--   plan         entry at the next open; safety stop = close - 4 x ATR14 (simple 14-day average true range); out at the
--                stop (or the open, if it gaps under), otherwise the close of the 60th session. One trade per stock.
--                The same plan as Strong trend and SMA 20/50 trend; the 500 largest companies.
-- The tested numbers are in rule_expectations below and web/src/lib/strong-trend.ts (MA200_TREND_TESTED).

-- ------------------------------------------------------------------ 1. the rule
create or replace function private.refresh_ma200_trend(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sym     record;
  v_ts    timestamptz[];
  v_o     numeric[];
  v_l     numeric[];
  v_c     numeric[];
  v_sma   numeric[];
  v_slope float8[];
  v_r     float8[];
  v_atr   numeric[];
  v_natr  integer[];
  n       integer;
  i       integer;
  j       integer;
  k       integer;
  m       integer;
  busy    integer;
  v_ok    boolean;
  v_prev  boolean;
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
    select array_agg(z.ts order by z.ts), array_agg(z.open order by z.ts), array_agg(z.low order by z.ts),
           array_agg(z.close order by z.ts), array_agg(z.sma200 order by z.ts), array_agg(z.slope_pct order by z.ts),
           array_agg(z.r_px order by z.ts), array_agg(z.atr14 order by z.ts), array_agg(z.natr order by z.ts)
      into v_ts, v_o, v_l, v_c, v_sma, v_slope, v_r, v_atr, v_natr
      from (
        select y.ts, y.open, y.low, y.close, y.sma200, y.atr14, y.natr,
               -- the fitted line's change over 20 sessions, in % of today's 200-day average
               case when y.n_slope = 100 then 2000 * y.slope / y.sma200::float8 end as slope_pct,
               case when y.n_r = 100 then y.r end as r_px
        from (
          select x.*,
                 regr_slope(x.sma200::float8, x.k::float8) over w100 as slope,
                 regr_count(x.sma200::float8, x.k::float8) over w100 as n_slope,
                 corr(x.close::float8, x.k::float8) over w100 as r,
                 count(*) over w100 as n_r
          from (
            select t.ts, t.open, t.low, t.close, row_number() over (order by t.ts) as k,
                   case when count(*) over w200 = 200 then avg(t.close) over w200 end as sma200,
                   avg(t.tr) over w14 as atr14, count(t.tr) over w14 as natr
            from (
              select c.ts, c.open, c.low, c.close,
                     greatest(c.high - c.low, abs(c.high - lag(c.close) over o), abs(c.low - lag(c.close) over o)) as tr
              from public.market_candles c
              where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
              window o as (order by c.ts)
            ) t
            window w200 as (order by t.ts rows 199 preceding), w14 as (order by t.ts rows 13 preceding)
          ) x
          window w100 as (order by x.ts rows 99 preceding)
        ) y
      ) z;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 300;

    g_type := '{}'; g_pay := '{}'; g_at := '{}';
    busy := 0;
    v_prev := null;                                 -- null = the day before could not be measured
    for i in 1..n loop
      if v_sma[i] is null or v_slope[i] is null or v_r[i] is null then
        v_ok := null;
      else
        v_ok := v_c[i] > v_sma[i] and v_slope[i] >= -0.25 and v_r[i] >= 0.5;
      end if;
      if v_ok and v_prev is not null and not v_prev and i > busy and v_natr[i] >= 14 then
        v_stop := round(v_c[i] - 4 * v_atr[i], 2);
        if v_stop > 0 then
          g_type := g_type || 'buy'::text;
          g_pay := g_pay || jsonb_build_object(
            'action', 'buy', 'direction', 'buy', 'label', '200-day trend',
            'close', v_c[i], 'stop', v_stop, 'atr14', round(v_atr[i], 2), 'sma200', round(v_sma[i], 2),
            'slope_pct', round(v_slope[i]::numeric, 2), 'r_px', round(v_r[i]::numeric, 2), 'review_sessions', 60);
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
                'label', case v_how when 'STOP_HIT' then '200-day trend: safety stop' else '200-day trend: 60-session review' end,
                'close', v_px, 'exit_price', v_px, 'entry_fill', v_o[j], 'result', v_how,
                'pnl_pct', round((v_px / v_o[j] - 1) * 100, 2), 'bars_held', k - j + 1);
              g_at := g_at || (v_ts[k] + interval '15 minutes');
            end if;
          end if;
        end if;
      end if;
      v_prev := v_ok;
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, 'ma200_trend', x.t, x.p, x.at
    from unnest(g_type, g_pay, g_at) as x(t, p, at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $$;
revoke all on function private.refresh_ma200_trend(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ 2. its trades join the health checks
-- Same view as migration 40 with the new rule in the list.
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
  where t.strategy in ('strong_trend', 'rsi_dip', 'kk_dip', 'sma_trend', 'ma200_trend')
  window w as (partition by t.strategy, t.symbol, t.exchange order by t.generated_at)
) x
where x.signal_type = 'buy';

-- The tested record of the exact rule (research/strategies/record_lr.py), the yardstick for its health.
insert into public.rule_expectations (strategy, made_pct, avg_pct, period, trades) values
  ('ma200_trend', 56, 5.9, 'Mar 2020 – Oct 2026', 1906);

-- ------------------------------------------------------------------ 3. pipeline wrapper + backstop
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
  v_out := v_out || jsonb_build_object('dips', private.refresh_dip_rules(p_symbols));
  v_out := v_out || jsonb_build_object('graded', private.grade_signals(p_symbols));
  return v_out;
end $$;
revoke execute on function public.svc_refresh_market_analytics(integer, text[]) from public, anon, authenticated;
grant  execute on function public.svc_refresh_market_analytics(integer, text[]) to service_role;

select cron.schedule('market-analytics', '25 12 * * 1-5',
  $$ select private.refresh_market_analytics(10); select private.refresh_setups();
     select private.refresh_market_weather(); select private.refresh_strong_trend(); select private.refresh_sma_trend();
     select private.refresh_ma200_trend(); select private.refresh_dip_rules(); select private.grade_signals();
     select public.svc_refresh_signal_checks(); $$);

-- Build every trade the stored candles allow, grade them, and give the new rule a year of weekly health history.
select private.refresh_ma200_trend();
select private.grade_signals(null, null);
select private.refresh_rule_health(d::date)
from generate_series((now() at time zone 'Asia/Kolkata')::date - 364, (now() at time zone 'Asia/Kolkata')::date, interval '7 days') d;
select private.refresh_rule_health();
