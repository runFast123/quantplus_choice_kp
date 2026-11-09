-- Price guard and signal conditions (ADR-053).
--
-- 1. Price guard. Yahoo now and then serves a day's open, low or high far from the day before and from the day's own
--    close (6 Nov 2026: CLEANMAX opened and dipped to ₹1,021.20 between closes of ₹1,276.50 and ₹1,259.70). A rule then
--    reads a stop as hit that was not. Written down before looking at any rule's result (ADR-053):
--      pc = the previous stored session's close; a day is suspect when
--        low  < 0.88 × least(pc, close)          (dipped more than 12 % below both closes around it)
--        high > 1.12 × greatest(pc, close)        (rose more than 12 % above both)
--        open < 0.88 × least(pc, close) or open > 1.12 × greatest(pc, close)
--    Over the two years to 9 Nov 2026 that is 49 lows and 35 opens among the 500 largest companies, out of 235,109
--    sessions. A suspect day is kept as Yahoo sent it (the chart and the audit show it), and listed for an admin to
--    review. Until an admin says the price was real, the rules, the grades and price alerts read it through
--    private.trusted_candles: the suspect open becomes the close, a suspect low or high becomes the lower or higher of
--    that open and the close. So on a day we can't trust only the close counts.
--    The flags follow the candles: statement triggers re-check every day written and the session after it (its
--    previous close may have changed), so the guard is in place before the evening analytics run. A day Yahoo revises
--    so it no longer looks wrong loses its flag; a revised day that still looks wrong goes back to "suspect".
--    Signals already issued are not rewritten here; an admin review rebuilds that one stock's rule history.
-- 2. Signal conditions. For every buy of the live rules, the market and the stock as they were at the signal's close
--    (the RSI dip check's numbers, generalised, plus how crowded the rule was): signal_conditions. They are what later
--    research needs to learn which conditions a rule works in. Point in time: each number uses data up to that close
--    only. The 500 largest are today's list, as in market_breadth (ADR-038).

-- ------------------------------------------------------------------ 1. the flags
create table public.candle_checks (
  symbol      text not null,
  exchange    public.exchange_code not null,
  interval    text not null default '1d' check (interval = '1d'),
  ts          timestamptz not null,
  day         date not null,
  prev_close  numeric not null,
  open        numeric not null,              -- the day as stored when it was found
  high        numeric not null,
  low         numeric not null,
  close       numeric not null,
  bad_open    boolean not null,
  bad_high    boolean not null,
  bad_low     boolean not null,
  status      text not null default 'suspect' check (status in ('suspect', 'real', 'bad')),
  found_at    timestamptz not null default now(),
  reviewed_at timestamptz,
  primary key (symbol, exchange, interval, ts),
  check (bad_open or bad_high or bad_low)
);
create index candle_checks_review_idx on public.candle_checks (status, day desc);
alter table public.candle_checks enable row level security;
create policy candle_checks_read on public.candle_checks for select to authenticated using (true);
revoke insert, update, delete, truncate on public.candle_checks from authenticated;
revoke all on public.candle_checks from anon, public;
grant select on public.candle_checks to authenticated;

-- What the rules read: the stored day, except a flagged day nobody has called real.
create view private.trusted_candles as
select c.symbol, c.exchange, c.interval, c.ts,
       case when k.bad_open then c.close else c.open end as open,
       case when k.bad_high then greatest(case when k.bad_open then c.close else c.open end, c.close) else c.high end as high,
       case when k.bad_low then least(case when k.bad_open then c.close else c.open end, c.close) else c.low end as low,
       c.close, c.volume
from public.market_candles c
left join public.candle_checks k
  on k.symbol = c.symbol and k.exchange = c.exchange and k.interval = c.interval and k.ts = c.ts and k.status <> 'real';
revoke all on private.trusted_candles from public, anon, authenticated;

-- Re-check the given days and, for each, the next stored session. Called by the triggers below.
create or replace function private.check_candle_days(p_symbols text[], p_exchanges text[], p_ts timestamptz[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  with ch as (
    select distinct x.symbol, x.exchange::public.exchange_code as exchange, x.ts
    from unnest(p_symbols, p_exchanges, p_ts) as x(symbol, exchange, ts)
  ),
  tg as (
    select ch.symbol, ch.exchange, ch.ts from ch
    union
    select ch.symbol, ch.exchange, nx.ts
    from ch
    cross join lateral (
      select c.ts from public.market_candles c
      where c.symbol = ch.symbol and c.exchange = ch.exchange and c.interval = '1d' and c.ts > ch.ts
      order by c.ts limit 1
    ) nx
  ),
  ev as (
    select tg.symbol, tg.exchange, tg.ts, c.open, c.high, c.low, c.close, pv.close as pc
    from tg
    join public.market_candles c
      on c.symbol = tg.symbol and c.exchange = tg.exchange and c.interval = '1d' and c.ts = tg.ts
    cross join lateral (
      select p.close from public.market_candles p
      where p.symbol = tg.symbol and p.exchange = tg.exchange and p.interval = '1d' and p.ts < tg.ts
      order by p.ts desc limit 1
    ) pv
    where pv.close > 0
  ),
  fl as (
    select ev.*,
           ev.open < 0.88 * least(ev.pc, ev.close) or ev.open > 1.12 * greatest(ev.pc, ev.close) as bo,
           ev.high > 1.12 * greatest(ev.pc, ev.close) as bh,
           ev.low < 0.88 * least(ev.pc, ev.close) as bl
    from ev
  ),
  gone as (
    delete from public.candle_checks k
    using tg
    where k.symbol = tg.symbol and k.exchange = tg.exchange and k.interval = '1d' and k.ts = tg.ts
      and not exists (select 1 from fl where fl.symbol = k.symbol and fl.exchange = k.exchange and fl.ts = k.ts
                                         and (fl.bo or fl.bh or fl.bl))
    returning 1
  )
  insert into public.candle_checks (symbol, exchange, interval, ts, day, prev_close, open, high, low, close,
                                    bad_open, bad_high, bad_low)
  select fl.symbol, fl.exchange, '1d', fl.ts, (fl.ts at time zone 'Asia/Kolkata')::date, fl.pc,
         fl.open, fl.high, fl.low, fl.close, fl.bo, fl.bh, fl.bl
  from fl
  where fl.bo or fl.bh or fl.bl
  on conflict (symbol, exchange, interval, ts) do update
    set prev_close = excluded.prev_close, open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, bad_open = excluded.bad_open, bad_high = excluded.bad_high, bad_low = excluded.bad_low,
        status = 'suspect', found_at = now(), reviewed_at = null
    where (candle_checks.prev_close, candle_checks.open, candle_checks.high, candle_checks.low, candle_checks.close)
          is distinct from (excluded.prev_close, excluded.open, excluded.high, excluded.low, excluded.close);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.check_candle_days(text[], text[], timestamptz[]) from public, anon, authenticated;

create or replace function private.market_candles_checked() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_s  text[];
  v_e  text[];
  v_t  timestamptz[];
begin
  select array_agg(n.symbol), array_agg(n.exchange::text), array_agg(n.ts) into v_s, v_e, v_t
  from new_rows n where n.interval = '1d';
  if v_s is not null then
    perform private.check_candle_days(v_s, v_e, v_t);
  end if;
  return null;
end $$;
revoke all on function private.market_candles_checked() from public, anon, authenticated;

create trigger trg_market_candles_checked_ins after insert on public.market_candles
  referencing new table as new_rows for each statement execute function private.market_candles_checked();
create trigger trg_market_candles_checked_upd after update on public.market_candles
  referencing new table as new_rows for each statement execute function private.market_candles_checked();

-- Every stored day, once.
insert into public.candle_checks (symbol, exchange, interval, ts, day, prev_close, open, high, low, close,
                                  bad_open, bad_high, bad_low)
select x.symbol, x.exchange, '1d', x.ts, (x.ts at time zone 'Asia/Kolkata')::date, x.pc, x.open, x.high, x.low, x.close,
       x.bo, x.bh, x.bl
from (
  select y.*,
         y.open < 0.88 * least(y.pc, y.close) or y.open > 1.12 * greatest(y.pc, y.close) as bo,
         y.high > 1.12 * greatest(y.pc, y.close) as bh,
         y.low < 0.88 * least(y.pc, y.close) as bl
  from (
    select c.symbol, c.exchange, c.ts, c.open, c.high, c.low, c.close,
           lag(c.close) over (partition by c.symbol, c.exchange order by c.ts) as pc
    from public.market_candles c
    where c.interval = '1d'
  ) y
  where y.pc > 0
) x
where x.bo or x.bh or x.bl
on conflict do nothing;

-- An admin's review (the console, through the service role): 'real' puts the stored price back into the rules,
-- 'bad' keeps it set aside, 'suspect' undoes a review. When what the rules read changes, that one stock's rule
-- history is worked out again (private.rebuild_rule_signals: the rules, the latest signal, the grades).
create or replace function public.svc_review_candle(p_symbol text, p_exchange text, p_day date, p_status text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_old  text;
  v_out  jsonb := '{}'::jsonb;
begin
  if p_status is null or p_status not in ('suspect', 'real', 'bad') then
    raise exception 'INVALID_INPUT';
  end if;
  select k.status into v_old from public.candle_checks k
   where k.symbol = p_symbol and k.exchange::text = p_exchange and k.interval = '1d' and k.day = p_day
   for update;
  if v_old is null then raise exception 'NOT_FOUND'; end if;
  update public.candle_checks k
     set status = p_status, reviewed_at = case when p_status = 'suspect' then null else now() end
   where k.symbol = p_symbol and k.exchange::text = p_exchange and k.interval = '1d' and k.day = p_day;
  if (v_old = 'real') is distinct from (p_status = 'real')
     and exists (select 1 from public.market_symbols s
                  where s.symbol = p_symbol and s.exchange::text = p_exchange and s.mcap_rank <= 500) then
    v_out := private.rebuild_rule_signals(array[p_symbol]);
  end if;
  return jsonb_build_object('status', p_status, 'was', v_old, 'rebuilt', v_out <> '{}'::jsonb) || v_out;
end $$;
revoke execute on function public.svc_review_candle(text, text, date, text) from public, anon, authenticated;
grant  execute on function public.svc_review_candle(text, text, date, text) to service_role;

-- ------------------------------------------------------------------ 2. the rules, grades and alerts read trusted prices
-- The live definitions as of migration 56 (migrations 39, 45, 47, 50, 55 and earlier), copied with one change:
-- public.market_candles -> private.trusted_candles. Nothing else differs.
-- private.refresh_strong_trend: 1 read of the prices
CREATE OR REPLACE FUNCTION private.refresh_strong_trend(p_symbols text[] DEFAULT NULL::text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sym     record;
  v_ts    timestamptz[];
  v_o     numeric[];
  v_l     numeric[];
  v_c     numeric[];
  v_v     numeric[];
  v_hi    numeric[];
  v_n252  integer[];
  v_vol50 numeric[];
  v_n50   integer[];
  v_sma50 numeric[];
  v_atr   numeric[];
  v_natr  integer[];
  v_wx    text[];
  n       integer;
  i       integer;
  j       integer;
  k       integer;
  m       integer;
  busy    integer;
  v_stop  numeric;
  v_px    numeric;
  v_how   text;
  g_type  text[];
  g_pay   jsonb[];
  g_at    timestamptz[];
  v_cnt   integer;
  n_sig   integer := 0;
begin
  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    select array_agg(x.ts order by x.ts), array_agg(x.open order by x.ts), array_agg(x.low order by x.ts),
           array_agg(x.close order by x.ts), array_agg(x.volume::numeric order by x.ts),
           array_agg(x.hi252 order by x.ts), array_agg(x.n252 order by x.ts),
           array_agg(x.vol50 order by x.ts), array_agg(x.n50 order by x.ts), array_agg(x.sma50 order by x.ts),
           array_agg(x.atr14 order by x.ts), array_agg(x.natr order by x.ts), array_agg(x.state order by x.ts)
      into v_ts, v_o, v_l, v_c, v_v, v_hi, v_n252, v_vol50, v_n50, v_sma50, v_atr, v_natr, v_wx
      from (
        select t.*, w.state,
               max(t.close) over p252 as hi252, count(*) over p252 as n252,
               avg(t.volume) over p50 as vol50, count(*) over p50 as n50,
               avg(t.close) over w50 as sma50,
               avg(t.tr) over w14 as atr14, count(t.tr) over w14 as natr
        from (
          select c.ts, c.open, c.low, c.close, c.volume,
                 greatest(c.high - c.low, abs(c.high - lag(c.close) over o), abs(c.low - lag(c.close) over o)) as tr
          from private.trusted_candles c
          where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
          window o as (order by c.ts)
        ) t
        left join public.market_weather w on w.day = (t.ts at time zone 'Asia/Kolkata')::date
        window p252 as (order by t.ts rows between 252 preceding and 1 preceding),
               p50  as (order by t.ts rows between 50 preceding and 1 preceding),
               w50  as (order by t.ts rows 49 preceding),
               w14  as (order by t.ts rows 13 preceding)
      ) x;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 254;

    g_type := '{}'; g_pay := '{}'; g_at := '{}';
    busy := private.rule_resume(sym.symbol, sym.exchange, 'strong_trend', v_ts, 1);
    for i in 2..n loop
      continue when i <= busy;
      continue when v_n252[i] < 252 or v_n50[i] < 50 or v_natr[i] < 14 or v_wx[i] is distinct from 'sunny';
      continue when not (v_c[i] > v_hi[i] and v_v[i] >= 2 * v_vol50[i] and v_c[i] > v_sma50[i]);
      v_stop := round(v_c[i] - 4 * v_atr[i], 2);
      continue when v_stop <= 0;

      g_type := g_type || 'buy'::text;
      g_pay := g_pay || jsonb_build_object(
        'action', 'buy', 'direction', 'buy', 'label', 'Strong trend',
        'close', v_c[i], 'stop', v_stop, 'atr14', round(v_atr[i], 2), 'high_52w', v_hi[i],
        'volume_ratio', round(v_v[i] / nullif(v_vol50[i], 0), 2), 'sma50', round(v_sma50[i], 2),
        'weather', 'sunny', 'review_sessions', 60);
      g_at := g_at || (v_ts[i] + interval '25 minutes');

      j := i + 1;                                   -- entry: the next session's open
      if j > n then busy := n; continue; end if;    -- signalled on the latest candle: no entry yet
      k := null;
      for m in j..least(j + 59, n) loop
        if v_l[m] <= v_stop then
          k := m; v_px := least(v_o[m], v_stop); v_how := 'STOP_HIT';
          exit;
        end if;
      end loop;
      if k is null then
        if j + 59 > n then busy := n; continue; end if;   -- still open: no exit yet, no new buy
        k := j + 59; v_px := v_c[k]; v_how := 'REVIEW_60';
      end if;
      busy := k;
      g_type := g_type || 'exit'::text;
      g_pay := g_pay || jsonb_build_object(
        'action', 'exit', 'direction', 'buy',
        'label', case v_how when 'STOP_HIT' then 'Strong trend: safety stop' else 'Strong trend: 60-session review' end,
        'close', v_px, 'exit_price', v_px, 'entry_fill', v_o[j], 'result', v_how,
        'pnl_pct', round((v_px / v_o[j] - 1) * 100, 2), 'bars_held', k - j + 1);
      g_at := g_at || (v_ts[k] + interval '25 minutes');
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, 'strong_trend', x.t, x.p, x.at
    from unnest(g_type, g_pay, g_at) as x(t, p, at)
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = 'strong_trend'
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $function$;
revoke all on function private.refresh_strong_trend(p_symbols text[]) from public, anon, authenticated;

-- private.refresh_sma_trend: 1 read of the prices
CREATE OR REPLACE FUNCTION private.refresh_sma_trend(p_symbols text[] DEFAULT NULL::text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sym     record;
  v_ts    timestamptz[];
  v_o     numeric[];
  v_l     numeric[];
  v_c     numeric[];
  v_s20   numeric[];
  v_s50   numeric[];
  v_atr   numeric[];
  v_natr  integer[];
  v_rs    numeric[];
  n       integer;
  i       integer;
  j       integer;
  k       integer;
  m       integer;
  busy    integer;
  v_stop  numeric;
  v_px    numeric;
  v_how   text;
  g_type  text[];
  g_pay   jsonb[];
  g_at    timestamptz[];
  v_cnt   integer;
  n_sig   integer := 0;
begin
  perform private.refresh_leaders();
  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    select array_agg(x.ts order by x.ts), array_agg(x.open order by x.ts), array_agg(x.low order by x.ts),
           array_agg(x.close order by x.ts), array_agg(x.s20 order by x.ts), array_agg(x.s50 order by x.ts),
           array_agg(x.atr14 order by x.ts), array_agg(x.natr order by x.ts), array_agg(x.rs_pct order by x.ts)
      into v_ts, v_o, v_l, v_c, v_s20, v_s50, v_atr, v_natr, v_rs
      from (
        select t.*, ld.rs_pct,
               case when count(*) over w20 = 20 then avg(t.close) over w20 end as s20,
               case when count(*) over w50 = 50 then avg(t.close) over w50 end as s50,
               avg(t.tr) over w14 as atr14, count(t.tr) over w14 as natr
        from (
          select c.ts, c.open, c.low, c.close,
                 greatest(c.high - c.low, abs(c.high - lag(c.close) over o), abs(c.low - lag(c.close) over o)) as tr
          from private.trusted_candles c
          where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
          window o as (order by c.ts)
        ) t
        left join public.market_leaders ld
          on ld.symbol = sym.symbol and ld.exchange = sym.exchange and ld.day = (t.ts at time zone 'Asia/Kolkata')::date
        window w20 as (order by t.ts rows 19 preceding), w50 as (order by t.ts rows 49 preceding),
               w14 as (order by t.ts rows 13 preceding)
      ) x;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 52;

    g_type := '{}'; g_pay := '{}'; g_at := '{}';
    busy := private.rule_resume(sym.symbol, sym.exchange, 'sma_trend', v_ts, 1);
    for i in 51..n loop
      continue when i <= busy or v_s50[i] is null or v_s50[i - 1] is null or v_natr[i] < 14;
      continue when not (v_s20[i] > v_s50[i] and v_s20[i - 1] <= v_s50[i - 1]);
      continue when v_rs[i] is null or v_rs[i] < 0.7;
      v_stop := round(v_c[i] - 4 * v_atr[i], 2);
      continue when v_stop <= 0;

      g_type := g_type || 'buy'::text;
      g_pay := g_pay || jsonb_build_object(
        'action', 'buy', 'direction', 'buy', 'label', 'SMA 20/50 trend',
        'close', v_c[i], 'stop', v_stop, 'atr14', round(v_atr[i], 2), 'sma20', round(v_s20[i], 2), 'sma50', round(v_s50[i], 2),
        'rs_pct', round(v_rs[i], 3), 'review_sessions', 60);
      g_at := g_at || (v_ts[i] + interval '15 minutes');

      j := i + 1;                                   -- entry: the next session's open
      if j > n then busy := n; continue; end if;
      k := null;
      for m in j..least(j + 59, n) loop
        if v_l[m] <= v_stop then
          k := m; v_px := least(v_o[m], v_stop); v_how := 'STOP_HIT';
          exit;
        end if;
      end loop;
      if k is null then
        if j + 59 > n then busy := n; continue; end if;   -- still open
        k := j + 59; v_px := v_c[k]; v_how := 'REVIEW_60';
      end if;
      busy := k;
      g_type := g_type || 'exit'::text;
      g_pay := g_pay || jsonb_build_object(
        'action', 'exit', 'direction', 'buy',
        'label', case v_how when 'STOP_HIT' then 'SMA 20/50 trend: safety stop' else 'SMA 20/50 trend: 60-session review' end,
        'close', v_px, 'exit_price', v_px, 'entry_fill', v_o[j], 'result', v_how,
        'pnl_pct', round((v_px / v_o[j] - 1) * 100, 2), 'bars_held', k - j + 1);
      g_at := g_at || (v_ts[k] + interval '15 minutes');
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, 'sma_trend', x.t, x.p, x.at
    from unnest(g_type, g_pay, g_at) as x(t, p, at)
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = 'sma_trend'
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $function$;
revoke all on function private.refresh_sma_trend(p_symbols text[]) from public, anon, authenticated;

-- private.refresh_ma200_trend: 1 read of the prices
CREATE OR REPLACE FUNCTION private.refresh_ma200_trend(p_symbols text[] DEFAULT NULL::text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sym     record;
  v_ts    timestamptz[];
  v_o     numeric[];
  v_l     numeric[];
  v_c     numeric[];
  v_sma   numeric[];
  v_slope float8[];
  v_r     float8[];
  v_atr   numeric[];
  v_natr  integer[];
  n       integer;
  i       integer;
  j       integer;
  k       integer;
  m       integer;
  busy    integer;
  v_ok    boolean;
  v_prev  boolean;
  v_stop  numeric;
  v_px    numeric;
  v_how   text;
  g_type  text[];
  g_pay   jsonb[];
  g_at    timestamptz[];
  v_cnt   integer;
  n_sig   integer := 0;
begin
  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    select array_agg(z.ts order by z.ts), array_agg(z.open order by z.ts), array_agg(z.low order by z.ts),
           array_agg(z.close order by z.ts), array_agg(z.sma200 order by z.ts), array_agg(z.slope_pct order by z.ts),
           array_agg(z.r_px order by z.ts), array_agg(z.atr14 order by z.ts), array_agg(z.natr order by z.ts)
      into v_ts, v_o, v_l, v_c, v_sma, v_slope, v_r, v_atr, v_natr
      from (
        select y.ts, y.open, y.low, y.close, y.sma200, y.atr14, y.natr,
               -- the fitted line's change over 20 sessions, in % of today's 200-day average
               case when y.n_slope = 100 then 2000 * y.slope / y.sma200::float8 end as slope_pct,
               case when y.n_r = 100 then y.r end as r_px
        from (
          select x.*,
                 regr_slope(x.sma200::float8, x.k::float8) over w100 as slope,
                 regr_count(x.sma200::float8, x.k::float8) over w100 as n_slope,
                 corr(x.close::float8, x.k::float8) over w100 as r,
                 count(*) over w100 as n_r
          from (
            select t.ts, t.open, t.low, t.close, row_number() over (order by t.ts) as k,
                   case when count(*) over w200 = 200 then avg(t.close) over w200 end as sma200,
                   avg(t.tr) over w14 as atr14, count(t.tr) over w14 as natr
            from (
              select c.ts, c.open, c.low, c.close,
                     greatest(c.high - c.low, abs(c.high - lag(c.close) over o), abs(c.low - lag(c.close) over o)) as tr
              from private.trusted_candles c
              where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
              window o as (order by c.ts)
            ) t
            window w200 as (order by t.ts rows 199 preceding), w14 as (order by t.ts rows 13 preceding)
          ) x
          window w100 as (order by x.ts rows 99 preceding)
        ) y
      ) z;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 300;

    g_type := '{}'; g_pay := '{}'; g_at := '{}';
    busy := private.rule_resume(sym.symbol, sym.exchange, 'ma200_trend', v_ts, 1);
    v_prev := null;                                 -- null = the day before could not be measured
    for i in 1..n loop
      if v_sma[i] is null or v_slope[i] is null or v_r[i] is null then
        v_ok := null;
      else
        v_ok := v_c[i] > v_sma[i] and v_slope[i] >= -0.25 and v_r[i] >= 0.5;
      end if;
      if v_ok and v_prev is not null and not v_prev and i > busy and v_natr[i] >= 14 then
        v_stop := round(v_c[i] - 4 * v_atr[i], 2);
        if v_stop > 0 then
          g_type := g_type || 'buy'::text;
          g_pay := g_pay || jsonb_build_object(
            'action', 'buy', 'direction', 'buy', 'label', '200-day trend',
            'close', v_c[i], 'stop', v_stop, 'atr14', round(v_atr[i], 2), 'sma200', round(v_sma[i], 2),
            'slope_pct', round(v_slope[i]::numeric, 2), 'r_px', round(v_r[i]::numeric, 2), 'review_sessions', 60);
          g_at := g_at || (v_ts[i] + interval '15 minutes');

          j := i + 1;                               -- entry: the next session's open
          if j > n then
            busy := n;
          else
            k := null;
            for m in j..least(j + 59, n) loop
              if v_l[m] <= v_stop then
                k := m; v_px := least(v_o[m], v_stop); v_how := 'STOP_HIT';
                exit;
              end if;
            end loop;
            if k is null and j + 59 > n then
              busy := n;                            -- still open
            else
              if k is null then k := j + 59; v_px := v_c[k]; v_how := 'REVIEW_60'; end if;
              busy := k;
              g_type := g_type || 'exit'::text;
              g_pay := g_pay || jsonb_build_object(
                'action', 'exit', 'direction', 'buy',
                'label', case v_how when 'STOP_HIT' then '200-day trend: safety stop' else '200-day trend: 60-session review' end,
                'close', v_px, 'exit_price', v_px, 'entry_fill', v_o[j], 'result', v_how,
                'pnl_pct', round((v_px / v_o[j] - 1) * 100, 2), 'bars_held', k - j + 1);
              g_at := g_at || (v_ts[k] + interval '15 minutes');
            end if;
          end if;
        end if;
      end if;
      v_prev := v_ok;
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, 'ma200_trend', x.t, x.p, x.at
    from unnest(g_type, g_pay, g_at) as x(t, p, at)
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = 'ma200_trend'
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $function$;
revoke all on function private.refresh_ma200_trend(p_symbols text[]) from public, anon, authenticated;

-- private.refresh_secular_trend: 1 read of the prices
CREATE OR REPLACE FUNCTION private.refresh_secular_trend(p_symbols text[] DEFAULT NULL::text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sym     record;
  v_ts    timestamptz[];
  v_o     numeric[];
  v_l     numeric[];
  v_c     numeric[];
  v_k     float8[];
  v_sig   float8[];
  v_atr   numeric[];
  v_natr  integer[];
  n       integer;
  i       integer;
  j       integer;
  k       integer;
  m       integer;
  busy    integer;
  v_stop  numeric;
  v_px    numeric;
  v_how   text;
  g_type  text[];
  g_pay   jsonb[];
  g_at    timestamptz[];
  v_cnt   integer;
  n_sig   integer := 0;
begin
  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    select array_agg(q.ts order by q.ts), array_agg(q.open order by q.ts), array_agg(q.low order by q.ts),
           array_agg(q.close order by q.ts), array_agg(q.sk order by q.ts), array_agg(q.sig order by q.ts),
           array_agg(q.atr14 order by q.ts), array_agg(q.natr order by q.ts)
      into v_ts, v_o, v_l, v_c, v_k, v_sig, v_atr, v_natr
      from (
        select z.*, case when count(z.k1) over w50 = 50 then avg(z.k1) over w50 end as sig
        from (
          select y.*, case when count(y.sk) over w50 = 50 then avg(y.sk) over w50 end as k1
          from (
            select x.ts, x.open, x.low, x.close, x.atr14, x.natr,
                   case when count(x.r10) over w10 = 10 and count(x.r15) over w10 = 10 and count(x.r20) over w10 = 10
                         and count(x.r30) over w15 = 15 and count(x.r40) over w50 = 50 and count(x.r65) over w65 = 65
                         and count(x.r75) over w75 = 75 and count(x.r100) over w100 = 100
                         and count(x.r195) over w130 = 130 and count(x.r265) over w130 = 130
                         and count(x.r390) over w130 = 130 and count(x.r530) over w195 = 195 then
                          1 * avg(x.r10) over w10  + 2 * avg(x.r15) over w10  + 3 * avg(x.r20) over w10  + 4 * avg(x.r30) over w15
                        + 1 * avg(x.r40) over w50  + 2 * avg(x.r65) over w65  + 3 * avg(x.r75) over w75  + 4 * avg(x.r100) over w100
                        + 1 * avg(x.r195) over w130 + 2 * avg(x.r265) over w130 + 3 * avg(x.r390) over w130 + 4 * avg(x.r530) over w195
                   end as sk
            from (
              select t.ts, t.open, t.low, t.close,
                     (100 * (t.close / nullif(lag(t.close, 10)  over o, 0) - 1))::float8 as r10,
                     (100 * (t.close / nullif(lag(t.close, 15)  over o, 0) - 1))::float8 as r15,
                     (100 * (t.close / nullif(lag(t.close, 20)  over o, 0) - 1))::float8 as r20,
                     (100 * (t.close / nullif(lag(t.close, 30)  over o, 0) - 1))::float8 as r30,
                     (100 * (t.close / nullif(lag(t.close, 40)  over o, 0) - 1))::float8 as r40,
                     (100 * (t.close / nullif(lag(t.close, 65)  over o, 0) - 1))::float8 as r65,
                     (100 * (t.close / nullif(lag(t.close, 75)  over o, 0) - 1))::float8 as r75,
                     (100 * (t.close / nullif(lag(t.close, 100) over o, 0) - 1))::float8 as r100,
                     (100 * (t.close / nullif(lag(t.close, 195) over o, 0) - 1))::float8 as r195,
                     (100 * (t.close / nullif(lag(t.close, 265) over o, 0) - 1))::float8 as r265,
                     (100 * (t.close / nullif(lag(t.close, 390) over o, 0) - 1))::float8 as r390,
                     (100 * (t.close / nullif(lag(t.close, 530) over o, 0) - 1))::float8 as r530,
                     avg(t.tr) over w14 as atr14, count(t.tr) over w14 as natr
              from (
                select c.ts, c.open, c.low, c.close,
                       greatest(c.high - c.low, abs(c.high - lag(c.close) over o), abs(c.low - lag(c.close) over o)) as tr
                from private.trusted_candles c
                where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
                window o as (order by c.ts)
              ) t
              window o as (order by t.ts), w14 as (order by t.ts rows 13 preceding)
            ) x
            window w10 as (order by x.ts rows 9 preceding), w15 as (order by x.ts rows 14 preceding),
                   w50 as (order by x.ts rows 49 preceding), w65 as (order by x.ts rows 64 preceding),
                   w75 as (order by x.ts rows 74 preceding), w100 as (order by x.ts rows 99 preceding),
                   w130 as (order by x.ts rows 129 preceding), w195 as (order by x.ts rows 194 preceding)
          ) y
          window w50 as (order by y.ts rows 49 preceding)
        ) z
        window w50 as (order by z.ts rows 49 preceding)
      ) q;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 824;                          -- the signal line needs 823 sessions, the cross one more

    g_type := '{}'; g_pay := '{}'; g_at := '{}';
    busy := private.rule_resume(sym.symbol, sym.exchange, 'secular_trend', v_ts, 1);
    for i in 6..n loop
      if v_k[i] is not null and v_sig[i] is not null and v_k[i - 1] is not null and v_sig[i - 1] is not null
         and v_k[i - 5] is not null
         and v_k[i] > v_sig[i] and v_k[i - 1] <= v_sig[i - 1]    -- crosses above its signal line
         and v_k[i] >= v_k[i - 5]                                -- flat or rising
         and v_k[i] < -150                                       -- under the owner's line
         and i > busy and v_natr[i] >= 14 then
        v_stop := round(v_c[i] - 4 * v_atr[i], 2);
        if v_stop > 0 then
          g_type := g_type || 'buy'::text;
          g_pay := g_pay || jsonb_build_object(
            'action', 'buy', 'direction', 'buy', 'label', 'Secular trend',
            'close', v_c[i], 'stop', v_stop, 'atr14', round(v_atr[i], 2),
            'secular', round(v_k[i]::numeric, 1), 'secular_signal', round(v_sig[i]::numeric, 1), 'line', -150,
            'review_sessions', 60);
          g_at := g_at || (v_ts[i] + interval '15 minutes');

          j := i + 1;                               -- entry: the next session's open
          if j > n then
            busy := n;
          else
            k := null;
            for m in j..least(j + 59, n) loop
              if v_l[m] <= v_stop then
                k := m; v_px := least(v_o[m], v_stop); v_how := 'STOP_HIT';
                exit;
              end if;
            end loop;
            if k is null and j + 59 > n then
              busy := n;                            -- still open
            else
              if k is null then k := j + 59; v_px := v_c[k]; v_how := 'REVIEW_60'; end if;
              busy := k;
              g_type := g_type || 'exit'::text;
              g_pay := g_pay || jsonb_build_object(
                'action', 'exit', 'direction', 'buy',
                'label', case v_how when 'STOP_HIT' then 'Secular trend: safety stop' else 'Secular trend: 60-session review' end,
                'close', v_px, 'exit_price', v_px, 'entry_fill', v_o[j], 'result', v_how,
                'pnl_pct', round((v_px / v_o[j] - 1) * 100, 2), 'bars_held', k - j + 1);
              g_at := g_at || (v_ts[k] + interval '15 minutes');
            end if;
          end if;
        end if;
      end if;
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, 'secular_trend', x.t, x.p, x.at
    from unnest(g_type, g_pay, g_at) as x(t, p, at)
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = 'secular_trend'
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $function$;
revoke all on function private.refresh_secular_trend(p_symbols text[]) from public, anon, authenticated;

-- private.refresh_dip_rules: 2 reads of the prices
CREATE OR REPLACE FUNCTION private.refresh_dip_rules(p_symbols text[] DEFAULT NULL::text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sym      record;
  v_latest timestamptz;
  v_ts     timestamptz[];
  v_o      numeric[];
  v_h      numeric[];
  v_l      numeric[];
  v_c      numeric[];
  v_s5     numeric[];
  v_s200   numeric[];
  v_lo20   numeric[];
  v_atr    float8[];
  v_rsi2   float8[];
  n        integer;
  t        integer;
  i        integer;
  j        integer;
  k        integer;
  m        integer;
  busy     integer;
  a        float8;
  g        float8;
  ls       float8;
  d        float8;
  tr       float8;
  v_rule   text;
  v_hit    boolean;
  v_lim    numeric;
  v_e      numeric;
  v_stop   numeric;
  v_px     numeric;
  v_how    text;
  v_label  text;
  v_extra  jsonb;
  g_strat  text[];
  g_type   text[];
  g_pay    jsonb[];
  g_at     timestamptz[];
  v_cnt    integer;
  n_sig    integer := 0;
begin
  select max(c.ts) into v_latest from private.trusted_candles c
   where c.symbol = 'NIFTY' and c.exchange = 'NSE' and c.interval = '1d';
  -- A dip-buy level is good for the next session only.
  delete from public.signal_watch w where w.signal_day < (v_latest at time zone 'Asia/Kolkata')::date;

  for sym in
    select s.symbol, s.exchange from public.market_symbols s
    where s.is_active and s.segment = 'equity' and s.mcap_rank <= 500
      and (p_symbols is null or s.symbol = any(p_symbols))
    order by s.symbol
  loop
    delete from public.signal_watch w where w.symbol = sym.symbol and w.exchange = sym.exchange;
    select array_agg(x.ts order by x.ts), array_agg(x.open order by x.ts), array_agg(x.high order by x.ts),
           array_agg(x.low order by x.ts), array_agg(x.close order by x.ts), array_agg(x.s5 order by x.ts),
           array_agg(x.s200 order by x.ts), array_agg(x.lo20 order by x.ts)
      into v_ts, v_o, v_h, v_l, v_c, v_s5, v_s200, v_lo20
      from (
        select c.ts, c.open, c.high, c.low, c.close,
               case when count(*) over w5 = 5 then avg(c.close) over w5 end as s5,
               case when count(*) over w200 = 200 then avg(c.close) over w200 end as s200,
               case when count(*) over p20 = 20 then min(c.low) over p20 end as lo20
        from private.trusted_candles c
        where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
        window w5 as (order by c.ts rows 4 preceding), w200 as (order by c.ts rows 199 preceding),
               p20 as (order by c.ts rows between 20 preceding and 1 preceding)
      ) x;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 202;

    -- ATR14 and RSI(2) as exponential averages (the tested definitions)
    v_atr := array_fill(null::float8, array[n]);
    v_rsi2 := array_fill(null::float8, array[n]);
    for t in 1..n loop
      tr := case when t = 1 then (v_h[t] - v_l[t])::float8
                 else greatest(v_h[t] - v_l[t], abs(v_h[t] - v_c[t - 1]), abs(v_l[t] - v_c[t - 1]))::float8 end;
      a := case when t = 1 then tr else a + (tr - a) / 14 end;
      if t >= 14 then v_atr[t] := a; end if;
      if t >= 2 then
        d := (v_c[t] - v_c[t - 1])::float8;
        if t = 2 then g := greatest(d, 0); ls := greatest(-d, 0);
        else g := 0.5 * g + 0.5 * greatest(d, 0); ls := 0.5 * ls + 0.5 * greatest(-d, 0); end if;
        if t >= 3 then v_rsi2[t] := case when ls = 0 then 100 else 100 - 100 / (1 + g / ls) end; end if;
      end if;
    end loop;

    g_strat := '{}'; g_type := '{}'; g_pay := '{}'; g_at := '{}';
    foreach v_rule in array array['rsi_dip', 'kk_dip'] loop
      v_label := case v_rule when 'rsi_dip' then 'RSI dip' else 'KK dip' end;
      busy := private.rule_resume(sym.symbol, sym.exchange, v_rule, v_ts, 2);
      for i in 1..n loop
        continue when i <= busy or v_atr[i] is null or v_s200[i] is null or v_c[i] <= v_s200[i];
        v_hit := case v_rule when 'rsi_dip' then v_rsi2[i] < 10
                             else v_lo20[i] is not null and v_l[i] <= 0.99 * v_lo20[i] end;
        continue when not coalesce(v_hit, false);
        v_lim := round(v_c[i] - v_atr[i]::numeric, 2);
        continue when v_lim <= 0;
        v_extra := case v_rule when 'rsi_dip' then jsonb_build_object('rsi2', round(v_rsi2[i]::numeric, 1))
                               else jsonb_build_object('low_20d', v_lo20[i]) end;
        j := i + 1;
        if j > n then
          -- signalled on the latest close: tomorrow's dip-buy level
          if v_ts[i] = v_latest then
            insert into public.signal_watch (symbol, exchange, strategy, signal_day, limit_price, stop, payload)
            values (sym.symbol, sym.exchange, v_rule, (v_ts[i] at time zone 'Asia/Kolkata')::date, v_lim,
                    round(v_lim - 5 * v_atr[i]::numeric, 2),
                    v_extra || jsonb_build_object('signal_close', v_c[i], 'atr14', round(v_atr[i]::numeric, 2)));
          end if;
          continue;
        end if;
        continue when v_l[j] > v_lim * 0.998;                  -- the dip did not come: no trade
        v_e := least(v_o[j], v_lim);
        v_stop := round(v_e - 5 * v_atr[i]::numeric, 2);
        k := null;
        for m in j..least(j + 9, n) loop
          if v_l[m] <= v_stop then
            k := m; v_px := case when m > j then least(v_o[m], v_stop) else v_stop end; v_how := 'STOP_HIT';
            exit;
          end if;
          if v_s5[m] is not null and v_c[m] > v_s5[m] then
            k := m; v_px := v_c[m]; v_how := 'BOUNCE';
            exit;
          end if;
        end loop;

        g_strat := g_strat || v_rule;
        g_type := g_type || 'buy'::text;
        g_pay := g_pay || (v_extra || jsonb_build_object(
          'action', 'buy', 'direction', 'buy', 'label', v_label, 'close', v_e, 'fill', v_e, 'limit', v_lim,
          'signal_day', to_char(v_ts[i] at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), 'signal_close', v_c[i],
          'stop', v_stop, 'atr14', round(v_atr[i]::numeric, 2), 'max_sessions', 10));
        g_at := g_at || (v_ts[j] + interval '30 minutes');

        if k is null then
          if j + 9 > n then busy := n; continue; end if;     -- still open
          k := j + 9; v_px := v_c[k]; v_how := 'TIME_10';
        end if;
        busy := k;
        g_strat := g_strat || v_rule;
        g_type := g_type || 'exit'::text;
        g_pay := g_pay || jsonb_build_object(
          'action', 'exit', 'direction', 'buy',
          'label', v_label || case v_how when 'BOUNCE' then ': sold on the bounce'
                                         when 'STOP_HIT' then ': safety stop' else ': 10 sessions passed' end,
          'close', v_px, 'exit_price', v_px, 'entry_fill', v_e, 'result', v_how,
          'pnl_pct', round((v_px / v_e - 1) * 100, 2), 'bars_held', k - j + 1);
        g_at := g_at || (v_ts[k] + interval '35 minutes');
      end loop;
    end loop;

    insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
    select sym.symbol, sym.exchange, x.s, x.t, x.p, x.at
    from unnest(g_strat, g_type, g_pay, g_at) as x(s, t, p, at)
    where not exists (select 1 from public.trading_signals o
                      where o.symbol = sym.symbol and o.exchange = sym.exchange and o.strategy = x.s
                        and o.generated_at >= x.at)
    on conflict (symbol, exchange, strategy, signal_type, generated_at) do nothing;
    get diagnostics v_cnt = row_count;
    n_sig := n_sig + v_cnt;
  end loop;
  return n_sig;
end $function$;
revoke all on function private.refresh_dip_rules(p_symbols text[]) from public, anon, authenticated;

-- private.grade_signals: 2 reads of the prices
CREATE OR REPLACE FUNCTION private.grade_signals(p_symbols text[] DEFAULT NULL::text[], p_since timestamp with time zone DEFAULT (now() - '200 days'::interval))
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rows integer;
begin
  with todo as (
    select t.id, t.symbol, t.exchange, t.strategy,
           case when t.payload->>'action' = 'sell' then 'short' else 'long' end as side,
           (t.generated_at at time zone 'Asia/Kolkata')::date as day,
           case when t.payload->>'fill' ~ '^[0-9.]+$' then (t.payload->>'fill')::numeric end as fill,
           case when t.payload->>'stop' ~ '^[0-9.]+$' then (t.payload->>'stop')::numeric end as stop
    from public.trading_signals t
    left join public.signal_outcomes o on o.signal_id = t.id
    where (p_since is null or t.generated_at >= p_since)
      and (p_symbols is null or t.symbol = any(p_symbols))
      and ((t.signal_type = 'buy' and coalesce(t.payload->>'action', 'buy') = 'buy') or t.payload->>'action' = 'sell')
      and (o.signal_id is null or o.r60 is null)
  ),
  win as (
    select td.id, w.session, w.day, w.open, w.high, w.low, w.close
    from todo td
    cross join lateral (
      select row_number() over (order by c.ts) as session, (c.ts at time zone 'Asia/Kolkata')::date as day,
             c.open, c.high, c.low, c.close
      from private.trusted_candles c
      where c.symbol = td.symbol and c.exchange = td.exchange and c.interval = '1d'
        and c.ts >= ((td.day + case when td.fill is null then 1 else 0 end)::timestamp at time zone 'Asia/Kolkata')
      order by c.ts
      limit 60
    ) w
  ),
  g as (
    select td.id, td.symbol, td.exchange, td.strategy, td.side, td.day, td.stop,
           min(w.day) filter (where w.session = 1)                     as entry_day,
           coalesce(td.fill, max(w.open) filter (where w.session = 1)) as entry,
           max(w.close) filter (where w.session = 5)  as c5,
           max(w.close) filter (where w.session = 20) as c20,
           max(w.close) filter (where w.session = 60) as c60,
           max(w.day) filter (where w.session = 5)    as d5,
           max(w.day) filter (where w.session = 20)   as d20,
           max(w.day) filter (where w.session = 60)   as d60,
           case when td.stop is null or count(*) filter (where w.session <= 20) < 20 then null
                when td.side = 'long' then bool_or(w.low <= td.stop) filter (where w.session <= 20)
                else bool_or(w.high >= td.stop) filter (where w.session <= 20) end as stop20
    from todo td
    join win w on w.id = td.id
    group by td.id, td.symbol, td.exchange, td.strategy, td.side, td.day, td.stop, td.fill
  ),
  idx as (
    select (c.ts at time zone 'Asia/Kolkata')::date as day, c.open, c.close
    from private.trusted_candles c
    where c.symbol = 'NIFTY500' and c.exchange = 'NSE' and c.interval = '1d'
  ),
  graded as (
    select g.*, wx.state as weather,
           case when g.side = 'long' then 1 else -1 end * (g.c5 / g.entry - 1)  as r5,
           case when g.side = 'long' then 1 else -1 end * (g.c20 / g.entry - 1) as r20,
           case when g.side = 'long' then 1 else -1 end * (g.c60 / g.entry - 1) as r60,
           i5.close / nullif(i0.open, 0) - 1  as idx5,
           i20.close / nullif(i0.open, 0) - 1 as idx20,
           i60.close / nullif(i0.open, 0) - 1 as idx60
    from g
    left join public.market_weather wx on wx.day = g.day
    left join idx i0 on i0.day = g.entry_day
    left join idx i5 on i5.day = g.d5
    left join idx i20 on i20.day = g.d20
    left join idx i60 on i60.day = g.d60
    where g.entry > 0 and g.entry_day is not null
  )
  insert into public.signal_outcomes (signal_id, symbol, exchange, strategy, side, signal_day, weather, entry_day,
                                      entry_price, stop, r5, r20, r60, idx5, idx20, idx60, stop_hit_20, graded_at)
  select id, symbol, exchange, strategy, side, day, weather, entry_day, entry, stop,
         round(r5, 6), round(r20, 6), round(r60, 6), round(idx5, 6), round(idx20, 6), round(idx60, 6), stop20, now()
  from graded
  on conflict (signal_id) do update
    set weather = excluded.weather, r5 = excluded.r5, r20 = excluded.r20, r60 = excluded.r60,
        idx5 = excluded.idx5, idx20 = excluded.idx20, idx60 = excluded.idx60,
        stop_hit_20 = excluded.stop_hit_20, graded_at = now()
    where (signal_outcomes.r5, signal_outcomes.r20, signal_outcomes.r60, signal_outcomes.idx60, signal_outcomes.weather)
          is distinct from (excluded.r5, excluded.r20, excluded.r60, excluded.idx60, excluded.weather);
  get diagnostics v_rows = row_count;
  return v_rows;
end $function$;
revoke all on function private.grade_signals(p_symbols text[], p_since timestamp with time zone) from public, anon, authenticated;

-- private.refresh_rsi_checks: 1 read of the prices
CREATE OR REPLACE FUNCTION private.refresh_rsi_checks()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sym      record;
  v_day    date;
  v_ts     timestamptz[];
  v_o      numeric[];
  v_h      numeric[];
  v_l      numeric[];
  v_c      numeric[];
  v_v      numeric[];
  v_s20    numeric[];
  v_s50    numeric[];
  v_s200   numeric[];
  v_vol50  numeric[];
  v_hi     numeric[];
  v_rsi14  float8[];
  v_rsi2   float8[];
  v_atr    float8[];
  v_days   date[];
  n        integer;
  t        integer;
  i        integer;
  a        float8;
  tr       float8;
  d        float8;
  g14      float8;
  l14      float8;
  g2       float8;
  l2       float8;
  v_sector text;
  m        record;
  mk       record;
  v_rs     float8;
  v_secr   float8;
  v_in     boolean;
  v_f      jsonb;
  z        float8;
  p        float8;
  v_label  text;
  v_rows   integer := 0;
begin
  for sym in
    select x.symbol, x.exchange, array_agg(distinct x.day) as days
    from (
      select w.symbol, w.exchange, w.signal_day as day from public.signal_watch w where w.strategy = 'rsi_dip'
      union
      select t.symbol, t.exchange, (t.payload->>'signal_day')::date
      from public.trading_signals t
      where t.strategy = 'rsi_dip' and t.signal_type = 'buy' and t.payload->>'signal_day' ~ '^\d{4}-\d{2}-\d{2}$'
    ) x
    where not exists (select 1 from public.signal_checks c
                       where c.strategy = 'rsi_dip' and c.symbol = x.symbol and c.exchange = x.exchange
                         and c.signal_day = x.day)
      and exists (select 1 from public.signal_check_models mm where mm.strategy = 'rsi_dip' and mm.valid_from <= x.day)
    group by x.symbol, x.exchange
  loop
    select array_agg(x.ts order by x.ts), array_agg(x.open order by x.ts), array_agg(x.high order by x.ts),
           array_agg(x.low order by x.ts), array_agg(x.close order by x.ts), array_agg(x.volume order by x.ts),
           array_agg(x.s20 order by x.ts), array_agg(x.s50 order by x.ts), array_agg(x.s200 order by x.ts),
           array_agg(x.vol50 order by x.ts), array_agg(x.hi252 order by x.ts)
      into v_ts, v_o, v_h, v_l, v_c, v_v, v_s20, v_s50, v_s200, v_vol50, v_hi
      from (
        select c.ts, c.open, c.high, c.low, c.close, c.volume::numeric as volume,
               case when count(*) over w20 = 20 then avg(c.close) over w20 end as s20,
               case when count(*) over w50 = 50 then avg(c.close) over w50 end as s50,
               case when count(*) over w200 = 200 then avg(c.close) over w200 end as s200,
               case when count(*) over p50 = 50 then avg(c.volume) over p50 end as vol50,
               case when count(*) over p252 >= 200 then max(c.close) over p252 end as hi252
        from private.trusted_candles c
        where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
        window w20 as (order by c.ts rows 19 preceding), w50 as (order by c.ts rows 49 preceding),
               w200 as (order by c.ts rows 199 preceding),
               p50 as (order by c.ts rows between 50 preceding and 1 preceding),
               p252 as (order by c.ts rows between 252 preceding and 1 preceding)
      ) x;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 2;

    v_atr := array_fill(null::float8, array[n]);
    v_rsi14 := array_fill(null::float8, array[n]);
    v_rsi2 := array_fill(null::float8, array[n]);
    for t in 1..n loop
      tr := case when t = 1 then (v_h[t] - v_l[t])::float8
                 else greatest(v_h[t] - v_l[t], abs(v_h[t] - v_c[t - 1]), abs(v_l[t] - v_c[t - 1]))::float8 end;
      a := case when t = 1 then tr else a + (tr - a) / 14 end;
      if t >= 14 then v_atr[t] := a; end if;
      if t >= 2 then
        d := (v_c[t] - v_c[t - 1])::float8;
        if t = 2 then
          g14 := greatest(d, 0); l14 := greatest(-d, 0); g2 := g14; l2 := l14;
        else
          g14 := g14 + (greatest(d, 0) - g14) / 14; l14 := l14 + (greatest(-d, 0) - l14) / 14;
          g2 := 0.5 * g2 + 0.5 * greatest(d, 0); l2 := 0.5 * l2 + 0.5 * greatest(-d, 0);
        end if;
        if t >= 15 and l14 > 0 then v_rsi14[t] := 100 - 100 / (1 + g14 / l14); end if;
        if t >= 3 and l2 > 0 then v_rsi2[t] := 100 - 100 / (1 + g2 / l2); end if;
      end if;
    end loop;
    v_days := array(select (v_ts[k] at time zone 'Asia/Kolkata')::date from generate_series(1, n) k order by k);
    select coalesce(nullif(btrim(s.sector), ''), 'Other') into v_sector
      from public.market_symbols s where s.symbol = sym.symbol and s.exchange = sym.exchange;

    foreach v_day in array sym.days loop
      i := array_position(v_days, v_day);
      continue when i is null;
      select mm.valid_from, mm.hr_rule, mm.model into m
        from public.signal_check_models mm
       where mm.strategy = 'rsi_dip' and mm.valid_from <= v_day
       order by mm.valid_from desc limit 1;
      select w.* into mk from (
        select wx.day, wx.nifty / nullif(wx.nifty_sma200, 0) - 1 as nifty_d200,
               wx.nifty / nullif(lag(wx.nifty, 20) over o, 0) - 1 as nifty_r20,
               wx.vix, wx.vix / nullif(lag(wx.vix, 5) over o, 0) - 1 as vix_chg5,
               case wx.state when 'sunny' then 2 when 'mixed' then 1 when 'stormy' then 0 end as wx,
               b.breadth50, b.breadth200, b.rsi_setups
        from public.market_weather wx
        left join public.market_breadth b on b.day = wx.day
        where wx.day <= v_day and wx.day > v_day - 60
        window o as (order by wx.day)
      ) w where w.day = v_day;
      continue when mk.day is null or mk.rsi_setups is null;      -- the market context is not stored yet: next run
      select l.rs_pct into v_rs from public.market_leaders l
       where l.day = v_day and l.symbol = sym.symbol and l.exchange = sym.exchange;
      select ms.rank_pct into v_secr from public.market_sectors ms where ms.day = v_day and ms.sector = v_sector;
      v_in := exists (select 1 from public.market_pit_top pt
                       where pt.year = extract(year from v_day)::integer and pt.symbol = sym.symbol
                         and pt.exchange = sym.exchange);

      v_f := jsonb_strip_nulls(jsonb_build_object(
        'd200', v_c[i] / nullif(v_s200[i], 0) - 1,
        'd50', v_c[i] / nullif(v_s50[i], 0) - 1,
        'd20', v_c[i] / nullif(v_s20[i], 0) - 1,
        'slope200', case when i > 20 then v_s200[i] / nullif(v_s200[i - 20], 0) - 1 end,
        'rsi14', v_rsi14[i],
        'rsi2', v_rsi2[i],
        'atrpct', v_atr[i] / nullif(v_c[i], 0)::float8,
        'volratio', v_v[i] / nullif(v_vol50[i], 0),
        'rs_rank', v_rs,
        'r5', case when i > 5 then v_c[i] / nullif(v_c[i - 5], 0) - 1 end,
        'r20', case when i > 20 then v_c[i] / nullif(v_c[i - 20], 0) - 1 end,
        'r126', case when i > 126 then v_c[i] / nullif(v_c[i - 126], 0) - 1 end,
        'dist_hi252', v_c[i] / nullif(v_hi[i], 0) - 1,
        'clv', case when v_h[i] > v_l[i] then (v_c[i] - v_l[i]) / (v_h[i] - v_l[i]) else 0.5 end,
        'gap', case when i > 1 then v_o[i] / nullif(v_c[i - 1], 0) - 1 end,
        'sector_rank', v_secr,
        'nifty_d200', mk.nifty_d200,
        'nifty_r20', mk.nifty_r20,
        'vix', mk.vix,
        'vix_chg5', mk.vix_chg5,
        'wx', mk.wx,
        'breadth50', mk.breadth50,
        'breadth200', mk.breadth200,
        'hr_rule', m.hr_rule,
        'n_same_day', ln((1 + mk.rsi_setups + case when v_in then 0 else 1 end)::float8)));

      -- score: impute with the training median, standardise, logistic regression, then the quarter's calibration
      v_label := 'none';
      p := null;
      if (m.model->>'shown')::boolean and m.model ? 'coef' then
        select (m.model->>'intercept')::float8
               + sum((m.model->'coef'->>(k::integer - 1))::float8
                     * (coalesce((v_f->>e.name)::float8, (m.model->'median'->>(k::integer - 1))::float8)
                        - (m.model->'mean'->>(k::integer - 1))::float8)
                     / nullif((m.model->'sd'->>(k::integer - 1))::float8, 0))
          into z
          from jsonb_array_elements_text(m.model->'features') with ordinality as e(name, k);
        p := 1 / (1 + exp(least(700, -((m.model->>'platt_a')::float8 * z + (m.model->>'platt_b')::float8))));
        v_label := case when p >= (m.model->>'cut_hi')::float8 then 'high'
                        when p < (m.model->>'cut_lo')::float8 then 'low' else 'normal' end;
      end if;

      insert into public.signal_checks (strategy, symbol, exchange, signal_day, label, score, detail, version)
      values ('rsi_dip', sym.symbol, sym.exchange, v_day, v_label, round(p::numeric, 4),
              jsonb_build_object('features', v_f, 'model', m.valid_from, 'top300', v_in),
              coalesce(m.model->>'version', 'rsi_dip_tier'))
      on conflict (strategy, symbol, exchange, signal_day) do nothing;
      v_rows := v_rows + 1;
    end loop;
  end loop;
  return v_rows;
end $function$;
revoke all on function private.refresh_rsi_checks() from public, anon, authenticated;

-- private.run_eod_notifier: 1 read of the prices
CREATE OR REPLACE FUNCTION private.run_eod_notifier()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_alerts  integer := 0;
  v_signals integer := 0;
  v_expiry  integer := 0;
  v_adjust  integer := 0;
  v_errors  text[]  := '{}';
begin
  begin
    v_adjust := private.ledger_maintenance();
  exception when others then
    v_errors := v_errors || ('corporate_actions: ' || sqlerrm);
  end;

  begin
    with latest as (
      select distinct on (c.symbol, c.exchange) c.symbol, c.exchange, c.high, c.low, c.close, c.ts
      from private.trusted_candles c
      where c.interval = '1d' and c.ts > now() - interval '7 days'
      order by c.symbol, c.exchange, c.ts desc
    ),
    hit as (
      update public.price_alerts a
         set status = 'triggered',
             triggered_at = now(),
             triggered_price = case when a.condition = 'above' then greatest(a.trigger_price, l.close)
                                    else least(a.trigger_price, l.close) end
        from latest l
       where a.status = 'armed'
         and l.symbol = a.symbol and l.exchange = a.exchange
         and l.ts - interval '6 hours 15 minutes' > a.updated_at
         and ((a.condition = 'above' and l.high >= a.trigger_price)
           or (a.condition = 'below' and l.low  <= a.trigger_price))
         and coalesce((select (p.features ->> 'alerts')::boolean from public.plans p
                        where p.code = private.effective_plan(a.user_id, a.tenant_id)), false)
      returning a.id, a.tenant_id, a.user_id, a.symbol, a.condition, a.trigger_price, l.close
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select h.tenant_id, h.user_id, 'price_alert',
             h.symbol || ' crossed ' || case when h.condition = 'above' then 'above ' else 'below ' end
               || '₹' || to_char(h.trigger_price, 'FM999G99G99G990D00'),
             'Closed at ₹' || to_char(h.close, 'FM999G99G99G990D00') || '. The alert is now off; set a new level if you still care.',
             jsonb_build_object('alert_id', h.id, 'symbol', h.symbol)
      from hit h
      returning 1
    )
    select count(*) into v_alerts from ins;
  exception when others then
    v_errors := v_errors || ('price_alerts: ' || sqlerrm);
  end;

  begin
    with recent as (
      select s.id, s.symbol, s.exchange, s.strategy, s.payload ->> 'result' as how,
             private.try_numeric(s.payload ->> 'close') as at
      from public.trading_signals s
      where s.signal_type = 'exit' and s.generated_at > now() - interval '4 days'
    ),
    holders as (
      select distinct h.tenant_id, h.user_id, r.id as signal_id, r.symbol, r.strategy, r.how, r.at
      from recent r
      join public.holdings h on h.symbol = r.symbol and h.exchange = r.exchange and h.quantity > 0
      left join public.notification_prefs p on p.user_id = h.user_id and p.tenant_id = h.tenant_id
      where r.strategy = any (coalesce(p.exit_rules, array['strong_trend', 'sma_trend', 'ma200_trend']))
    ),
    fresh as (
      insert into private.notification_ledger (user_id, tenant_id, kind, ref)
      select x.user_id, x.tenant_id, 'exit_signal', x.signal_id::text from holders x
      on conflict do nothing
      returning user_id, tenant_id, ref
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select x.tenant_id, x.user_id, 'exit_signal',
             private.rule_label(x.strategy) || ' closed its trade in ' || x.symbol,
             case x.how when 'STOP_HIT' then 'Its safety stop was hit'
                        when 'BOUNCE'   then 'It sold on the bounce'
                        when 'TIME'     then 'Its time limit passed'
                        else 'It closed its trade' end
               || coalesce(' at ₹' || to_char(x.at, 'FM999G99G99G990D00'), '')
               || '. This is the rule''s own research trade, not advice. Your holding is unchanged.',
             jsonb_build_object('signal_id', x.signal_id, 'symbol', x.symbol, 'strategy', x.strategy)
      from holders x
      join fresh f on f.user_id = x.user_id and f.tenant_id = x.tenant_id and f.ref = x.signal_id::text
      returning 1
    )
    select count(*) into v_signals from ins;
  exception when others then
    v_errors := v_errors || ('exit_signals: ' || sqlerrm);
  end;

  begin
    with due as (
      select s.tenant_id, s.user_id, s.id, s.status, s.current_period_end
      from public.subscriptions s
      where s.status in ('trialing', 'active')
        and s.current_period_end > now()
        and s.current_period_end <= now() + interval '7 days'
    ),
    fresh as (
      insert into private.notification_ledger (user_id, tenant_id, kind, ref)
      select d.user_id, d.tenant_id, 'plan_expiry', d.id::text || ':' || d.current_period_end::text from due d
      on conflict do nothing
      returning user_id, tenant_id, ref
    ),
    ins as (
      insert into public.notifications (tenant_id, user_id, type, title, body, data)
      select d.tenant_id, d.user_id, 'plan_expiry',
             case when d.status = 'trialing' then 'Your trial ends soon' else 'Your plan ends soon' end,
             'It ends on ' || to_char(d.current_period_end at time zone 'Asia/Kolkata', 'DD Mon YYYY')
               || '. Renew from Plan & billing to keep your radar, alerts and portfolio running.',
             jsonb_build_object('subscription_id', d.id, 'period_end', d.current_period_end)
      from due d
      join fresh f on f.user_id = d.user_id and f.tenant_id = d.tenant_id
                  and f.ref = d.id::text || ':' || d.current_period_end::text
      returning 1
    )
    select count(*) into v_expiry from ins;
  exception when others then
    v_errors := v_errors || ('plan_expiry: ' || sqlerrm);
  end;

  return jsonb_build_object('holding_adjustments', v_adjust, 'price_alerts', v_alerts, 'exit_signals', v_signals,
                            'plan_expiry', v_expiry, 'errors', to_jsonb(v_errors));
end $function$;
revoke all on function private.run_eod_notifier() from public, anon, authenticated;

-- ------------------------------------------------------------------ 3. signal conditions
create or replace function private.signal_condition_names() returns text[]
language sql immutable set search_path = '' as $$
  select array['d200', 'd50', 'd20', 'slope200', 'rsi14', 'rsi2', 'atrpct', 'volratio', 'rs_rank', 'r5', 'r20', 'r126',
               'dist_hi252', 'clv', 'gap', 'sector_rank', 'nifty_d200', 'nifty_r20', 'vix', 'vix_chg5', 'wx',
               'breadth50', 'breadth200', 'same_day', 'open_rule', 'open_sector']
$$;
revoke all on function private.signal_condition_names() from public, anon, authenticated;

create table public.signal_conditions (
  strategy    text not null,
  symbol      text not null,
  exchange    public.exchange_code not null,
  signal_day  date not null,             -- the close the rule fired on (for a dip: the close before the buy)
  sector      text,
  top300      boolean not null,          -- in that year's 300 most traded (the research population)
  features    jsonb not null,            -- private.signal_condition_names(); a missing number is left out
  version     text not null,
  computed_at timestamptz not null default now(),
  primary key (strategy, symbol, exchange, signal_day)
);
create index signal_conditions_day_idx on public.signal_conditions (signal_day);
alter table public.signal_conditions enable row level security;
create policy signal_conditions_read on public.signal_conditions for select to authenticated using (true);
revoke insert, update, delete, truncate on public.signal_conditions from authenticated;
revoke all on public.signal_conditions from anon, public;
grant select on public.signal_conditions to authenticated;

-- Writes the conditions of every live buy that has none, once its day's market context is stored (weather; breadth
-- for the last 14 days, which refresh_market_breadth rewrites). Frozen once written.
-- Indicators as in private.refresh_rsi_checks (research/strategies/backtest.py: Wilder RSI and ATR, rolling windows).
-- same_day = the rule's buys on that close; open_rule = its trades still open at that close (bought before it, not yet
-- out); open_sector = those in the same sector.
create or replace function private.refresh_signal_conditions(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sym      record;
  sg       record;
  v_ts     timestamptz[];
  v_o      numeric[];
  v_h      numeric[];
  v_l      numeric[];
  v_c      numeric[];
  v_v      numeric[];
  v_s20    numeric[];
  v_s50    numeric[];
  v_s200   numeric[];
  v_vol50  numeric[];
  v_hi     numeric[];
  v_rsi14  float8[];
  v_rsi2   float8[];
  v_atr    float8[];
  v_days   date[];
  n        integer;
  t        integer;
  i        integer;
  a        float8;
  tr       float8;
  d        float8;
  g14      float8;
  l14      float8;
  g2       float8;
  l2       float8;
  v_sector text;
  mk       record;
  v_rs     float8;
  v_secr   float8;
  v_f      jsonb;
  v_rows   integer := 0;
begin
  drop table if exists pg_temp.cond_trades;
  create temporary table cond_trades on commit drop as
    select t.strategy, t.symbol, t.exchange, t.signal_day, t.exit_day,
           coalesce(nullif(btrim(s.sector), ''), 'Other') as sector
    from public.signal_trades t
    left join public.market_symbols s on s.symbol = t.symbol and s.exchange = t.exchange
    where t.strategy in (select e.strategy from public.rule_expectations e);
  create index on pg_temp.cond_trades (strategy, signal_day);

  for sym in
    select x.symbol, x.exchange, x.sector,
           array_agg(x.strategy order by x.signal_day, x.strategy) as strategies,
           array_agg(x.signal_day order by x.signal_day, x.strategy) as days
    from pg_temp.cond_trades x
    where (p_symbols is null or x.symbol = any(p_symbols))
      and not exists (select 1 from public.signal_conditions sc
                       where sc.strategy = x.strategy and sc.symbol = x.symbol and sc.exchange = x.exchange
                         and sc.signal_day = x.signal_day)
    group by x.symbol, x.exchange, x.sector
  loop
    select array_agg(x.ts order by x.ts), array_agg(x.open order by x.ts), array_agg(x.high order by x.ts),
           array_agg(x.low order by x.ts), array_agg(x.close order by x.ts), array_agg(x.volume order by x.ts),
           array_agg(x.s20 order by x.ts), array_agg(x.s50 order by x.ts), array_agg(x.s200 order by x.ts),
           array_agg(x.vol50 order by x.ts), array_agg(x.hi252 order by x.ts)
      into v_ts, v_o, v_h, v_l, v_c, v_v, v_s20, v_s50, v_s200, v_vol50, v_hi
      from (
        select c.ts, c.open, c.high, c.low, c.close, c.volume::numeric as volume,
               case when count(*) over w20 = 20 then avg(c.close) over w20 end as s20,
               case when count(*) over w50 = 50 then avg(c.close) over w50 end as s50,
               case when count(*) over w200 = 200 then avg(c.close) over w200 end as s200,
               case when count(*) over p50 = 50 then avg(c.volume) over p50 end as vol50,
               case when count(*) over p252 >= 200 then max(c.close) over p252 end as hi252
        from private.trusted_candles c
        where c.symbol = sym.symbol and c.exchange = sym.exchange and c.interval = '1d'
        window w20 as (order by c.ts rows 19 preceding), w50 as (order by c.ts rows 49 preceding),
               w200 as (order by c.ts rows 199 preceding),
               p50 as (order by c.ts rows between 50 preceding and 1 preceding),
               p252 as (order by c.ts rows between 252 preceding and 1 preceding)
      ) x;
    n := coalesce(cardinality(v_ts), 0);
    continue when n < 2;

    v_atr := array_fill(null::float8, array[n]);
    v_rsi14 := array_fill(null::float8, array[n]);
    v_rsi2 := array_fill(null::float8, array[n]);
    for t in 1..n loop
      tr := case when t = 1 then (v_h[t] - v_l[t])::float8
                 else greatest(v_h[t] - v_l[t], abs(v_h[t] - v_c[t - 1]), abs(v_l[t] - v_c[t - 1]))::float8 end;
      a := case when t = 1 then tr else a + (tr - a) / 14 end;
      if t >= 14 then v_atr[t] := a; end if;
      if t >= 2 then
        d := (v_c[t] - v_c[t - 1])::float8;
        if t = 2 then
          g14 := greatest(d, 0); l14 := greatest(-d, 0); g2 := g14; l2 := l14;
        else
          g14 := g14 + (greatest(d, 0) - g14) / 14; l14 := l14 + (greatest(-d, 0) - l14) / 14;
          g2 := 0.5 * g2 + 0.5 * greatest(d, 0); l2 := 0.5 * l2 + 0.5 * greatest(-d, 0);
        end if;
        if t >= 15 and l14 > 0 then v_rsi14[t] := 100 - 100 / (1 + g14 / l14); end if;
        if t >= 3 and l2 > 0 then v_rsi2[t] := 100 - 100 / (1 + g2 / l2); end if;
      end if;
    end loop;
    v_days := array(select (v_ts[k] at time zone 'Asia/Kolkata')::date from generate_series(1, n) k order by k);
    v_sector := sym.sector;

    for sg in select u.strategy, u.day from unnest(sym.strategies, sym.days) as u(strategy, day) loop
      i := array_position(v_days, sg.day);
      if i is null then                         -- the day is no longer stored: written empty once it is two weeks old
        if sg.day <= current_date - 14 then
          insert into public.signal_conditions (strategy, symbol, exchange, signal_day, sector, top300, features, version)
          values (sg.strategy, sym.symbol, sym.exchange, sg.day, v_sector, false, '{}'::jsonb, 'conditions/1')
          on conflict (strategy, symbol, exchange, signal_day) do nothing;
          v_rows := v_rows + 1;
        end if;
        continue;
      end if;
      select w.* into mk from (
        select wx.day, wx.nifty / nullif(wx.nifty_sma200, 0) - 1 as nifty_d200,
               wx.nifty / nullif(lag(wx.nifty, 20) over o, 0) - 1 as nifty_r20,
               wx.vix, wx.vix / nullif(lag(wx.vix, 5) over o, 0) - 1 as vix_chg5,
               case wx.state when 'sunny' then 2 when 'mixed' then 1 when 'stormy' then 0 end as wx,
               b.day as b_day, b.breadth50, b.breadth200
        from public.market_weather wx
        left join public.market_breadth b on b.day = wx.day
        where wx.day <= sg.day and wx.day > sg.day - 60
        window o as (order by wx.day)
      ) w where w.day = sg.day;
      -- the market context is not stored yet: next run. Breadth is written for the last 14 days only, so an older day
      -- without it is written with what there is.
      continue when (mk.day is null or mk.b_day is null) and sg.day > current_date - 14;
      select l.rs_pct into v_rs from public.market_leaders l
       where l.day = sg.day and l.symbol = sym.symbol and l.exchange = sym.exchange;
      select ms.rank_pct into v_secr from public.market_sectors ms where ms.day = sg.day and ms.sector = v_sector;

      v_f := jsonb_strip_nulls(jsonb_build_object(
        'd200', round((v_c[i] / nullif(v_s200[i], 0) - 1)::numeric, 6),
        'd50', round((v_c[i] / nullif(v_s50[i], 0) - 1)::numeric, 6),
        'd20', round((v_c[i] / nullif(v_s20[i], 0) - 1)::numeric, 6),
        'slope200', case when i > 20 then round((v_s200[i] / nullif(v_s200[i - 20], 0) - 1)::numeric, 6) end,
        'rsi14', round(v_rsi14[i]::numeric, 4),
        'rsi2', round(v_rsi2[i]::numeric, 4),
        'atrpct', round((v_atr[i] / nullif(v_c[i], 0)::float8)::numeric, 6),
        'volratio', round((v_v[i] / nullif(v_vol50[i], 0))::numeric, 4),
        'rs_rank', round(v_rs::numeric, 6),
        'r5', case when i > 5 then round((v_c[i] / nullif(v_c[i - 5], 0) - 1)::numeric, 6) end,
        'r20', case when i > 20 then round((v_c[i] / nullif(v_c[i - 20], 0) - 1)::numeric, 6) end,
        'r126', case when i > 126 then round((v_c[i] / nullif(v_c[i - 126], 0) - 1)::numeric, 6) end,
        'dist_hi252', round((v_c[i] / nullif(v_hi[i], 0) - 1)::numeric, 6),
        'clv', round(case when v_h[i] > v_l[i] then (v_c[i] - v_l[i]) / (v_h[i] - v_l[i]) else 0.5 end, 6),
        'gap', case when i > 1 then round((v_o[i] / nullif(v_c[i - 1], 0) - 1)::numeric, 6) end,
        'sector_rank', round(v_secr::numeric, 6),
        'nifty_d200', round(mk.nifty_d200::numeric, 6),
        'nifty_r20', round(mk.nifty_r20::numeric, 6),
        'vix', mk.vix,
        'vix_chg5', round(mk.vix_chg5::numeric, 6),
        'wx', mk.wx,
        'breadth50', mk.breadth50,
        'breadth200', mk.breadth200));

      insert into public.signal_conditions (strategy, symbol, exchange, signal_day, sector, top300, features, version)
      values (sg.strategy, sym.symbol, sym.exchange, sg.day, v_sector,
              exists (select 1 from public.market_pit_top pt
                       where pt.year = extract(year from sg.day)::integer and pt.symbol = sym.symbol
                         and pt.exchange = sym.exchange),
              v_f, 'conditions/1')
      on conflict (strategy, symbol, exchange, signal_day) do nothing;
      v_rows := v_rows + 1;
    end loop;
  end loop;

  -- How crowded the rule was at that close (needs every stock's trades, so after the loop).
  update public.signal_conditions sc
     set features = sc.features || jsonb_build_object(
           'same_day', (select count(*) from pg_temp.cond_trades t
                         where t.strategy = sc.strategy and t.signal_day = sc.signal_day),
           'open_rule', (select count(*) from pg_temp.cond_trades t
                          where t.strategy = sc.strategy and t.signal_day < sc.signal_day
                            and (t.exit_day is null or t.exit_day > sc.signal_day)),
           'open_sector', (select count(*) from pg_temp.cond_trades t
                            where t.strategy = sc.strategy and t.signal_day < sc.signal_day
                              and (t.exit_day is null or t.exit_day > sc.signal_day)
                              and t.sector = coalesce(sc.sector, 'Other')))
   where not (sc.features ? 'open_rule');
  return v_rows;
end $$;
revoke all on function private.refresh_signal_conditions(text[]) from public, anon, authenticated;

-- After the breadth (it reads it) and before the rule health, in every run of the checks (the market-analytics,
-- evening and morning cron jobs and the pipeline all call this).
create or replace function public.svc_refresh_signal_checks(p_full boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  v_out := jsonb_build_object('breadth', private.refresh_market_breadth(p_full));
  v_out := v_out || jsonb_build_object('conditions', private.refresh_signal_conditions());
  v_out := v_out || jsonb_build_object('trend', private.refresh_trend_checks());
  v_out := v_out || jsonb_build_object('rsi', private.refresh_rsi_checks());
  v_out := v_out || jsonb_build_object('training', private.refresh_check_training());
  v_out := v_out || jsonb_build_object('health', private.refresh_rule_health());
  return v_out;
end $$;
revoke execute on function public.svc_refresh_signal_checks(boolean) from public, anon, authenticated;
grant  execute on function public.svc_refresh_signal_checks(boolean) to service_role;

-- Every stored buy now.
select private.refresh_signal_conditions();
