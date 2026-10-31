-- SMA 20/50 trend (migration 38): the 20/50 cross only in a market leader, with a 60-session plan. Rolled back.
begin;

create schema qp_t12;
create function qp_t12.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t12.day(p_d integer) returns timestamptz language sql immutable as $$
  select date_trunc('day', now()) - (330 - p_d + 1) * interval '1 day' + interval '10 hours'
$$;
create function qp_t12.load(p_symbol text, p_close numeric[]) returns void language sql as $$
  insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
  select p_symbol, 'NSE', '1d', qp_t12.day(i::int), c, c + 1, c - 1, c, 1000000
  from unnest(p_close) with ordinality as t(c, i)
$$;

-- Only the fixtures are ranked: everything else leaves the 500 largest for this test.
update public.market_symbols set mcap_rank = null where mcap_rank is not null;
delete from public.market_leaders;
delete from public.trading_signals where strategy = 'sma_trend';          -- only the fixtures' trades count (rolled back)
delete from public.market_candles where symbol = 'NIFTY';
insert into public.market_symbols (symbol, exchange, name, is_active, segment) values ('NIFTY', 'NSE', 'NIFTY 50', true, 'index')
on conflict (symbol, exchange) do update set is_active = true, segment = 'index';
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'NIFTY', 'NSE', '1d', qp_t12.day(d), 10000 + d, 10001 + d, 9999 + d, 10000 + d, 0 from generate_series(1, 330) d;

insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPSMA1', 'NSE', 'Leader that turns up', true, 'equity', 1),
  ('QPSMA2', 'NSE', 'Laggard that bounces', true, 'equity', 2),
  ('QPSMA3', 'NSE', 'Filler', true, 'equity', 3), ('QPSMA4', 'NSE', 'Filler', true, 'equity', 4),
  ('QPSMA5', 'NSE', 'Filler', true, 'equity', 5), ('QPSMA6', 'NSE', 'Filler', true, 'equity', 6),
  ('QPSMA7', 'NSE', 'Leader chart, small company', true, 'equity', 900);

-- QPSMA1: up to 150, a dip to 120 (the 20-day average falls under the 50-day), then up 1 a day: the 20-day crosses
-- back above around day 172 with a +7 % six-month return, the best of the six.
select qp_t12.load('QPSMA1', (select array_agg(case when d <= 100 then 100 + 0.5 * d when d <= 160 then 150 - 0.5 * (d - 100)
                                                   else 120 + (d - 160) end::numeric order by d) from generate_series(1, 330) d));
-- QPSMA2: a long fall, then a bounce that crosses the averages too, with a -40 % six-month return.
select qp_t12.load('QPSMA2', (select array_agg(case when d <= 160 then 300 - d when d <= 200 then 140 + 1.5 * (d - 160)
                                                   else 200 end::numeric order by d) from generate_series(1, 330) d));
-- QPSMA3-6: steady falls (no cross), six-month returns from about -6 % to -28 %.
select qp_t12.load('QPSMA' || (2 + k), (select array_agg((100 - 0.05 * k * d)::numeric order by d) from generate_series(1, 330) d))
from generate_series(1, 4) k;
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'QPSMA7', exchange, interval, ts, open, high, low, close, volume from public.market_candles where symbol = 'QPSMA1';

select private.refresh_market_analytics(400, array['QPSMA1', 'QPSMA2', 'QPSMA3', 'QPSMA4', 'QPSMA5', 'QPSMA6', 'QPSMA7']);
select qp_t12.check(not exists (select 1 from public.trading_signals where symbol like 'QPSMA%' and strategy = 'sma_20_50_cross'),
                    'retired: the analytics no longer write SMA 20/50 cross signals');
-- QPSMA2 does cross: the 20-day average closes above the 50-day after the bounce.
select qp_t12.check((select count(*) > 0 from (
                       select a.ts, a.s20, a.s50, lag(a.s20) over (order by a.ts) as p20, lag(a.s50) over (order by a.ts) as p50
                       from (select c.ts, avg(c.close) over w20 as s20, avg(c.close) over w50 as s50
                               from public.market_candles c where c.symbol = 'QPSMA2'
                             window w20 as (order by c.ts rows 19 preceding), w50 as (order by c.ts rows 49 preceding)) a) x
                      where x.ts > qp_t12.day(60) and x.s20 > x.s50 and x.p20 <= x.p50),
                    'fixture: the laggard crosses too');

-- The migration ranks every stored session once; a normal run then ranks only the last 14 days.
select private.refresh_leaders(true);
select private.refresh_sma_trend(array['QPSMA1', 'QPSMA2', 'QPSMA7']);

select qp_t12.check((select rs_pct = 1 from public.market_leaders where symbol = 'QPSMA1' and day = (qp_t12.day(172) at time zone 'Asia/Kolkata')::date)
                    and (select rs_pct < 0.7 from public.market_leaders where symbol = 'QPSMA2' and day = (qp_t12.day(172) at time zone 'Asia/Kolkata')::date)
                    and not exists (select 1 from public.market_leaders where symbol = 'QPSMA7'),
                    'leaders: six-month return ranked among the 500 largest companies only');
select qp_t12.check((select count(*) = 1 and bool_and((payload->>'rs_pct')::numeric >= 0.7 and (payload->>'stop')::numeric < (payload->>'close')::numeric
                                                       and (payload->>'review_sessions')::int = 60)
                       from public.trading_signals where symbol = 'QPSMA1' and strategy = 'sma_trend' and signal_type = 'buy'),
                    'buy: the 20/50 cross in a leader, safety stop under the close, review after 60 sessions');
select qp_t12.check((select p->>'result' = 'REVIEW_60' and (p->>'bars_held')::int = 60 and (p->>'pnl_pct')::numeric > 0
                       from (select payload p from public.trading_signals where symbol = 'QPSMA1' and strategy = 'sma_trend' and signal_type = 'exit') x),
                    'exit: still rising after 60 sessions, closed at the review with its result');
select qp_t12.check(not exists (select 1 from public.trading_signals where symbol in ('QPSMA2', 'QPSMA7') and strategy = 'sma_trend'),
                    'no buy: a laggard''s cross, or a company outside the 500 largest');
select qp_t12.check(private.refresh_sma_trend(array['QPSMA1']) = 0 and private.refresh_leaders() = 0,
                    'refresh: re-running adds nothing, and the ranking runs once per session');

select private.grade_signals(array['QPSMA1'], null);
select qp_t12.check(exists (select 1 from public.signal_outcomes o join public.trading_signals t on t.id = o.signal_id
                             where t.symbol = 'QPSMA1' and t.strategy = 'sma_trend' and o.r20 > 0),
                    'grade: the buy is graded like every rule');
select qp_t12.check((select trades = 1 and made_money_pct = 100 from public.strategy_trade_results where strategy = 'sma_trend'),
                    'trade results: the exit''s stored result');
select qp_t12.check(has_table_privilege('authenticated', 'public.market_leaders', 'select')
                    and not has_table_privilege('authenticated', 'public.market_leaders', 'insert')
                    and not has_table_privilege('anon', 'public.market_leaders', 'select')
                    and not has_function_privilege('authenticated', 'private.refresh_sma_trend(text[])', 'execute'),
                    'grants: rankings read-only to members, jobs for the service role');
select qp_t12.check((select public.svc_refresh_market_analytics(400, array['QPSMA1']) ? 'sma_trend'), 'svc: the pipeline wrapper runs the SMA trend rule');

rollback;
