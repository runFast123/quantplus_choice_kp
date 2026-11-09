-- Rule trades (migration 54): each live rule's graded buy paired with its next exit before its next buy; open trades
-- have no exit; retired rules and short sides are left out; signed-in users read it, anonymous visitors cannot.
-- Rolled back.
begin;

create schema qp_t23;
create function qp_t23.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
grant usage on schema qp_t23 to authenticated, anon;
grant execute on all functions in schema qp_t23 to authenticated, anon;

-- Signals for a made-up stock (times are IST evenings, stored in UTC).
create function qp_t23.sig(p_strategy text, p_type text, p_at text, p_payload jsonb) returns bigint
language sql as $$
  insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
  values ('QPTEST', 'NSE', p_strategy, p_type, p_payload, (p_at || ' 16:00+05:30')::timestamptz) returning id
$$;
create function qp_t23.graded(p_id bigint, p_entry_day date, p_price numeric, p_side text default 'long') returns void
language sql as $$
  insert into public.signal_outcomes (signal_id, symbol, exchange, strategy, side, signal_day, entry_day, entry_price)
  select id, symbol, exchange, strategy, p_side, (generated_at at time zone 'Asia/Kolkata')::date, p_entry_day, p_price
  from public.trading_signals where id = p_id
$$;

-- 1. SMA 20/50 trend: bought (next open 100), sold at its 60-session review at 110.
select qp_t23.graded(qp_t23.sig('sma_trend', 'buy', '2026-01-01', '{"close": 99}'), '2026-01-02', 100);
select qp_t23.sig('sma_trend', 'exit', '2026-03-30',
                  '{"exit_price": 110, "entry_fill": 100, "result": "REVIEW_60", "label": "SMA 20/50 trend: 60-session review"}');
-- 2. Its next buy has no exit yet: open.
select qp_t23.graded(qp_t23.sig('sma_trend', 'buy', '2026-05-04', '{"close": 120}'), '2026-05-05', 121);
-- 3. 200-day trend: a buy that was never closed, then a second buy and one exit. The exit belongs to the second buy only.
select qp_t23.graded(qp_t23.sig('ma200_trend', 'buy', '2026-02-02', '{"close": 50}'), '2026-02-03', 50.5);
select qp_t23.graded(qp_t23.sig('ma200_trend', 'buy', '2026-02-16', '{"close": 52}'), '2026-02-17', 52.25);
select qp_t23.sig('ma200_trend', 'exit', '2026-02-20', '{"exit_price": 49.6, "entry_fill": 52.25, "result": "STOP_HIT"}');
-- 4. KK dip: filled at the limit on the signal row's own day.
select qp_t23.graded(qp_t23.sig('kk_dip', 'buy', '2026-06-10', '{"fill": 90.5}'), '2026-06-10', 90.5);
select qp_t23.sig('kk_dip', 'exit', '2026-06-15', '{"exit_price": 94, "entry_fill": 90.5, "result": "BOUNCE"}');
-- 5. Left out: a retired rule, and a short side.
select qp_t23.graded(qp_t23.sig('sma_20_50_cross', 'buy', '2026-01-01', '{"close": 99}'), '2026-01-02', 100);
select qp_t23.graded(qp_t23.sig('rsi_dip', 'buy', '2026-07-01', '{"action": "sell"}'), '2026-07-02', 80, 'short');

select qp_t23.check((select count(*) = 5 from public.rule_trades where symbol = 'QPTEST'),
                    'five trades: the retired rule and the short side are left out');
select qp_t23.check((select exit_day = '2026-03-30' and exit_price = 110 and exit_entry_fill = 100 and result = 'REVIEW_60'
                            and entry_day = '2026-01-02' and entry_price = 100 and signal_day = '2026-01-01'
                     from public.rule_trades where symbol = 'QPTEST' and strategy = 'sma_trend' and entry_day = '2026-01-02'),
                    'a closed trade: graded entry, its exit day, price and reason');
select qp_t23.check((select exit_day is null and exit_price is null
                     from public.rule_trades where symbol = 'QPTEST' and strategy = 'sma_trend' and entry_day = '2026-05-05'),
                    'a trade without an exit is open');
select qp_t23.check((select exit_day is null from public.rule_trades
                     where symbol = 'QPTEST' and strategy = 'ma200_trend' and entry_day = '2026-02-03'),
                    'an exit after the next buy does not close the earlier buy');
select qp_t23.check((select exit_day = '2026-02-20' and exit_price = 49.6 from public.rule_trades
                     where symbol = 'QPTEST' and strategy = 'ma200_trend' and entry_day = '2026-02-17'),
                    'the exit closes the buy right before it');
select qp_t23.check((select entry_day = '2026-06-10' and entry_price = 90.5 and exit_price = 94 from public.rule_trades
                     where symbol = 'QPTEST' and strategy = 'kk_dip'),
                    'a dip rule: filled on its own day, sold on the bounce');

-- Access: signed in reads it; anonymous cannot.
set local role authenticated;
select qp_t23.check((select count(*) = 5 from public.rule_trades where symbol = 'QPTEST'), 'a signed-in user reads rule trades');
reset role;
set local role anon;
do $$ begin
  perform 1 from public.rule_trades limit 1;
  raise exception 'FAIL [anonymous visitors cannot read rule trades]';
exception when insufficient_privilege then raise notice 'PASS [anonymous visitors cannot read rule trades]';
end $$;
reset role;

do $$ begin raise notice 'RULE TRADES TESTS PASSED'; end $$;
rollback;
