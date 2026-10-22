import json
import urllib.request
import os
import sys

def get_env():
    env = {}
    with open('web/.env.local') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

env = get_env()
headers = {
    'apikey': env['SUPABASE_SERVICE_ROLE_KEY'],
    'Authorization': f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal'
}

# 1. Fetch ALL active NSE symbols with pagination
def get_all_symbols():
    symbols = []
    offset = 0
    limit = 1000
    while True:
        url = f"{env['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/market_symbols?select=symbol,name&exchange=eq.NSE&order=symbol.asc&offset={offset}&limit={limit}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as resp:
            batch = json.loads(resp.read().decode('utf-8'))
            if not batch:
                break
            symbols.extend(batch)
            if len(batch) < limit:
                break
            offset += limit
    return symbols

db_symbols = get_all_symbols()
print(f"Loaded {len(db_symbols)} symbols from DB with pagination.")

# Exact dictionary overrides for companies with different registered vs trade names
OVERRIDES = {
    'adani ports and special economic zone ltd.': 'ADANIPORTS',
    'ce info systems ltd.': 'MAPMYINDIA',
    'e.i.d. - parry (india) ltd.': 'EIDPARRY',
    'godawari power and ispat ltd.': 'GPIL',
    'heg ltd.': 'HEG',
    'housing & urban development corporation ltd.': 'HUDCO',
    'icici prudential life insurance company ltd.': 'ICICIPRULI',
    'jk cement ltd.': 'JKCEMENT',
    'lloyds metals & energy ltd.': 'LLOYDSME',
    'rr kabel ltd.': 'RRKABEL',
    'the jammu & kashmir bank ltd.': 'J&KBANK',
    'transformers & rectifiers (india) ltd.': 'TRIL',
    'jsw infrastructure ltd.': 'JSWINFRA',
    'k.p.r. mill ltd.': 'KPRMILL',
    'mankind pharma ltd.': 'MANKIND',
}

db_by_sym = {s['symbol']: s for s in db_symbols}
db_name_to_sym = {}
for s in db_symbols:
    n = s['name'].lower().replace(' ltd.', '').replace(' limited', '').replace(' ind.', ' industries').strip()
    db_name_to_sym[n] = s['symbol']

# 2. Read kk_eod_results_fixed.json
data = json.load(open('kk_eod_results_fixed.json'))
trades = data['trades']
print(f"Total trades in JSON: {len(trades)}")

def get_symbol_for_company(company_name):
    c_lower = company_name.lower().strip()
    if c_lower in OVERRIDES and OVERRIDES[c_lower] in db_by_sym:
        return OVERRIDES[c_lower]
    c_clean = c_lower.replace(' ltd.', '').replace(' limited', '').replace(' ind.', ' industries').strip()
    if c_clean in db_name_to_sym:
        return db_name_to_sym[c_clean]
    for n, sym in db_name_to_sym.items():
        if n == c_clean or (len(n) > 5 and n in c_clean) or (len(c_clean) > 5 and c_clean in n):
            return sym
    return None

# Filter trades for recent years (>= 2024-01-01) for covered symbols
rows_to_insert = []
unmapped_companies = set()

for t in trades:
    if t['signal_date'] >= '2024-01-01':
        cname = t['company_name']
        sym = get_symbol_for_company(cname)
        if not sym:
            unmapped_companies.add(cname)
            continue

        sig = t['signal'] # BUY or SELL
        conf_date = t.get('confirmation_date') or t.get('entry_date') or t['signal_date']
        exit_date = t.get('exit_date')
        entry_fill = t.get('entry_fill_price') or t['entry']
        planned_risk = abs(entry_fill - t['stop_loss']) if entry_fill and t.get('stop_loss') else 0
        realized_r = t.get('realized_r_multiple')
        res = t.get('result')

        if sig == 'BUY':
            entry_ts = f"{conf_date}T10:00:00+05:30"
            rows_to_insert.append({
                "symbol": sym,
                "exchange": "NSE",
                "strategy": "kk_breakout",
                "signal_type": "buy",
                "payload": {
                    "action": "buy",
                    "direction": "buy",
                    "label": "KK 20d Breakout Buy",
                    "close": entry_fill,
                    "entry": t['entry'],
                    "fill": entry_fill,
                    "stop": t['stop_loss'],
                    "target": t['target_1'],
                    "target1": t['target_1'],
                    "target2": t['target_2'],
                    "signal_date": t['signal_date'],
                    "confirmation_date": conf_date,
                    "result": res
                },
                "generated_at": entry_ts
            })

            # Exit row if completed
            if exit_date and t.get('exit_price') and exit_date != conf_date:
                exit_ts = f"{exit_date}T15:30:00+05:30"
                exit_price = t['exit_price']
                pnl_pct = ((exit_price - entry_fill) / entry_fill) * 100 if entry_fill else 0
                exit_label = "KK Target 2 (+2.0R)" if res == "TARGET_2_HIT" else \
                             "KK T1 (+0.75R) + Time Exit" if res == "TARGET_1_HIT_TIME_EXIT" else \
                             "KK Stop Loss (-1.0R)" if res == "SL_HIT" else "KK Exit"
                rows_to_insert.append({
                    "symbol": sym,
                    "exchange": "NSE",
                    "strategy": "kk_breakout",
                    "signal_type": "exit",
                    "payload": {
                        "action": "exit",
                        "direction": "buy",
                        "label": exit_label,
                        "close": exit_price,
                        "exit_price": exit_price,
                        "result": res,
                        "realized_r": realized_r,
                        "pnl_pct": round(pnl_pct, 2),
                        "signal_date": t['signal_date']
                    },
                    "generated_at": exit_ts
                })

        else: # sig == 'SELL' (Short Breakdown Setup)
            # Database check constraint requires signal_type in ('buy', 'exit')
            # Entry into short position stored as signal_type: "exit" with action: "sell"
            entry_ts = f"{conf_date}T10:00:00+05:30"
            rows_to_insert.append({
                "symbol": sym,
                "exchange": "NSE",
                "strategy": "kk_breakout",
                "signal_type": "exit",
                "payload": {
                    "action": "sell",
                    "direction": "sell",
                    "label": "KK 20d Breakdown Sell",
                    "close": entry_fill,
                    "entry": t['entry'],
                    "fill": entry_fill,
                    "stop": t['stop_loss'],
                    "target": t['target_1'],
                    "target1": t['target_1'],
                    "target2": t['target_2'],
                    "signal_date": t['signal_date'],
                    "confirmation_date": conf_date,
                    "result": res
                },
                "generated_at": entry_ts
            })

            # Exit / Cover row if completed
            if exit_date and t.get('exit_price') and exit_date != conf_date:
                cover_ts = f"{exit_date}T15:30:00+05:30"
                exit_price = t['exit_price']
                pnl_pct = ((entry_fill - exit_price) / entry_fill) * 100 if entry_fill else 0
                cover_label = "KK Target 2 Cover (+2.0R)" if res == "TARGET_2_HIT" else \
                              "KK T1 Cover + Time Exit" if res == "TARGET_1_HIT_TIME_EXIT" else \
                              "KK Stop Loss Cover" if res == "SL_HIT" else "KK Cover"
                rows_to_insert.append({
                    "symbol": sym,
                    "exchange": "NSE",
                    "strategy": "kk_breakout",
                    "signal_type": "exit",
                    "payload": {
                        "action": "cover",
                        "direction": "sell",
                        "label": cover_label,
                        "close": exit_price,
                        "exit_price": exit_price,
                        "result": res,
                        "realized_r": realized_r,
                        "pnl_pct": round(pnl_pct, 2),
                        "signal_date": t['signal_date']
                    },
                    "generated_at": cover_ts
                })

print(f"Generated {len(rows_to_insert)} rich trading_signals rows to upsert.")
if unmapped_companies:
    print(f"Unmapped ({len(unmapped_companies)}): {list(unmapped_companies)[:5]}")

# Batch upsert in chunks of 250
batch_size = 250
upsert_url = f"{env['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/trading_signals?on_conflict=symbol,exchange,strategy,signal_type,generated_at"

inserted = 0
for i in range(0, len(rows_to_insert), batch_size):
    chunk = rows_to_insert[i:i + batch_size]
    body = json.dumps(chunk).encode('utf-8')
    post_req = urllib.request.Request(upsert_url, data=body, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(post_req) as resp:
            inserted += len(chunk)
            if inserted % 1000 == 0 or inserted == len(rows_to_insert):
                print(f"Upserted {inserted} / {len(rows_to_insert)} signals...")
    except Exception as e:
        print(f"Error upserting batch {i}: {e}")

print("Done! KK Breakout signals successfully ingested into trading_signals across all 500 Nifty equities.")
