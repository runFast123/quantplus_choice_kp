-- =====================================================================
-- 5.19 Turn off feeds that refuse automated readers.
--      Moneycontrol and Business Standard return 403 to crawlers; NSE's
--      archive sits behind bot protection that drops non-browser clients.
--      We identify honestly (QuantsPulseBot user-agent) and do not
--      impersonate browsers, so these stay off until a licensed feed or
--      written permission exists. See docs/DECISIONS.md ADR-014.
-- =====================================================================
update public.news_sources
   set is_active = false,
       last_status = 'disabled',
       last_error = 'Source blocks automated readers; needs licensed access'
 where code in ('mc_markets', 'mc_business', 'bs_markets', 'nse_filings');
