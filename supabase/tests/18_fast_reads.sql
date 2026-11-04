-- Faster reads and the nightly clean-up (migration 44, ADR-042). Rolled back.
begin;

create schema qp_t18;
create function qp_t18.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;

-- the records are kept and match the live views
select private.refresh_record_summaries();
select qp_t18.check((select count(*) from public.strategy_trade_summary) = (select count(*) from public.strategy_trade_results)
                    and (select count(*) from public.strategy_scorecard_summary) = (select count(*) from public.strategy_scorecard),
                    'summaries: the kept records have the live views'' rows');
select qp_t18.check((public.svc_refresh_signal_checks() ? 'summaries'), 'summaries: refreshed with the evening checks');
select qp_t18.check(has_table_privilege('authenticated', 'public.strategy_trade_summary', 'select')
                    and not has_table_privilege('authenticated', 'public.strategy_trade_summary', 'insert')
                    and not has_table_privilege('anon', 'public.strategy_scorecard_summary', 'select'),
                    'grants: members read the kept records, nobody writes them');

-- the clean-up: an RSI crossing older than the stock's stored candles goes, a recent one stays
insert into public.market_symbols (symbol, exchange, name, is_active, segment, history_days)
values ('QPFR1', 'NSE', 'Clean-up fixture', true, 'equity', 400);
insert into public.rsi_events (symbol, exchange, ts, rsi, event_type) values
  ('QPFR1', 'NSE', now() - interval '500 days', 25, 'oversold_cross'),
  ('QPFR1', 'NSE', now() - interval '30 days', 75, 'overbought_cross');
insert into public.rule_health (strategy, day, trades, made, expected_pct, low_pct, high_pct, status)
values ('kk_dip', current_date - 800, 40, 20, 68, 50, 80, 'within');
select private.retention_derived();
select qp_t18.check((select count(*) = 1 and bool_and(ts > now() - interval '400 days') from public.rsi_events where symbol = 'QPFR1'),
                    'clean-up: RSI crossings older than the stored candles go');
select qp_t18.check(not exists (select 1 from public.rule_health where day = current_date - 800), 'clean-up: rule health older than two years goes');
select qp_t18.check(not has_function_privilege('authenticated', 'private.retention_derived()', 'execute')
                    and not has_function_privilege('authenticated', 'private.refresh_record_summaries()', 'execute'),
                    'grants: the jobs are for the service role only');

-- research_latest: a filter on the symbol reads that symbol
select qp_t18.check((select count(*) <= 1 from public.research_latest where symbol = 'QPFR1'), 'research: one stock, at most one note');

rollback;
