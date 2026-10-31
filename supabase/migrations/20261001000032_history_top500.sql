-- ADR-034: two years of daily candles for the 500 largest companies (was 400 days for all but ~80
-- core symbols, ADR-027). Dry Run replays and the odds pool need it; ~+25 MB on the free tier.
-- The nightly retention job (migration 26) deletes candles older than history_days, so the rule
-- lives on the row: a trigger raises history_days to 760 whenever a symbol's mcap_rank is in the
-- top 500, including companies that climb into it later. It never lowers it.

create or replace function private.history_for_rank()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.mcap_rank is not null and new.mcap_rank <= 500 and new.history_days < 760 then
    new.history_days := 760;
  end if;
  return new;
end $$;
revoke all on function private.history_for_rank() from public, anon, authenticated;

drop trigger if exists market_symbols_history_for_rank on public.market_symbols;
create trigger market_symbols_history_for_rank
  before insert or update of mcap_rank, history_days on public.market_symbols
  for each row execute function private.history_for_rank();

update public.market_symbols
   set history_days = 760
 where mcap_rank <= 500 and history_days < 760;
