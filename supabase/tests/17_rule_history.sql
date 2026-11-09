-- Longer history and the rule rebuild (migration 43, ADR-041). Rolled back.
begin;

create schema qp_t17;
create function qp_t17.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t17.day(p_d integer) returns timestamptz language sql immutable as $$
  select date_trunc('day', now()) - (400 - p_d + 1) * interval '1 day' + interval '10 hours'
$$;

-- 1. how much history is kept
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank, history_days) values
  ('QPRH1', 'NSE', 'Large company', true, 'equity', 3, 760),
  ('QPRH2', 'NSE', 'Small company', true, 'equity', 900, 400);
select qp_t17.check((select history_days = 1300 from public.market_symbols where symbol = 'QPRH1')
                    and (select history_days = 400 from public.market_symbols where symbol = 'QPRH2'),
                    'history: a top-500 company keeps ~3.6 years, a small one what it had');
update public.market_symbols set mcap_rank = 450 where symbol = 'QPRH2';
select qp_t17.check((select history_days = 1300 from public.market_symbols where symbol = 'QPRH2'),
                    'history: a company climbing into the 500 is raised too');
update public.market_symbols set history_days = 900 where symbol = 'QPRH1';
select qp_t17.check((select history_days = 1300 from public.market_symbols where symbol = 'QPRH1'),
                    'history: never lowered under 1,300 for the 500 largest');

-- 2. the rebuild: QPRH1 flat at 100 for 300 sessions, then up 0.5 a day (200-day trend buys on day 312, see test 15)
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'QPRH1', 'NSE', '1d', qp_t17.day(d), c, c + 1, c - 1, c, 1000000
from (select d, (case when d <= 300 then 100 else 100 + 0.5 * (d - 300) end)::numeric c from generate_series(1, 400) d) x;
delete from public.trading_signals where symbol = 'QPRH1';
-- What a shorter history had written: a 200-day trend buy on day 330, inside the trade the full history opens on day 312,
-- and an old rule's signal, which is history and must stay.
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at) values
  ('QPRH1', 'NSE', 'ma200_trend', 'buy', '{"close": 115, "stop": 100, "label": "200-day trend"}', qp_t17.day(330) + interval '15 minutes'),
  ('QPRH1', 'NSE', 'rsi_reversal', 'buy', '{"close": 101}', qp_t17.day(305) + interval '15 minutes');

select qp_t17.check((select (private.rebuild_rule_signals(array['QPRH1']) ->> 'deleted')::int = 1), 'rebuild: the five rules'' signals are removed first');
select qp_t17.check((select count(*) = 1 and bool_and((generated_at at time zone 'Asia/Kolkata')::date = (qp_t17.day(312) at time zone 'Asia/Kolkata')::date)
                       from public.trading_signals where symbol = 'QPRH1' and strategy = 'ma200_trend' and signal_type = 'buy'),
                    'rebuild: the buy the full history gives, not the one written on a shorter history');
select qp_t17.check(exists (select 1 from public.trading_signals where symbol = 'QPRH1' and strategy = 'rsi_reversal'),
                    'rebuild: the old rules'' signals are kept');
select qp_t17.check(exists (select 1 from public.signal_outcomes o join public.trading_signals t on t.id = o.signal_id
                             where t.symbol = 'QPRH1' and t.strategy = 'ma200_trend'),
                    'rebuild: the new signals are graded');
create table qp_t17.ids as select id from public.trading_signals where symbol = 'QPRH1' and strategy = 'ma200_trend';
select qp_t17.check((select (r ->> 'deleted')::int = 2 and (r ->> 'same_id')::int = 2 from (select private.rebuild_rule_signals(array['QPRH1']) r) x)
                    and (select count(*) = 2 from public.trading_signals where symbol = 'QPRH1' and strategy = 'ma200_trend'),
                    'rebuild: running it again gives the same signals');
select qp_t17.check((select array_agg(id order by id) from public.trading_signals where symbol = 'QPRH1' and strategy = 'ma200_trend')
                    = (select array_agg(id order by id) from qp_t17.ids),
                    'rebuild: a signal written again keeps its id (no second notification)');

do $$ begin
  perform private.rebuild_rule_signals(array[]::text[]);
  raise exception 'FAIL [rebuild: an empty list is refused]';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS [rebuild: an empty list is refused]';
end $$;
select qp_t17.check(not has_function_privilege('authenticated', 'private.rebuild_rule_signals(text[])', 'execute')
                    and not has_function_privilege('anon', 'private.rebuild_rule_signals(text[])', 'execute'),
                    'grants: the rebuild is for the service role only');

rollback;
