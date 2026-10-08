-- =====================================================================
-- REFERENCE data (safe for production): the covered NSE universe.
-- pipelines/eod fetches daily candles for every ACTIVE row (Yahoo ticker
-- = symbol + ".NS"). Idempotent upsert; deactivating hides a symbol from
-- quotes, research and the pipeline but keeps its history.
-- 2025 Tata Motors demerger: TATAMOTORS stopped trading and became TMPV
-- (passenger vehicles, incl. JLR) and TMCV (commercial vehicles).
-- =====================================================================
insert into public.market_symbols (symbol, exchange, name, sector, is_active, history_days) values
  ('RELIANCE',   'NSE', 'Reliance Industries',             'Energy',         true, 760),
  ('TCS',        'NSE', 'Tata Consultancy Services',       'IT',             true, 760),
  ('HDFCBANK',   'NSE', 'HDFC Bank',                       'Banking',        true, 760),
  ('INFY',       'NSE', 'Infosys',                         'IT',             true, 760),
  ('ICICIBANK',  'NSE', 'ICICI Bank',                      'Banking',        true, 760),
  ('HINDUNILVR', 'NSE', 'Hindustan Unilever',              'FMCG',           true, 760),
  ('ITC',        'NSE', 'ITC',                             'FMCG',           true, 760),
  ('SBIN',       'NSE', 'State Bank of India',             'Banking',        true, 760),
  ('BHARTIARTL', 'NSE', 'Bharti Airtel',                   'Telecom',        true, 760),
  ('KOTAKBANK',  'NSE', 'Kotak Mahindra Bank',             'Banking',        true, 760),
  ('LT',         'NSE', 'Larsen & Toubro',                 'Capital Goods',  true, 760),
  ('AXISBANK',   'NSE', 'Axis Bank',                       'Banking',        true, 760),
  ('ASIANPAINT', 'NSE', 'Asian Paints',                    'Consumer',       true, 760),
  ('MARUTI',     'NSE', 'Maruti Suzuki India',             'Auto',           true, 760),
  ('SUNPHARMA',  'NSE', 'Sun Pharmaceutical',              'Pharma',         true, 760),
  ('TITAN',      'NSE', 'Titan Company',                   'Consumer',       true, 760),
  ('BAJFINANCE', 'NSE', 'Bajaj Finance',                   'Financials',     true, 760),
  ('HCLTECH',    'NSE', 'HCL Technologies',                'IT',             true, 760),
  ('WIPRO',      'NSE', 'Wipro',                           'IT',             true, 760),
  ('ULTRACEMCO', 'NSE', 'UltraTech Cement',                'Materials',      true, 760),
  ('NESTLEIND',  'NSE', 'Nestle India',                    'FMCG',           true, 760),
  ('ONGC',       'NSE', 'Oil & Natural Gas Corp',          'Energy',         true, 760),
  ('NTPC',       'NSE', 'NTPC',                            'Utilities',      true, 760),
  ('POWERGRID',  'NSE', 'Power Grid Corp',                 'Utilities',      true, 760),
  ('TATAMOTORS', 'NSE', 'Tata Motors (pre-demerger)',      'Auto',           false, 760),
  ('TMPV',       'NSE', 'Tata Motors Passenger Vehicles',  'Auto',           true, 760),
  ('TMCV',       'NSE', 'Tata Motors',                     'Auto',           true, 760),
  ('TATASTEEL',  'NSE', 'Tata Steel',                      'Metals',         true, 760),
  ('JSWSTEEL',   'NSE', 'JSW Steel',                       'Metals',         true, 760),
  ('M&M',        'NSE', 'Mahindra & Mahindra',             'Auto',           true, 760),
  ('ADANIPORTS', 'NSE', 'Adani Ports & SEZ',               'Infrastructure', true, 760),
  ('COALINDIA',  'NSE', 'Coal India',                      'Energy',         true, 760),
  ('DRREDDY',    'NSE', 'Dr. Reddy''s Laboratories',       'Pharma',         true, 760),
  ('CIPLA',      'NSE', 'Cipla',                           'Pharma',         true, 760),
  ('TECHM',      'NSE', 'Tech Mahindra',                   'IT',             true, 760),
  ('HDFCLIFE',   'NSE', 'HDFC Life Insurance',             'Financials',     true, 760),
  ('BAJAJ-AUTO', 'NSE', 'Bajaj Auto',                      'Auto',           true, 760),
  ('EICHERMOT',  'NSE', 'Eicher Motors',                   'Auto',           true, 760),
  ('GRASIM',     'NSE', 'Grasim Industries',               'Materials',      true, 760),
  ('HEROMOTOCO', 'NSE', 'Hero MotoCorp',                   'Auto',           true, 760),
  ('BRITANNIA',  'NSE', 'Britannia Industries',            'FMCG',           true, 760),
  ('APOLLOHOSP', 'NSE', 'Apollo Hospitals',                'Healthcare',     true, 760),
  ('DMART',      'NSE', 'Avenue Supermarts',               'Retail',         true, 760),
  ('IRCTC',      'NSE', 'Indian Railway Catering',         'Services',       true, 760)
on conflict (symbol, exchange) do update
  -- names/sectors of existing rows belong to the universe sync (pipelines/eod/universe.py)
  set is_active = excluded.is_active, history_days = 760;

update public.market_symbols
   set status_note = 'Tata Motors demerged on 14 Oct 2025 into Tata Motors Passenger Vehicles (TMPV, incl. JLR) and Tata Motors (TMCV, commercial vehicles). TATAMOTORS no longer trades.',
       successors = '{TMPV,TMCV}'
 where symbol = 'TATAMOTORS' and exchange = 'NSE';
