-- Daily setup scanner (migration 31): five fixture charts, each shaped to match (or miss) a rule.
-- Rolled back.
begin;

create schema qp_t8;
create function qp_t8.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t8.tags(p_symbol text) returns text[] language sql stable as $$
  select setups from public.market_quotes where symbol = p_symbol and exchange = 'NSE'
$$;

insert into public.market_symbols (symbol, exchange, name, is_active) values
  ('QPBRK', 'NSE', 'Breakout fixture', true),
  ('QPFLAG', 'NSE', 'Flag fixture', true),
  ('QPDROP', 'NSE', 'Oversold fixture', true),
  ('QPRECL', 'NSE', 'Reclaim fixture', true),
  ('QPSHORT', 'NSE', 'Too little history', true);

-- 30 daily closes, oldest first, ending yesterday (all inside the 75-day window).
create function qp_t8.load(p_symbol text, p_closes numeric[]) returns void language sql as $$
  insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
  select p_symbol, 'NSE', '1d',
         date_trunc('day', now()) - (array_length(p_closes, 1) - i + 1) * interval '1 day' + interval '10 hours',
         c, c, c, c, 1000000
  from unnest(p_closes) with ordinality as t(c, i)
$$;

-- Rising every day: the last close tops the 20 before it, and nothing else fires.
select qp_t8.load('QPBRK', (select array_agg(100 + i::numeric) from generate_series(0, 29) i));
-- Flat, then +15 % over ten sessions, then five closes inside 1 %: a flag, not a breakout.
select qp_t8.load('QPFLAG', array[100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,
                                  101.5,103,104.5,106,107.5,109,110.5,112,113.5,115,
                                  116,115.5,116.5,116,116.2]::numeric[]);
-- Falling for weeks (RSI far under 30), then one up close: oversold and an oversold bounce.
select qp_t8.load('QPDROP', (select array_agg(200 - i * 3::numeric) from generate_series(0, 27) i) || array[118, 119]::numeric[]);
-- Flat at 100, one dip under the average, then a close above it (also a 20-day closing high).
select qp_t8.load('QPRECL', (select array_agg(100::numeric) from generate_series(0, 27)) || array[95, 104]::numeric[]);
-- 20 sessions only: never tagged.
select qp_t8.load('QPSHORT', (select array_agg(100 + i::numeric) from generate_series(0, 19) i));

select private.refresh_market_analytics(60, array['QPBRK', 'QPFLAG', 'QPDROP', 'QPRECL', 'QPSHORT']);
select private.refresh_setups(array['QPBRK', 'QPFLAG', 'QPDROP', 'QPRECL', 'QPSHORT']);

select qp_t8.check(qp_t8.tags('QPBRK') = '{breakout_20d}', 'breakout: a new 20-day closing high, alone');
select qp_t8.check(qp_t8.tags('QPFLAG') = '{bull_flag}', 'flag: +15% run then a tight five-day range, not a breakout');
select qp_t8.check(qp_t8.tags('QPDROP') @> '{oversold,oversold_bounce}', 'drop: oversold, and the up close is a bounce');
select qp_t8.check(not qp_t8.tags('QPDROP') && '{breakout_20d,reclaim_ma20,bull_flag}', 'drop: nothing bullish on a falling chart');
select qp_t8.check(qp_t8.tags('QPRECL') @> '{reclaim_ma20,breakout_20d}', 'reclaim: back above the 20-day average');
select qp_t8.check(coalesce(qp_t8.tags('QPSHORT'), '{}') = '{}', 'history: fewer than 30 sessions is never tagged');

-- A symbol that stops matching loses its tags on the next run.
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
values ('QPBRK', 'NSE', '1d', date_trunc('day', now()) + interval '10 hours', 110, 110, 110, 110, 1000000);
select private.refresh_market_analytics(60, array['QPBRK']);
select private.refresh_setups(array['QPBRK']);
select qp_t8.check(not qp_t8.tags('QPBRK') @> '{breakout_20d}', 'refresh: a lower close clears the breakout');

-- Readable through the snapshot by members; only the service role may run the refresh wrapper.
select qp_t8.check((select setups from public.market_snapshot where symbol = 'QPFLAG') = '{bull_flag}', 'snapshot: setups column');
select qp_t8.check(not has_function_privilege('authenticated', 'private.refresh_setups(text[])', 'execute'), 'grants: users cannot run the refresh');
select qp_t8.check((public.svc_refresh_market_analytics(60, array['QPFLAG']) ? 'setups'), 'svc: the pipeline wrapper refreshes setups too');

rollback;
