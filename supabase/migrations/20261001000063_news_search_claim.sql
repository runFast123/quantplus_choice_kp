-- =====================================================================
-- 63 · Per-company news search: claim the next stocks atomically, users' stocks first (ADR-062)
--      Before: each run read the 8 stalest cursor rows and stamped only the ones it searched. Rows for retired
--      symbols were skipped without a stamp, so they stayed at the front forever and took 3 of the 8 places on every
--      run; ETF and index rows took more. With the GitHub schedule firing ~5 times a day, ~25 companies a day were
--      searched and 2,747 of 3,619 had never been searched (19 Nov 2026).
--      Now svc_claim_news_search() picks active equity/SME stocks only, stamps them as it hands them out (a failed
--      fetch waits for its next turn instead of blocking the queue; overlapping runs never take the same stock), puts
--      stocks someone watches or holds first once they are 6 hours old, then never-searched and stalest, larger
--      companies first. With p_symbols it claims just those (a stock page opened by a member), only when 6 hours old
--      and only while fewer than 30 searches ran in the last minute, so page views can't flood the news site.
-- =====================================================================

-- Rows the search never uses: retired symbols, ETFs and indices (news is matched to those from the feeds).
delete from public.news_search_cursor c
using public.market_symbols s
where s.symbol = c.symbol and s.exchange = c.exchange
  and (not s.is_active or s.segment not in ('equity', 'sme'));

create or replace function public.svc_claim_news_search(p_limit integer default 40, p_symbols text[] default null)
returns table (symbol text, exchange public.exchange_code, name text, mcap_rank integer, segment text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_symbols is null then
    -- Scheduled run: every active stock gets a row (new listings included); an anti-join on ~3,600 rows.
    insert into public.news_search_cursor (symbol, exchange)
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment in ('equity', 'sme')
    on conflict do nothing;
  elsif (select count(*) from public.news_search_cursor c where c.last_fetched_at > now() - interval '1 minute') >= 30 then
    return; -- busy: page views wait for the scheduled runs
  end if;

  return query
  with users_stocks as (
    select w.symbol, w.exchange from public.watchlist_items w
    union
    select h.symbol, h.exchange from public.holdings h
  ),
  pick as (
    select c.symbol, c.exchange
    from public.news_search_cursor c
    join public.market_symbols s on s.symbol = c.symbol and s.exchange = c.exchange
    where s.is_active and s.segment in ('equity', 'sme')
      and (p_symbols is null or (c.symbol = any (p_symbols)
                                  and (c.last_fetched_at is null or c.last_fetched_at < now() - interval '6 hours')))
    order by (exists (select 1 from users_stocks u where u.symbol = c.symbol and u.exchange = c.exchange)
              and (c.last_fetched_at is null or c.last_fetched_at < now() - interval '6 hours')) desc,
             c.last_fetched_at nulls first,
             s.mcap_rank nulls last,
             c.symbol
    limit least(greatest(coalesce(p_limit, 40), 1), 200)
    for update of c skip locked
  ),
  claimed as (
    update public.news_search_cursor c set last_fetched_at = now()
    from pick p where c.symbol = p.symbol and c.exchange = p.exchange
    returning c.symbol, c.exchange
  )
  select s.symbol, s.exchange, s.name, s.mcap_rank::integer, s.segment
  from claimed k join public.market_symbols s on s.symbol = k.symbol and s.exchange = k.exchange;
end $$;
revoke execute on function public.svc_claim_news_search(integer, text[]) from public, anon, authenticated;
grant  execute on function public.svc_claim_news_search(integer, text[]) to service_role;
