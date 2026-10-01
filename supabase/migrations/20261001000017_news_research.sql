-- =====================================================================
-- 5.18 News (RSS) + rule-based research notes (not in the original spec).
--      Global market data like §5.7: NO user data, readable by every
--      signed-in user, written only by the ingestion pipeline (service
--      role) and by the research function below.
--      Copyright: we keep headline, short feed summary and the link —
--      never full article bodies.
-- =====================================================================

create table public.news_sources (
  id              smallint generated always as identity primary key,
  code            text not null unique check (code ~ '^[a-z0-9_]{2,40}$'),
  name            text not null,
  feed_url        text not null,
  kind            text not null check (kind in ('news', 'filing', 'search')),
  is_active       boolean not null default true,
  last_fetched_at timestamptz,
  last_status     text,
  last_item_count integer,
  last_error      text
);

create table public.news_articles (
  id           bigint generated always as identity primary key,
  source_id    smallint not null references public.news_sources(id) on delete cascade,
  url          text not null,
  url_hash     text not null unique,          -- sha256 of the normalised url (dedupe across feeds)
  title        text not null check (char_length(title) <= 400),
  summary      text check (char_length(summary) <= 600),
  category     text,                          -- filings: the exchange "SUBJECT"
  is_filing    boolean not null default false,
  published_at timestamptz not null,
  fetched_at   timestamptz not null default now(),
  tone         numeric(4,3) check (tone between -1 and 1),
  tone_label   text check (tone_label in ('positive', 'negative', 'neutral')),
  tone_terms   text[] not null default '{}'
);
create index news_articles_published_idx on public.news_articles (published_at desc);

create table public.news_article_symbols (
  article_id    bigint not null references public.news_articles(id) on delete cascade,
  symbol        text not null,
  exchange      public.exchange_code not null,
  match_kind    text not null check (match_kind in ('filing', 'ticker', 'alias', 'name')),
  matched_text  text,
  primary key (article_id, symbol, exchange),
  foreign key (symbol, exchange) references public.market_symbols (symbol, exchange) on delete cascade
);
create index news_article_symbols_symbol_idx on public.news_article_symbols (symbol, exchange);

-- Curated names the matcher looks for in headlines ("L&T", "RIL", "HUL" …).
create table public.news_symbol_aliases (
  symbol   text not null,
  exchange public.exchange_code not null,
  alias    text not null check (char_length(alias) between 2 and 60),
  primary key (symbol, exchange, alias),
  foreign key (symbol, exchange) references public.market_symbols (symbol, exchange) on delete cascade
);

-- Rotation state for per-company search feeds (Google News), so each run
-- refreshes the stalest symbols instead of all of them.
create table public.news_search_cursor (
  symbol          text not null,
  exchange        public.exchange_code not null,
  last_fetched_at timestamptz,
  primary key (symbol, exchange),
  foreign key (symbol, exchange) references public.market_symbols (symbol, exchange) on delete cascade
);

-- One note per symbol per session; history kept for stance changes.
create table public.research_notes (
  symbol       text not null,
  exchange     public.exchange_code not null,
  as_of        date not null,
  score        numeric(5,1) not null check (score between -100 and 100),
  stance       text not null check (stance in ('constructive', 'neutral', 'cautious')),
  prev_stance  text check (prev_stance in ('constructive', 'neutral', 'cautious')),
  headline     text not null,
  factors      jsonb not null,               -- [{key,label,weight,score,detail}]
  news_count   integer not null default 0,
  filing_count integer not null default 0,
  generated_at timestamptz not null default now(),
  primary key (symbol, exchange, as_of),
  foreign key (symbol, exchange) references public.market_symbols (symbol, exchange) on delete cascade
);
create index research_notes_latest_idx on public.research_notes (as_of desc);

-- ---------- RLS: read-only for signed-in users; pipelines write ----------
do $$
declare t text;
begin
  foreach t in array array['news_sources', 'news_articles', 'news_article_symbols', 'news_symbol_aliases',
                           'news_search_cursor', 'research_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('grant select on public.%I to analytics_reader', t);
    execute format('create policy %I on public.%I for select to analytics_reader using (true)', t || '_analytics_read', t);
  end loop;
end $$;
-- Feed health (errors, URLs) is ops detail, not something members need.
revoke select on public.news_sources from authenticated;
grant select (id, code, name, kind) on public.news_sources to authenticated;

insert into public.news_sources (code, name, feed_url, kind) values
  ('et_markets',      'Economic Times · Markets',      'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', 'news'),
  ('et_stocks',       'Economic Times · Stocks',       'https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2146842.cms', 'news'),
  ('mc_markets',      'Moneycontrol · Market reports', 'https://www.moneycontrol.com/rss/marketreports.xml', 'news'),
  ('mc_business',     'Moneycontrol · Business',       'https://www.moneycontrol.com/rss/business.xml', 'news'),
  ('mint_markets',    'Mint · Markets',                'https://www.livemint.com/rss/markets', 'news'),
  ('bs_markets',      'Business Standard · Markets',   'https://www.business-standard.com/rss/markets-106.rss', 'news'),
  ('bl_stocks',       'BusinessLine · Stock markets',  'https://www.thehindubusinessline.com/markets/stock-markets/feeder/default.rss', 'news'),
  ('ndtv_profit',     'NDTV Profit',                   'https://feeds.feedburner.com/ndtvprofit-latest', 'news'),
  ('nse_filings',     'NSE · Corporate announcements', 'https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml', 'filing'),
  ('gnews_company',   'Google News · company search',  'https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en', 'search');

-- ---------- Per-symbol news stats for lists (security invoker) ----------
create or replace view public.symbol_news_stats
with (security_invoker = true) as
select l.symbol, l.exchange,
       count(*) filter (where not a.is_filing and a.published_at > now() - interval '7 days')  as news_7d,
       count(*) filter (where a.is_filing     and a.published_at > now() - interval '30 days') as filings_30d,
       round(avg(a.tone) filter (where not a.is_filing and a.published_at > now() - interval '14 days'), 3) as tone_14d,
       max(a.published_at) as last_published_at
from public.news_article_symbols l
join public.news_articles a on a.id = l.article_id
where a.published_at > now() - interval '30 days'
group by l.symbol, l.exchange;
revoke all on public.symbol_news_stats from anon, public;
grant select on public.symbol_news_stats to authenticated;

-- =====================================================================
-- Research notes. Five factors, each scored −2…+2, weighted, scaled to
-- −100…+100. Every number that moves the score is written into
-- `factors.detail` so the note explains itself.
--   trend     30%  close vs 200-day avg; 50-day vs 200-day
--   momentum  20%  RSI(14) zone; one-month return
--   range     10%  position inside the 52-week range
--   signal    15%  most recent rule signal (≤ 30 days)
--   news      25%  recency-weighted headline tone, 14 days (damped if < 3 articles)
-- Stance: ≥ +25 constructive · ≤ −25 cautious · otherwise neutral.
-- =====================================================================
create or replace function private.refresh_research_notes() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  with daily as (
    select c.symbol, c.exchange, c.ts, c.close, c.high, c.low,
           row_number() over (partition by c.symbol, c.exchange order by c.ts desc) as rn
    from public.market_candles c
    where c.interval = '1d' and c.ts > now() - interval '420 days'
  ),
  tech as (
    select d.symbol, d.exchange,
           max(d.ts)    filter (where d.rn = 1)    as last_ts,
           max(d.close) filter (where d.rn = 1)    as last_close,
           max(d.close) filter (where d.rn = 22)   as close_1m,
           avg(d.close) filter (where d.rn <= 50)  as sma50,
           avg(d.close) filter (where d.rn <= 200) as sma200,
           count(*)     filter (where d.rn <= 200) as n200,
           max(d.high)  filter (where d.rn <= 250) as hi52,
           min(d.low)   filter (where d.rn <= 250) as lo52
    from daily d
    group by d.symbol, d.exchange
    having count(*) >= 50
  ),
  rsi as (
    select distinct on (r.symbol, r.exchange) r.symbol, r.exchange, r.rsi
    from public.rsi_events r
    order by r.symbol, r.exchange, r.ts desc
  ),
  sig as (
    select distinct on (s.symbol, s.exchange) s.symbol, s.exchange, s.signal_type, s.strategy, s.generated_at,
           nullif(s.payload ->> 'close', '')::numeric as at_price
    from public.trading_signals s
    order by s.symbol, s.exchange, s.generated_at desc
  ),
  news as (
    select l.symbol, l.exchange,
           count(*) filter (where not a.is_filing) as n_news,
           count(*) filter (where a.is_filing)     as n_filings,
           sum(a.tone * exp(-extract(epoch from now() - a.published_at) / 86400.0 / 5))
             filter (where not a.is_filing and a.tone is not null)
           / nullif(sum(exp(-extract(epoch from now() - a.published_at) / 86400.0 / 5))
             filter (where not a.is_filing and a.tone is not null), 0) as tone,
           (array_agg(a.title order by a.published_at desc) filter (where not a.is_filing))[1] as top_title,
           (array_agg(coalesce(a.category, a.title) order by a.published_at desc) filter (where a.is_filing))[1] as last_filing
    from public.news_article_symbols l
    join public.news_articles a on a.id = l.article_id
    where a.published_at > now() - interval '14 days'
    group by l.symbol, l.exchange
  ),
  scored as (
    select t.*, r.rsi, g.signal_type, g.strategy, g.generated_at as signal_at, g.at_price,
           coalesce(n.n_news, 0) as n_news, coalesce(n.n_filings, 0) as n_filings, n.tone, n.top_title, n.last_filing,
           -- trend
           case when t.n200 >= 150 then
                  (case when t.last_close > t.sma200 then 1 else -1 end)
                + (case when t.sma50 > t.sma200 then 1 else -1 end)
                else (case when t.last_close > t.sma50 then 1 else -1 end) end::numeric as s_trend,
           -- momentum
           greatest(-2, least(2,
             (case when r.rsi is null then 0
                   when r.rsi >= 70 then 0.5
                   when r.rsi >= 55 then 1.5
                   when r.rsi >= 45 then 0
                   when r.rsi >= 30 then -1
                   else -1.5 end)
           + (case when t.close_1m is null then 0
                   when t.last_close / t.close_1m - 1 >  0.05 then 0.5
                   when t.last_close / t.close_1m - 1 < -0.05 then -0.5
                   else 0 end)))::numeric as s_momentum,
           -- 52-week range position
           (case when t.hi52 is null or t.hi52 <= t.lo52 then 0
                 when (t.last_close - t.lo52) / (t.hi52 - t.lo52) >= 0.85 then 1
                 when (t.last_close - t.lo52) / (t.hi52 - t.lo52) >= 0.60 then 0.5
                 when (t.last_close - t.lo52) / (t.hi52 - t.lo52) <= 0.15 then -1
                 when (t.last_close - t.lo52) / (t.hi52 - t.lo52) <= 0.40 then -0.5
                 else 0 end)::numeric as s_range,
           -- latest signal within 30 days
           (case when g.generated_at is null or g.generated_at < t.last_ts - interval '30 days' then 0
                 when g.signal_type = 'buy'  then 1.5 + (case when g.at_price > 0 and t.last_close > g.at_price then 0.5 else 0 end)
                 else -1.5 - (case when g.at_price > 0 and t.last_close < g.at_price then 0.5 else 0 end) end)::numeric as s_signal,
           -- news tone (damped when thin)
           greatest(-2, least(2, coalesce(n.tone, 0) * 2 * least(1, coalesce(n.n_news, 0) / 3.0)))::numeric as s_news
    from tech t
    left join rsi  r on r.symbol = t.symbol and r.exchange = t.exchange
    left join sig  g on g.symbol = t.symbol and g.exchange = t.exchange
    left join news n on n.symbol = t.symbol and n.exchange = t.exchange
  ),
  composed as (
    select s.*,
           round((0.30 * s_trend + 0.20 * s_momentum + 0.10 * s_range + 0.15 * s_signal + 0.25 * s_news) / 2 * 100, 1) as score,
           (s.last_ts at time zone 'Asia/Kolkata')::date as as_of
    from scored s
  ),
  final as (
    select c.*,
           case when c.score >= 25 then 'constructive' when c.score <= -25 then 'cautious' else 'neutral' end as stance,
           (select rn.stance from public.research_notes rn
             where rn.symbol = c.symbol and rn.exchange = c.exchange and rn.as_of < c.as_of
             order by rn.as_of desc limit 1) as prev_stance
    from composed c
  )
  insert into public.research_notes
    (symbol, exchange, as_of, score, stance, prev_stance, headline, factors, news_count, filing_count, generated_at)
  select f.symbol, f.exchange, f.as_of, f.score, f.stance, f.prev_stance,
         -- headline: trend phrase; momentum phrase; news phrase
         (case when f.s_trend >= 2 then 'Uptrend intact'
               when f.s_trend <= -2 then 'Downtrend in force'
               when f.s_trend > 0 then 'Trend turning up'
               else 'Trend turning down' end)
         || ', ' ||
         (case when f.rsi is null then 'momentum unclear'
               when f.rsi >= 70 then 'momentum stretched'
               when f.rsi >= 55 then 'momentum firm'
               when f.rsi >= 45 then 'momentum flat'
               when f.rsi >= 30 then 'momentum soft'
               else 'deeply oversold' end)
         || '; ' ||
         (case when f.n_news = 0 then 'no recent news'
               when f.tone >= 0.2 then 'news flow positive'
               when f.tone <= -0.2 then 'news flow negative'
               else 'news flow mixed' end)
         || '.',
         jsonb_build_array(
           jsonb_build_object('key', 'trend', 'label', 'Trend', 'weight', 0.30, 'score', f.s_trend,
             'detail', case when f.n200 >= 150 then
               format('Close %s%% %s the 200-day average; 50-day %s the 200-day.',
                      to_char(abs(f.last_close / f.sma200 - 1) * 100, 'FM990.0'),
                      case when f.last_close >= f.sma200 then 'above' else 'below' end,
                      case when f.sma50 >= f.sma200 then 'above' else 'below' end)
               else format('Under 150 sessions of history; close is %s the 50-day average.',
                      case when f.last_close >= f.sma50 then 'above' else 'below' end) end),
           jsonb_build_object('key', 'momentum', 'label', 'Momentum', 'weight', 0.20, 'score', f.s_momentum,
             'detail', format('RSI(14) %s; %s over the last month.',
               coalesce(to_char(f.rsi, 'FM990.0'), 'n/a'),
               case when f.close_1m is null then 'no one-month history'
                    else (case when f.last_close >= f.close_1m then '+' else '−' end)
                         || to_char(abs(f.last_close / f.close_1m - 1) * 100, 'FM990.0') || '%' end)),
           jsonb_build_object('key', 'range', 'label', '52-week range', 'weight', 0.10, 'score', f.s_range,
             'detail', case when f.hi52 > f.lo52 then
               format('At %s%% of the 52-week range (₹%s – ₹%s).',
                 to_char((f.last_close - f.lo52) / (f.hi52 - f.lo52) * 100, 'FM990'),
                 to_char(f.lo52, 'FM9999990.00'), to_char(f.hi52, 'FM9999990.00'))
               else 'Range not available.' end),
           jsonb_build_object('key', 'signal', 'label', 'Signals', 'weight', 0.15, 'score', f.s_signal,
             'detail', case when f.s_signal = 0 then 'No rule signal in the last 30 sessions.'
               else format('%s on %s (%s) at ₹%s; now %s.',
                 upper(f.signal_type), to_char(f.signal_at at time zone 'Asia/Kolkata', 'DD Mon'),
                 replace(f.strategy, '_', ' '), to_char(f.at_price, 'FM9999990.00'),
                 case when f.last_close >= f.at_price then 'above' else 'below' end) end),
           jsonb_build_object('key', 'news', 'label', 'News tone', 'weight', 0.25, 'score', f.s_news,
             'detail', case when f.n_news = 0 then 'No headlines matched in 14 days.'
               else format('%s headline%s in 14 days, recency-weighted tone %s%s.',
                 f.n_news, case when f.n_news = 1 then '' else 's' end,
                 case when f.tone >= 0 then '+' else '−' end || to_char(abs(f.tone), 'FM0.00'),
                 case when f.n_news < 3 then ' (damped: thin coverage)' else '' end) end,
             'top_headline', f.top_title),
           jsonb_build_object('key', 'filings', 'label', 'Exchange filings', 'weight', 0, 'score', 0,
             'detail', case when f.n_filings = 0 then 'No NSE filings in 14 days.'
               else format('%s filing%s in 14 days; latest: %s.', f.n_filings,
                 case when f.n_filings = 1 then '' else 's' end, f.last_filing) end)
         ),
         f.n_news, f.n_filings, now()
  from final f
  on conflict (symbol, exchange, as_of) do update
    set score = excluded.score, stance = excluded.stance, prev_stance = excluded.prev_stance,
        headline = excluded.headline, factors = excluded.factors,
        news_count = excluded.news_count, filing_count = excluded.filing_count, generated_at = now();
  get diagnostics v_rows = row_count;

  -- Tell people who watch or hold a symbol when its stance changes (once per session).
  insert into public.notifications (tenant_id, user_id, type, title, body, data)
  select distinct w.tenant_id, w.user_id, 'research_stance',
         rn.symbol || ' research turned ' || rn.stance,
         rn.headline || ' Score ' || to_char(rn.score, 'FMS990') || ' (was ' || rn.prev_stance || ').',
         jsonb_build_object('symbol', rn.symbol, 'as_of', rn.as_of, 'stance', rn.stance)
  from public.research_notes rn
  join (
    select wi.tenant_id, wi.user_id, wi.symbol, wi.exchange from public.watchlist_items wi
    union
    select h.tenant_id, h.user_id, h.symbol, h.exchange from public.holdings h where h.quantity > 0
  ) w on w.symbol = rn.symbol and w.exchange = rn.exchange
  where rn.as_of = (select max(x.as_of) from public.research_notes x where x.symbol = rn.symbol and x.exchange = rn.exchange)
    and rn.prev_stance is not null and rn.prev_stance <> rn.stance
    and not exists (
      select 1 from public.notifications n
      where n.user_id = w.user_id and n.tenant_id = w.tenant_id and n.type = 'research_stance'
        and n.data ->> 'symbol' = rn.symbol and n.data ->> 'as_of' = rn.as_of::text
    );

  return v_rows;
end $$;

revoke all on function private.refresh_research_notes() from public, anon, authenticated;

-- Service bridge so the ingestion pipeline can refresh notes right after new headlines land.
create or replace function public.svc_refresh_research() returns integer
language sql volatile security definer set search_path = '' as $$
  select private.refresh_research_notes()
$$;
revoke execute on function public.svc_refresh_research() from public, anon, authenticated;
grant  execute on function public.svc_refresh_research() to service_role;

-- 16:30 IST weekdays, after candles + EOD notifier.
select cron.schedule('research-notes', '0 11 * * 1-5', $$ select private.refresh_research_notes() $$);

-- Retention: headlines 180 days, research history 1 year.
select cron.schedule('retention-news', '35 2 * * *',
  $$ delete from public.news_articles where published_at < now() - interval '180 days' $$);
select cron.schedule('retention-research', '40 2 * * *',
  $$ delete from public.research_notes where as_of < current_date - 365 $$);

