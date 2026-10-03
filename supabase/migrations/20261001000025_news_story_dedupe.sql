-- =====================================================================
-- 5.25 News: one row per story, not per URL.
--      Google News search hands out a fresh redirect URL for the same story
--      on every fetch, so url_hash alone let repeats in (16 of 1,263 rows
--      in the first two days). A story is now also identified by its
--      normalised headline + publish second. Rows are stored through
--      svc_store_news_articles(), which skips a story already present under
--      either key — atomically, so overlapping runs can't race.
-- =====================================================================

create or replace function private.news_story_hash(p_title text, p_published timestamptz) returns text
language sql immutable set search_path = '' as $$
  select md5(lower(regexp_replace(btrim(p_title), '\s+', ' ', 'g')) || '|'
             || (extract(epoch from p_published))::bigint::text)
$$;

alter table public.news_articles add column if not exists story_hash text;
update public.news_articles set story_hash = private.news_story_hash(title, published_at) where story_hash is null;

-- Merge existing repeats into the oldest row (its links first, then drop the rest).
with ranked as (
  select id, first_value(id) over (partition by story_hash order by id) as keeper
  from public.news_articles
)
insert into public.news_article_symbols (article_id, symbol, exchange, match_kind, matched_text)
select r.keeper, l.symbol, l.exchange, l.match_kind, l.matched_text
from ranked r join public.news_article_symbols l on l.article_id = r.id
where r.id <> r.keeper
on conflict do nothing;

delete from public.news_articles a
 using public.news_articles b
 where a.story_hash = b.story_hash and a.id > b.id;

alter table public.news_articles alter column story_hash set not null;
create unique index if not exists news_articles_story_hash_key on public.news_articles (story_hash);

create or replace function private.set_news_story_hash() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.story_hash := private.news_story_hash(new.title, new.published_at);
  return new;
end $$;
drop trigger if exists news_articles_story_hash on public.news_articles;
create trigger news_articles_story_hash before insert or update of title, published_at on public.news_articles
  for each row execute function private.set_news_story_hash();

-- Store a batch; returns the article id for every input url_hash (new or the
-- existing row for the same URL or story) so callers can write symbol links.
create or replace function public.svc_store_news_articles(p_rows jsonb)
returns table (url_hash text, article_id bigint, inserted boolean)
language plpgsql volatile security definer set search_path = '' as $$
begin
  return query
  with input as (
    select r.*, private.news_story_hash(r.title, r.published_at) as story
    from jsonb_to_recordset(p_rows) as r(
      source_id smallint, url text, url_hash text, title text, summary text, category text,
      is_filing boolean, published_at timestamptz, tone numeric, tone_label text, tone_terms text[])
  ),
  ins as (
    insert into public.news_articles
      (source_id, url, url_hash, title, summary, category, is_filing, published_at, tone, tone_label, tone_terms)
    select i.source_id, i.url, i.url_hash, i.title, i.summary, i.category, coalesce(i.is_filing, false),
           i.published_at, i.tone, i.tone_label, coalesce(i.tone_terms, '{}')
    from input i
    on conflict do nothing
    returning news_articles.id, news_articles.url_hash
  )
  select i.url_hash, coalesce(n.id, e.id), n.id is not null
  from input i
  left join ins n on n.url_hash = i.url_hash
  left join lateral (
    select a.id from public.news_articles a
    where a.url_hash = i.url_hash or a.story_hash = i.story
    order by a.id limit 1
  ) e on true;
end $$;
revoke execute on function public.svc_store_news_articles(jsonb) from public, anon, authenticated;
grant  execute on function public.svc_store_news_articles(jsonb) to service_role;
