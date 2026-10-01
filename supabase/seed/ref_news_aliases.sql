-- =====================================================================
-- REFERENCE data (safe for production): names the news matcher looks for.
-- Only rows whose symbol exists in market_symbols are inserted, so it can
-- run before or after the market pipelines. Idempotent.
--
-- Rules of thumb:
--  * Avoid bare words that name a different listed company
--    ("Reliance" → Reliance Power/Capital; "Tata" → many; "Bajaj" → several).
--  * Tickers are matched separately (case-sensitive, ≥ 4 chars); only add
--    short tickers here if they're unambiguous in headlines (ITC, TCS, SBI).
-- =====================================================================
insert into public.news_symbol_aliases (symbol, exchange, alias)
select v.symbol, 'NSE'::public.exchange_code, v.alias
from (values
  ('RELIANCE',   'Reliance Industries'), ('RELIANCE', 'RIL'), ('RELIANCE', 'Jio Platforms'), ('RELIANCE', 'Reliance Jio'), ('RELIANCE', 'Reliance Retail'),
  ('TCS',        'TCS'), ('TCS', 'Tata Consultancy'),
  ('HDFCBANK',   'HDFC Bank'),
  ('INFY',       'Infosys'),
  ('ICICIBANK',  'ICICI Bank'),
  ('HINDUNILVR', 'Hindustan Unilever'), ('HINDUNILVR', 'HUL'),
  ('ITC',        'ITC'),
  ('SBIN',       'State Bank of India'), ('SBIN', 'SBI'),
  ('BHARTIARTL', 'Bharti Airtel'), ('BHARTIARTL', 'Airtel'),
  ('KOTAKBANK',  'Kotak Mahindra Bank'), ('KOTAKBANK', 'Kotak Bank'),
  ('LT',         'Larsen & Toubro'), ('LT', 'L&T'), ('LT', 'Larsen and Toubro'),
  ('AXISBANK',   'Axis Bank'),
  ('ASIANPAINT', 'Asian Paints'),
  ('MARUTI',     'Maruti Suzuki'), ('MARUTI', 'Maruti'),
  ('SUNPHARMA',  'Sun Pharma'), ('SUNPHARMA', 'Sun Pharmaceutical'),
  ('TITAN',      'Titan Company'), ('TITAN', 'Titan'),
  ('BAJFINANCE', 'Bajaj Finance'),
  ('HCLTECH',    'HCL Tech'), ('HCLTECH', 'HCLTech'), ('HCLTECH', 'HCL Technologies'),
  ('WIPRO',      'Wipro'),
  ('ULTRACEMCO', 'UltraTech Cement'), ('ULTRACEMCO', 'UltraTech'),
  ('NESTLEIND',  'Nestle India'), ('NESTLEIND', 'Nestlé India'),
  ('ONGC',       'ONGC'), ('ONGC', 'Oil and Natural Gas'), ('ONGC', 'Oil & Natural Gas'),
  ('NTPC',       'NTPC'),
  ('POWERGRID',  'Power Grid'), ('POWERGRID', 'PowerGrid'),
  -- 2025 demerger: TATAMOTORS is inactive. Bare "Tata Motors" is ambiguous between the two successors,
  -- so it is not an alias for either; JLR belongs to the passenger-vehicle company.
  ('TMPV',       'Tata Motors Passenger Vehicles'), ('TMPV', 'TMPV'), ('TMPV', 'Jaguar Land Rover'), ('TMPV', 'JLR'),
  ('TMCV',       'Tata Motors Commercial Vehicles'), ('TMCV', 'TMCV'),
  ('TATASTEEL',  'Tata Steel'),
  ('JSWSTEEL',   'JSW Steel'),
  ('M&M',        'Mahindra & Mahindra'), ('M&M', 'M&M'), ('M&M', 'Mahindra and Mahindra'),
  ('ADANIPORTS', 'Adani Ports'), ('ADANIPORTS', 'APSEZ'),
  ('COALINDIA',  'Coal India'),
  ('DRREDDY',    'Dr Reddy''s'), ('DRREDDY', 'Dr. Reddy''s'), ('DRREDDY', 'Dr Reddys'),
  ('CIPLA',      'Cipla'),
  ('TECHM',      'Tech Mahindra'),
  ('HDFCLIFE',   'HDFC Life'),
  ('BAJAJ-AUTO', 'Bajaj Auto'),
  ('EICHERMOT',  'Eicher Motors'), ('EICHERMOT', 'Royal Enfield'),
  ('GRASIM',     'Grasim'),
  ('HEROMOTOCO', 'Hero MotoCorp'), ('HEROMOTOCO', 'Hero Motocorp'),
  ('BRITANNIA',  'Britannia'),
  ('APOLLOHOSP', 'Apollo Hospitals'),
  ('DMART',      'DMart'), ('DMART', 'D-Mart'), ('DMART', 'Avenue Supermarts'),
  ('IRCTC',      'IRCTC')
) as v(symbol, alias)
join public.market_symbols s on s.symbol = v.symbol and s.exchange = 'NSE'
on conflict do nothing;

insert into public.news_search_cursor (symbol, exchange)
select symbol, exchange from public.market_symbols where is_active
on conflict do nothing;
