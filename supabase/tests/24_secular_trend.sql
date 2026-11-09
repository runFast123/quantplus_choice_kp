-- Secular trend (migration 55): Pring's Special K crossing above its 50/50 signal line while flat or rising and below
-- -150; a 60-session plan. The expected days come from the independent Python version (research/strategies/
-- record_secular.py) on the same made-up prices. Rolled back.
begin;

create schema qp_t24;
create function qp_t24.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t24.day(p_d integer) returns timestamptz language sql immutable as $$
  select date_trunc('day', now()) - (1000 - p_d + 1) * interval '1 day' + interval '10 hours'
$$;
-- 1,000 sessions: up 0.1 % a day to day 650, down p_fall a day to day 870, then up 0.6 % a day; rounded each day.
create function qp_t24.load(p_symbol text, p_fall numeric, p_from integer default 1) returns void language sql as $$
  with recursive s(d, c) as (
    select 1, 100.00::numeric
    union all
    select d + 1, round(c * (1 + case when d + 1 <= 650 then 0.001 when d + 1 <= 870 then -p_fall else 0.006 end), 2)
    from s where d < 1000
  )
  insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
  select p_symbol, 'NSE', '1d', qp_t24.day(d), c, c + 1, c - 1, c, 1000000 from s where d >= p_from
$$;

delete from public.trading_signals where strategy = 'secular_trend';      -- only the fixtures' trades count (rolled back)
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPSK1', 'NSE', 'Long rise, deep fall, rebound', true, 'equity', 1),
  ('QPSK2', 'NSE', 'Long rise, shallow fall, rebound', true, 'equity', 2),
  ('QPSK3', 'NSE', 'Deep fall, small company', true, 'equity', 900),
  ('QPSK4', 'NSE', 'Deep fall, too little history', true, 'equity', 3);
select qp_t24.load('QPSK1', 0.004);
select qp_t24.load('QPSK2', 0.0015);
select qp_t24.load('QPSK3', 0.004);
select qp_t24.load('QPSK4', 0.004, 201);                                  -- 800 sessions: the signal line needs 823

select qp_t24.check((select close = 91.43 from public.market_candles where symbol = 'QPSK1' and ts = qp_t24.day(894)),
                    'fixture: the same prices as the Python version');

select private.refresh_secular_trend(array['QPSK1', 'QPSK2', 'QPSK3', 'QPSK4']);

select qp_t24.check((select count(*) = 1
                            and bool_and((generated_at at time zone 'Asia/Kolkata')::date = (qp_t24.day(894) at time zone 'Asia/Kolkata')::date)
                            and bool_and((payload->>'close')::numeric = 91.43 and (payload->>'stop')::numeric = 83.43
                                         and (payload->>'secular')::numeric < -150
                                         and (payload->>'secular')::numeric > (payload->>'secular_signal')::numeric
                                         and payload->>'label' = 'Secular trend' and (payload->>'review_sessions')::int = 60)
                       from public.trading_signals where symbol = 'QPSK1' and strategy = 'secular_trend' and signal_type = 'buy'),
                    'buy: day 894, as in Python: crossed its signal line below -150, close - 4 x ATR stop, 60-session review');
select qp_t24.check((select (generated_at at time zone 'Asia/Kolkata')::date = (qp_t24.day(954) at time zone 'Asia/Kolkata')::date
                            and payload->>'result' = 'REVIEW_60' and (payload->>'bars_held')::int = 60
                            and (payload->>'exit_price')::numeric = 130.92
                            and (payload->>'entry_fill')::numeric = (select open from public.market_candles where symbol = 'QPSK1' and ts = qp_t24.day(895))
                            and payload->>'label' = 'Secular trend: 60-session review'
                       from public.trading_signals where symbol = 'QPSK1' and strategy = 'secular_trend' and signal_type = 'exit'),
                    'exit: the 60th session (day 954) at its close, entered at the next open');
select qp_t24.check(not exists (select 1 from public.trading_signals where symbol = 'QPSK2' and strategy = 'secular_trend'),
                    'no buy: a shallow fall crosses its signal line above -150');
select qp_t24.check(not exists (select 1 from public.trading_signals where symbol in ('QPSK3', 'QPSK4') and strategy = 'secular_trend'),
                    'no buy: a company outside the 500 largest, or too little history for the signal line');
select qp_t24.check(private.refresh_secular_trend(array['QPSK1', 'QPSK2']) = 0, 'refresh: re-running adds nothing');

-- It joins the other rules everywhere they are listed.
select private.grade_signals(array['QPSK1'], null);
select qp_t24.check((select entry_day = (qp_t24.day(895) at time zone 'Asia/Kolkata')::date
                            and exit_day = (qp_t24.day(954) at time zone 'Asia/Kolkata')::date and result = 'REVIEW_60'
                     from public.rule_trades where symbol = 'QPSK1' and strategy = 'secular_trend'),
                    'rule_trades: its trade, entry to exit (your trades next to the rules)');
select qp_t24.check((select count(*) = 1 and bool_and(result_pct > 0) from public.signal_trades where symbol = 'QPSK1' and strategy = 'secular_trend'),
                    'signal_trades: its result, for rule health');
select qp_t24.check(private.rule_label('secular_trend') = 'Secular trend', 'its name');
select qp_t24.check((select made_pct = 52.9 and trades = 450 from public.rule_expectations where strategy = 'secular_trend'),
                    'its tested record is the yardstick for rule health');
select qp_t24.check((select pg_get_constraintdef(oid) like '%secular_trend%' from pg_constraint
                     where conname = 'notification_prefs_exit_rules_check'),
                    'holders may choose it for messages');
select qp_t24.check((select column_default not like '%secular%' from information_schema.columns
                     where table_schema = 'public' and table_name = 'notification_prefs' and column_name = 'exit_rules'),
                    'not on by default for messages');
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank, history_days)
values ('QPSK5', 'NSE', 'New in the top 500', true, 'equity', 10, 400);
select qp_t24.check((select history_days = 1300 from public.market_symbols where symbol = 'QPSK5'),
                    'the 500 largest keep 1,300 days of prices');

do $$ begin raise notice 'SECULAR TREND TESTS PASSED'; end $$;
rollback;
