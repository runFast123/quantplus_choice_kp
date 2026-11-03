-- Rule health and mistake review (migration 40): the window, the tested range, the causes and the grants. Rolled back.
begin;

create schema qp_t14;
create function qp_t14.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t14.d(p_d integer) returns date language sql immutable as $$ select current_date - 200 + p_d $$;
create function qp_t14.at(p_d integer) returns timestamptz language sql immutable as $$
  select (qp_t14.d(p_d)::timestamp + interval '10 hours') at time zone 'UTC'
$$;
-- one finished trade: a buy on day p_in and its exit on day p_out with the rule's result
create function qp_t14.trade(p_rule text, p_sym text, p_in integer, p_out integer, p_pnl numeric, p_result text)
returns void language sql as $$
  insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at) values
    (p_sym, 'NSE', p_rule, 'buy', '{"action": "buy"}', qp_t14.at(p_in)),
    (p_sym, 'NSE', p_rule, 'exit', jsonb_build_object('action', 'exit', 'result', p_result, 'pnl_pct', p_pnl), qp_t14.at(p_out))
$$;

delete from public.trading_signals where strategy in ('strong_trend', 'rsi_dip', 'kk_dip', 'sma_trend', 'ma200_trend');
delete from public.rule_health;
delete from public.market_candles where symbol = 'NIFTY500';
-- the Nifty 500 at 100 until day 100, then 95
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'NIFTY500', 'NSE', '1d', qp_t14.at(k), v, v, v, v, 0
from generate_series(1, 199) k, lateral (select case when k <= 100 then 100 else 95 end::numeric as v) x;

-- KK dip: 20 winners, 6 small losses, 7 losses while the market fell, 7 while it didn't (50 in 100 vs 68 tested).
select qp_t14.trade('kk_dip', 'QPW' || k, k, k + 5, 3, 'BOUNCE') from generate_series(1, 20) k;
select qp_t14.trade('kk_dip', 'QPS' || k, k, k + 5, -0.5, 'BOUNCE') from generate_series(1, 6) k;
select qp_t14.trade('kk_dip', 'QPM' || k, 96 + k % 3, 104 + k, -5, 'TIME_10') from generate_series(1, 7) k;
select qp_t14.trade('kk_dip', 'QPX' || k, 20 + k, 30 + k, -5, 'STOP_HIT') from generate_series(1, 7) k;
-- an older loser outside the window of 40 (it finished first), and an open trade with no exit
select qp_t14.trade('kk_dip', 'QPOLD', 1, 2, -9, 'STOP_HIT');
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
values ('QPOPEN', 'NSE', 'kk_dip', 'buy', '{"action": "buy"}', qp_t14.at(150));
-- RSI dip: only 10 finished trades
select qp_t14.trade('rsi_dip', 'QPR' || k, k, k + 3, 2, 'BOUNCE') from generate_series(1, 10) k;

select qp_t14.check((select count(*) = 20 and count(*) filter (where cause = 'small') = 6
                            and count(*) filter (where cause = 'market') = 7 and count(*) filter (where cause = 'stock') = 7
                       from public.rule_mistakes where strategy = 'kk_dip' and symbol <> 'QPOLD'),
                    'mistakes: every loser has one cause (small loss, market fell 5 %, stock fell on its own)');
select qp_t14.check((select market_pct = -5 and net_pct = -5.5 and exit_reason = 'TIME_10'
                       from public.rule_mistakes where symbol = 'QPM1'),
                    'mistakes: the market move over the trade, the result after costs and how it ended');
select qp_t14.check(not exists (select 1 from public.rule_mistakes where symbol like 'QPW%' or symbol = 'QPOPEN'),
                    'mistakes: winners and open trades are not mistakes');

select private.refresh_rule_health(current_date);
select qp_t14.check((select trades = 40 and made = 20 and made_pct = 50 and expected_pct = 68 and status = 'below'
                            and low_pct between 55 and 57 and (causes->>'market')::int = 7 and (causes->>'stock')::int = 7
                       from public.rule_health where strategy = 'kk_dip' and day = current_date),
                    'health: the last 40 finished trades, 50 in 100 against 68 tested -> below its range');
select qp_t14.check((select status = 'too_few' and trades = 10 from public.rule_health where strategy = 'rsi_dip' and day = current_date),
                    'health: under 20 finished trades -> too few to judge');
select qp_t14.check((select status = 'too_few' and trades = 0 and made_pct is null
                       from public.rule_health where strategy = 'sma_trend' and day = current_date),
                    'health: a rule with no finished trades still gets a row');

-- as of day 30 only trades finished by then count; re-running a day updates it in place
select private.refresh_rule_health(qp_t14.d(30));
select qp_t14.check((select trades = 27 and made = 20 and status = 'within'
                       from public.rule_health where strategy = 'kk_dip' and day = qp_t14.d(30)),
                    'health: as of an earlier day, only the trades finished by then');
select private.refresh_rule_health(current_date);
select qp_t14.check((select count(*) = (select count(*) from public.rule_expectations) from public.rule_health where day = current_date),
                    'health: one row per rule per day, re-runs update it');

select qp_t14.check(has_table_privilege('authenticated', 'public.rule_health', 'select')
                    and not has_table_privilege('authenticated', 'public.rule_health', 'insert')
                    and not has_table_privilege('authenticated', 'public.rule_expectations', 'update')
                    and not has_table_privilege('anon', 'public.rule_health', 'select')
                    and has_table_privilege('authenticated', 'public.rule_mistakes', 'select')
                    and not has_table_privilege('anon', 'public.rule_mistakes', 'select')
                    and not has_function_privilege('authenticated', 'private.refresh_rule_health(date)', 'execute'),
                    'grants: health, expectations and mistakes are read-only market data for members, nothing for anon');

rollback;
