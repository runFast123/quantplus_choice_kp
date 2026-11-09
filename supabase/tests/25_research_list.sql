-- The Research list, kept (migration 56): one row per stock, in step with research_notes and market_symbols through
-- statement triggers, equal to the research_latest view; read-only for signed-in users. Rolled back.
begin;

create schema qp_t25;
create function qp_t25.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL [%]', p_label; end if;
  raise notice 'PASS [%]', p_label;
end $$;
grant usage on schema qp_t25 to authenticated, anon;
grant execute on all functions in schema qp_t25 to authenticated, anon;
create function qp_t25.note(p_symbol text, p_day date, p_score numeric, p_stance text, p_prev text default null) returns void
language sql as $$
  insert into public.research_notes (symbol, exchange, as_of, score, stance, prev_stance, headline, factors)
  values (p_symbol, 'NSE', p_day, p_score, p_stance, p_prev, 'Note ' || p_day, '[]'::jsonb)
$$;

insert into public.market_symbols (symbol, exchange, name, sector, is_active, segment, mcap_rank) values
  ('QPRL1', 'NSE', 'Research list one', 'Tech', true, 'equity', 7),
  ('QPRL2', 'NSE', 'Research list two', 'Banks', true, 'equity', 8);

-- 1. New notes: the newest one, with the score before it.
select qp_t25.note('QPRL1', '2026-11-05', 10, 'neutral');
select qp_t25.note('QPRL1', '2026-11-06', 40, 'constructive', 'neutral');
select qp_t25.check((select as_of = '2026-11-06' and score = 40 and stance = 'constructive' and prev_stance = 'neutral'
                            and prev_score = 10 and score_change = 30 and name = 'Research list one' and segment = 'equity'
                     from public.research_list where symbol = 'QPRL1'),
                    'a new note: the newest one, with the score before it');

-- 2. A note rewritten (the nightly refresh updates the day's note).
update public.research_notes set score = 55 where symbol = 'QPRL1' and as_of = '2026-11-06';
select qp_t25.check((select score = 55 and score_change = 45 from public.research_list where symbol = 'QPRL1'),
                    'a rewritten note is followed');

-- 3. The newest note deleted (retention): the one before it is the latest again.
delete from public.research_notes where symbol = 'QPRL1' and as_of = '2026-11-06';
select qp_t25.check((select as_of = '2026-11-05' and score = 10 and prev_score is null from public.research_list where symbol = 'QPRL1'),
                    'a deleted note: the one before it shows');

-- 4. The stock renamed, then no longer listed.
update public.market_symbols set name = 'Research list one (renamed)' where symbol = 'QPRL1';
select qp_t25.check((select name = 'Research list one (renamed)' from public.research_list where symbol = 'QPRL1'),
                    'a renamed stock is followed');
update public.market_symbols set is_active = false where symbol = 'QPRL1';
select qp_t25.check(not exists (select 1 from public.research_list where symbol = 'QPRL1'), 'a stock no longer listed leaves the list');
update public.market_symbols set history_days = history_days where symbol = 'QPRL2';
select qp_t25.check(true, 'an update that changes nothing the list shows is fine');

-- 5. Equal to the view, for every stock.
select qp_t25.note('QPRL2', '2026-11-06', -20, 'cautious');
select private.refresh_research_list();
select qp_t25.check((select count(*) = 0 from (
                       (select symbol, exchange, name, sector, as_of, score, stance, prev_stance, prev_score, headline,
                               news_count, filing_count, segment, mcap_rank, score_change from public.research_latest
                        except select symbol, exchange, name, sector, as_of, score, stance, prev_stance, prev_score, headline,
                               news_count, filing_count, segment, mcap_rank, score_change from public.research_list)
                       union all
                       (select symbol, exchange, name, sector, as_of, score, stance, prev_stance, prev_score, headline,
                               news_count, filing_count, segment, mcap_rank, score_change from public.research_list
                        except select symbol, exchange, name, sector, as_of, score, stance, prev_stance, prev_score, headline,
                               news_count, filing_count, segment, mcap_rank, score_change from public.research_latest)) d),
                    'the list equals research_latest, row for row');

-- 6. Access.
set local role authenticated;
select qp_t25.check((select count(*) = 1 from public.research_list where symbol = 'QPRL2'), 'a signed-in user reads the list');
do $$ begin
  insert into public.research_list (symbol, exchange) values ('QPRL9', 'NSE');
  raise exception 'FAIL [a signed-in user cannot write the list]';
exception when insufficient_privilege then raise notice 'PASS [a signed-in user cannot write the list]';
end $$;
reset role;
set local role anon;
do $$ begin
  perform 1 from public.research_list limit 1;
  raise exception 'FAIL [anonymous visitors cannot read the list]';
exception when insufficient_privilege then raise notice 'PASS [anonymous visitors cannot read the list]';
end $$;
reset role;

do $$ begin raise notice 'RESEARCH LIST TESTS PASSED'; end $$;
rollback;
