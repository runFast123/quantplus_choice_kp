-- News + research notes: read-only to members, factors move with tone,
-- stance-change notifications go to watchers once. Rolled back.
begin;

create schema qp_t3;
create function qp_t3.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
create function qp_t3.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then raise notice 'PASS [%]', p_label; return; end if;
    raise exception 'FAIL [%]: got "%"', p_label, sqlerrm;
  end;
  raise exception 'FAIL [%]: no error', p_label;
end $$;
grant usage on schema qp_t3 to authenticated;
grant execute on all functions in schema qp_t3 to authenticated;

-- Headlines: TCS upbeat, ITC downbeat, one INFY filing.
insert into public.news_articles (source_id, url, url_hash, title, published_at, tone, tone_label, is_filing, category)
select (select id from public.news_sources where code = 'et_stocks'), 'https://example.test/' || t.g, 'h' || t.g,
       t.title, now() - (t.g || ' hours')::interval, t.tone, t.label, t.filing, t.cat
from (values
  (1, 'TCS wins record deal, shares surge',          0.8, 'positive', false, null),
  (2, 'TCS beats estimates as margins expand',       0.7, 'positive', false, null),
  (3, 'Analysts upgrade TCS on strong order book',   0.6, 'positive', false, null),
  (4, 'ITC slumps after weak quarter',              -0.8, 'negative', false, null),
  (5, 'ITC faces tax probe, stock falls',           -0.7, 'negative', false, null),
  (6, 'ITC downgraded on margin pressure',          -0.6, 'negative', false, null),
  (7, 'Infosys Limited',                              0,  'neutral',  true,  'Board Meeting Intimation')
) as t(g, title, tone, label, filing, cat);

insert into public.news_article_symbols (article_id, symbol, exchange, match_kind)
select a.id, case when a.title like 'TCS%' or a.title like '%TCS%' then 'TCS'
                  when a.title like 'ITC%' then 'ITC' else 'INFY' end, 'NSE',
       case when a.is_filing then 'filing' else 'alias' end
from public.news_articles a where a.url like 'https://example.test/%';

select private.refresh_research_notes();

select qp_t3.check((select count(distinct symbol) from public.research_notes) = (select count(*) from public.market_symbols),
                   'notes: one per symbol');
select qp_t3.check((select (f ->> 'score')::numeric > 0 from public.research_notes rn, jsonb_array_elements(rn.factors) f
                    where rn.symbol = 'TCS' and f ->> 'key' = 'news' order by as_of desc limit 1), 'notes: positive tone lifts TCS');
select qp_t3.check((select (f ->> 'score')::numeric < 0 from public.research_notes rn, jsonb_array_elements(rn.factors) f
                    where rn.symbol = 'ITC' and f ->> 'key' = 'news' order by as_of desc limit 1), 'notes: negative tone weighs on ITC');
select qp_t3.check((select filing_count = 1 from public.research_notes where symbol = 'INFY' order by as_of desc limit 1),
                   'notes: filing counted for INFY');
select qp_t3.check((select bool_and(score between -100 and 100 and jsonb_array_length(factors) = 6) from public.research_notes),
                   'notes: bounded score, six factors');

-- A watcher of TCS, then a forced stance change.
insert into auth.users (id, email) values ('cccccccc-0000-4000-8000-0000000000c9', 'news@test.quantspulse.local');
update public.subscriptions set plan_code = 'pro', status = 'active' where user_id = 'cccccccc-0000-4000-8000-0000000000c9';
insert into public.watchlists (id, tenant_id, user_id)
select 'cccccccc-0000-4000-8000-0000000000ca', default_tenant_id, user_id from public.profiles where user_id = 'cccccccc-0000-4000-8000-0000000000c9';
insert into public.watchlist_items (watchlist_id, tenant_id, user_id, symbol)
select 'cccccccc-0000-4000-8000-0000000000ca', default_tenant_id, user_id, 'TCS' from public.profiles where user_id = 'cccccccc-0000-4000-8000-0000000000c9';

insert into public.research_notes (symbol, exchange, as_of, score, stance, headline, factors)
select 'TCS', 'NSE', rn.as_of - 1, 0,
       case when rn.stance = 'cautious' then 'constructive' else 'cautious' end, 'x', '[]'
from public.research_notes rn where rn.symbol = 'TCS' order by rn.as_of desc limit 1;

select private.refresh_research_notes();
select private.refresh_research_notes();
select qp_t3.check((select count(*) from public.notifications
                    where user_id = 'cccccccc-0000-4000-8000-0000000000c9' and type = 'research_stance') = 1,
                   'notes: stance change notifies watcher exactly once');

-- Access
select set_config('request.jwt.claims', json_build_object('sub', 'cccccccc-0000-4000-8000-0000000000c9', 'role', 'authenticated')::text, true);
set local role authenticated;
select qp_t3.check((select count(*) > 0 from public.research_notes), 'access: members read notes');
select qp_t3.check((select count(*) > 0 from public.news_articles), 'access: members read headlines');
select qp_t3.check((select count(*) > 0 from public.symbol_news_stats), 'access: members read news stats');
select qp_t3.check((select count(*) = 10 from (select id, code, name, kind from public.news_sources) s), 'access: source names readable');
select qp_t3.expect_error('select feed_url from public.news_sources', 'permission denied', 'access: feed urls/errors hidden');
select qp_t3.expect_error($$insert into public.news_articles (source_id, url, url_hash, title, published_at) values (1, 'x', 'y', 'z', now())$$,
                          'permission denied', 'access: members cannot write news');
select qp_t3.expect_error('select public.svc_refresh_research()', 'permission denied', 'access: members cannot trigger refresh');
reset role;

do $$ begin raise notice 'NEWS RESEARCH TESTS PASSED'; end $$;
rollback;
