-- =====================================================================
-- REFERENCE data (safe for production): the covered NSE universe.
-- pipelines/eod fetches daily candles for every ACTIVE row (Yahoo ticker
-- = symbol + ".NS"). Idempotent upsert; deactivating hides a symbol from
-- quotes, research and the pipeline but keeps its history.
-- 2025 Tata Motors demerger: TATAMOTORS stopped trading and became TMPV
-- (passenger vehicles, incl. JLR) and TMCV (commercial vehicles).
-- =====================================================================
insert into public.market_symbols (symbol, exchange, name, sector, is_active) values
  ('RELIANCE',   'NSE', 'Reliance Industries',             'Energy',         true),
  ('TCS',        'NSE', 'Tata Consultancy Services',       'IT',             true),
  ('HDFCBANK',   'NSE', 'HDFC Bank',                       'Banking',        true),
  ('INFY',       'NSE', 'Infosys',                         'IT',             true),
  ('ICICIBANK',  'NSE', 'ICICI Bank',                      'Banking',        true),
  ('HINDUNILVR', 'NSE', 'Hindustan Unilever',              'FMCG',           true),
  ('ITC',        'NSE', 'ITC',                             'FMCG',           true),
  ('SBIN',       'NSE', 'State Bank of India',             'Banking',        true),
  ('BHARTIARTL', 'NSE', 'Bharti Airtel',                   'Telecom',        true),
  ('KOTAKBANK',  'NSE', 'Kotak Mahindra Bank',             'Banking',        true),
  ('LT',         'NSE', 'Larsen & Toubro',                 'Capital Goods',  true),
  ('AXISBANK',   'NSE', 'Axis Bank',                       'Banking',        true),
  ('ASIANPAINT', 'NSE', 'Asian Paints',                    'Consumer',       true),
  ('MARUTI',     'NSE', 'Maruti Suzuki India',             'Auto',           true),
  ('SUNPHARMA',  'NSE', 'Sun Pharmaceutical',              'Pharma',         true),
  ('TITAN',      'NSE', 'Titan Company',                   'Consumer',       true),
  ('BAJFINANCE', 'NSE', 'Bajaj Finance',                   'Financials',     true),
  ('HCLTECH',    'NSE', 'HCL Technologies',                'IT',             true),
  ('WIPRO',      'NSE', 'Wipro',                           'IT',             true),
  ('ULTRACEMCO', 'NSE', 'UltraTech Cement',                'Materials',      true),
  ('NESTLEIND',  'NSE', 'Nestle India',                    'FMCG',           true),
  ('ONGC',       'NSE', 'Oil & Natural Gas Corp',          'Energy',         true),
  ('NTPC',       'NSE', 'NTPC',                            'Utilities',      true),
  ('POWERGRID',  'NSE', 'Power Grid Corp',                 'Utilities',      true),
  ('TATAMOTORS', 'NSE', 'Tata Motors (pre-demerger)',      'Auto',           false),
  ('TMPV',       'NSE', 'Tata Motors Passenger Vehicles',  'Auto',           true),
  ('TMCV',       'NSE', 'Tata Motors',                     'Auto',           true),
  ('TATASTEEL',  'NSE', 'Tata Steel',                      'Metals',         true),
  ('JSWSTEEL',   'NSE', 'JSW Steel',                       'Metals',         true),
  ('M&M',        'NSE', 'Mahindra & Mahindra',             'Auto',           true),
  ('ADANIPORTS', 'NSE', 'Adani Ports & SEZ',               'Infrastructure', true),
  ('COALINDIA',  'NSE', 'Coal India',                      'Energy',         true),
  ('DRREDDY',    'NSE', 'Dr. Reddy''s Laboratories',       'Pharma',         true),
  ('CIPLA',      'NSE', 'Cipla',                           'Pharma',         true),
  ('TECHM',      'NSE', 'Tech Mahindra',                   'IT',             true),
  ('HDFCLIFE',   'NSE', 'HDFC Life Insurance',             'Financials',     true),
  ('BAJAJ-AUTO', 'NSE', 'Bajaj Auto',                      'Auto',           true),
  ('EICHERMOT',  'NSE', 'Eicher Motors',                   'Auto',           true),
  ('GRASIM',     'NSE', 'Grasim Industries',               'Materials',      true),
  ('HEROMOTOCO', 'NSE', 'Hero MotoCorp',                   'Auto',           true),
  ('BRITANNIA',  'NSE', 'Britannia Industries',            'FMCG',           true),
  ('APOLLOHOSP', 'NSE', 'Apollo Hospitals',                'Healthcare',     true),
  ('DMART',      'NSE', 'Avenue Supermarts',               'Retail',         true),
  ('IRCTC',      'NSE', 'Indian Railway Catering',         'Services',       true)
on conflict (symbol, exchange) do update
  set name = excluded.name, sector = excluded.sector, is_active = excluded.is_active;
