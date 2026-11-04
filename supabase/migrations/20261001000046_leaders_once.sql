-- Market leaders are ranked once per new data, not once per analytics batch (ADR-043).
-- refresh_sma_trend calls refresh_leaders() at the start of every pipeline batch. It returned early when the latest
-- session had about as many ranks as the session before; on a day only part of the market is stored (the app's 17:00
-- cron loads the 33 benchmark symbols, NIFTY among them, before the full pipeline), that test failed on every batch,
-- each batch re-ranked the 500 largest over 270 days (3–6 s on live, 4 Nov 2026) and the pipeline hit the 8 s
-- statement limit. The test is now exact: the session needs ranking only while a stock ranked on the session before
-- has the latest session's candle but no rank for it yet. What is ranked, and how, is unchanged.
create or replace function private.refresh_leaders(p_full boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_latest date;
  v_prev   date;
  v_from   date;
  v_rows   integer;
begin
  select (max(c.ts) at time zone 'Asia/Kolkata')::date into v_latest
    from public.market_candles c where c.symbol = 'NIFTY' and c.exchange = 'NSE' and c.interval = '1d';
  if v_latest is null then return 0; end if;
  if not p_full then
    select max(l.day) into v_prev from public.market_leaders l where l.day < v_latest;
    if not exists (
      select 1
      from public.market_leaders p
      join public.market_candles c
        on c.symbol = p.symbol and c.exchange = p.exchange and c.interval = '1d'
       and c.ts >= v_latest::timestamp at time zone 'Asia/Kolkata'
       and c.ts < (v_latest + 1)::timestamp at time zone 'Asia/Kolkata'
      where p.day = v_prev
        and not exists (select 1 from public.market_leaders l
                         where l.day = v_latest and l.symbol = p.symbol and l.exchange = p.exchange)
    ) and (v_prev is not null or exists (select 1 from public.market_leaders l where l.day = v_latest)) then
      return 0;                                   -- everything stored for the latest session is ranked
    end if;
  end if;
  v_from := case when p_full then date '1900-01-01' else v_latest - 14 end;

  with r as (
    select c.symbol, c.exchange, (c.ts at time zone 'Asia/Kolkata')::date as day,
           c.close / nullif(lag(c.close, 126) over w, 0) - 1 as ret126
    from public.market_candles c
    join public.market_symbols s on s.symbol = c.symbol and s.exchange = c.exchange
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500 and c.interval = '1d'
      and (p_full or c.ts > now() - interval '270 days')
    window w as (partition by c.symbol, c.exchange order by c.ts)
  )
  insert into public.market_leaders (day, symbol, exchange, ret126, rs_pct)
  select x.day, x.symbol, x.exchange, round(x.ret126, 6), x.rs_pct
  from (select r.*, cume_dist() over (partition by r.day order by r.ret126) as rs_pct
          from r where r.ret126 is not null) x
  where x.day >= v_from
  on conflict (day, symbol, exchange) do update set ret126 = excluded.ret126, rs_pct = excluded.rs_pct
    where (market_leaders.ret126, market_leaders.rs_pct) is distinct from (excluded.ret126, excluded.rs_pct);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_leaders(boolean) from public, anon, authenticated;
