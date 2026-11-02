-- Signal checks (migration 39): the Strong trend check, the RSI dip check, their record and the refit bridge. Rolled back.
begin;

create schema qp_t13;
create function qp_t13.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
-- calendar day d of the fixture (1..400), and a signal time on it (15:30 IST)
create function qp_t13.d(p_d integer) returns date language sql immutable as $$ select current_date - 400 + p_d $$;
create function qp_t13.at(p_d integer) returns timestamptz language sql immutable as $$
  select (qp_t13.d(p_d)::timestamp + interval '10 hours') at time zone 'UTC'
$$;

delete from public.signal_checks;
delete from public.signal_outcomes;
delete from public.trading_signals where strategy in ('strong_trend', 'rsi_dip');
delete from public.market_weather;
delete from public.signal_check_models;
delete from public.signal_check_training;

-- ------------------------------------------------------------------ Strong trend check
-- 30 finished trades in sunny weather that lost (-2 % / -5 % before the 0.5 % cost), then 30 in stormy weather that won.
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPCK', 'NSE', 'Check fixture', true, 'equity', 1)
on conflict (symbol, exchange) do update set is_active = true, segment = 'equity';
create function qp_t13.trade(p_sym text, p_d integer, p_weather text, p_r20 numeric) returns void language sql as $$
  with s as (
    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    values (p_sym, 'NSE', 'strong_trend', 'buy', '{"action": "buy", "close": 100, "stop": 90}', qp_t13.at(p_d))
    returning id
  )
  insert into public.signal_outcomes (signal_id, symbol, exchange, strategy, side, signal_day, weather, entry_day,
                                      entry_price, stop, r5, r20, stop_hit_20)
  select s.id, p_sym, 'NSE', 'strong_trend', 'long', qp_t13.d(p_d), p_weather, qp_t13.d(p_d + 1), 100, 90, 0, p_r20, false
  from s
$$;
select qp_t13.trade('QPLOSE' || k, k, 'sunny', case when k % 2 = 0 then -0.02 else -0.05 end) from generate_series(1, 30) k;
select qp_t13.trade('QPWIN' || k, 30 + k, 'stormy', case when k % 2 = 0 then 0.04 else 0.08 end) from generate_series(1, 30) k;
insert into public.market_weather (day, nifty, state) values
  (qp_t13.d(60), 100, 'sunny'), (qp_t13.d(150), 100, 'sunny'), (qp_t13.d(151), 100, 'stormy'), (qp_t13.d(152), 100, 'mixed');
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at) values
  ('QPCK', 'NSE', 'strong_trend', 'buy', '{"action": "buy"}', qp_t13.at(60)),
  ('QPST_A', 'NSE', 'strong_trend', 'buy', '{"action": "buy"}', qp_t13.at(150)),
  ('QPST_C', 'NSE', 'strong_trend', 'buy', '{"action": "buy"}', qp_t13.at(151)),
  ('QPST_E', 'NSE', 'strong_trend', 'buy', '{"action": "buy"}', qp_t13.at(152));
select private.refresh_trend_checks();

select qp_t13.check((select label = 'weak' and score < -1 and (detail->>'trades')::int = 30 and detail->>'bucket' = 'weather'
                       from public.signal_checks where symbol = 'QPST_A'),
                    'trend: weak when the last 30 finished trades in this weather lost money');
select qp_t13.check((select label = 'ok' and detail->>'bucket' = 'weather' from public.signal_checks where symbol = 'QPST_C'),
                    'trend: not weak when they made money (stormy trades won)');
select qp_t13.check((select label = 'ok' and detail->>'bucket' = 'all' and (detail->>'trades')::int = 50
                       from public.signal_checks where symbol = 'QPST_E'),
                    'trend: under 30 in this weather -> the rule''s last 50 (30 winners, 20 losers)');
select qp_t13.check((select label = 'none' and (detail->>'trades')::int = 17 from public.signal_checks
                      where symbol = 'QPCK' and strategy = 'strong_trend'),
                    'trend: only trades signalled over 42 days earlier count; under 20 -> no check');
select qp_t13.check((select count(*) = 64 from public.signal_checks where strategy = 'strong_trend'),
                    'trend: every Strong trend buy gets a check, the fixtures'' old trades too');
update public.signal_outcomes set r20 = 0.10 where symbol like 'QPLOSE%';
select qp_t13.check(private.refresh_trend_checks() = 0, 'trend: nothing new to check');
select qp_t13.check((select label = 'weak' from public.signal_checks where symbol = 'QPST_A'),
                    'trend: a check is frozen; later grades never rewrite it');

-- ------------------------------------------------------------------ RSI dip check
-- QPRSI: 330 rising sessions, then two sharp falls (an RSI dip setup on day 320). A model whose only weight is on
-- n_same_day makes the chance exact: 4 setups that close -> sigmoid(ln 5) = 5/6.
delete from public.market_candles where symbol = 'QPRSI';
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPRSI', 'NSE', 'RSI check fixture', true, 'equity', 2)
on conflict (symbol, exchange) do update set is_active = true, segment = 'equity';
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'QPRSI', 'NSE', '1d', qp_t13.at(d) - interval '6 hours', c, c * 1.01, c * 0.99, c, 1000000
from generate_series(1, 321) d,
     lateral (select (case when d < 319 then 100 + 0.2 * d when d = 319 then 158 when d = 320 then 154 else 155 end)::numeric as c) x;
insert into public.market_weather (day, nifty, nifty_sma50, nifty_sma200, vix, state)
select qp_t13.d(d), 10000 + d, 9900, 9800, 14, 'sunny' from generate_series(270, 321) d
on conflict (day) do update set nifty = excluded.nifty, nifty_sma200 = excluded.nifty_sma200, vix = excluded.vix,
  state = excluded.state;
delete from public.signal_watch where strategy = 'rsi_dip';                 -- only the fixture's setups (rolled back)
delete from public.market_breadth where day >= qp_t13.d(300);
delete from public.market_sectors where day >= qp_t13.d(300);
insert into public.market_breadth (day, breadth50, breadth200, stocks, rsi_setups) values (qp_t13.d(320), 0.6, 0.55, 480, 4);
insert into public.market_sectors (day, sector, r63, rank_pct) values (qp_t13.d(320), 'Other', 0.05, 0.5);
insert into public.market_pit_top (year, symbol, exchange, rank)
values (extract(year from qp_t13.d(320))::int, 'QPRSI', 'NSE', 7) on conflict do nothing;
insert into public.signal_watch (symbol, exchange, strategy, signal_day, limit_price, stop) values
  ('QPRSI', 'NSE', 'rsi_dip', qp_t13.d(320), 150, 140);

select qp_t13.check(private.refresh_rsi_checks() = 0, 'rsi: no model for the quarter -> no check yet (tried again next run)');
insert into public.signal_check_models (strategy, valid_from, version, hr_rule, model)
select 'rsi_dip', date_trunc('quarter', qp_t13.d(320))::date, 'test/1', 0.6,
       jsonb_build_object('version', 'test/1', 'features', to_jsonb(f), 'shown', true,
                          'median', to_jsonb(array_fill(0, array[25])), 'mean', to_jsonb(array_fill(0, array[25])),
                          'sd', to_jsonb(array_fill(1, array[25])),
                          'coef', to_jsonb(array(select case when x = 'n_same_day' then 1 else 0 end
                                                   from unnest(f) with ordinality as u(x, k) order by k)),
                          'intercept', 0, 'platt_a', 1, 'platt_b', 0, 'cut_lo', 0.6, 'cut_hi', 0.8)
from (select private.rsi_check_features() as f) z;
select private.refresh_rsi_checks();
select qp_t13.check((select label = 'high' and tagged and abs(score - 0.8333) < 0.0001
                       from public.signal_checks where strategy = 'rsi_dip' and symbol = 'QPRSI'),
                    'rsi: the chance comes from the quarter''s model (5/6 here), and it is in the top third -> high');
select qp_t13.check((select abs((detail->'features'->>'n_same_day')::float8 - ln(5)) < 1e-9
                            and (detail->'features'->>'rsi2')::float8 < 10
                            and (detail->'features'->>'hr_rule')::float8 = 0.6
                            and (detail->'features'->>'breadth200')::float8 = 0.55
                            and (detail->>'top300')::boolean
                       from public.signal_checks where strategy = 'rsi_dip' and symbol = 'QPRSI'),
                    'rsi: the features it was scored on are stored with the check');
update public.signal_check_models set model = jsonb_set(model, '{shown}', 'false');
delete from public.signal_checks where strategy = 'rsi_dip';
select private.refresh_rsi_checks();
select qp_t13.check((select label = 'none' and not tagged from public.signal_checks where strategy = 'rsi_dip' and symbol = 'QPRSI'),
                    'rsi: a quarter whose model cannot rank its own past gives no label');
update public.signal_check_models set model = jsonb_set(model, '{shown}', 'true');
delete from public.signal_checks where strategy = 'rsi_dip';
select private.refresh_rsi_checks();
delete from public.signal_watch where symbol = 'QPRSI';
insert into public.signal_watch (symbol, exchange, strategy, signal_day, limit_price, stop) values
  ('QPRSI', 'NSE', 'rsi_dip', qp_t13.d(321), 150, 140);
select qp_t13.check(private.refresh_rsi_checks() = 0, 'rsi: no market context for the day yet -> no check (tried again next run)');

-- ------------------------------------------------------------------ the record, and the training set
-- The setup filled the next day and sold on the bounce at +3 % (2.5 % after the 0.5 % cost).
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at) values
  ('QPRSI', 'NSE', 'rsi_dip', 'buy', jsonb_build_object('action', 'buy', 'fill', 150, 'signal_day', qp_t13.d(320)::text), qp_t13.at(321)),
  ('QPRSI', 'NSE', 'rsi_dip', 'exit', '{"action": "exit", "pnl_pct": 3.0}', qp_t13.at(323));
select qp_t13.check((select result_pct = 3.0 and exit_day = qp_t13.d(323) from public.signal_trades
                      where strategy = 'rsi_dip' and symbol = 'QPRSI'),
                    'record: a buy is closed by the exit after it, keyed by the setup''s close');
select qp_t13.check((select trades = 1 and made_money = 1 and avg_result_pct = 2.5 from public.signal_check_record
                      where strategy = 'rsi_dip' and label = 'high'),
                    'record: tagged signals and how they did after costs');
select qp_t13.check((select count(*) = 0 from public.signal_trades where strategy = 'strong_trend' and result_pct is not null),
                    'record: an open trade has no result');
insert into public.signal_check_training (strategy, symbol, signal_day, features, net, source)
values ('rsi_dip', 'QPOLD', qp_t13.d(310), array_fill(0::float8, array[25]), 0.01, 'research');
select qp_t13.check(private.refresh_check_training() = 1, 'training: one live trade to add');
select qp_t13.check((select abs(net - 0.025) < 1e-9 and source = 'live' and cardinality(features) = 25
                                and abs(features[25] - ln(5)) < 1e-9
                           from public.signal_check_training where symbol = 'QPRSI'),
                    'training: a live trade closed after the research record joins, with the features it was scored on');
select qp_t13.check(private.refresh_check_training() = 0, 'training: added once');

-- ------------------------------------------------------------------ the refit bridge and grants
select qp_t13.check((select jsonb_array_length(public.svc_signal_check_training('rsi_dip')->'rows') = 2
                            and public.svc_signal_check_training('rsi_dip')->'features' = to_jsonb(private.rsi_check_features())),
                    'svc: the refit reads the training set with the feature order');
do $$
begin
  begin
    perform public.svc_put_signal_check_model('rsi_dip', date '2027-02-01', 0.6,
                                              jsonb_build_object('features', to_jsonb(private.rsi_check_features())));
    raise exception 'FAIL [svc: a model must start at a quarter]';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.svc_put_signal_check_model('rsi_dip', date '2027-01-01', 0.6, '{"features": ["d200"]}');
    raise exception 'FAIL [svc: a model must use the feature order]';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
select public.svc_put_signal_check_model('rsi_dip', date '2027-01-01', 0.61,
                                         jsonb_build_object('version', 'v9', 'features', to_jsonb(private.rsi_check_features())));
select qp_t13.check((select version = 'v9' and hr_rule = 0.61 from public.signal_check_models where valid_from = date '2027-01-01'),
                    'svc: a refit is stored for its quarter (and bad ones are refused)');
select qp_t13.check((select public.svc_refresh_signal_checks() ?& array['breadth', 'trend', 'rsi', 'training']),
                    'svc: one call runs breadth, both checks and the training set');
select qp_t13.check(has_table_privilege('authenticated', 'public.signal_checks', 'select')
                    and not has_table_privilege('authenticated', 'public.signal_checks', 'insert')
                    and not has_table_privilege('anon', 'public.signal_checks', 'select')
                    and has_table_privilege('authenticated', 'public.signal_check_record', 'select')
                    and has_table_privilege('authenticated', 'public.market_breadth', 'select')
                    and not has_table_privilege('authenticated', 'public.market_breadth', 'update')
                    and not has_table_privilege('authenticated', 'public.signal_check_training', 'select'),
                    'grants: checks, record and market context are read-only to members; the training set is not theirs');
select qp_t13.check(not has_function_privilege('authenticated', 'public.svc_refresh_signal_checks(boolean)', 'execute')
                    and not has_function_privilege('authenticated', 'public.svc_put_signal_check_model(text, date, numeric, jsonb)', 'execute')
                    and not has_function_privilege('authenticated', 'public.svc_signal_check_training(text)', 'execute')
                    and not has_function_privilege('anon', 'public.svc_signal_check_training(text)', 'execute')
                    and not has_function_privilege('authenticated', 'private.refresh_rsi_checks()', 'execute'),
                    'grants: only the service role runs and refits the checks');

rollback;
