-- The evening checks run in the database's cron after every price load, not only over the API (ADR-043).
-- With 1,250 days stored for the 500 largest, the checks no longer fit the API's 8 s statement limit on a cold cache
-- (5 Nov 2026, live: market breadth 33.7 s, rule health 6.5 s, the kept records 7.3 s), so the pipeline's call fails
-- (it already treats that as non-fatal) and only the 17:55 IST backstop ran them — before GitHub's late price loads.
--  1. svc_refresh_signal_checks no longer refreshes the kept records (the cron jobs below do, after it)
--  2. the 17:55 IST backstop also refreshes the kept records
--  3. the checks, the kept records and the research notes run again at 21:40, 00:40 and 03:40 IST, and at 09:40 IST
--     after the catch-up load (a late pipeline's own research call can time out too: 4 Nov, 300 stocks, 6.5 s cold)
create or replace function public.svc_refresh_signal_checks(p_full boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  v_out := jsonb_build_object('breadth', private.refresh_market_breadth(p_full));
  v_out := v_out || jsonb_build_object('trend', private.refresh_trend_checks());
  v_out := v_out || jsonb_build_object('rsi', private.refresh_rsi_checks());
  v_out := v_out || jsonb_build_object('training', private.refresh_check_training());
  v_out := v_out || jsonb_build_object('health', private.refresh_rule_health());
  return v_out;
end $$;
revoke execute on function public.svc_refresh_signal_checks(boolean) from public, anon, authenticated;
grant  execute on function public.svc_refresh_signal_checks(boolean) to service_role;

select cron.schedule('market-analytics', '25 12 * * 1-5',
  $$ select private.refresh_market_analytics(10); select private.refresh_setups();
     select private.refresh_market_weather(); select private.refresh_strong_trend(); select private.refresh_sma_trend();
     select private.refresh_ma200_trend(); select private.refresh_dip_rules(); select private.refresh_last_signal();
     select private.grade_signals(); select public.svc_refresh_signal_checks(); select private.refresh_record_summaries(); $$);
select cron.schedule('evening-checks', '10 16,19,22 * * 1-5',
  $$ select public.svc_refresh_signal_checks(); select private.refresh_record_summaries(); select private.refresh_research_notes(); $$);
select cron.schedule('morning-checks', '10 4 * * 2-6',
  $$ select public.svc_refresh_signal_checks(); select private.refresh_record_summaries(); select private.refresh_research_notes(); $$);
