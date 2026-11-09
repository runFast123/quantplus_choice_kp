-- The Research list, kept (ADR-052).
-- Measured on live (9 Nov 2026, as a signed-in user): the Research page's list took 3.2 s cold and 0.2 s warm. The
-- research_latest view finds every stock's newest note and the one before it, reading the whole 33 MB research_notes
-- table (each note carries its factors as JSON) for 2,900 stocks, and the page asks for it six times at once (the list,
-- three stance counts, two "turned" lists). Under load that passed the 8 s statement limit and the page showed "The
-- notes didn't load".
-- Now the list's columns live in a small table, one row per stock, kept in step by statement triggers on research_notes
-- (new notes, the nightly rewrite, retention's deletes) and on market_symbols (a name, sector, segment, size rank or
-- listing change). research_latest stays: one stock's full note (with its factors) still reads it, through its index.

create table public.research_list as
select symbol, exchange, name, sector, as_of, score, stance, prev_stance, prev_score, headline, news_count, filing_count,
       segment, mcap_rank, score_change
from public.research_latest
with no data;
alter table public.research_list add primary key (symbol, exchange);
create index research_list_score_idx on public.research_list (segment, score desc);
create index research_list_stance_idx on public.research_list (segment, stance);
alter table public.research_list enable row level security;
create policy research_list_read on public.research_list for select to authenticated using (true);
revoke all on public.research_list from anon, public;
revoke insert, update, delete, truncate on public.research_list from authenticated;
grant select on public.research_list to authenticated;

-- Rebuild the rows of some stocks (or all) from the view.
create or replace function private.refresh_research_list(p_symbols text[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  if p_symbols is null then
    delete from public.research_list where true;
  else
    delete from public.research_list where symbol = any(p_symbols);
  end if;
  insert into public.research_list
  select v.symbol, v.exchange, v.name, v.sector, v.as_of, v.score, v.stance, v.prev_stance, v.prev_score, v.headline,
         v.news_count, v.filing_count, v.segment, v.mcap_rank, v.score_change
  from public.research_latest v
  where p_symbols is null or v.symbol = any(p_symbols);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function private.refresh_research_list(text[]) from public, anon, authenticated;

-- Notes written, changed or deleted: those stocks again.
create or replace function private.research_notes_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_syms text[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.symbol) into v_syms from new_rows n;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.symbol) into v_syms from old_rows o;
  else
    select array_agg(distinct x.symbol) into v_syms
    from (select n.symbol from new_rows n union select o.symbol from old_rows o) x;
  end if;
  if v_syms is not null then
    perform private.refresh_research_list(v_syms);
  end if;
  return null;
end $$;
revoke all on function private.research_notes_changed() from public, anon, authenticated;

create trigger trg_research_notes_list_ins after insert on public.research_notes
  referencing new table as new_rows for each statement execute function private.research_notes_changed();
create trigger trg_research_notes_list_upd after update on public.research_notes
  referencing new table as new_rows old table as old_rows for each statement execute function private.research_notes_changed();
create trigger trg_research_notes_list_del after delete on public.research_notes
  referencing old table as old_rows for each statement execute function private.research_notes_changed();

-- A stock's name, sector, segment, size rank or listing changed: its row again (the pipeline's universe upsert writes
-- every symbol; only real changes count).
create or replace function private.market_symbols_list_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_syms text[];
begin
  select array_agg(distinct n.symbol) into v_syms
  from new_rows n
  join old_rows o on o.symbol = n.symbol and o.exchange = n.exchange
  where (n.name, n.sector, n.segment, n.mcap_rank, n.is_active) is distinct from (o.name, o.sector, o.segment, o.mcap_rank, o.is_active);
  if v_syms is not null then
    perform private.refresh_research_list(v_syms);
  end if;
  return null;
end $$;
revoke all on function private.market_symbols_list_changed() from public, anon, authenticated;

create trigger trg_market_symbols_research_list after update on public.market_symbols
  referencing new table as new_rows old table as old_rows for each statement execute function private.market_symbols_list_changed();

select private.refresh_research_list();
