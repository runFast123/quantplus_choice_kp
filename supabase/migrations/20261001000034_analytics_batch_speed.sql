-- Keep the pipeline's analytics batches well inside PostgREST's 8 s statement limit (migration 33 added the
-- weather, Strong trend and grading steps to every batch; on 31 Oct 2026 one batch of 100 timed out).
--  * private.refresh_market_weather(p_full): a normal run rewrites only the last 10 sessions (the 50/200-day
--    averages still use the whole Nifty history); p_full => true rebuilds every day. Called once per batch, it
--    now costs a few ms instead of ~150 ms.
--  * Retired symbols keep no SIP ledger: a trigger deletes it when is_active turns false (the analytics already
--    skip inactive symbols, so their ledgers went stale), and the 8 left over from earlier retirements go now.
-- The pipeline also halves its batch to 50 symbols (pipelines/eod/eod.py), like the Vercel route.

drop function if exists private.refresh_market_weather();

create or replace function private.refresh_market_weather(p_full boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
  v_from date := case when p_full then date '1900-01-01'
                      else coalesce((select max(day) from public.market_weather), date '1900-01-01') - 10 end;
begin
  insert into public.market_weather (day, nifty, nifty_sma50, nifty_sma200, vix, state, updated_at)
  select d.day, d.close, d.s50, d.s200, v.close,
         case when d.s200 is null or d.s50 is null then null
              when (d.close < d.s200 and d.s50 < d.s200) or v.close > 22 then 'stormy'
              when d.close > d.s200 and d.s50 > d.s200 then 'sunny'
              else 'mixed' end,
         now()
  from (
    select c.ts, (c.ts at time zone 'Asia/Kolkata')::date as day, c.close,
           case when count(*) over w50 = 50 then avg(c.close) over w50 end as s50,
           case when count(*) over w200 = 200 then avg(c.close) over w200 end as s200
    from public.market_candles c
    where c.symbol = 'NIFTY' and c.exchange = 'NSE' and c.interval = '1d'
    window w50 as (order by c.ts rows 49 preceding), w200 as (order by c.ts rows 199 preceding)
  ) d
  left join lateral (
    select x.close from public.market_candles x
    where x.symbol = 'INDIAVIX' and x.exchange = 'NSE' and x.interval = '1d'
      and x.ts <= d.ts and x.ts > d.ts - interval '7 days'
    order by x.ts desc limit 1
  ) v on true
  where d.day >= v_from
  on conflict (day) do update
    set nifty = excluded.nifty, nifty_sma50 = excluded.nifty_sma50, nifty_sma200 = excluded.nifty_sma200,
        vix = excluded.vix, state = excluded.state, updated_at = now()
    where (market_weather.nifty, market_weather.nifty_sma50, market_weather.nifty_sma200, market_weather.vix,
           market_weather.state)
          is distinct from (excluded.nifty, excluded.nifty_sma50, excluded.nifty_sma200, excluded.vix, excluded.state);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_market_weather(boolean) from public, anon, authenticated;

-- ------------------------------------------------------------------ retired symbols drop their SIP ledger
create or replace function private.drop_ledger_when_retired() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.backtest_ledgers b where b.symbol = new.symbol and b.exchange = new.exchange;
  return new;
end $$;
revoke all on function private.drop_ledger_when_retired() from public, anon, authenticated;

drop trigger if exists market_symbols_drop_ledger_when_retired on public.market_symbols;
create trigger market_symbols_drop_ledger_when_retired
  after update of is_active on public.market_symbols
  for each row when (old.is_active and not new.is_active)
  execute function private.drop_ledger_when_retired();

delete from public.backtest_ledgers b
 using public.market_symbols s
 where s.symbol = b.symbol and s.exchange = b.exchange and not s.is_active;

-- A full rebuild once, so every stored day uses the same code path.
select private.refresh_market_weather(true);
