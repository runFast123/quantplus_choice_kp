-- =====================================================================
-- 5.26 Whole-market coverage (ADR-027): every NSE equity Yahoo lists
--      (main board + SME), major ETFs and NSE indices — ~3,600 symbols.
--      * market_symbols: segment, vendor_ticker, mcap_rank, history_days,
--        status_note / successors (retired symbols explain themselves)
--      * market_quotes: latest quote per symbol, written by the analytics
--        refresh (the old per-request view scanned a year of candles per
--        symbol — fine for 43, not for 3,600). market_snapshot reads it.
--      * refresh_market_analytics(days, symbols): per-symbol arrays, so the
--        pipeline can call it in batches under PostgREST's 8 s limit
--      * refresh_research_notes(symbols): same batching
--      * search_symbols(q): ranked server-side search (no 3,600-row lists)
--      * retention sized for the free 500 MB tier
-- =====================================================================

-- ---------- symbol metadata ----------
alter table public.market_symbols
  add column if not exists segment text not null default 'equity'
    check (segment in ('equity', 'sme', 'etf', 'index')),
  add column if not exists vendor_ticker text,
  add column if not exists mcap_rank integer,
  add column if not exists history_days smallint not null default 400 check (history_days between 30 and 1000),
  add column if not exists status_note text,
  add column if not exists successors text[] not null default '{}';
create index if not exists market_symbols_rank_idx on public.market_symbols (mcap_rank);
create index if not exists market_symbols_segment_idx on public.market_symbols (segment) where is_active;

-- Everything covered so far is the core list: keep two years of history.
update public.market_symbols set history_days = 760;
update public.market_symbols
   set status_note = 'Tata Motors demerged on 14 Oct 2025 into Tata Motors Passenger Vehicles (TMPV, incl. JLR) and Tata Motors (TMCV, commercial vehicles). TATAMOTORS no longer trades.',
       successors = '{TMPV,TMCV}'
 where symbol = 'TATAMOTORS' and exchange = 'NSE';

-- ---------- latest quote per symbol ----------
create table if not exists public.market_quotes (
  symbol               text not null,
  exchange             public.exchange_code not null,
  as_of                timestamptz not null,
  last_price           numeric(14,4) not null,
  prev_close           numeric(14,4),
  change               numeric(14,4),
  change_pct           numeric(9,2),
  volume               bigint,
  high_52w             numeric(14,4),
  low_52w              numeric(14,4),
  rsi                  numeric(6,2),
  last_signal          text,
  last_signal_strategy text,
  last_signal_at       timestamptz,
  updated_at           timestamptz not null default now(),
  primary key (symbol, exchange),
  foreign key (symbol, exchange) references public.market_symbols (symbol, exchange) on delete cascade
);
create index if not exists market_quotes_change_idx on public.market_quotes (change_pct);
alter table public.market_quotes enable row level security;
drop policy if exists market_quotes_read on public.market_quotes;
create policy market_quotes_read on public.market_quotes for select to authenticated using (true);
drop policy if exists market_quotes_analytics_read on public.market_quotes;
create policy market_quotes_analytics_read on public.market_quotes for select to analytics_reader using (true);
revoke all on public.market_quotes from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.market_quotes from authenticated;
grant select on public.market_quotes to authenticated, analytics_reader;

drop view if exists public.market_snapshot;
create view public.market_snapshot
with (security_invoker = true) as
select s.symbol, s.exchange, s.name, s.sector,
       q.as_of, q.last_price, q.prev_close, q.change, q.change_pct, q.volume,
       q.high_52w, q.low_52w, q.rsi, q.last_signal, q.last_signal_strategy, q.last_signal_at,
       s.segment, s.mcap_rank
from public.market_symbols s
left join public.market_quotes q on q.symbol = s.symbol and q.exchange = s.exchange
where s.is_active;
revoke all on public.market_snapshot from anon, public;
grant select on public.market_snapshot to authenticated;

-- ---------- analytics, per symbol ----------
-- Same rules as 5.24 (Wilder RSI 14, SMA 20/50 crosses, RSI reversals, monthly
-- SIP ledger) computed from per-symbol arrays. 'daily' RSI rows are written for
-- the last 35 sessions of each symbol only; crossings and signals for p_days.
create or replace function private.refresh_market_analytics(p_days integer default 10, p_symbols text[] default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_since   timestamptz := now() - make_interval(days => greatest(p_days, 1));
  sym       record;
  v_ts      timestamptz[];
  v_c       numeric[];
  v_h       numeric[];
  v_l       numeric[];
  v_v       bigint[];
  n         integer;
  i         integer;
  v_rsi     numeric[];
  s20       float8[];
  s50       float8[];
  sum20     float8;
  sum50     float8;
  g         float8;
  l         float8;
  d         float8;
  t         text;
  v_daily_from timestamptz;
  e_ts      timestamptz[];
  e_rsi     numeric[];
  e_type    text[];
  g_strat   text[];
  g_type    text[];
  g_payload jsonb[];
  g_at      timestamptz[];
  v_month   text;
  v_prev_m  text;
  v_units   numeric;
  v_run     numeric;
  v_k       integer;
  v_entries jsonb[];
  v_hi      numeric;
  v_lo      numeric;
  v_sig     record;
  v_cnt     integer;
  n_rsi     integer := 0;
  n_sig     integer := 0;
  n_led     integer := 0;
  n_q       integer := 0;
begin
  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    select array_agg(c.ts order by c.ts), array_agg(c.close order by c.ts), array_agg(c.high order by c.ts),
           array_agg(c.low order by c.ts), array_agg(c.volume order by c.ts)
      into v_ts, v_c, v_h, v_l, v_v
      from public.market_candles c
     where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d';
    n := coalesce(cardinality(v_ts), 0);
    if n = 0 then
      delete from public.market_quotes q where q.symbol = sym.symbol and q.exchange = sym.exchange;
      continue;
    end if;

    v_rsi := array_fill(null::numeric, array[n]);
    s20 := array_fill(null::float8, array[n]);
    s50 := array_fill(null::float8, array[n]);
    sum20 := 0; sum50 := 0; g := 0; l := 0;
    for i in 1..n loop
      sum20 := sum20 + v_c[i]::float8;
      if i > 20 then sum20 := sum20 - v_c[i - 20]::float8; end if;
      sum50 := sum50 + v_c[i]::float8;
      if i > 50 then sum50 := sum50 - v_c[i - 50]::float8; end if;
      s20[i] := sum20 / least(i, 20);
      s50[i] := sum50 / least(i, 50);
      if i > 1 then
        d := v_c[i]::float8 - v_c[i - 1]::float8;
        if i <= 15 then
          g := g + greatest(d, 0) / 14;
          l := l + greatest(-d, 0) / 14;
        else
          g := (g * 13 + greatest(d, 0)) / 14;
          l := (l * 13 + greatest(-d, 0)) / 14;
        end if;
        if i >= 15 then
          v_rsi[i] := case when l = 0 then 100 else round((100 - 100 / (1 + g / l))::numeric, 2) end;
        end if;
      end if;
    end loop;

    -- RSI events + signals
    v_daily_from := greatest(v_since, v_ts[n] - interval '35 days');
    e_ts := '{}'; e_rsi := '{}'; e_type := '{}';
    g_strat := '{}'; g_type := '{}'; g_payload := '{}'; g_at := '{}';
    for i in 2..n loop
      continue when v_ts[i] < v_since;
      if v_rsi[i] is not null then
        t := case when v_rsi[i] < 30 and coalesce(v_rsi[i - 1], 50) >= 30 then 'oversold_cross'
                  when v_rsi[i] > 70 and coalesce(v_rsi[i - 1], 50) <= 70 then 'overbought_cross'
                  else 'daily' end;
        if t <> 'daily' or v_ts[i] >= v_daily_from then
          e_ts := e_ts || v_ts[i]; e_rsi := e_rsi || v_rsi[i]; e_type := e_type || t;
        end if;
      end if;
      if i > 50 and ((s20[i] > s50[i] and s20[i - 1] <= s50[i - 1]) or (s20[i] < s50[i] and s20[i - 1] >= s50[i - 1])) then
        g_strat := g_strat || 'sma_20_50_cross'::text;
        g_type := g_type || (case when s20[i] > s50[i] then 'buy' else 'exit' end);
        g_payload := g_payload || jsonb_build_object('close', v_c[i], 'sma20', round(s20[i]::numeric, 2), 'sma50', round(s50[i]::numeric, 2),
                                                     'stop', round(v_c[i] * 0.93, 2), 'target', round(v_c[i] * 1.12, 2));
        g_at := g_at || (v_ts[i] + interval '15 minutes');
      end if;
      if (v_rsi[i - 1] < 30 and v_rsi[i] >= 30) or (v_rsi[i - 1] > 70 and v_rsi[i] <= 70) then
        g_strat := g_strat || 'rsi_reversal'::text;
        g_type := g_type || (case when v_rsi[i - 1] < 30 then 'buy' else 'exit' end);
        g_payload := g_payload || jsonb_build_object('close', v_c[i], 'rsi', v_rsi[i], 'prev_rsi', v_rsi[i - 1],
                                                     'stop', round(v_c[i] * 0.95, 2), 'target', round(v_c[i] * 1.08, 2));
        g_at := g_at || (v_ts[i] + interval '20 minutes');
      end if;
    end loop;

    insert into public.rsi_events (symbol, exchange, ts, rsi, event_type)
    select sym.symbol, sym.exchange, x.ts, x.rsi, x.t from unnest(e_ts, e_rsi, e_type) as x(ts, rsi, t)
    on conflict (symbol, exchange, ts) do update set rsi = excluded.rsi, event_type = excluded.event_type;
    get diagnostics v_cnt = row_count; n_rsi := n_rsi + v_cnt;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, x.s, x.t, x.p, x.at from unnest(g_strat, g_type, g_payload, g_at) as x(s, t, p, at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count; n_sig := n_sig + v_cnt;

    -- Monthly ₹10,000 SIP from the first candle, valued at the latest close.
    v_entries := '{}'; v_run := 0; v_k := 0; v_prev_m := null;
    for i in 1..n loop
      v_month := to_char(v_ts[i] at time zone 'Asia/Kolkata', 'YYYY-MM');
      if v_month is distinct from v_prev_m then
        v_prev_m := v_month;
        if v_c[i] > 0 then
          v_k := v_k + 1;
          v_units := round(10000 / v_c[i], 4);
          v_run := v_run + v_units;
          v_entries := v_entries || jsonb_build_object(
            'date', to_char(v_ts[i] at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), 'type', 'buy', 'price', v_c[i],
            'units', v_units, 'running_units', v_run, 'invested', v_k * 10000, 'value', round(v_run * v_c[i], 2));
        end if;
      end if;
    end loop;
    if v_k > 0 then
      insert into public.backtest_ledgers (symbol, exchange, ledger, roi_pct, computed_at)
      values (sym.symbol, sym.exchange,
              jsonb_build_object('strategy', 'monthly_sip', 'installment', 10000, 'entries', to_jsonb(v_entries),
                                 'invested', v_k * 10000, 'final_value', round(v_run * v_c[n], 2)),
              round((v_run * v_c[n] - v_k * 10000) / (v_k * 10000) * 100, 4), now())
      on conflict (symbol, exchange) do update
        set ledger = excluded.ledger, roi_pct = excluded.roi_pct, computed_at = excluded.computed_at;
      n_led := n_led + 1;
    end if;

    -- Latest quote
    v_hi := null; v_lo := null;
    for i in 1..n loop
      if v_ts[i] > v_ts[n] - interval '365 days' then
        v_hi := greatest(v_hi, v_h[i]);
        v_lo := least(v_lo, v_l[i]);
      end if;
    end loop;
    select ts.signal_type, ts.strategy, ts.generated_at into v_sig
      from public.trading_signals ts
     where ts.symbol = sym.symbol and ts.exchange = sym.exchange
     order by ts.generated_at desc limit 1;
    insert into public.market_quotes as q
      (symbol, exchange, as_of, last_price, prev_close, change, change_pct, volume, high_52w, low_52w, rsi,
       last_signal, last_signal_strategy, last_signal_at, updated_at)
    values (sym.symbol, sym.exchange, v_ts[n], v_c[n],
            case when n > 1 then v_c[n - 1] end,
            case when n > 1 then v_c[n] - v_c[n - 1] end,
            case when n > 1 and v_c[n - 1] > 0 then round((v_c[n] - v_c[n - 1]) / v_c[n - 1] * 100, 2) end,
            v_v[n], v_hi, v_lo, v_rsi[n], v_sig.signal_type, v_sig.strategy, v_sig.generated_at, now())
    on conflict (symbol, exchange) do update
      set as_of = excluded.as_of, last_price = excluded.last_price, prev_close = excluded.prev_close,
          change = excluded.change, change_pct = excluded.change_pct, volume = excluded.volume,
          high_52w = excluded.high_52w, low_52w = excluded.low_52w, rsi = excluded.rsi,
          last_signal = excluded.last_signal, last_signal_strategy = excluded.last_signal_strategy,
          last_signal_at = excluded.last_signal_at, updated_at = now();
    n_q := n_q + 1;
  end loop;

  return jsonb_build_object('rsi_events', n_rsi, 'signals', n_sig, 'ledgers', n_led, 'quotes', n_q);
end $$;
revoke all on function private.refresh_market_analytics(integer, text[]) from public, anon, authenticated;

drop function if exists private.refresh_market_analytics(integer);
drop function if exists public.svc_refresh_market_analytics(integer);
create or replace function public.svc_refresh_market_analytics(p_days integer default 10, p_symbols text[] default null) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select private.refresh_market_analytics(p_days, p_symbols)
$$;
revoke execute on function public.svc_refresh_market_analytics(integer, text[]) from public, anon, authenticated;
grant  execute on function public.svc_refresh_market_analytics(integer, text[]) to service_role;

-- ---------- research notes, per symbol batch ----------
drop function if exists private.refresh_research_notes();
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

drop function if exists public.svc_refresh_research();
create or replace function public.svc_refresh_research(p_symbols text[] default null) returns integer
language sql volatile security definer set search_path = '' as $$
  select private.refresh_research_notes(p_symbols)
$$;
revoke execute on function public.svc_refresh_research(text[]) from public, anon, authenticated;
grant  execute on function public.svc_refresh_research(text[]) to service_role;

-- ---------- search ----------
create or replace function public.search_symbols(p_q text, p_limit integer default 12)
returns table (symbol text, exchange public.exchange_code, name text, segment text, last_price numeric, change_pct numeric)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select upper(x) as u, lower(x) as l
    from (select replace(replace(replace(btrim(left(coalesce(p_q, ''), 40)), '\', '\\'), '%', '\%'), '_', '\_') as x) y
  )
  select s.symbol, s.exchange, s.name, s.segment, mq.last_price, mq.change_pct
  from public.market_symbols s
  cross join q
  left join public.market_quotes mq on mq.symbol = s.symbol and mq.exchange = s.exchange
  where s.is_active and q.u <> ''
    and (s.symbol like q.u || '%' or lower(s.name) like '%' || q.l || '%')
  order by (s.symbol = q.u) desc, (s.symbol like q.u || '%') desc, (lower(s.name) like q.l || '%') desc,
           (s.segment = 'index') desc, s.mcap_rank nulls last, s.symbol
  limit least(greatest(coalesce(p_limit, 12), 1), 50)
$$;
revoke execute on function public.search_symbols(text, integer) from public, anon;
grant  execute on function public.search_symbols(text, integer) to authenticated;

-- ---------- per-company news search: core + anything someone watches/holds ----------
create or replace function private.ensure_news_cursor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.news_search_cursor (symbol, exchange)
  select new.symbol, new.exchange
  where exists (select 1 from public.market_symbols s
                where s.symbol = new.symbol and s.exchange = new.exchange and s.is_active and s.segment in ('equity', 'sme'))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists watchlist_items_news_cursor on public.watchlist_items;
create trigger watchlist_items_news_cursor after insert on public.watchlist_items
  for each row execute function private.ensure_news_cursor();
drop trigger if exists holdings_news_cursor on public.holdings;
create trigger holdings_news_cursor after insert on public.holdings
  for each row execute function private.ensure_news_cursor();

-- ---------- retention for ~3,600 symbols on the free tier ----------
select cron.schedule('retention-candles', '45 2 * * *', $$
  delete from public.market_candles c using public.market_symbols s
   where s.symbol = c.symbol and s.exchange = c.exchange
     and c.ts < now() - make_interval(days => s.history_days::int) $$);
select cron.schedule('retention-rsi-daily', '50 2 * * *', $$
  delete from public.rsi_events where event_type = 'daily' and ts < now() - interval '40 days' $$);
-- Notes are rebuilt each session; history is only needed for the previous score / stance.
select cron.schedule('retention-research', '40 2 * * *', $$
  delete from public.research_notes where as_of < current_date - 10 $$);
select cron.schedule('market-analytics', '25 12 * * 1-5', $$ select private.refresh_market_analytics(10) $$);

-- Fill market_quotes for what's already loaded.
select private.refresh_market_analytics(15);
