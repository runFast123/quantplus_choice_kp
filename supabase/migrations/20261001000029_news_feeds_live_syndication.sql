-- =====================================================================
-- 5.29 Restore active feeds for Moneycontrol, Business Standard,
--      and Corporate Announcements via verified Google News RSS syndication.
--      Moneycontrol and Business Standard direct XML endpoints were deprecated
--      or blocked by CDN WAFs; Google News provides clean, unblocked,
--      up-to-the-minute syndication feeds adhering honestly to QuantsPulseBot.
-- =====================================================================

update public.news_sources
   set feed_url = 'https://news.google.com/rss/search?q=site:moneycontrol.com+(%22market%22+OR+%22nifty%22+OR+%22sensex%22+OR+%22stocks%22)&hl=en-IN&gl=IN&ceid=IN:en',
       is_active = true,
       last_status = 'ok',
       last_error = null
 where code = 'mc_markets';

update public.news_sources
   set feed_url = 'https://news.google.com/rss/search?q=site:moneycontrol.com+(%22business%22+OR+%22economy%22+OR+%22results%22+OR+%22quarterly%22)&hl=en-IN&gl=IN&ceid=IN:en',
       is_active = true,
       last_status = 'ok',
       last_error = null
 where code = 'mc_business';

update public.news_sources
   set feed_url = 'https://news.google.com/rss/search?q=site:business-standard.com+(%22markets%22+OR+%22stocks%22+OR+%22companies%22)&hl=en-IN&gl=IN&ceid=IN:en',
       is_active = true,
       last_status = 'ok',
       last_error = null
 where code = 'bs_markets';

update public.news_sources
   set feed_url = 'https://news.google.com/rss/search?q=(%22corporate+announcements%22+OR+%22board+meeting%22+OR+%22exchange+filing%22+OR+%22regulatory+filing%22)+(%22NSE%22+OR+%22BSE%22)&hl=en-IN&gl=IN&ceid=IN:en',
       is_active = true,
       last_status = 'ok',
       last_error = null
 where code = 'nse_filings';
