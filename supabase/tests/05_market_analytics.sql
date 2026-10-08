-- Market analytics (5.24): Wilder RSI matches the textbook example, re-runs
-- add nothing, and only the service role can trigger a refresh.
-- Runs in a rolled-back transaction; needs the dev seed.
begin;

create schema qp_t5;
create function qp_t5.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;

-- StockCharts' RSI worked example (Wilder smoothing). Their table rounds the averages (0.24 / 0.10) and shows
-- 70.53, 66.32, ...; unrounded (and independently checked in Python) the values are 70.46, 66.25, 66.48, 69.35, 66.29.
insert into public.market_symbols (symbol, exchange, name, is_active) values ('QPRSI', 'NSE', 'RSI fixture', true);
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close)
select 'QPRSI', 'NSE', '1d', timestamptz '2020-01-01 10:00+00' + (i - 1) * interval '1 day', c, c, c, c
from unnest(array[44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
                  45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22]::numeric[])
     with ordinality as t(c, i);

select private.refresh_market_analytics(100000);

create temp table got as
select row_number() over (order by ts) as k, rsi from public.rsi_events where symbol = 'QPRSI';
select qp_t5.check((select count(*) from got) = 5, 'rsi: first value after 14 moves');
select qp_t5.check((select bool_and(abs(g.rsi - e.v) <= 0.02)
                    from got g join unnest(array[70.46, 66.25, 66.48, 69.35, 66.29]::numeric[])
                         with ordinality as e(v, k) on e.k = g.k),
                   'rsi: matches Wilder reference values');

create temp table before as select count(*) as n, max(id) as max_id from public.trading_signals;
select qp_t5.check((private.refresh_market_analytics(100000) ->> 'signals')::int = 0, 'signals: re-run adds nothing');
select qp_t5.check((select n from before) = (select count(*) from public.trading_signals)
               and (select max_id from before) = (select max(id) from public.trading_signals),
                   'signals: existing rows untouched (notifier ledger keys stay valid)');

select qp_t5.check((select count(*) from public.backtest_ledgers b
                    join public.market_symbols s using (symbol, exchange) where not s.is_active) = 0,
                   'ledgers: inactive symbols skipped');

select qp_t5.check(not has_function_privilege('authenticated', 'public.svc_refresh_market_analytics(integer, text[])', 'execute')
               and not has_function_privilege('anon', 'public.svc_refresh_market_analytics(integer, text[])', 'execute')
               and not has_function_privilege('authenticated', 'public.svc_run_eod_notifier()', 'execute')
               and has_function_privilege('service_role', 'public.svc_refresh_market_analytics(integer, text[])', 'execute'),
                   'svc: only service_role can refresh');

select qp_t5.check(to_regclass('public.broker_connections') is null and to_regclass('private.broker_credentials') is null
               and to_regtype('public.broker_code') is null,
                   'broker: tables and type are gone');

-- 5.26: quotes table matches the candles; search; retired symbols; news cursor
select qp_t5.check((select q.last_price = 46.22 and q.prev_close = 46.41 and q.change_pct = round((46.22 - 46.41) / 46.41 * 100, 2)
                           and q.rsi = 66.29 and q.high_52w = 46.41 and q.low_52w = 43.61
                    from public.market_quotes q where q.symbol = 'QPRSI'), 'quotes: last, prev, change %, RSI, 52-week range');
select qp_t5.check((select count(*) from public.market_snapshot where symbol = 'QPRSI' and last_price = 46.22) = 1, 'quotes: snapshot reads them');
select qp_t5.check((select private.refresh_market_analytics(10, '{QPRSI}') ->> 'quotes')::int = 1, 'batch: only the listed symbols');

select qp_t5.check((select symbol from public.search_symbols('tcs', 5) limit 1) = 'TCS', 'search: exact ticker first');
select qp_t5.check((select count(*) from public.search_symbols('consultancy', 5) where symbol = 'TCS') = 1, 'search: by name');
select qp_t5.check((select count(*) from public.search_symbols('%', 5)) = 0, 'search: wildcards are literal');
select qp_t5.check((select count(*) from public.search_symbols('tatamotors', 5)) = 0, 'search: retired symbols hidden');
select qp_t5.check(not has_function_privilege('anon', 'public.search_symbols(text, integer)', 'execute')
               and has_function_privilege('authenticated', 'public.search_symbols(text, integer)', 'execute'), 'search: members only');
select qp_t5.check((select successors = '{TMPV,TMCV}' and status_note like 'Tata Motors demerged%' from public.market_symbols where symbol = 'TATAMOTORS'),
                   'retired: TATAMOTORS explains itself');

insert into public.market_symbols (symbol, exchange, name, segment) values ('QPSMALL', 'NSE', 'QP Small Co', 'sme');
insert into auth.users (id, email) values ('dddddddd-0000-4000-8000-0000000000d5', 'cursor@test.quantspulse.local');
insert into public.watchlists (id, tenant_id, user_id)
select 'dddddddd-0000-4000-8000-0000000000d6', default_tenant_id, user_id from public.profiles where user_id = 'dddddddd-0000-4000-8000-0000000000d5';
insert into public.watchlist_items (watchlist_id, tenant_id, user_id, symbol)
select 'dddddddd-0000-4000-8000-0000000000d6', default_tenant_id, user_id, 'QPSMALL' from public.profiles where user_id = 'dddddddd-0000-4000-8000-0000000000d5';
select qp_t5.check((select count(*) from public.news_search_cursor where symbol = 'QPSMALL') = 1, 'news: watched symbol joins the search rotation');

do $$ begin raise notice 'MARKET ANALYTICS TESTS PASSED'; end $$;
rollback;
