-- News stories are stored once, however many URLs they arrive under (5.25).
-- Runs in a rolled-back transaction.
begin;

create schema qp_t6;
create function qp_t6.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;

create temp table first_run as
select * from public.svc_store_news_articles(jsonb_build_array(
  jsonb_build_object('source_id', (select min(id) from public.news_sources), 'url', 'https://example.test/dedupe-a',
                     'url_hash', 'qp-dedupe-a', 'title', 'QP fixture:  Why  widget makers are falling',
                     'published_at', '2026-10-01T09:34:59Z', 'tone_terms', jsonb_build_array('falling'))));
select qp_t6.check((select inserted from first_run), 'store: new story inserted');
select qp_t6.check((select tone_terms = '{falling}' from public.news_articles where url_hash = 'qp-dedupe-a'), 'store: arrays round-trip');

-- Same story, new redirect URL, different spacing/case → no new row, same id back.
create temp table second_run as
select * from public.svc_store_news_articles(jsonb_build_array(
  jsonb_build_object('source_id', (select min(id) from public.news_sources), 'url', 'https://example.test/dedupe-b',
                     'url_hash', 'qp-dedupe-b', 'title', 'qp fixture: why widget makers are falling ',
                     'published_at', '2026-10-01T09:34:59Z')));
select qp_t6.check(not (select inserted from second_run), 'store: same story under a new URL skipped');
select qp_t6.check((select article_id from second_run) = (select article_id from first_run), 'store: returns the existing id');
select qp_t6.check((select count(*) from public.news_articles where title ilike 'qp fixture:%widget makers are falling%') = 1,
                   'store: one row per story');

-- Same headline at a different time is a different story (daily round-ups reuse titles).
select public.svc_store_news_articles(jsonb_build_array(
  jsonb_build_object('source_id', (select min(id) from public.news_sources), 'url', 'https://example.test/dedupe-c',
                     'url_hash', 'qp-dedupe-c', 'title', 'QP fixture: Why widget makers are falling',
                     'published_at', '2026-10-02T09:34:59Z')));
select qp_t6.check((select count(*) from public.news_articles where url_hash like 'qp-dedupe-%') = 2, 'store: same title, later time kept');

-- Plain inserts get the hash from the trigger and hit the unique index.
do $$ begin
  insert into public.news_articles (source_id, url, url_hash, title, published_at)
  values ((select min(id) from public.news_sources), 'https://example.test/dedupe-d', 'qp-dedupe-d',
          'QP FIXTURE: WHY WIDGET MAKERS ARE FALLING', '2026-10-01T09:34:59Z');
  raise exception 'FAIL [trigger: duplicate story accepted]';
exception when unique_violation then
  raise notice 'PASS [trigger: duplicate story rejected by unique index]';
end $$;

select qp_t6.check(not has_function_privilege('authenticated', 'public.svc_store_news_articles(jsonb)', 'execute')
               and not has_function_privilege('anon', 'public.svc_store_news_articles(jsonb)', 'execute')
               and has_function_privilege('service_role', 'public.svc_store_news_articles(jsonb)', 'execute'),
                   'svc: only service_role can store news');

do $$ begin raise notice 'NEWS DEDUPE TESTS PASSED'; end $$;
rollback;
