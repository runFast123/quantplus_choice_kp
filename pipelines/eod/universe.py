"""The covered universe: every NSE equity Yahoo lists (main board + SME), plus
curated NSE indices and ETFs. Run as part of `eod.py --sync-universe`.

Yahoo's screener returns ~3,500 NSE equities with name and market cap; sector
comes from one screener query per Yahoo sector. Symbols are stored as the NSE
symbol (Yahoo's "-SM" SME suffix stripped) with the Yahoo ticker kept in
`vendor_ticker`. Existing rows keep their name; sector, segment, rank and
ticker are refreshed. A symbol missing from the screener is retired only when
the screener answer looks complete (see `retire`).
"""

from __future__ import annotations

import re
import time

SECTORS = [
    "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy",
    "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities",
]
SME_SUFFIXES = {"SM", "ST"}                       # NSE Emerge
OTHER_SUFFIXES = {"IV", "RR", "BL", "E1", "BE", "BZ"}  # alternate series of a listed symbol

# (our symbol, Yahoo ticker, display name)
INDICES = [
    ("NIFTY", "^NSEI", "NIFTY 50"), ("BANKNIFTY", "^NSEBANK", "NIFTY Bank"), ("NIFTYIT", "^CNXIT", "NIFTY IT"),
    ("NIFTYAUTO", "^CNXAUTO", "NIFTY Auto"), ("NIFTYPHARMA", "^CNXPHARMA", "NIFTY Pharma"),
    ("NIFTYFMCG", "^CNXFMCG", "NIFTY FMCG"), ("NIFTYMETAL", "^CNXMETAL", "NIFTY Metal"),
    ("NIFTYENERGY", "^CNXENERGY", "NIFTY Energy"), ("NIFTYREALTY", "^CNXREALTY", "NIFTY Realty"),
    ("NIFTYPSUBANK", "^CNXPSUBANK", "NIFTY PSU Bank"), ("NIFTYINFRA", "^CNXINFRA", "NIFTY Infrastructure"),
    ("NIFTYMEDIA", "^CNXMEDIA", "NIFTY Media"), ("NIFTYFINSERV", "^CNXFIN", "NIFTY Financial Services"),
    ("NIFTYMNC", "^CNXMNC", "NIFTY MNC"), ("NIFTY100", "^CNX100", "NIFTY 100"), ("NIFTY200", "^CNX200", "NIFTY 200"),
    ("NIFTY500", "^CRSLDX", "NIFTY 500"), ("NIFTYMIDCAP50", "^NSEMDCP50", "NIFTY Midcap 50"),
    ("NIFTYMIDCAP100", "NIFTY_MIDCAP_100.NS", "NIFTY Midcap 100"), ("NIFTYSMALLCAP100", "^CNXSC", "NIFTY Smallcap 100"),
    ("INDIAVIX", "^INDIAVIX", "India VIX"),
]
ETFS = [
    ("NIFTYBEES", "Nippon India ETF Nifty 50 BeES"), ("BANKBEES", "Nippon India ETF Nifty Bank BeES"),
    ("JUNIORBEES", "Nippon India ETF Nifty Next 50 Junior BeES"), ("ITBEES", "Nippon India ETF Nifty IT"),
    ("GOLDBEES", "Nippon India ETF Gold BeES"), ("SILVERBEES", "Nippon India Silver ETF"),
    ("LIQUIDBEES", "Nippon India ETF Nifty 1D Rate Liquid BeES"), ("SETFNIF50", "SBI Nifty 50 ETF"),
    ("HDFCNIFTY", "HDFC Nifty 50 ETF"), ("ICICIB22", "Bharat 22 ETF"), ("CPSEETF", "CPSE ETF"),
    ("MON100", "Motilal Oswal Nasdaq 100 ETF"), ("MAFANG", "Mirae Asset NYSE FANG+ ETF"),
]


ETF_NAME = re.compile(r"\bETF\b|\bBeES\b|exchange traded|\bETS\b", re.I)


def clean_name(name: str) -> str:
    name = re.sub(r"\s+", " ", name or "").strip()
    return re.sub(r"[\s,]+(limited|ltd\.?)$", "", name, flags=re.I).strip()


def split_ticker(yahoo_symbol: str) -> tuple[str, str | None]:
    """'ZEAL-SM.NS' -> ('ZEAL', 'SM'); 'BAJAJ-AUTO.NS' -> ('BAJAJ-AUTO', None)."""
    base = yahoo_symbol[:-3] if yahoo_symbol.endswith(".NS") else yahoo_symbol
    head, _, tail = base.rpartition("-")
    if head and tail in SME_SUFFIXES | OTHER_SUFFIXES:
        return head, tail
    return base, None


def _screen_all(yf, query) -> list[dict]:
    out, offset = [], 0
    while True:
        res = yf.screen(query, size=250, offset=offset, sortField="intradaymarketcap", sortAsc=False)
        quotes = res.get("quotes", [])
        out += quotes
        offset += len(quotes)
        if not quotes or offset >= (res.get("total") or 0):
            return out
        time.sleep(0.3)


def fetch_universe() -> list[dict]:
    """Rows for market_symbols (without history_days / is_active decisions)."""
    import yfinance as yf

    nse = yf.EquityQuery("eq", ["exchange", "NSI"])
    quotes = _screen_all(yf, nse)
    sector_of: dict[str, str] = {}
    for sector in SECTORS:
        q = yf.EquityQuery("and", [nse, yf.EquityQuery("eq", ["sector", sector])])
        for x in _screen_all(yf, q):
            sector_of[x["symbol"]] = sector

    rows: dict[str, dict] = {}
    ranked = sorted(quotes, key=lambda x: -(x.get("marketCap") or 0))
    main = {split_ticker(x["symbol"])[0] for x in quotes if split_ticker(x["symbol"])[1] is None}
    for rank, x in enumerate(ranked, start=1):
        base, suffix = split_ticker(x["symbol"])
        if suffix in OTHER_SUFFIXES and base in main:
            continue                                   # alternate series of a symbol we already have
        if base in rows:
            continue
        rows[base] = {
            "symbol": base, "exchange": "NSE",
            "name": clean_name(x.get("longName") or x.get("shortName") or base),
            "sector": sector_of.get(x["symbol"]),
            # Yahoo's screener files ETFs as equities; their names say what they are.
            "segment": "sme" if suffix in SME_SUFFIXES else "etf" if ETF_NAME.search(x.get("longName") or x.get("shortName") or "") else "equity",
            "vendor_ticker": None if suffix is None else x["symbol"],
            "mcap_rank": rank if x.get("marketCap") else None,
        }
    for sym, ticker, name in INDICES:
        rows[sym] = {"symbol": sym, "exchange": "NSE", "name": name, "sector": None, "segment": "index",
                     "vendor_ticker": ticker, "mcap_rank": None}
    for sym, name in ETFS:
        rows[sym] = {"symbol": sym, "exchange": "NSE", "name": name, "sector": None, "segment": "etf",
                     "vendor_ticker": None, "mcap_rank": None}
    return list(rows.values())


def merge(fresh: list[dict], existing: list[dict]) -> tuple[list[dict], list[str]]:
    """Upsert rows (existing names/history/notes kept) and the symbols to retire."""
    have = {r["symbol"]: r for r in existing}
    out = []
    for r in fresh:
        old = have.get(r["symbol"])
        row = dict(r, is_active=True, history_days=760 if r["segment"] in ("index", "etf") else 400)
        if old:
            row["name"] = old["name"]
            row["history_days"] = old["history_days"]
            row["sector"] = r["sector"] or old.get("sector")
            if old.get("status_note"):                 # retired on purpose (e.g. demerger): leave it retired
                continue
        out.append(row)
    seen = {r["symbol"] for r in fresh}
    gone = [r["symbol"] for r in existing
            if r["is_active"] and r["segment"] in ("equity", "sme") and r["symbol"] not in seen]
    return out, gone


def retire_allowed(fresh_count: int, active_count: int) -> bool:
    """Only trust 'missing from the screener' when the screener answer looks complete."""
    return fresh_count >= 0.95 * active_count
