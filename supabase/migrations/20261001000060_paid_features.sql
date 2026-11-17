-- New paid features (17 Nov 2026): plan keys for the features the owner chose to sell.
--   head_start        "Am I too late?" on the stock page (web/src/lib/head-start.ts; research/strategies/head_start.py).
--                     Tested research numbers only, no user rows: the plan key is the whole gate.
--   behaviour_mirror  "Your trading habits" (/app/portfolio/mirror, web/src/lib/behaviour-mirror.ts). Reads only the
--                     caller's own portfolio rows (existing RLS on portfolio_lots / portfolio_realized) and market data,
--                     so it adds no table and no policy; the page also needs the portfolio feature.
-- AGENTS rule 12: the UI checks can(session, key); public.plans.features must agree. Granted to Pro and Pro Plus, which
-- today carry the same features; the owner may move a key to Pro Plus later.
update public.plans
   set features = features || '{"head_start": true, "behaviour_mirror": true}'::jsonb
 where code in ('pro', 'pro_plus');
