"""Read-only copy of the live daily candles the Strong trend SQL will see: the 500 largest companies plus
NIFTY, INDIAVIX and NIFTY500. Writes data/live_candles.parquet and data/live_symbols.csv. Never writes to Supabase."""
import json
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(sys.argv[1])
OUT = Path(__file__).parent / "data"
OUT.mkdir(exist_ok=True)
env = {}
for line in open(ROOT / "web/.env.local", encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
KEY, BASE = env["SUPABASE_SERVICE_ROLE_KEY"], env["NEXT_PUBLIC_SUPABASE_URL"]


def get(path):
    req = urllib.request.Request(f"{BASE}/rest/v1/{path}", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


syms = get("market_symbols?select=symbol,exchange,segment,mcap_rank,is_active&is_active=eq.true&segment=eq.equity&mcap_rank=lte.500")
syms += get("market_symbols?select=symbol,exchange,segment,mcap_rank,is_active&symbol=in.(NIFTY,INDIAVIX,NIFTY500)")
pd.DataFrame(syms).to_csv(OUT / "live_symbols.csv", index=False)


def candles(s):
    q = urllib.parse.quote(s["symbol"], safe="")
    return get(f"market_candles?select=symbol,exchange,ts,open,high,low,close,volume&symbol=eq.{q}&exchange=eq.NSE"
               f"&interval=eq.1d&order=ts.asc&limit=1000")


with ThreadPoolExecutor(8) as ex:
    rows = [r for part in ex.map(candles, syms) for r in part]
df = pd.DataFrame(rows)
df.to_parquet(OUT / "live_candles.parquet", index=False)
# the same rows as JSON for pglite_live.mjs (Node reads no parquet)
df["volume"] = df.volume.fillna(0).astype("int64")
json.dump({"symbols": [{"symbol": r["symbol"], "segment": r["segment"], "mcap_rank": r.get("mcap_rank")} for r in syms],
           "candles": df[["symbol", "ts", "open", "high", "low", "close", "volume"]].to_dict("records")},
          open(OUT / "live_rows.json", "w"))
print("symbols", len(syms), "candles", len(df), "from", df.ts.min(), "to", df.ts.max())
