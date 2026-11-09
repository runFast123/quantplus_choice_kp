-- Price guard, market-wide days (migrations 58-59): when 3 or more of the 500 largest companies are flagged on the same
-- day AND the NIFTY 50's low is at least 3 % under its close before, it was the market (4 Jun 2024, 7 Apr 2025), and the
-- rules read those prices as real. Rolled back.
begin;

create schema qp_t27;
create function qp_t27.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
-- Two days far in the past (no other stock has prices then): a calm one, then an intraday plunge that closes near.
create function qp_t27.ts(p_d integer) returns timestamptz language sql immutable as $$
  select timestamptz '2001-03-01 10:00+00' + p_d * interval '1 day'
$$;
create function qp_t27.load(p_symbol text, p_low numeric) returns void language sql as $$
  insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume) values
    (p_symbol, 'NSE', '1d', qp_t27.ts(1), 100, 101, 99, 100, 1000),
    (p_symbol, 'NSE', '1d', qp_t27.ts(2), 100, 101, p_low, 99, 1000)
$$;
create function qp_t27.status(p_symbol text) returns text language sql stable as $$
  select status from public.candle_checks where symbol = p_symbol and ts = qp_t27.ts(2)
$$;
create function qp_t27.day() returns date language sql immutable as $$
  select (qp_t27.ts(2) at time zone 'Asia/Kolkata')::date
$$;

insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank) values
  ('QPMD1', 'NSE', 'Market day one', true, 'equity', 11),
  ('QPMD2', 'NSE', 'Market day two', true, 'equity', 12),
  ('QPMD3', 'NSE', 'Market day three', true, 'equity', 13),
  ('QPMD4', 'NSE', 'Market day small', true, 'equity', 2000);

select qp_t27.load('QPMD1', 80);
select qp_t27.load('QPMD2', 80);
select qp_t27.check(qp_t27.status('QPMD1') = 'suspect' and qp_t27.status('QPMD2') = 'suspect',
                    'two large companies flagged the same day: still suspect (a bad price is one stock''s)');
select qp_t27.load('QPMD4', 80);
select qp_t27.check(qp_t27.status('QPMD4') = 'suspect' and qp_t27.status('QPMD1') = 'suspect',
                    'a small company does not count toward the three');
select qp_t27.load('QPMD3', 80);
select qp_t27.check(qp_t27.status('QPMD1') = 'suspect' and qp_t27.status('QPMD3') = 'suspect',
                    'three large companies, but the index did not fall: still suspect (a glitch across a few stocks)');
insert into public.market_symbols (symbol, exchange, name, is_active, segment) values ('NIFTY', 'NSE', 'Nifty 50', true, 'index')
on conflict do nothing;
delete from public.market_candles where symbol = 'NIFTY' and ts in (qp_t27.ts(1), qp_t27.ts(2));
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume) values
  ('NIFTY', 'NSE', '1d', qp_t27.ts(1), 100, 101, 99, 100, 0),
  ('NIFTY', 'NSE', '1d', qp_t27.ts(2), 99, 99.5, 96.5, 97, 0);
select qp_t27.check(qp_t27.status('QPMD1') = 'market' and qp_t27.status('QPMD2') = 'market'
                    and qp_t27.status('QPMD3') = 'market' and qp_t27.status('QPMD4') = 'market',
                    'and the NIFTY fell 3.5 % that day: the market fell, every flag of that day counts as real');
select qp_t27.check((select low = 80 from private.trusted_candles where symbol = 'QPMD1' and ts = qp_t27.ts(2)),
                    'the rules read a market day''s prices as stored');

-- An admin can still call one bad; undoing it puts it back with the market.
select public.svc_review_candle('QPMD2', 'NSE', qp_t27.day(), 'bad');
select qp_t27.check(qp_t27.status('QPMD2') = 'bad'
                    and (select low = 99 from private.trusted_candles where symbol = 'QPMD2' and ts = qp_t27.ts(2)),
                    'review "bad" on a market day: set aside, the close counts');
select public.svc_review_candle('QPMD2', 'NSE', qp_t27.day(), 'suspect');
select qp_t27.check(qp_t27.status('QPMD2') = 'market', 'undo: the flag is the market''s again');

-- Yahoo revises one of them to a normal day: two large companies left, so they are suspect again.
update public.market_candles set low = 98 where symbol = 'QPMD3' and ts = qp_t27.ts(2);
select qp_t27.check(qp_t27.status('QPMD3') is null and qp_t27.status('QPMD1') = 'suspect'
                    and qp_t27.status('QPMD2') = 'suspect',
                    'a revision leaves two large companies: suspect again');

do $$ begin raise notice 'PRICE GUARD MARKET DAY TESTS PASSED'; end $$;
rollback;
