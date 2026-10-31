-- Strong trend, market weather and the signal grader (migration 33). Fixture charts, rolled back.
begin;

create schema qp_t10;
create function qp_t10.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;

-- Start from an empty market so the fixtures alone decide the weather and the signals.
delete from public.signal_outcomes;
delete from public.market_weather;
delete from public.market_candles where symbol in ('NIFTY', 'INDIAVIX', 'NIFTY500');
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('NIFTY', 'NSE', 'NIFTY 50', true, 'index', null), ('INDIAVIX', 'NSE', 'India VIX', true, 'index', null),
  ('NIFTY500', 'NSE', 'NIFTY 500', true, 'index', null)
on conflict (symbol, exchange) do update set is_active = true, segment = 'index';
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPST1', 'NSE', 'Breakout on volume', true, 'equity', 10),
  ('QPST2', 'NSE', 'Breakout, thin volume', true, 'equity', 20),
  ('QPST3', 'NSE', 'Breakout, small company', true, 'equity', 900),
  ('QPST4', 'NSE', 'Breakout that runs', true, 'equity', 30);

-- n daily candles ending yesterday: day d (1..n) gets close f(d), a 1 % range and volume v(d).
create function qp_t10.day(p_n integer, p_d integer) returns timestamptz language sql immutable as $$
  select date_trunc('day', now()) - (p_n - p_d + 1) * interval '1 day' + interval '10 hours'
$$;

-- The market: 330 rising sessions (sunny once the 200-day average exists), VIX calm at 14.
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select s, 'NSE', '1d', qp_t10.day(330, d), c, c * 1.005, c * 0.995, c, 0
from generate_series(1, 330) d,
     lateral (values ('NIFTY', 10000 + d * 10.0), ('NIFTY500', 9000 + d * 9.0), ('INDIAVIX', 14.0)) v(s, c);

-- QPST1: 300 flat sessions at 100, a breakout to 110 on 3x volume (day 301), then a fall through the stop.
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'QPST1', 'NSE', '1d', qp_t10.day(330, d), o, h, l, c, v
from generate_series(1, 330) d,
     lateral (select case when d < 301 then 100 when d = 301 then 101 when d < 306 then 110 else 90 end::numeric as o,
                     case when d < 301 then 101 when d = 301 then 110 when d < 306 then 112 else 91 end::numeric as h,
                     case when d < 301 then 99 when d = 301 then 100 when d < 306 then 109 else 88 end::numeric as l,
                     case when d < 301 then 100 when d = 301 then 110 when d < 306 then 111 else 90 end::numeric as c,
                     case when d = 301 then 3000000 else 1000000 end as v) x;
-- QPST2: the same breakout on 1.5x volume (under the 2x bar).
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'QPST2', 'NSE', '1d', ts, open, high, low, close, case when volume = 3000000 then 1500000 else volume end
from public.market_candles where symbol = 'QPST1';
-- QPST3: the QPST1 chart on a company outside the 500 largest.
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'QPST3', 'NSE', '1d', ts, open, high, low, close, volume from public.market_candles where symbol = 'QPST1';
-- QPST4: the breakout keeps rising for 29 sessions (still open: no exit, no second buy).
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'QPST4', 'NSE', '1d', qp_t10.day(330, d), c, c * 1.01, c * 0.99, c,
       case when d = 301 then 3000000 else 4000000 end
from generate_series(1, 330) d,
     lateral (select case when d < 301 then 100 else 110 + (d - 301) end::numeric as c) x;
update public.market_candles set volume = 1000000 where symbol = 'QPST4' and ts < qp_t10.day(330, 301);

select private.refresh_market_weather(true);
select qp_t10.check((select state from public.market_weather where day = (qp_t10.day(330, 301) at time zone 'Asia/Kolkata')::date) = 'sunny',
                    'weather: a rising Nifty with calm VIX is sunny');
select qp_t10.check((select count(*) from public.market_weather where state is null) = 199,
                    'weather: unknown until the Nifty has 200 sessions');

select private.refresh_strong_trend(array['QPST1', 'QPST2', 'QPST3', 'QPST4']);

select qp_t10.check((select count(*) from public.trading_signals where symbol = 'QPST1' and strategy = 'strong_trend' and signal_type = 'buy') = 1,
                    'buy: a new 52-week closing high on 3x volume in a sunny market');
select qp_t10.check((select (payload->>'stop')::numeric between 95 and 100 and (payload->>'review_sessions')::int = 60
                       from public.trading_signals where symbol = 'QPST1' and strategy = 'strong_trend' and signal_type = 'buy'),
                    'buy: stop four ATRs under the close, review after 60 sessions');
select qp_t10.check((select payload->>'result' = 'STOP_HIT' and (payload->>'entry_fill')::numeric = 110
                            and (payload->>'pnl_pct')::numeric < 0
                       from public.trading_signals where symbol = 'QPST1' and strategy = 'strong_trend' and signal_type = 'exit'),
                    'exit: the fall through the stop closes the trade, measured from the next open');
select qp_t10.check(not exists (select 1 from public.trading_signals where symbol in ('QPST2', 'QPST3') and strategy = 'strong_trend'),
                    'no buy: under 2x volume, or outside the 500 largest companies');
select qp_t10.check((select count(*) filter (where signal_type = 'buy') = 1 and count(*) filter (where signal_type = 'exit') = 0
                       from public.trading_signals where symbol = 'QPST4' and strategy = 'strong_trend'),
                    'open trade: no exit before the stop or 60 sessions, and no second buy meanwhile');
select qp_t10.check(private.refresh_strong_trend(array['QPST1', 'QPST4']) = 0, 'refresh: re-running adds nothing');

-- A stormy day: VIX above 22 on the breakout day stops the signal.
update public.market_candles set close = 25 where symbol = 'INDIAVIX' and ts = qp_t10.day(330, 301);
select private.refresh_market_weather();
select qp_t10.check((select state from public.market_weather where day = (qp_t10.day(330, 301) at time zone 'Asia/Kolkata')::date) = 'sunny',
                    'weather: a normal run only rewrites the last 10 sessions');
select private.refresh_market_weather(true);
select qp_t10.check((select state from public.market_weather where day = (qp_t10.day(330, 301) at time zone 'Asia/Kolkata')::date) = 'stormy',
                    'weather: VIX above 22 is stormy');
delete from public.trading_signals where symbol = 'QPST1' and strategy = 'strong_trend';
select private.refresh_strong_trend(array['QPST1']);
select qp_t10.check(not exists (select 1 from public.trading_signals where symbol = 'QPST1' and strategy = 'strong_trend'),
                    'no buy: the market was stormy that day');
update public.market_candles set close = 14 where symbol = 'INDIAVIX' and ts = qp_t10.day(330, 301);
select private.refresh_market_weather(true);
select private.refresh_strong_trend(array['QPST1']);

-- Grading: QPST4's buy (day 301) entered at day 302's open (111); 28 sessions since, so r5 and r20 exist.
select private.grade_signals(array['QPST1', 'QPST4'], null);
select qp_t10.check((select entry_price = 111 and side = 'long' and weather = 'sunny'
                            and round(r5, 4) = round(115.0 / 111 - 1, 4) and round(r20, 4) = round(130.0 / 111 - 1, 4)
                            and r60 is null and idx20 > 0
                       from public.signal_outcomes o join public.trading_signals t on t.id = o.signal_id
                      where t.symbol = 'QPST4' and t.strategy = 'strong_trend'),
                    'grade: next open entry, 5 and 20 sessions graded, 60 still waiting, Nifty 500 alongside');
select qp_t10.check((select r5 < 0 and stop_hit_20 from public.signal_outcomes o join public.trading_signals t on t.id = o.signal_id
                      where t.symbol = 'QPST1' and t.strategy = 'strong_trend'),
                    'grade: a losing signal is graded too, with its stop hit');
select qp_t10.check(not exists (select 1 from public.signal_outcomes o join public.trading_signals t on t.id = o.signal_id
                                 where t.signal_type = 'exit' and coalesce(t.payload->>'action', '') <> 'sell'),
                    'grade: exits are not graded as predictions');
select qp_t10.check((select graded_20 = 2 and up_20_pct = 50 and beat_index_20_pct = 50 from public.strategy_scorecard
                      where strategy = 'strong_trend' and side = 'long' and period = 'all'),
                    'scorecard: one right, one wrong = 50 %, nothing left out');

-- A KK-style short with a fill is graded from its fill on the signal day, sign-flipped.
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
values ('QPST4', 'NSE', 'kk_breakout', 'exit', '{"action":"sell","fill":115,"stop":120}', qp_t10.day(330, 305));
select private.grade_signals(array['QPST4'], null);
select qp_t10.check((select side = 'short' and entry_price = 115 and r5 < 0
                       from public.signal_outcomes o join public.trading_signals t on t.id = o.signal_id
                      where t.symbol = 'QPST4' and t.strategy = 'kk_breakout'),
                    'grade: a short entered at its fill, losing as the price rose');

-- Grants: members read; only the service role runs the jobs; the pipeline wrapper runs them all.
select qp_t10.check(has_table_privilege('authenticated', 'public.signal_outcomes', 'select')
                    and not has_table_privilege('authenticated', 'public.signal_outcomes', 'insert')
                    and not has_table_privilege('anon', 'public.signal_outcomes', 'select'), 'grants: outcomes read-only to members');
select qp_t10.check(has_table_privilege('authenticated', 'public.market_weather', 'select')
                    and not has_table_privilege('authenticated', 'public.market_weather', 'update'), 'grants: weather read-only');
select qp_t10.check(not has_function_privilege('authenticated', 'private.grade_signals(text[], timestamptz)', 'execute')
                    and not has_function_privilege('authenticated', 'private.refresh_strong_trend(text[])', 'execute'),
                    'grants: users cannot run the jobs');
select qp_t10.check((select public.svc_refresh_market_analytics(400, array['QPST1']) ?& array['setups', 'weather', 'strong_trend', 'graded']),
                    'svc: the pipeline wrapper runs weather, strong trend and grading');

-- Retiring a symbol drops its SIP ledger (migration 34).
insert into public.backtest_ledgers (symbol, exchange, ledger, roi_pct) values ('QPST3', 'NSE', '{}', 0)
on conflict (symbol, exchange) do nothing;
update public.market_symbols set is_active = false where symbol = 'QPST3';
select qp_t10.check(not exists (select 1 from public.backtest_ledgers where symbol = 'QPST3'), 'retire: the SIP ledger goes with the symbol');
select qp_t10.check(not exists (select 1 from public.backtest_ledgers b join public.market_symbols s using (symbol, exchange) where not s.is_active),
                    'retire: no ledger left on any retired symbol');

rollback;
