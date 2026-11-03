-- 200-day trend (migration 41): above the 200-day average, the average's regression line flat or rising, the price
-- leaning up in a fairly straight line; a 60-session plan. Rolled back.
begin;

create schema qp_t15;
create function qp_t15.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t15.day(p_d integer) returns timestamptz language sql immutable as $$
  select date_trunc('day', now()) - (400 - p_d + 1) * interval '1 day' + interval '10 hours'
$$;
create function qp_t15.load(p_symbol text, p_close numeric[]) returns void language sql as $$
  insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
  select p_symbol, 'NSE', '1d', qp_t15.day(i::int), c, c + 1, c - 1, c, 1000000
  from unnest(p_close) with ordinality as t(c, i)
$$;

delete from public.trading_signals where strategy = 'ma200_trend';        -- only the fixtures' trades count (rolled back)
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPMA1', 'NSE', 'Flat for a year, then rising', true, 'equity', 1),
  ('QPMA2', 'NSE', 'Long fall, sharp bounce', true, 'equity', 2),
  ('QPMA3', 'NSE', 'Rising chart, small company', true, 'equity', 900);

-- QPMA1: 100 for 300 sessions, then up 0.5 a day. It closes above its flat 200-day average from day 301; the last 100
-- closes lean up straight enough (Pearson's R >= 0.5) from day 312, so the rule turns on that day.
select qp_t15.load('QPMA1', (select array_agg(case when d <= 300 then 100 else 100 + 0.5 * (d - 300) end::numeric order by d)
                               from generate_series(1, 400) d));
-- QPMA2: falls 0.9 a day for 320 sessions, then bounces 3 a day: it closes above its 200-day average around day 345,
-- but that average is still falling steeply, so the rule stays off.
select qp_t15.load('QPMA2', (select array_agg(case when d <= 320 then 400 - 0.9 * d else 112 + 3 * (d - 320) end::numeric order by d)
                               from generate_series(1, 400) d));
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'QPMA3', exchange, interval, ts, open, high, low, close, volume from public.market_candles where symbol = 'QPMA1';

select qp_t15.check((select count(*) > 0 from (
                       select a.close, a.s200, a.n, lag(a.close) over (order by a.ts) as pc, lag(a.s200) over (order by a.ts) as ps
                       from (select c.ts, c.close, avg(c.close) over w as s200, count(*) over w as n
                               from public.market_candles c where c.symbol = 'QPMA2'
                             window w as (order by c.ts rows 199 preceding)) a) x
                      where x.n = 200 and x.close > x.s200 and x.pc <= x.ps),
                    'fixture: the bounce does close above its 200-day average');

select private.refresh_ma200_trend(array['QPMA1', 'QPMA2', 'QPMA3']);

select qp_t15.check((select count(*) = 1
                            and bool_and((generated_at at time zone 'Asia/Kolkata')::date = (qp_t15.day(312) at time zone 'Asia/Kolkata')::date)
                            and bool_and((payload->>'close')::numeric > (payload->>'sma200')::numeric
                                         and (payload->>'slope_pct')::numeric >= -0.25 and (payload->>'r_px')::numeric >= 0.5
                                         and (payload->>'stop')::numeric < (payload->>'close')::numeric
                                         and (payload->>'review_sessions')::int = 60)
                       from public.trading_signals where symbol = 'QPMA1' and strategy = 'ma200_trend' and signal_type = 'buy'),
                    'buy: the first day all three hold, with its measures, a safety stop and a 60-session review');
select qp_t15.check((select p->>'result' = 'REVIEW_60' and (p->>'bars_held')::int = 60 and (p->>'pnl_pct')::numeric > 0
                       from (select payload p from public.trading_signals where symbol = 'QPMA1' and strategy = 'ma200_trend' and signal_type = 'exit') x),
                    'exit: still rising after 60 sessions, closed at the review with its result');
select qp_t15.check(not exists (select 1 from public.trading_signals where symbol in ('QPMA2', 'QPMA3') and strategy = 'ma200_trend'),
                    'no buy: a bounce over a falling 200-day average, or a company outside the 500 largest');
select qp_t15.check(private.refresh_ma200_trend(array['QPMA1']) = 0, 'refresh: re-running adds nothing');

select private.grade_signals(array['QPMA1'], null);
select qp_t15.check(exists (select 1 from public.signal_outcomes o join public.trading_signals t on t.id = o.signal_id
                             where t.symbol = 'QPMA1' and t.strategy = 'ma200_trend' and o.r20 > 0),
                    'grade: the buy is graded like every rule');
select qp_t15.check((select result_pct > 0 and exit_reason = 'REVIEW_60' from public.signal_trades
                      where strategy = 'ma200_trend' and symbol = 'QPMA1'),
                    'health: the trade reaches the rule-health view with how it ended');
select private.refresh_rule_health();
select qp_t15.check((select trades = 1 and status = 'too_few' and expected_pct = 56 from public.rule_health
                      where strategy = 'ma200_trend' and day = (now() at time zone 'Asia/Kolkata')::date),
                    'health: the rule is checked daily against its tested record');
select qp_t15.check(not has_function_privilege('authenticated', 'private.refresh_ma200_trend(text[])', 'execute')
                    and not has_function_privilege('anon', 'private.refresh_ma200_trend(text[])', 'execute'),
                    'grants: the job is for the service role only');
select qp_t15.check((select public.svc_refresh_market_analytics(400, array['QPMA1']) ? 'ma200_trend'),
                    'svc: the pipeline wrapper runs the 200-day trend rule');

rollback;
