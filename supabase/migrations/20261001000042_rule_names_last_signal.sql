-- Rule names and the latest signal everywhere (ADR-040 follow-up).
-- 1. private.rule_label: the name a person reads for each stored rule key (same words as web/src/lib/rules.ts and
--    strategyLabel); research notes used the key with underscores ("ma200 trend").
-- 2. private.refresh_last_signal: market_quotes.last_signal* were set by refresh_market_analytics, which runs before the
--    five rules write the evening's signals, so a new signal reached the Markets list, Market Radar, Overview and the
--    Dry Run candidates only a day later (and 200-day trend's back-filled signals not at all). It now runs after them.
--    Every rule counts, the old ones too (their signals are history and say "(old rule)").

-- ------------------------------------------------------------------ 1. names
create or replace function private.rule_label(p_strategy text) returns text
language sql immutable set search_path = '' as $$
  select case p_strategy
    when 'strong_trend'    then 'Strong trend'
    when 'sma_trend'       then 'SMA 20/50 trend'
    when 'ma200_trend'     then '200-day trend'
    when 'rsi_dip'         then 'RSI dip'
    when 'kk_dip'          then 'KK dip'
    when 'sma_20_50_cross' then 'SMA 20/50 cross (old rule)'
    when 'rsi_reversal'    then 'RSI reversal (old rule)'
    when 'kk_breakout'     then 'KK breakout (old rule)'
    else replace(p_strategy, '_', ' ') end
$$;
revoke all on function private.rule_label(text) from public, anon, authenticated;

-- Same function as migration 26, with the rule's name in the Signals line of a note.
create or replace function private.refresh_research_notes(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  with daily as (
    select c.symbol, c.exchange, c.ts, c.close, c.high, c.low,
           row_number() over (partition by c.symbol, c.exchange order by c.ts desc) as rn
    from public.market_candles c
    where c.interval = '1d' and c.ts > now() - interval '420 days'
      and (p_symbols is null or c.symbol = any(p_symbols))
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
    join public.market_symbols ms on ms.symbol = d.symbol and ms.exchange = d.exchange and ms.is_active
    group by d.symbol, d.exchange
    having count(*) >= 50
  ),
  rsi as (
    select distinct on (r.symbol, r.exchange) r.symbol, r.exchange, r.rsi
    from public.rsi_events r
    where (p_symbols is null or r.symbol = any(p_symbols))
    order by r.symbol, r.exchange, r.ts desc
  ),
  sig as (
    select distinct on (s.symbol, s.exchange) s.symbol, s.exchange, s.signal_type, s.strategy, s.generated_at,
           private.try_numeric(s.payload ->> 'close') as at_price
    from public.trading_signals s
    where (p_symbols is null or s.symbol = any(p_symbols))
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
      and (p_symbols is null or l.symbol = any(p_symbols))
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
                   when t.last_close / nullif(t.close_1m, 0) - 1 >  0.05 then 0.5
                   when t.last_close / nullif(t.close_1m, 0) - 1 < -0.05 then -0.5
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
                      to_char(abs(f.last_close / nullif(f.sma200, 0) - 1) * 100, 'FM990.0'),
                      case when f.last_close >= f.sma200 then 'above' else 'below' end,
                      case when f.sma50 >= f.sma200 then 'above' else 'below' end)
               else format('Under 150 sessions of history; close is %s the 50-day average.',
                      case when f.last_close >= f.sma50 then 'above' else 'below' end) end),
           jsonb_build_object('key', 'momentum', 'label', 'Momentum', 'weight', 0.20, 'score', f.s_momentum,
             'detail', format('RSI(14) %s; %s over the last month.',
               coalesce(to_char(f.rsi, 'FM990.0'), 'n/a'),
               case when f.close_1m is null then 'no one-month history'
                    else (case when f.last_close >= f.close_1m then '+' else '−' end)
                         || to_char(abs(f.last_close / nullif(f.close_1m, 0) - 1) * 100, 'FM990.0') || '%' end)),
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
                 private.rule_label(f.strategy), to_char(f.at_price, 'FM9999990.00'),
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

  -- Tell people who watch or hold a symbol when its stance changes (once per
  -- symbol per session, deduped in the ledger so deleting a notification
  -- doesn't bring it back).
  with changed as (
    select rn.symbol, rn.exchange, rn.as_of, rn.stance, rn.prev_stance, rn.score, rn.headline
    from public.research_notes rn
    where (p_symbols is null or rn.symbol = any(p_symbols))
      and rn.as_of = (select max(x.as_of) from public.research_notes x where x.symbol = rn.symbol and x.exchange = rn.exchange)
      and rn.prev_stance is not null and rn.prev_stance <> rn.stance
  ),
  watchers as (
    select distinct w.tenant_id, w.user_id, c.*
    from changed c
    join (
      select wi.tenant_id, wi.user_id, wi.symbol, wi.exchange from public.watchlist_items wi
      union
      select h.tenant_id, h.user_id, h.symbol, h.exchange from public.holdings h where h.quantity > 0
    ) w on w.symbol = c.symbol and w.exchange = c.exchange
  ),
  fresh as (
    insert into private.notification_ledger (user_id, tenant_id, kind, ref)
    select x.user_id, x.tenant_id, 'research_stance', x.symbol || ':' || x.as_of::text from watchers x
    on conflict do nothing
    returning user_id, tenant_id, ref
  )
  insert into public.notifications (tenant_id, user_id, type, title, body, data)
  select x.tenant_id, x.user_id, 'research_stance',
         x.symbol || ' research turned ' || x.stance,
         x.headline || ' Score ' || to_char(x.score, 'FMS990') || ' (was ' || x.prev_stance || ').',
         jsonb_build_object('symbol', x.symbol, 'as_of', x.as_of, 'stance', x.stance)
  from watchers x
  join fresh f on f.user_id = x.user_id and f.tenant_id = x.tenant_id and f.ref = x.symbol || ':' || x.as_of::text;

  return v_rows;
end $$;
revoke all on function private.refresh_research_notes(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ 2. the latest signal, after every rule has run
-- The newest signal of any rule. Ties on the same session: a buy before an exit, then the rule key, so the same row wins
-- every time.
create or replace function private.refresh_last_signal(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  with s as (
    select distinct on (t.symbol, t.exchange) t.symbol, t.exchange, t.signal_type, t.strategy, t.generated_at
    from public.trading_signals t
    where p_symbols is null or t.symbol = any(p_symbols)
    order by t.symbol, t.exchange, t.generated_at desc, (t.signal_type = 'buy') desc, t.strategy
  )
  update public.market_quotes q
     set last_signal = s.signal_type, last_signal_strategy = s.strategy, last_signal_at = s.generated_at
    from s
   where q.symbol = s.symbol and q.exchange = s.exchange
     and (q.last_signal, q.last_signal_strategy, q.last_signal_at) is distinct from (s.signal_type, s.strategy, s.generated_at);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_last_signal(text[]) from public, anon, authenticated;

create or replace function public.svc_refresh_market_analytics(p_days integer default 10, p_symbols text[] default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  v_out := private.refresh_market_analytics(p_days, p_symbols);
  v_out := v_out || jsonb_build_object('setups', private.refresh_setups(p_symbols));
  v_out := v_out || jsonb_build_object('weather', private.refresh_market_weather());
  v_out := v_out || jsonb_build_object('strong_trend', private.refresh_strong_trend(p_symbols));
  v_out := v_out || jsonb_build_object('sma_trend', private.refresh_sma_trend(p_symbols));
  v_out := v_out || jsonb_build_object('ma200_trend', private.refresh_ma200_trend(p_symbols));
  v_out := v_out || jsonb_build_object('dips', private.refresh_dip_rules(p_symbols));
  v_out := v_out || jsonb_build_object('last_signal', private.refresh_last_signal(p_symbols));
  v_out := v_out || jsonb_build_object('graded', private.grade_signals(p_symbols));
  return v_out;
end $$;
revoke execute on function public.svc_refresh_market_analytics(integer, text[]) from public, anon, authenticated;
grant  execute on function public.svc_refresh_market_analytics(integer, text[]) to service_role;

select cron.schedule('market-analytics', '25 12 * * 1-5',
  $$ select private.refresh_market_analytics(10); select private.refresh_setups();
     select private.refresh_market_weather(); select private.refresh_strong_trend(); select private.refresh_sma_trend();
     select private.refresh_ma200_trend(); select private.refresh_dip_rules(); select private.refresh_last_signal();
     select private.grade_signals(); select public.svc_refresh_signal_checks(); $$);

-- Bring every quote's latest signal and every note's wording up to date now.
select private.refresh_last_signal();
select private.refresh_research_notes();
