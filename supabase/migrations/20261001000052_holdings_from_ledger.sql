-- Holdings are written by the ledger only (portfolio plan, step B; ADR-046). Since migration 51 a holding is worked out
-- from its trades; the app now records trades (portfolio/actions.ts) instead of writing holdings. A client write to
-- holdings would put the row out of step with its trades, so clients may only read them now.
revoke insert, update, delete on public.holdings from authenticated;
drop policy if exists holdings_insert_own on public.holdings;
drop policy if exists holdings_update_own on public.holdings;
drop policy if exists holdings_delete_own on public.holdings;

-- Anything written directly between migration 51 and the app that records trades gets its opening balance.
select private.ensure_opening_balances();
