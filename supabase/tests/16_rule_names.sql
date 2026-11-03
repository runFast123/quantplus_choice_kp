-- Rule names and the latest signal (migration 42): each quote's last signal is re-read after every rule has run, and
-- research notes name the rule the way people read it. Rolled back.
begin;

create schema qp_t16;
create function qp_t16.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;

select qp_t16.check(private.rule_label('ma200_trend') = '200-day trend' and private.rule_label('kk_dip') = 'KK dip'
                    and private.rule_label('rsi_reversal') = 'RSI reversal (old rule)' and private.rule_label('new_rule') = 'new rule',
                    'names: every rule key reads as its name, an unknown key without underscores');

-- A stock with 120 rising sessions; the analytics write its quote.
insert into public.market_symbols (symbol, exchange, name, is_active, segment, mcap_rank)
values ('QPRN1', 'NSE', 'Names fixture', true, 'equity', 1);
insert into public.market_candles (symbol, exchange, interval, ts, open, high, low, close, volume)
select 'QPRN1', 'NSE', '1d', date_trunc('day', now()) - (121 - d) * interval '1 day' + interval '10 hours',
       100 + d, 101 + d, 99 + d, 100 + d, 1000000
from generate_series(1, 120) d;
select private.refresh_market_analytics(400, array['QPRN1']);

-- Two rules fire on the latest session after the analytics ran (as in the evening run): a buy and an exit.
insert into public.trading_signals (symbol, exchange, strategy, signal_type, payload, generated_at)
select 'QPRN1', 'NSE', x.s, x.t, jsonb_build_object('close', 220, 'label', x.s), max(c.ts) + interval '15 minutes'
from public.market_candles c, (values ('sma_trend', 'exit'), ('ma200_trend', 'buy')) as x(s, t)
where c.symbol = 'QPRN1'
group by x.s, x.t;
select qp_t16.check((select last_signal_strategy is distinct from 'ma200_trend' from public.market_quotes where symbol = 'QPRN1'),
                    'fixture: the quote does not know the evening''s signals yet');

select qp_t16.check(private.refresh_last_signal(array['QPRN1']) = 1, 'last signal: the quote is updated once');
select qp_t16.check((select last_signal = 'buy' and last_signal_strategy = 'ma200_trend' from public.market_quotes where symbol = 'QPRN1'),
                    'last signal: the newest signal, a buy before an exit on the same session');
select qp_t16.check(private.refresh_last_signal(array['QPRN1']) = 0, 'last signal: re-running changes nothing');

select private.refresh_research_notes(array['QPRN1']);
select qp_t16.check((select f->>'detail' like '%(200-day trend)%'
                       from public.research_notes n, jsonb_array_elements(n.factors) f
                      where n.symbol = 'QPRN1' and f->>'key' = 'signal' order by n.as_of desc limit 1),
                    'research note: the Signals line names the rule');

select qp_t16.check((select public.svc_refresh_market_analytics(400, array['QPRN1']) ? 'last_signal'),
                    'svc: the pipeline wrapper re-reads the last signal after the rules');
select qp_t16.check(not has_function_privilege('authenticated', 'private.refresh_last_signal(text[])', 'execute')
                    and not has_function_privilege('anon', 'private.rule_label(text)', 'execute'),
                    'grants: jobs and helpers for the service role only');

rollback;
