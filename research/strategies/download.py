"""Research only: 7 years of adjusted daily NSE candles for today's top 500 by market cap, plus the
Nifty 50 and Nifty 500 indices. Reads the symbol list from Supabase (read-only); writes nothing there."""
import json, os, sys, time, urllib.request
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(sys.argv[1])            # repo root (for web/.env.local)
OUT = Path(__file__).parent / "data"
OUT.mkdir(exist_ok=True)

env = {}
for line in open(ROOT / "web/.env.local", encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
key = env["SUPABASE_SERVICE_ROLE_KEY"]
url = (f"{env['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/market_symbols?select=symbol,name,sector,mcap_rank,segment"
       "&exchange=eq.NSE&is_active=eq.true&mcap_rank=lte.500&order=mcap_rank.asc&limit=1000")
req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
syms = json.loads(urllib.request.urlopen(req).read())
syms = [s for s in syms if (s.get("segment") or "equity") == "equity"]
pd.DataFrame(syms).to_csv(OUT / "universe.csv", index=False)
print("symbols", len(syms))

tickers = {s["symbol"]: s["symbol"].replace("&", "%26") + ".NS" for s in syms}
tickers["^NSEI"] = "^NSEI"
tickers["^CRSLDX"] = "^CRSLDX"
items = list(tickers.items())
frames = []
for i in range(0, len(items), 100):
    chunk = dict(items[i:i + 100])
    data = yf.download(list(chunk.values()), start="2019-01-01", end="2026-11-01", interval="1d",
                       auto_adjust=True, group_by="ticker", threads=True, progress=False)
    for s, t in chunk.items():
        if t in data.columns.get_level_values(0):
            f = data[t].dropna(how="all").copy()
            if len(f):
                f["symbol"] = s
                frames.append(f.reset_index())
    time.sleep(1)
df = pd.concat(frames)
df.columns = [c.lower() for c in df.columns]
df.to_parquet(OUT / "candles.parquet", index=False)
print("rows", len(df), "symbols with data", df.symbol.nunique(), "from", df.date.min(), "to", df.date.max())
