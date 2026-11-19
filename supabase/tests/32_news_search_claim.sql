-- Per-company news search queue (migration 63, ADR-062): users' stocks first, then never-searched and larger
-- companies; retired symbols and ETFs never; a stock page claims only a stale stock, and not while the site is busy.
-- Runs in a rolled-back transaction.
begin;

create schema qp_t32;
create function qp_t32.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;

-- Everything already listed was searched an hour ago (recent enough that no real watched stock jumps the queue on the
-- live database), so only the fixtures below compete.
insert into public.news_search_cursor (symbol, exchange, last_fetched_at)
select symbol, exchange, now() - interval '1 hour' from public.market_symbols where is_active and segment in ('equity', 'sme')
on conflict (symbol, exchange) do update set last_fetched_at = excluded.last_fetched_at;

insert into public.market_symbols (symbol, exchange, name, segment, mcap_rank, is_active) values
  ('QPWATCH', 'NSE', 'QP Watched Co', 'sme', 3000, true),
  ('QPNEWBIG', 'NSE', 'QP New Big Co', 'equity', 5, true),
  ('QPNEWTINY', 'NSE', 'QP New Tiny Co', 'sme', null, true),
  ('QPGONE', 'NSE', 'QP Retired Co', 'equity', 7, false),
  ('QPFUND', 'NSE', 'QP Fund ETF', 'etf', 8, true);
insert into public.news_search_cursor (symbol, exchange, last_fetched_at) values ('QPGONE', 'NSE', null), ('QPFUND', 'NSE', null)
on conflict do nothing;

-- Someone watches QPWATCH (its cursor row comes from the watchlist trigger); last searched 7 hours ago.
insert into auth.users (id, email) values ('dddddddd-0000-4000-8000-0000000003a1', 'claim@test.quantspulse.local');
insert into public.watchlists (id, tenant_id, user_id)
select 'dddddddd-0000-4000-8000-0000000003a2', default_tenant_id, user_id from public.profiles where user_id = 'dddddddd-0000-4000-8000-0000000003a1';
insert into public.watchlist_items (watchlist_id, tenant_id, user_id, symbol)
select 'dddddddd-0000-4000-8000-0000000003a2', default_tenant_id, user_id, 'QPWATCH' from public.profiles where user_id = 'dddddddd-0000-4000-8000-0000000003a1';
update public.news_search_cursor set last_fetched_at = now() - interval '7 hours' where symbol = 'QPWATCH';

select qp_t32.check((select symbol from public.svc_claim_news_search(1)) = 'QPWATCH', 'queue: a watched stock 6+ hours old goes first');
select qp_t32.check((select symbol from public.svc_claim_news_search(1)) = 'QPNEWBIG', 'queue: then never searched, larger first');
select qp_t32.check((select count(*) from public.news_search_cursor where symbol = 'QPNEWTINY') = 1, 'queue: a new listing gets its row');
select qp_t32.check((select symbol from public.svc_claim_news_search(1)) = 'QPNEWTINY', 'queue: then the rest of the never searched');
select qp_t32.check((select last_fetched_at = now() from public.news_search_cursor where symbol = 'QPWATCH'), 'queue: claimed stocks are stamped');
select qp_t32.check((select count(*) from public.svc_claim_news_search(200) where symbol in ('QPGONE', 'QPFUND')) = 0,
                    'queue: never a retired symbol or an ETF');

-- A stock page: only a stale stock, only the stocks asked for.
select qp_t32.check((select count(*) from public.svc_claim_news_search(1, '{QPWATCH}')) = 0, 'page: not again within 6 hours');
update public.news_search_cursor set last_fetched_at = now() - interval '1 hour' where last_fetched_at = now();
update public.news_search_cursor set last_fetched_at = now() - interval '7 hours' where symbol = 'QPNEWTINY';
select qp_t32.check((select symbol from public.svc_claim_news_search(5, '{QPNEWTINY}')) = 'QPNEWTINY', 'page: claims a stale stock');
select qp_t32.check((select count(*) from public.svc_claim_news_search(5, '{QPGONE}')) = 0, 'page: never a retired symbol');

-- Busy: 30 searches in the last minute and a page view waits; a scheduled run doesn't.
update public.news_search_cursor set last_fetched_at = now()
where (symbol, exchange) in (select symbol, exchange from public.news_search_cursor where symbol <> 'QPWATCH' order by symbol limit 30);
update public.news_search_cursor set last_fetched_at = now() - interval '7 hours' where symbol = 'QPWATCH';
select qp_t32.check((select count(*) from public.svc_claim_news_search(1, '{QPWATCH}')) = 0, 'page: waits while the site is busy');
select qp_t32.check((select symbol from public.svc_claim_news_search(1)) = 'QPWATCH', 'queue: scheduled runs go on');

select qp_t32.check(not has_function_privilege('authenticated', 'public.svc_claim_news_search(integer, text[])', 'execute')
                and not has_function_privilege('anon', 'public.svc_claim_news_search(integer, text[])', 'execute')
                and has_function_privilege('service_role', 'public.svc_claim_news_search(integer, text[])', 'execute'),
                    'grants: service role only');

do $$ begin raise notice 'NEWS SEARCH CLAIM TESTS PASSED'; end $$;
rollback;
