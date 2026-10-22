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
    'Prefer': 'resolution=ignore-duplicates,return=minimal'
}

# 1. Fetch active symbols from market_symbols
url_symbols = f"{env['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/market_symbols?select=symbol,name&exchange=eq.NSE&limit=2000"
req = urllib.request.Request(url_symbols, headers=headers)
with urllib.request.urlopen(req) as resp:
    db_symbols = json.loads(resp.read().decode('utf-8'))

print(f"Loaded {len(db_symbols)} symbols from DB.")

# Map clean names
name_map = {}
for s in db_symbols:
    clean = s['name'].lower().replace(' ltd.', '').replace(' limited', '').replace(' ind.', ' industries').strip()
    name_map[clean] = s['symbol']

# 2. Read kk_eod_results_fixed.json
data = json.load(open('kk_eod_results_fixed.json'))
trades = data['trades']
print(f"Total trades in JSON: {len(trades)}")

# Filter trades for recent years (>= 2024-01-01) for covered symbols
rows_to_insert = []
for t in trades:
    if t['signal_date'] >= '2024-01-01':
        cname = t['company_name'].lower().replace(' ltd.', '').replace(' limited', '').replace(' ind.', ' industries').strip()
        sym = None
        for k, v in name_map.items():
            if k == cname or k in cname or cname in k:
                sym = v
                break
        if not sym:
            continue

        # Signal Type in DB is check (signal_type in ('buy', 'exit'))
        # If signal is BUY: insert buy signal at confirmation date/time
        # If trade ended with exit: insert exit signal at exit date/time
        sig = t['signal']
        conf_date = t.get('confirmation_date') or t.get('entry_date') or t['signal_date']
        exit_date = t.get('exit_date')

        # Entry row (BUY)
        if sig == 'BUY':
            ts = f"{conf_date}T10:00:00+05:30"
            rows_to_insert.append({
                "symbol": sym,
                "exchange": "NSE",
                "strategy": "kk_breakout",
                "signal_type": "buy",
                "payload": {
                    "close": t.get('entry_fill_price') or t['entry'],
                    "entry": t['entry'],
                    "fill": t.get('entry_fill_price') or t['entry'],
                    "stop": t['stop_loss'],
                    "target": t['target_1'],
                    "target2": t['target_2'],
                    "signal_date": t['signal_date'],
                    "result": t.get('result')
                },
                "generated_at": ts
            })

            # Exit row if completed
            if exit_date and t.get('exit_price') and exit_date != conf_date:
                exit_ts = f"{exit_date}T15:30:00+05:30"
                rows_to_insert.append({
                    "symbol": sym,
                    "exchange": "NSE",
                    "strategy": "kk_breakout",
                    "signal_type": "exit",
                    "payload": {
                        "close": t['exit_price'],
                        "exit_price": t['exit_price'],
                        "result": t.get('result'),
                        "realized_r": t.get('realized_r_multiple'),
                        "signal_date": t['signal_date']
                    },
                    "generated_at": exit_ts
                })
        else: # SELL signal in cash equity: exit
            ts = f"{conf_date}T10:00:00+05:30"
            rows_to_insert.append({
                "symbol": sym,
                "exchange": "NSE",
                "strategy": "kk_breakout",
                "signal_type": "exit",
                "payload": {
                    "close": t.get('entry_fill_price') or t['entry'],
                    "entry": t['entry'],
                    "stop": t['stop_loss'],
                    "target": t['target_1'],
                    "target2": t['target_2'],
                    "direction": "sell",
                    "signal_date": t['signal_date'],
                    "result": t.get('result')
                },
                "generated_at": ts
            })

print(f"Generated {len(rows_to_insert)} trading_signals rows to upsert.")

# Batch upsert in chunks of 200
batch_size = 200
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

print("Done! KK Breakout signals successfully ingested into trading_signals.")
