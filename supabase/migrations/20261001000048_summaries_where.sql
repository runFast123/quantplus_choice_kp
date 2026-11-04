-- The kept records refresh from the pipeline too (ADR-042, fix).
-- API sessions load the safeupdate extension (authenticator: session_preload_libraries = supautils, safeupdate), which
-- refuses a DELETE without a WHERE clause even inside a function. refresh_record_summaries (migration 44) cleared both
-- tables with a bare DELETE, so svc_refresh_signal_checks failed whenever the pipeline called it over the API
-- (5 Nov 2026: "DELETE requires a WHERE clause"); the pg_cron backstop, a direct session, still worked. Same work.
create or replace function private.refresh_record_summaries() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
  v_more integer;
begin
  delete from public.strategy_trade_summary where true;
  insert into public.strategy_trade_summary select r.*, now() from public.strategy_trade_results r;
  get diagnostics v_rows = row_count;
  delete from public.strategy_scorecard_summary where true;
  insert into public.strategy_scorecard_summary select r.*, now() from public.strategy_scorecard r;
  get diagnostics v_more = row_count;
  return v_rows + v_more;
end $$;
revoke all on function private.refresh_record_summaries() from public, anon, authenticated;

select private.refresh_record_summaries();
