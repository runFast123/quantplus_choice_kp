-- RSI crossings of the 500 largest rebuilt on their whole stored history (ADR-043).
-- Their history grew from 760 to 1,250 days (ADR-041). RSI 14 depends on every earlier close, so the crossings written
-- while that history began in Sep 2024 carried a cold start; the longer history moved some of them, and the analytics
-- only upsert, so the old rows stayed (the price audit, 4 Nov 2026: 1–4 per stock, off by up to 15 RSI points).
-- Crossings are derived data: delete them for these stocks and write them again from all stored candles.
delete from public.rsi_events e
using public.market_symbols s
where s.symbol = e.symbol and s.exchange = e.exchange and s.history_days >= 1250 and e.event_type <> 'daily';

do $$
declare
  v_syms text[];
  v_part text[];
  i      integer;
begin
  select array_agg(s.symbol order by s.symbol) into v_syms
    from public.market_symbols s where s.is_active and s.history_days >= 1250;
  if v_syms is null then return; end if;
  for i in 0 .. (cardinality(v_syms) - 1) / 50 loop
    v_part := v_syms[i * 50 + 1 : i * 50 + 50];
    perform private.refresh_market_analytics(1300, v_part);
  end loop;
end $$;
