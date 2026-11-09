"""Research only: the same stocks as data/candles.parquet, from 2010, so that indicators with a long warm-up (Pring's
Special K needs 725 sessions) have values from the first test day (2019-07-01). Downloaded in one go to 2026-10-31 so
the adjusted prices are consistent. Writes data/candles_long.parquet; touches nothing else.

    python download_long.py
"""
import time
from pathlib import Path

import pandas as pd
import yfinance as yf

D = Path(__file__).parent / "data"
symbols = sorted(pd.read_parquet(D / "candles.parquet", columns=["symbol"]).symbol.unique())
tickers = {s: (s if s.startswith("^") else s.replace("&", "%26") + ".NS") for s in symbols}
items = list(tickers.items())
frames = []
for i in range(0, len(items), 100):
    chunk = dict(items[i:i + 100])
    data = yf.download(list(chunk.values()), start="2010-01-01", end="2026-10-31", interval="1d",
                       auto_adjust=True, group_by="ticker", threads=True, progress=False)
    for s, t in chunk.items():
        if t in data.columns.get_level_values(0):
            f = data[t].dropna(how="all").copy()
            if len(f):
                f["symbol"] = s
                frames.append(f.reset_index())
    print(f"  {min(i + 100, len(items))} of {len(items)}", flush=True)
    time.sleep(1)
df = pd.concat(frames)
df.columns = [c.lower() for c in df.columns]
df.to_parquet(D / "candles_long.parquet", index=False)
print("rows", len(df), "symbols with data", df.symbol.nunique(), "from", df.date.min(), "to", df.date.max())
