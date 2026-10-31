-- RSI dip and KK dip (migration 35): fixture charts worked out by hand, rolled back.
begin;

create schema qp_t11;
create function qp_t11.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t11.day(p_d integer) returns timestamptz language sql immutable as $$
  select date_trunc('day', now()) - (330 - p_d + 1) * interval '1 day' + interval '10 hours'
$$;
create function qp_t11.ist(p_d integer) returns date language sql immutable as $$
  select (qp_t11.day(p_d) at time zone 'Asia/Kolkata')::date
$$;
create function qp_t11.sig(p_symbol text, p_strategy text, p_type text) returns jsonb language sql stable as $$
  select payload from public.trading_signals where symbol = p_symbol and strategy = p_strategy and signal_type = p_type
$$;
-- Daily candles: a close per day, a 1-point range either side, open = close unless given.
create function qp_t11.load(p_symbol text, p_close numeric[], p_open numeric[] default null, p_high numeric[] default null,
                            p_low numeric[] default null) returns void language sql as $$
  insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
  select p_symbol, 'NSE', '1d', qp_t11.day(i::int), coalesce(p_open[i], c), coalesce(p_high[i], c + 1), coalesce(p_low[i], c - 1), c, 1000000
  from unnest(p_close) with ordinality as t(c, i)
$$;

-- Only the fixtures' dip trades count in the summaries below (rolled back: the real ones stay).
delete from public.trading_signals where strategy in ('rsi_dip', 'kk_dip');
delete from public.market_candles where symbol = 'NIFTY';
insert into public.market_symbols (symbol, exchange, name, is_active, segment) values ('NIFTY', 'NSE', 'NIFTY 50', true, 'index')
on conflict (symbol, exchange) do update set is_active = true, segment = 'index';
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'NIFTY', 'NSE', '1d', qp_t11.day(d), 10000 + d, 10001 + d, 9999 + d, 10000 + d, 0 from generate_series(1, 330) d;

insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPDIP1', 'NSE', 'RSI dip, filled, sold on the bounce', true, 'equity', 11),
  ('QPDIP2', 'NSE', 'RSI dip, never filled', true, 'equity', 12),
  ('QPDIP3', 'NSE', 'Push under the 20-day low', true, 'equity', 13),
  ('QPDIP4', 'NSE', 'Dip on the latest close', true, 'equity', 14),
  ('QPDIP5', 'NSE', 'Dip in a falling stock', true, 'equity', 15),
  ('QPDIP6', 'NSE', 'Dip, small company', true, 'equity', 900);

-- QPDIP1: +0.5 a day to 250 (day 300), then 246, 242 (RSI(2) 4.0: the signal), day 303 trades down to 238
-- (through the 239.59 limit: filled), day 304 closes 247 above its 5-day average: sold.
select qp_t11.load('QPDIP1',
  (select array_agg(case when d <= 300 then 100 + 0.5 * d when d = 301 then 246 when d = 302 then 242 when d = 303 then 241
                         else 247 + 0.5 * (d - 304) end::numeric order by d) from generate_series(1, 330) d),
  p_low => (select array_agg(case when d = 303 then 238 end::numeric order by d) from generate_series(1, 330) d),
  p_high => (select array_agg(case when d = 303 then 242 end::numeric order by d) from generate_series(1, 330) d));
-- QPDIP2: the same, but day 303 only reaches 240 (not 0.2 % through the limit): no trade.
select qp_t11.load('QPDIP2',
  (select array_agg(case when d <= 300 then 100 + 0.5 * d when d = 301 then 246 when d = 302 then 242 when d = 303 then 241
                         else 247 + 0.5 * (d - 304) end::numeric order by d) from generate_series(1, 330) d),
  p_low => (select array_agg(case when d = 303 then 240 end::numeric order by d) from generate_series(1, 330) d),
  p_high => (select array_agg(case when d = 303 then 242 end::numeric order by d) from generate_series(1, 330) d));
-- QPDIP3: day 302 pushes to 230 (under 0.99 x the 20-day low of 240) and closes 245; day 303 dips to 240: filled.
select qp_t11.load('QPDIP3',
  (select array_agg(case when d <= 301 then 100 + 0.5 * d when d = 302 then 245 when d = 303 then 244
                         else 250 + 0.5 * (d - 304) end::numeric order by d) from generate_series(1, 330) d),
  p_open => (select array_agg(case when d = 302 then 250.5 end::numeric order by d) from generate_series(1, 330) d),
  p_high => (select array_agg(case when d = 302 then 251.5 when d = 303 then 245 end::numeric order by d) from generate_series(1, 330) d),
  p_low => (select array_agg(case when d = 302 then 230 when d = 303 then 240 end::numeric order by d) from generate_series(1, 330) d));
-- QPDIP4: the RSI dip lands on the latest close: tomorrow's dip-buy level, no trade yet.
select qp_t11.load('QPDIP4',
  (select array_agg(case when d <= 328 then 100 + 0.5 * d when d = 329 then 260 else 256 end::numeric order by d)
     from generate_series(1, 330) d));
-- QPDIP5: falling for 300 days, then the same two-day drop: under its 200-day average, so nothing.
select qp_t11.load('QPDIP5',
  (select array_agg(case when d <= 300 then 300 - 0.5 * d when d = 301 then 146 when d = 302 then 142 when d = 303 then 141
                         else 147 - 0.5 * (d - 304) end::numeric order by d) from generate_series(1, 330) d),
  p_low => (select array_agg(case when d = 303 then 138 end::numeric order by d) from generate_series(1, 330) d));
-- QPDIP6: QPDIP1's chart on a company outside the 500 largest.
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'QPDIP6', exchange, interval, ts, open, high, low, close, volume from public.market_candles where symbol = 'QPDIP1';

select private.refresh_market_analytics(400, array['QPDIP1', 'QPDIP2', 'QPDIP3', 'QPDIP4', 'QPDIP5', 'QPDIP6']);
select qp_t11.check(not exists (select 1 from public.trading_signals where symbol like 'QPDIP%' and strategy = 'rsi_reversal'),
                    'retired: the analytics no longer write RSI reversal signals');

select private.refresh_dip_rules(array['QPDIP1', 'QPDIP2', 'QPDIP3', 'QPDIP4', 'QPDIP5', 'QPDIP6']);

select qp_t11.check((select (p->>'fill')::numeric = 239.59 and (p->>'limit')::numeric = 239.59 and p->>'signal_day' = qp_t11.ist(302)::text
                            and (p->>'stop')::numeric = 227.52 and (p->>'rsi2')::numeric < 10
                       from qp_t11.sig('QPDIP1', 'rsi_dip', 'buy') p),
                    'rsi dip: RSI(2) under 10 in an uptrend, bought the next day at close - 1 ATR, stop 5 ATR under');
select qp_t11.check((select p->>'result' = 'BOUNCE' and (p->>'exit_price')::numeric = 247 and (p->>'pnl_pct')::numeric = 3.09
                            and (p->>'bars_held')::int = 2
                       from qp_t11.sig('QPDIP1', 'rsi_dip', 'exit') p),
                    'rsi dip: sold at the first close above the 5-day average');
select qp_t11.check((select generated_at from public.trading_signals where symbol = 'QPDIP1' and strategy = 'rsi_dip' and signal_type = 'buy')
                    = qp_t11.day(303) + interval '30 minutes', 'rsi dip: the buy is dated on the fill day');
select qp_t11.check(not exists (select 1 from public.trading_signals where symbol = 'QPDIP1' and strategy = 'kk_dip'),
                    'kk dip: a dip whose next day stays above the limit is no trade');
select qp_t11.check(not exists (select 1 from public.trading_signals where symbol = 'QPDIP2'),
                    'no fill: a low only 0.2 % short of the limit buys nothing');
select qp_t11.check((select (p->>'fill')::numeric = 241.61 and (p->>'low_20d')::numeric = 240
                       from qp_t11.sig('QPDIP3', 'kk_dip', 'buy') p)
                    and (select p->>'result' = 'BOUNCE' and (p->>'exit_price')::numeric = 250 from qp_t11.sig('QPDIP3', 'kk_dip', 'exit') p),
                    'kk dip: a push under the 20-day low that closes back up, bought on the next dip, sold on the bounce');
select qp_t11.check((select signal_day = qp_t11.ist(330) and limit_price > 0 and stop < limit_price and payload ? 'rsi2'
                       from public.signal_watch where symbol = 'QPDIP4' and strategy = 'rsi_dip')
                    and not exists (select 1 from public.trading_signals where symbol = 'QPDIP4'),
                    'watch: a dip on the latest close becomes tomorrow''s dip-buy level, not a trade');
select qp_t11.check(not exists (select 1 from public.trading_signals where symbol in ('QPDIP5', 'QPDIP6'))
                    and not exists (select 1 from public.signal_watch where symbol in ('QPDIP5', 'QPDIP6')),
                    'no signal: under the 200-day average, or outside the 500 largest companies');
select qp_t11.check(private.refresh_dip_rules(array['QPDIP1', 'QPDIP3', 'QPDIP4']) = 0
                    and (select count(*) from public.signal_watch where symbol = 'QPDIP4') = 1, 'refresh: re-running adds nothing');

-- A new session: yesterday's dip-buy level expires.
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
values ('NIFTY', 'NSE', '1d', qp_t11.day(331), 10331, 10332, 10330, 10331, 0);
select private.refresh_dip_rules(array['QPDIP4']);
select qp_t11.check(not exists (select 1 from public.signal_watch where symbol = 'QPDIP4'), 'watch: good for the next session only');

-- Graded from the fill like every entry signal; members read the watch list; only the jobs write it.
select private.grade_signals(array['QPDIP1'], null);
select qp_t11.check((select entry_price = 239.59 and entry_day = qp_t11.ist(303) and round(r5, 4) = round(248.5 / 239.59 - 1, 4)
                       from public.signal_outcomes o join public.trading_signals t on t.id = o.signal_id
                      where t.symbol = 'QPDIP1' and t.strategy = 'rsi_dip'),
                    'grade: from the fill on the fill day');
select qp_t11.check(has_table_privilege('authenticated', 'public.signal_watch', 'select')
                    and not has_table_privilege('authenticated', 'public.signal_watch', 'insert')
                    and not has_table_privilege('anon', 'public.signal_watch', 'select')
                    and not has_function_privilege('authenticated', 'private.refresh_dip_rules(text[])', 'execute'),
                    'grants: dip-buy levels are read-only to members');
select qp_t11.check((select public.svc_refresh_market_analytics(400, array['QPDIP1']) ? 'dips'), 'svc: the pipeline wrapper runs the dip rules');

-- Trade results by each rule's own plan (migration 36): the dip exits carry their result; an SMA-style exit is paired
-- with the buy just before it, and an exit with no buy before it is not a trade.
select qp_t11.check((select trades = 2 and made_money_pct = 100 and avg_result_pct = 3.28
                       from public.strategy_trade_results where strategy = 'rsi_dip' and side = 'long'),
                    'trade results: the rule''s own exits (QPDIP1 +3.09 %, QPDIP3 +3.47 %), with their results');
delete from public.trading_signals where symbol = 'QPDIP5' or strategy = 'sma_20_50_cross';
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at) values
  ('QPDIP5', 'NSE', 'sma_20_50_cross', 'exit', '{"close": 90}',  qp_t11.day(10)),
  ('QPDIP5', 'NSE', 'sma_20_50_cross', 'buy',  '{"close": 100}', qp_t11.day(20)),
  ('QPDIP5', 'NSE', 'sma_20_50_cross', 'exit', '{"close": 95}',  qp_t11.day(30)),
  ('QPDIP5', 'NSE', 'rsi_reversal',    'buy',  '{"close": 100}', qp_t11.day(20)),
  ('QPDIP5', 'NSE', 'rsi_reversal',    'exit', '{"close": 130}', qp_t11.day(40));
select qp_t11.check((select trades = 1 and avg_result_pct = -5 and made_money_pct = 0
                       from public.strategy_trade_results where strategy = 'sma_20_50_cross'),
                    'trade results: an SMA exit closes the buy before it; an exit without one is skipped');
select qp_t11.check(not exists (select 1 from public.strategy_trade_results where strategy = 'rsi_reversal'),
                    'trade results: none for RSI reversal (its exits only follow winners, so pairing would flatter it)');
select qp_t11.check(has_table_privilege('authenticated', 'public.strategy_trade_results', 'select')
                    and not has_table_privilege('anon', 'public.strategy_trade_results', 'select'), 'grants: trade results for members');

rollback;
