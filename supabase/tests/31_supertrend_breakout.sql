-- SuperTrend breakout (migration 62): the owner's AmiBroker rule. The expected days and prices come from the
-- independent Python port of the formula (research/strategies/ab_check.py) on the same made-up prices. Rolled back.
begin;

create schema qp_t31;
create function qp_t31.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t31.day(p_d integer) returns timestamptz language sql immutable as $$
  select date_trunc('day', now()) - (340 - p_d + 1) * interval '1 day' + interval '10 hours'
$$;
create function qp_t31.ist(p_d integer) returns date language sql immutable as $$
  select (qp_t31.day(p_d) at time zone 'Asia/Kolkata')::date
$$;
-- 340 sessions: up 0.3 % a day to day 260, down 2 % to 270, up 1 % to 300, down 2 % to 312, then up 0.4 %; rounded
-- each day; high = close + 1, low = close - 1, open = close.
create function qp_t31.load(p_symbol text, p_from integer default 1) returns void language sql as $$
  with recursive s(d, c) as (
    select 1, 100.00::numeric
    union all
    select d + 1, round(c * (1 + case when d + 1 <= 260 then 0.003 when d + 1 <= 270 then -0.02
                                      when d + 1 <= 300 then 0.01 when d + 1 <= 312 then -0.02 else 0.004 end), 2)
    from s where d < 340
  )
  insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
  select p_symbol, 'NSE', '1d', qp_t31.day(d), c, c + 1, c - 1, c, 1000000 from s where d >= p_from
$$;

delete from public.trading_signals where strategy = 'supertrend_breakout';   -- only the fixtures' trades count (rolled back)
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPST1', 'NSE', 'Climb, dip, rebound, dip, rebound', true, 'equity', 1),
  ('QPST2', 'NSE', 'Same prices, small company', true, 'equity', 900),
  ('QPST3', 'NSE', 'Same prices, too little history', true, 'equity', 2);
select qp_t31.load('QPST1');
select qp_t31.load('QPST2');
select qp_t31.load('QPST3', 130);                                          -- 211 sessions: the slope needs 220

select qp_t31.check((select close = 239.19 from public.market_candles where symbol = 'QPST1' and ts = qp_t31.day(300)),
                    'fixture: the same prices as the Python version');

select private.refresh_supertrend_breakout(array['QPST1', 'QPST2', 'QPST3']);

select qp_t31.check((select count(*) = 2 from public.trading_signals
                     where symbol = 'QPST1' and strategy = 'supertrend_breakout' and signal_type = 'buy'),
                    'two buys, as in Python');
select qp_t31.check((select (generated_at at time zone 'Asia/Kolkata')::date = qp_t31.ist(278)
                            and (payload->>'setup_day')::date = qp_t31.ist(277)
                            and (payload->>'trigger')::numeric = (select high + 0.05 from public.market_candles where symbol = 'QPST1' and ts = qp_t31.day(277))
                            and (payload->>'close')::numeric >= (payload->>'trigger')::numeric
                            and (payload->>'slope')::numeric > 0 and payload->>'stop' is null
                            and payload->>'label' = 'SuperTrend breakout'
                     from public.trading_signals where symbol = 'QPST1' and strategy = 'supertrend_breakout' and signal_type = 'buy'
                     order by generated_at limit 1),
                    'buy: SuperTrend turned up on day 277 with the slope up; day 278 closed above that day''s high + 0.05; no stop');
select qp_t31.check((select count(*) = 1
                            and bool_and((generated_at at time zone 'Asia/Kolkata')::date = qp_t31.ist(304))
                            and bool_and(payload->>'result' = 'ST_RED' and (payload->>'red_day')::date = qp_t31.ist(303))
                            and bool_and((payload->>'entry_fill')::numeric = 194.09 and (payload->>'exit_price')::numeric = 220.63)
                            and bool_and((payload->>'pnl_pct')::numeric = 13.67 and (payload->>'bars_held')::int = 26)
                     from public.trading_signals where symbol = 'QPST1' and strategy = 'supertrend_breakout' and signal_type = 'exit'),
                    'exit: SuperTrend turned down on day 303, sold at the day-304 open (194.09 -> 220.63, +13.67 %, 26 sessions)');
select qp_t31.check((select (generated_at at time zone 'Asia/Kolkata')::date = qp_t31.ist(332)
                     from public.trading_signals where symbol = 'QPST1' and strategy = 'supertrend_breakout'
                     order by generated_at desc limit 1),
                    'the second buy (day 332) is still open');
select qp_t31.check(not exists (select 1 from public.trading_signals where symbol in ('QPST2', 'QPST3') and strategy = 'supertrend_breakout'),
                    'nothing for a company outside the 500 largest, or with too little history');

-- It continues from the last stored signal.
select qp_t31.check(private.refresh_supertrend_breakout(array['QPST1']) = 0, 'refresh: re-running adds nothing');
delete from public.trading_signals where symbol = 'QPST1' and strategy = 'supertrend_breakout'
   and generated_at > qp_t31.day(300);
select qp_t31.check(private.refresh_supertrend_breakout(array['QPST1']) = 2, 'holding the day-278 buy: the exit and the next buy come back');
select qp_t31.check((select (payload->>'exit_price')::numeric = 220.63 and (payload->>'pnl_pct')::numeric = 13.67
                     from public.trading_signals where symbol = 'QPST1' and strategy = 'supertrend_breakout' and signal_type = 'exit'),
                    'the same exit, worked out again');

-- It joins the other rules everywhere they are listed.
select private.grade_signals(array['QPST1'], null);
select qp_t31.check((select entry_day = qp_t31.ist(279) and exit_day = qp_t31.ist(304) and result = 'ST_RED'
                     from public.rule_trades where symbol = 'QPST1' and strategy = 'supertrend_breakout'
                     order by signal_day limit 1),
                    'rule_trades: its trade, entry to exit (your trades next to the rules)');
select qp_t31.check((select count(*) = 2 and count(result_pct) = 1 and max(result_pct) = 13.67
                     from public.signal_trades where symbol = 'QPST1' and strategy = 'supertrend_breakout'),
                    'signal_trades: its result, for rule health; the open trade has none');
select qp_t31.check(private.rule_label('supertrend_breakout') = 'SuperTrend breakout', 'its name');
select qp_t31.check((select made_pct = 41.0 and avg_pct = 5.28 and trades = 3158 from public.rule_expectations where strategy = 'supertrend_breakout'),
                    'its tested record is the yardstick for rule health');
select qp_t31.check((select pg_get_constraintdef(oid) like '%supertrend_breakout%' from pg_constraint
                     where conname = 'notification_prefs_exit_rules_check'),
                    'holders may choose it for messages');
select qp_t31.check((select column_default not like '%supertrend%' from information_schema.columns
                     where table_schema = 'public' and table_name = 'notification_prefs' and column_name = 'exit_rules'),
                    'not on by default for messages');
select qp_t31.check(not has_function_privilege('authenticated', 'private.refresh_supertrend_breakout(text[])', 'execute'),
                    'only the server runs it');
select qp_t31.check((select prosrc like '%private.trusted_candles%' and prosrc not like '%public.market_candles%'
                     from pg_proc where proname = 'refresh_supertrend_breakout'),
                    'it reads the guarded prices');

do $$ begin raise notice 'SUPERTREND BREAKOUT TESTS PASSED'; end $$;
rollback;
