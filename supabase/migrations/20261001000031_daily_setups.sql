-- Daily setup scanner (ADR-031): every active symbol is tagged with the chart setups its latest
-- daily close matched. Rules from the MIT-licensed day-trader-skill scanner (daily mode), on closes:
--   breakout_20d     the last close is above every close of the 20 sessions before it
--   bull_flag        up more than 10 % over the 10 sessions before the last 5, then the last 5
--                    closes inside a 5 % range (of the last close)
--   reclaim_ma20     the close before was under its 20-day average, the last close is above it
--   oversold         RSI 14 (Wilder) under 30
--   oversold_bounce  RSI 14 was under 30 the session before and the last close is higher
-- RSI is the one refresh_market_analytics already stores (full history, so more exact than a
-- short window). A setup is a rule match on a chart, never a recommendation.

alter table public.market_quotes add column setups text[] not null default '{}';
create index market_quotes_setups_idx on public.market_quotes using gin (setups);

create or replace function private.refresh_setups(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  -- Clear first, so a symbol that no longer matches (or lost its history) loses its tags.
  update public.market_quotes q set setups = '{}'
   where q.setups <> '{}' and (p_symbols is null or q.symbol = any(p_symbols));

  with daily as (
    select c.symbol, c.exchange, c.ts, c.close,
           row_number() over (partition by c.symbol, c.exchange order by c.ts desc) as rn
    from public.market_candles c
    join public.market_symbols s on s.symbol = c.symbol and s.exchange = c.exchange and s.is_active
    where c.interval = '1d' and c.ts > now() - interval '75 days'
      and (p_symbols is null or c.symbol = any(p_symbols))
  ),
  w as (
    select d.symbol, d.exchange,
           count(*)                                       as n,
           max(d.ts)    filter (where d.rn = 1)           as ts1,
           max(d.ts)    filter (where d.rn = 2)           as ts2,
           max(d.close) filter (where d.rn = 1)           as c1,
           max(d.close) filter (where d.rn = 2)           as c2,
           max(d.close) filter (where d.rn = 6)           as c6,
           max(d.close) filter (where d.rn = 16)          as c16,
           max(d.close) filter (where d.rn between 2 and 21) as hi20,
           avg(d.close) filter (where d.rn between 1 and 20) as ma20,
           avg(d.close) filter (where d.rn between 2 and 21) as ma20_prev,
           max(d.close) filter (where d.rn <= 5)          as mx5,
           min(d.close) filter (where d.rn <= 5)          as mn5
    from daily d
    where d.rn <= 30
    group by d.symbol, d.exchange
  ),
  r as (
    select w.*,
           (select e.rsi from public.rsi_events e
             where e.symbol = w.symbol and e.exchange = w.exchange and e.ts = w.ts1 and e.event_type = 'daily') as rsi1,
           (select e.rsi from public.rsi_events e
             where e.symbol = w.symbol and e.exchange = w.exchange and e.ts = w.ts2 and e.event_type = 'daily') as rsi2
    from w
    where w.n >= 30 and w.c1 > 0
  ),
  tagged as (
    select r.symbol, r.exchange,
           array_remove(array[
             case when r.c1 > r.hi20 then 'breakout_20d' end,
             case when r.c16 > 0 and r.c6 / r.c16 - 1 > 0.10 and (r.mx5 - r.mn5) / r.c1 < 0.05 then 'bull_flag' end,
             case when r.c2 < r.ma20_prev and r.c1 > r.ma20 then 'reclaim_ma20' end,
             case when r.rsi1 < 30 then 'oversold' end,
             case when r.rsi2 < 30 and r.c1 > r.c2 then 'oversold_bounce' end
           ], null) as setups
    from r
  )
  update public.market_quotes q
     set setups = t.setups
    from tagged t
   where q.symbol = t.symbol and q.exchange = t.exchange and t.setups <> '{}';
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_setups(text[]) from public, anon, authenticated;

-- Pipelines (pipelines/eod, eod-sync) call this wrapper per symbol batch: setups follow the analytics.
create or replace function public.svc_refresh_market_analytics(p_days integer default 10, p_symbols text[] default null) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select private.refresh_market_analytics(p_days, p_symbols)
         || jsonb_build_object('setups', private.refresh_setups(p_symbols))
$$;
revoke execute on function public.svc_refresh_market_analytics(integer, text[]) from public, anon, authenticated;
grant  execute on function public.svc_refresh_market_analytics(integer, text[]) to service_role;

-- The pg_cron backstop runs the analytics directly; tag setups right after.
select cron.schedule('market-analytics', '25 12 * * 1-5',
  $$ select private.refresh_market_analytics(10); select private.refresh_setups(); $$);

-- The screener reads setups through the snapshot (new column appended).
create or replace view public.market_snapshot
with (security_invoker = true) as
select s.symbol, s.exchange, s.name, s.sector,
       q.as_of, q.last_price, q.prev_close, q.change, q.change_pct, q.volume,
       q.high_52w, q.low_52w, q.rsi, q.last_signal, q.last_signal_strategy, q.last_signal_at,
       s.segment, s.mcap_rank,
       coalesce(q.setups, '{}') as setups
from public.market_symbols s
left join public.market_quotes q on q.symbol = s.symbol and q.exchange = s.exchange
where s.is_active;
revoke all on public.market_snapshot from anon, public;
grant select on public.market_snapshot to authenticated;

-- Tag what is there now (the next analytics run keeps it current).
select private.refresh_setups();
