-- System audit fixes (migration 59): signal list indexes; the price guard on the pipeline's real write path (a
-- multi-row insert ... on conflict do update); the review view (500 largest, stored days only); a review refreshes the
-- stock's signal conditions. Rolled back.
begin;

create schema qp_t28;
create function qp_t28.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
grant usage on schema qp_t28 to authenticated, anon;
grant execute on all functions in schema qp_t28 to authenticated, anon;
create function qp_t28.plan(p_sql text) returns text language plpgsql as $$
declare
  v text := '';
  r record;
begin
  for r in execute 'explain ' || p_sql loop v := v || r."QUERY PLAN" || E'\n'; end loop;
  return v;
end $$;
create function qp_t28.ts(p_d integer) returns timestamptz language sql immutable as $$
  select timestamptz '2001-06-01 10:00+00' + p_d * interval '1 day'
$$;

-- 1. Signal lists.
select qp_t28.check(exists (select 1 from pg_indexes where tablename = 'trading_signals' and indexname = 'trading_signals_strategy_time_idx'
                            and indexdef like '%(strategy, generated_at DESC)%'), 'index: rule, newest first');
select qp_t28.check(exists (select 1 from pg_indexes where tablename = 'trading_signals' and indexname = 'trading_signals_time_idx'
                            and indexdef like '%(generated_at DESC)%'), 'index: newest first');
set local enable_seqscan = off;      -- the fixture table is small; ask whether an index can serve the read at all
select qp_t28.check(qp_t28.plan($q$select * from public.trading_signals where strategy = 'rsi_dip' order by generated_at desc limit 200$q$)
                      like '%trading_signals_strategy_time_idx%',
                    'one rule''s newest 200 read from the index, no sort');
-- (The six rules' list: on a table this small the planner sorts; on the live table it is checked with EXPLAIN.)
select qp_t28.check(qp_t28.plan($q$select * from public.trading_signals order by generated_at desc limit 200$q$)
                      like '%trading_signals_time_idx%',
                    'the newest 200 overall read from the index');
reset enable_seqscan;

-- 2. The pipeline's write path: one multi-row upsert that inserts a new day and rewrites an old one.
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPAF1', 'NSE', 'Audit fix one', true, 'equity', 21),
  ('QPAF2', 'NSE', 'Audit fix small', true, 'equity', 3000);
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume) values
  ('QPAF1', 'NSE', '1d', qp_t28.ts(1), 100, 101, 99, 100, 1000),
  ('QPAF1', 'NSE', '1d', qp_t28.ts(2), 100, 101, 99, 100, 1000),
  ('QPAF2', 'NSE', '1d', qp_t28.ts(1), 100, 101, 99, 100, 1000);
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume) values
  ('QPAF1', 'NSE', '1d', qp_t28.ts(2), 100, 101, 70, 100, 1000),      -- a rewritten day: a bad low
  ('QPAF1', 'NSE', '1d', qp_t28.ts(3), 100, 101, 60, 100, 1000),      -- a new day: a bad low
  ('QPAF2', 'NSE', '1d', qp_t28.ts(2), 100, 101, 60, 100, 1000)
on conflict (symbol, exchange, interval, ts) do update set low = excluded.low;
select qp_t28.check((select count(*) = 2 from public.candle_checks where symbol = 'QPAF1' and bad_low and status = 'suspect'),
                    'insert ... on conflict do update: the rewritten day and the new day are both flagged');

-- 3. The review view: the 500 largest, stored days only.
select qp_t28.check((select count(*) = 2 from public.candle_checks_review where symbol = 'QPAF1')
                    and not exists (select 1 from public.candle_checks_review where symbol = 'QPAF2')
                    and exists (select 1 from public.candle_checks where symbol = 'QPAF2'),
                    'review view: a small company''s flag is kept but not listed for review');
delete from public.market_candles where symbol = 'QPAF1' and ts = qp_t28.ts(3);
select qp_t28.check((select count(*) = 1 from public.candle_checks_review where symbol = 'QPAF1'),
                    'review view: a flag whose day is no longer stored is not listed');
set local role authenticated;
select qp_t28.check((select count(*) >= 1 from public.candle_checks_review where symbol = 'QPAF1'), 'signed in: reads the review view');
reset role;
set local role anon;
do $$ begin
  perform 1 from public.candle_checks_review limit 1;
  raise exception 'FAIL [anonymous: cannot read the review view]';
exception when insufficient_privilege then raise notice 'PASS [anonymous: cannot read the review view]';
end $$;
reset role;

-- 4. A review refreshes the stock's signal conditions with its rules; market days are one writer at a time and need
--    the index to have fallen.
select qp_t28.check(pg_get_functiondef('public.svc_review_candle(text, text, date, text)'::regprocedure)
                      like '%rebuild_rule_signals%delete from public.signal_conditions%refresh_signal_conditions%',
                    'a review rebuilds the stock''s rules, then its signal conditions');
select qp_t28.check(pg_get_functiondef('private.mark_market_days(date[])'::regprocedure) like '%pg_advisory_xact_lock%'
                    and pg_get_functiondef('private.mark_market_days(date[])'::regprocedure) like '%0.97%',
                    'market days: one writer at a time, and the NIFTY must have fallen 3 %');

do $$ begin raise notice 'AUDIT FIX TESTS PASSED'; end $$;
rollback;
