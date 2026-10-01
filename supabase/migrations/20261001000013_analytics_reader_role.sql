-- Source: quantspulse_supabase_schema.md §5.13 Least-Privilege Role for FastAPI
-- =====================================================================
-- 5.13 FastAPI reads market data only — it never sees user tables.
--      Set the password from your secret manager, not in source.
-- =====================================================================
-- [QP change] Guarded so the migration is re-runnable across environments.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'analytics_reader') then
    create role analytics_reader login;
  end if;
end $$;
grant usage on schema public to analytics_reader;
grant select on public.market_symbols, public.market_candles, public.backtest_ledgers,
                public.trading_signals, public.rsi_events
  to analytics_reader;

do $$
declare t text;
begin
  foreach t in array array['market_symbols', 'market_candles', 'backtest_ledgers',
                           'trading_signals', 'rsi_events'] loop
    execute format('create policy %I on public.%I for select to analytics_reader using (true)',
                   t || '_analytics_read', t);
  end loop;
end $$;
-- Pipelines that WRITE market data use a separate role or the service role from a worker.
