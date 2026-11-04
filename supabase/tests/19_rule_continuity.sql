-- The rules continue their stored record (migration 45) and leaders are ranked once (migration 46). Rolled back.
begin;

create schema qp_t19;
create function qp_t19.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t19.day(p_d integer) returns timestamptz language sql immutable as $$
  select date_trunc('day', now()) - (400 - p_d + 1) * interval '1 day' + interval '10 hours'
$$;
-- QPMA1 of test 15: 100 for 300 sessions, then up 0.5 a day; its 200-day trend buy is on day 312, the review on day 372.
create function qp_t19.load(p_symbol text, p_from integer, p_to integer) returns void language sql as $$
  insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
  select p_symbol, 'NSE', '1d', qp_t19.day(d), c, c + 1, c - 1, c, 1000000
  from (select d, (case when d <= 300 then 100 else 100 + 0.5 * (d - 300) end)::numeric as c
          from generate_series(p_from, p_to) d) x
$$;
create function qp_t19.rows(p_symbol text) returns bigint language sql as $$
  select count(*) from public.trading_signals where symbol = p_symbol and strategy = 'ma200_trend'
$$;

delete from public.trading_signals where strategy = 'ma200_trend';
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPC1', 'NSE', 'Open trade, then its exit', true, 'equity', 1),
  ('QPC2', 'NSE', 'A record that ends later than the chain', true, 'equity', 2);

-- 1. an open buy is followed to its exit when the later sessions arrive
select qp_t19.load('QPC1', 1, 340);
select private.refresh_ma200_trend(array['QPC1']);
select qp_t19.check(qp_t19.rows('QPC1') = 1
                    and (select signal_type = 'buy' and (generated_at at time zone 'Asia/Kolkata')::date = (qp_t19.day(312) at time zone 'Asia/Kolkata')::date
                           from public.trading_signals where symbol = 'QPC1' and strategy = 'ma200_trend'),
                    'open: day 312''s buy is stored, no exit yet');
create temporary table qp_t19_buy as select id from public.trading_signals where symbol = 'QPC1' and strategy = 'ma200_trend';
select qp_t19.load('QPC1', 341, 400);
select private.refresh_ma200_trend(array['QPC1']);
select qp_t19.check(qp_t19.rows('QPC1') = 2
                    and (select payload->>'result' = 'REVIEW_60' and (payload->>'bars_held')::int = 60
                           from public.trading_signals where symbol = 'QPC1' and strategy = 'ma200_trend' and signal_type = 'exit')
                    and exists (select 1 from public.trading_signals t join qp_t19_buy b on b.id = t.id),
                    'open: the next runs add its 60-session exit and keep the buy as it was');

-- 2. trimming the oldest candles (the nightly retention) writes nothing new
delete from public.market_candles where symbol = 'QPC1' and ts < qp_t19.day(61);
select qp_t19.check(private.refresh_ma200_trend(array['QPC1']) = 0 and qp_t19.rows('QPC1') = 2,
                    'trim: 60 sessions trimmed, the record unchanged');

-- 3. nothing is written at or before the last stored signal: a stored record ending on day 330 keeps the day-312 buy out
select qp_t19.load('QPC2', 1, 400);
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
values ('QPC2', 'NSE', 'ma200_trend', 'exit', '{"action":"exit","result":"STOP_HIT","pnl_pct":-3}', qp_t19.day(330) + interval '15 minutes');
select private.refresh_ma200_trend(array['QPC2']);
select qp_t19.check(qp_t19.rows('QPC2') = 1, 'append-only: no trade before the stock''s last stored signal');

-- 4. where each rule starts again
select qp_t19.check(private.rule_resume('QPNONE', 'NSE', 'ma200_trend', array[qp_t19.day(1), qp_t19.day(2)], 1) = 0,
                    'resume: a stock with no stored signal starts at the beginning');
select qp_t19.check(private.rule_resume('QPC2', 'NSE', 'ma200_trend',
                      (select array_agg(ts order by ts) from public.market_candles where symbol = 'QPC2'), 1) = 330,
                    'resume: after a stored exit, from the session after it');
select qp_t19.check(private.rule_resume('QPC1', 'NSE', 'ma200_trend',
                      array(select qp_t19.day(d) from generate_series(1, 340) d), 1) = 340,
                    'resume: the last stored row is the exit (day 372 is beyond these 340 sessions, all covered)');
delete from public.trading_signals where symbol = 'QPC1' and strategy = 'ma200_trend' and signal_type = 'exit';
select qp_t19.check(private.rule_resume('QPC1', 'NSE', 'ma200_trend',
                      array(select qp_t19.day(d) from generate_series(1, 400) d), 1) = 311
                    and private.rule_resume('QPC1', 'NSE', 'ma200_trend',
                      array(select qp_t19.day(d) from generate_series(1, 400) d), 2) = 310,
                    'resume: an open buy is taken again from its signal day (one session earlier for the dip rules)');
select qp_t19.check(not has_function_privilege('authenticated', 'private.rule_resume(text, public.exchange_code, text, timestamptz[], integer)', 'execute'),
                    'grants: rule_resume is not callable by members');

-- 5. leaders: once a session is ranked, a second call does nothing
select private.refresh_leaders();
select qp_t19.check(private.refresh_leaders() = 0, 'leaders: the latest session is ranked once');

rollback;
