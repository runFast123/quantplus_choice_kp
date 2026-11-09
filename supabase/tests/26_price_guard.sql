-- Price guard and signal conditions (migration 57). A made-up stock with the Secular trend fixture of test 24 (a buy on
-- day 894, out at the 60-session review on day 954), then one bad low that would have hit the safety stop. Rolled back.
begin;

create schema qp_t26;
create function qp_t26.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
grant usage on schema qp_t26 to authenticated, anon;
grant execute on all functions in schema qp_t26 to authenticated, anon;
create function qp_t26.day(p_d integer) returns timestamptz language sql immutable as $$
  select date_trunc('day', now()) - (1000 - p_d + 1) * interval '1 day' + interval '10 hours'
$$;
create function qp_t26.ist(p_d integer) returns date language sql immutable as $$
  select (qp_t26.day(p_d) at time zone 'Asia/Kolkata')::date
$$;
create function qp_t26.load(p_symbol text) returns void language sql as $$
  with recursive s(d, c) as (
    select 1, 100.00::numeric
    union all
    select d + 1, round(c * (1 + case when d + 1 <= 650 then 0.001 when d + 1 <= 870 then -0.004 else 0.006 end), 2)
    from s where d < 1000
  )
  insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
  select p_symbol, 'NSE', '1d', qp_t26.day(d), c, c + 1, c - 1, c, 1000000 from s
$$;
create function qp_t26.c(p_d integer) returns numeric language sql stable as $$
  select close from public.market_candles where symbol = 'QPPG1' and interval = '1d' and ts = qp_t26.day(p_d)
$$;
create function qp_t26.exit_reason() returns text language sql stable as $$
  select payload->>'result' || '@' || (generated_at at time zone 'Asia/Kolkata')::date
  from public.trading_signals where symbol = 'QPPG1' and strategy = 'secular_trend' and signal_type = 'exit'
$$;

delete from public.trading_signals where strategy = 'secular_trend';
insert into public.market_symbols (symbol, exchange, name, sector, is_active, segment, mcap_rank) values
  ('QPPG1', 'NSE', 'Price guard one', 'Tech', true, 'equity', 1),
  ('QPPG2', 'NSE', 'Price guard two', 'Tech', true, 'equity', 2),
  ('QPPG3', 'NSE', 'Price guard three', 'Tech', true, 'equity', 3);
select qp_t26.load('QPPG1');

-- 1. Flags follow the candles.
select qp_t26.check(not exists (select 1 from public.candle_checks where symbol = 'QPPG1'),
                    'smooth prices: nothing flagged');
update public.market_candles set low = 50 where symbol = 'QPPG1' and ts = qp_t26.day(900);
select qp_t26.check((select bad_low and not bad_open and not bad_high and status = 'suspect' and day = qp_t26.ist(900)
                            and prev_close = qp_t26.c(899) and low = 50 and close = qp_t26.c(900)
                     from public.candle_checks where symbol = 'QPPG1'),
                    'a low 12 % under both closes is flagged suspect, as stored');
select qp_t26.check((select count(*) = 1 from public.candle_checks where symbol = 'QPPG1'),
                    'only that day: the next session is re-checked and is fine');
select qp_t26.check((select t.low = least(t.open, t.close) and t.open = c.open and t.high = c.high and t.close = c.close
                     from private.trusted_candles t join public.market_candles c using (symbol, exchange, interval, ts)
                     where t.symbol = 'QPPG1' and t.ts = qp_t26.day(900)),
                    'the rules read the lower of open and close as that day''s low');
select qp_t26.check((select count(*) = 0 from private.trusted_candles t
                     join public.market_candles c using (symbol, exchange, interval, ts)
                     where t.symbol = 'QPPG1' and t.ts <> qp_t26.day(900)
                       and (t.open, t.high, t.low, t.close, t.volume) is distinct from (c.open, c.high, c.low, c.close, c.volume)),
                    'every other day reads as stored');

-- 2. The rules: the bad low does not hit the stop.
select private.refresh_secular_trend(array['QPPG1']);
select qp_t26.check(qp_t26.exit_reason() = 'REVIEW_60@' || qp_t26.ist(954),
                    'a suspect low does not hit the safety stop: out at the 60-session review, as without it');

-- 3. An admin calls it real: the stock's rule history is worked out again and the stop is hit.
select qp_t26.check((select (r->>'rebuilt')::boolean and r->>'was' = 'suspect'
                     from public.svc_review_candle('QPPG1', 'NSE', qp_t26.ist(900), 'real') r),
                    'review "real": rebuilt');
select qp_t26.check(qp_t26.exit_reason() = 'STOP_HIT@' || qp_t26.ist(900)
                    and (select (payload->>'exit_price')::numeric = (select (b.payload->>'stop')::numeric
                                   from public.trading_signals b where b.symbol = 'QPPG1' and b.strategy = 'secular_trend'
                                    and b.signal_type = 'buy')
                         from public.trading_signals where symbol = 'QPPG1' and strategy = 'secular_trend' and signal_type = 'exit'),
                    'a real low counts: out at the safety stop that day, at the stop');
select qp_t26.check((select status = 'real' and reviewed_at is not null from public.candle_checks where symbol = 'QPPG1'),
                    'the review is kept');
select qp_t26.check((select not (r->>'rebuilt')::boolean from public.svc_review_candle('QPPG1', 'NSE', qp_t26.ist(900), 'real') r),
                    'the same review again changes nothing the rules read');
select qp_t26.check((select (r->>'rebuilt')::boolean from public.svc_review_candle('QPPG1', 'NSE', qp_t26.ist(900), 'bad') r),
                    'review "bad": rebuilt');
select qp_t26.check(qp_t26.exit_reason() = 'REVIEW_60@' || qp_t26.ist(954),
                    'set aside again: the review exit comes back');
do $$ begin
  perform public.svc_review_candle('QPPG1', 'NSE', current_date, 'bad');
  raise exception 'FAIL [a day that is not flagged cannot be reviewed]';
exception when others then
  if sqlerrm not like '%NOT_FOUND%' then raise; end if;
  raise notice 'PASS [a day that is not flagged cannot be reviewed]';
end $$;

-- 4. Yahoo revises the day.
update public.market_candles set low = 60 where symbol = 'QPPG1' and ts = qp_t26.day(900);
select qp_t26.check((select status = 'suspect' and reviewed_at is null and low = 60 from public.candle_checks where symbol = 'QPPG1'),
                    'revised but still wrong: back to suspect, the review no longer applies');
update public.market_candles set low = close - 1 where symbol = 'QPPG1' and ts = qp_t26.day(900);
select qp_t26.check(not exists (select 1 from public.candle_checks where symbol = 'QPPG1'),
                    'revised to a normal day: the flag goes');
update public.market_candles set low = round(close * 0.86, 2) where symbol = 'QPPG1' and ts = qp_t26.day(911);
select qp_t26.check((select count(*) = 1 and bool_and(day = qp_t26.ist(911) and bad_low)
                     from public.candle_checks where symbol = 'QPPG1'),
                    'day 911: a low 14 % under its close is flagged');
update public.market_candles set close = round(close * 0.9, 2), low = round(close * 0.9, 2) - 1
 where symbol = 'QPPG1' and ts = qp_t26.day(910);
select qp_t26.check(not exists (select 1 from public.candle_checks where symbol = 'QPPG1'),
                    'a changed close the day before re-checks the next session: against the lower close it is not 12 % away');
update public.market_candles set close = round(close / 0.9, 2), low = round(close / 0.9, 2) - 1
 where symbol = 'QPPG1' and ts = qp_t26.day(910);
update public.market_candles set low = close - 1 where symbol = 'QPPG1' and ts = qp_t26.day(911);
delete from public.candle_checks where symbol = 'QPPG1';
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
values ('QPPG2', 'NSE', '1d', qp_t26.day(1), 100, 101, 99, 100, 1000),
       ('QPPG2', 'NSE', '1d', qp_t26.day(2), 70, 103, 70, 102, 1000);
select qp_t26.check((select bad_open and bad_low and not bad_high from public.candle_checks where symbol = 'QPPG2'),
                    'new rows are checked as they arrive');
select qp_t26.check((select open = 102 and low = 102 and high = 103 from private.trusted_candles
                      where symbol = 'QPPG2' and ts = qp_t26.day(2)),
                    'a suspect open: the close; the low: the lower of that and the close');
delete from public.market_candles where symbol = 'QPPG2';
delete from public.candle_checks where symbol = 'QPPG2';

-- 5. Every function that decides a trade, a grade or an alert reads trusted prices.
select qp_t26.check((select count(*) = 8 and bool_and(pg_get_functiondef(p.oid) like '%private.trusted_candles%'
                                                     and pg_get_functiondef(p.oid) not like '%public.market_candles%')
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'private'
                       and p.proname in ('refresh_strong_trend', 'refresh_sma_trend', 'refresh_ma200_trend', 'refresh_secular_trend',
                                         'refresh_dip_rules', 'grade_signals', 'refresh_rsi_checks', 'run_eod_notifier')),
                    'the rules, the grades, the RSI dip check and price alerts read private.trusted_candles');

-- 6. Signal conditions.
select private.refresh_secular_trend(array['QPPG1']);
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at) values
  ('QPPG2', 'NSE', 'secular_trend', 'buy', '{}', qp_t26.day(894) + interval '15 minutes'),
  ('QPPG3', 'NSE', 'secular_trend', 'buy', '{}', qp_t26.day(880) + interval '15 minutes');
delete from public.market_weather where day >= qp_t26.ist(820);
insert into public.market_weather (day, nifty, nifty_sma50, nifty_sma200, vix, state)
select qp_t26.ist(d), 20000 + 10 * d, 20000, 19000, 13 + d % 3, 'sunny' from generate_series(820, 900) d;
delete from public.market_breadth where day = qp_t26.ist(894);
insert into public.market_breadth (day, breadth50, breadth200, stocks) values (qp_t26.ist(894), 0.61, 0.55, 480);
delete from public.signal_conditions where symbol like 'QPPG%';

select qp_t26.check(private.refresh_signal_conditions(array['QPPG1', 'QPPG2', 'QPPG3']) >= 1, 'conditions written');
select qp_t26.check((select sector = 'Tech' and not top300 and version = 'conditions/1'
                            and (features->>'wx')::int = 2 and (features->>'breadth50')::numeric = 0.61
                            and (features->>'same_day')::int = 2 and (features->>'open_rule')::int = 1
                            and (features->>'open_sector')::int = 1
                            and features ? 'rsi14' and features ? 'atrpct' and features ? 'nifty_r20' and features ? 'vix_chg5'
                            and abs((features->>'nifty_d200')::numeric - ((20000 + 10 * 894)::numeric / 19000 - 1)) < 1e-6
                     from public.signal_conditions where symbol = 'QPPG1' and strategy = 'secular_trend'),
                    'the market at the signal''s close, and how crowded the rule was (2 buys that day, 1 still open)');
select qp_t26.check((select abs((sc.features->>'d50')::numeric
                                - (qp_t26.c(894) / (select avg(close) from public.market_candles
                                                     where symbol = 'QPPG1' and ts > qp_t26.day(844) and ts <= qp_t26.day(894)) - 1)) < 1e-6
                            and abs((sc.features->>'r20')::numeric - (qp_t26.c(894) / qp_t26.c(874) - 1)) < 1e-6
                     from public.signal_conditions sc where sc.symbol = 'QPPG1' and sc.strategy = 'secular_trend'),
                    'point in time: the 50-day distance and 20-day move use closes up to the signal day only');
select qp_t26.check(not exists (select 1 from public.signal_conditions where symbol in ('QPPG2', 'QPPG3')),
                    'no prices, no conditions (written once the stock''s days are stored or two weeks have passed)');

-- A recent buy waits for its day's market context.
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
values ('QPPG1', 'NSE', 'sma_trend', 'buy', '{}', qp_t26.day(1000) + interval '15 minutes');
select private.refresh_signal_conditions(array['QPPG1']);
select qp_t26.check(not exists (select 1 from public.signal_conditions where symbol = 'QPPG1' and strategy = 'sma_trend'),
                    'a recent buy without its day''s weather and breadth waits');
insert into public.market_weather (day, nifty, nifty_sma50, nifty_sma200, vix, state)
values (qp_t26.ist(1000), 21000, 20000, 19000, 15, 'stormy') on conflict (day) do update set state = 'stormy';
insert into public.market_breadth (day, breadth50, breadth200, stocks) values (qp_t26.ist(1000), 0.3, 0.4, 480)
on conflict (day) do update set breadth50 = 0.3;
select private.refresh_signal_conditions(array['QPPG1']);
select qp_t26.check((select (features->>'wx')::int = 0 and (features->>'breadth50')::numeric = 0.3
                     from public.signal_conditions where symbol = 'QPPG1' and strategy = 'sma_trend'),
                    'then it is written');
select qp_t26.check(private.refresh_signal_conditions(array['QPPG1']) = 0, 'frozen: re-running writes nothing');
select qp_t26.check(pg_get_functiondef('public.svc_refresh_signal_checks(boolean)'::regprocedure)
                      like '%refresh_market_breadth%refresh_signal_conditions%refresh_rule_health%',
                    'the checks run write them after the breadth');

-- 7. Access.
set local role authenticated;
select qp_t26.check((select count(*) >= 1 from public.signal_conditions where symbol = 'QPPG1'), 'signed in: reads conditions');
select qp_t26.check((select count(*) >= 0 from public.candle_checks), 'signed in: reads the price flags');
do $$ begin
  insert into public.candle_checks (symbol, exchange, ts, day, prev_close, open, high, low, close, bad_open, bad_high, bad_low)
  values ('QPPG9', 'NSE', now(), current_date, 1, 1, 1, 1, 1, true, false, false);
  raise exception 'FAIL [signed in: cannot write the price flags]';
exception when insufficient_privilege then raise notice 'PASS [signed in: cannot write the price flags]';
end $$;
do $$ begin
  perform public.svc_review_candle('QPPG1', 'NSE', current_date, 'real');
  raise exception 'FAIL [signed in: cannot review a price]';
exception when insufficient_privilege then raise notice 'PASS [signed in: cannot review a price]';
end $$;
do $$ begin
  perform 1 from private.trusted_candles limit 1;
  raise exception 'FAIL [signed in: cannot read the private view]';
exception when insufficient_privilege then raise notice 'PASS [signed in: cannot read the private view]';
end $$;
reset role;
set local role anon;
do $$ begin
  perform 1 from public.signal_conditions limit 1;
  raise exception 'FAIL [anonymous: cannot read conditions]';
exception when insufficient_privilege then raise notice 'PASS [anonymous: cannot read conditions]';
end $$;
reset role;

do $$ begin raise notice 'PRICE GUARD TESTS PASSED'; end $$;
rollback;
