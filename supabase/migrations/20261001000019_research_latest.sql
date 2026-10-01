-- =====================================================================
-- 5.20 Latest research note per symbol, with the previous session's
--      score for "what changed". security_invoker → caller's RLS applies.
-- =====================================================================
create or replace view public.research_latest
with (security_invoker = true) as
select rn.symbol, rn.exchange, s.name, s.sector, rn.as_of, rn.score, rn.stance, rn.prev_stance,
       rn.headline, rn.factors, rn.news_count, rn.filing_count, rn.generated_at,
       prev.score as prev_score
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

revoke all on public.research_latest from anon, public;
grant select on public.research_latest to authenticated;
grant select on public.research_latest to analytics_reader;
