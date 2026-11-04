-- Faster pages and automatic clean-up (ADR-042).
-- Measured on live (4 Nov 2026, 400 MB, 224 MB of shared buffers): the Signals page's two record views took 135–150 ms
-- warm and up to 2.6 s cold (they scan every stored signal's JSON on each view), and research_latest checked all 3,627
-- symbols even for one stock (955 ms cold). The rest of the reads were under 50 ms.
--  1. the two records are kept in small tables, refreshed once an evening with the signal checks; the views stay live
--     and exact (the tests and the refresh read them)
--  2. research_latest returns the symbol from market_symbols, so a filter on it reaches the index
--  3. data nothing can show any more is deleted nightly: RSI crossings older than the stock's stored candles, market
--     leader ranks older than the 1,250-day window, rule health snapshots older than two years

-- ------------------------------------------------------------------ 1. the records, kept
create table public.strategy_trade_summary as select * from public.strategy_trade_results with no data;
create table public.strategy_scorecard_summary as select * from public.strategy_scorecard with no data;
alter table public.strategy_trade_summary add column refreshed_at timestamptz not null default now();
alter table public.strategy_scorecard_summary add column refreshed_at timestamptz not null default now();
alter table public.strategy_trade_summary enable row level security;
alter table public.strategy_scorecard_summary enable row level security;
create policy strategy_trade_summary_read on public.strategy_trade_summary for select to authenticated using (true);
create policy strategy_scorecard_summary_read on public.strategy_scorecard_summary for select to authenticated using (true);
revoke all on public.strategy_trade_summary, public.strategy_scorecard_summary from anon, public;
revoke insert, update, delete, truncate on public.strategy_trade_summary, public.strategy_scorecard_summary from authenticated;
grant select on public.strategy_trade_summary, public.strategy_scorecard_summary to authenticated;

create or replace function private.refresh_record_summaries() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
  v_more integer;
begin
  delete from public.strategy_trade_summary;
  insert into public.strategy_trade_summary select r.*, now() from public.strategy_trade_results r;
  get diagnostics v_rows = row_count;
  delete from public.strategy_scorecard_summary;
  insert into public.strategy_scorecard_summary select r.*, now() from public.strategy_scorecard r;
  get diagnostics v_more = row_count;
  return v_rows + v_more;
end $$;
revoke all on function private.refresh_record_summaries() from public, anon, authenticated;

-- With the evening's checks (the pipeline calls it once after every batch; the pg_cron backstop runs it too).
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
  v_out := v_out || jsonb_build_object('summaries', private.refresh_record_summaries());
  return v_out;
end $$;
revoke execute on function public.svc_refresh_signal_checks(boolean) from public, anon, authenticated;
grant  execute on function public.svc_refresh_signal_checks(boolean) to service_role;

select private.refresh_record_summaries();

-- ------------------------------------------------------------------ 2. one stock's research note reads one stock
create or replace view public.research_latest
with (security_invoker = true) as
select s.symbol, s.exchange, s.name, s.sector, rn.as_of, rn.score, rn.stance, rn.prev_stance,
       rn.headline, rn.factors, rn.news_count, rn.filing_count, rn.generated_at,
       prev.score as prev_score,
       s.segment, s.mcap_rank,
       abs(rn.score - coalesce(prev.score, rn.score)) as score_change
from public.market_symbols s
join lateral (
  select * from public.research_notes r
  where r.symbol = s.symbol and r.exchange = s.exchange
  order by r.as_of desc limit 1
) rn on true
left join lateral (
  select r.score from public.research_notes r
  where r.symbol = s.symbol and r.exchange = s.exchange and r.as_of < rn.as_of
  order by r.as_of desc limit 1
) prev on true
where s.is_active;

-- ------------------------------------------------------------------ 3. nightly clean-up of what nothing can show
create or replace function private.retention_derived() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rsi integer;
  v_lead integer;
  v_health integer;
begin
  delete from public.rsi_events e using public.market_symbols s
   where s.symbol = e.symbol and s.exchange = e.exchange and e.event_type <> 'daily'
     and e.ts < now() - make_interval(days => s.history_days);
  get diagnostics v_rsi = row_count;
  delete from public.market_leaders l where l.day < (now() at time zone 'Asia/Kolkata')::date - 1260;
  get diagnostics v_lead = row_count;
  delete from public.rule_health h where h.day < (now() at time zone 'Asia/Kolkata')::date - 730;
  get diagnostics v_health = row_count;
  return jsonb_build_object('rsi_events', v_rsi, 'market_leaders', v_lead, 'rule_health', v_health);
end $$;
revoke all on function private.retention_derived() from public, anon, authenticated;

select cron.schedule('retention-derived', '55 2 * * *', $$ select private.retention_derived(); $$);
select private.retention_derived();
