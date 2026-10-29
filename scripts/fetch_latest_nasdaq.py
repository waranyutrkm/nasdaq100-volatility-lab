#!/usr/bin/env python3
"""Daily Nasdaq-100 Market Data Fetcher & Indicator Sync.

Downloads updated daily OHLCV bars for all Nasdaq-100 constituents via yfinance,
updates local matrix CSVs, and runs `scan_nasdaq100.py` to produce fresh
volatility snapshot payloads (`data/nasdaq100_volatility_snapshot.json` and `data/snapshot_data.js`).

Designed to run locally or as a scheduled GitHub Action daily after US market close (16:30 EST / 21:30 UTC).
"""

from __future__ import annotations

import sys
from pathlib import Path
import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.scan_nasdaq100 import run_scanner

DATA_DIR = ROOT / "data"


def update_market_data(period: str = "60d") -> None:
    print(f"[*] Fetching latest Nasdaq-100 market data (period={period})...")
    snap_path = DATA_DIR / "local_snapshot_universe.csv"
    if not snap_path.exists():
        raise FileNotFoundError(f"Missing {snap_path}")

    tickers = pd.read_csv(snap_path)["ticker"].dropna().unique().tolist()
    print(f"[*] Universe size: {len(tickers)} tickers")

    # yfinance bulk download
    raw_df = yf.download(
        tickers,
        period=period,
        interval="1d",
        group_by="column",
        auto_adjust=False,
        progress=False,
        threads=True,
    )

    if raw_df.empty:
        print("[!] No new data returned from yfinance. Keeping existing matrices.")
        return

    # Files to update
    matrices = {
        "Close": "close.csv",
        "Open": "open.csv",
        "High": "high.csv",
        "Low": "low.csv",
        "Volume": "volume.csv",
    }

    for price_col, filename in matrices.items():
        file_path = DATA_DIR / filename
        if not file_path.exists():
            continue

        existing_df = pd.read_csv(file_path, index_col=0, parse_dates=True)

        if price_col in raw_df.columns.levels[0]:
            new_sub_df = raw_df[price_col].copy()
            new_sub_df.index = pd.to_datetime(new_sub_df.index).tz_localize(None)

            # Combine and remove duplicate dates
            combined = pd.concat([existing_df, new_sub_df])
            combined = combined[~combined.index.duplicated(keep="last")]
            combined = combined.sort_index()

            # Save back
            combined.to_csv(file_path)
            print(f"[+] Updated {filename}: {len(combined)} rows (latest: {combined.index[-1].date()})")

    print("[*] Market data update complete. Refreshing volatility snapshot...")
    run_scanner()


if __name__ == "__main__":
    period_arg = sys.argv[1] if len(sys.argv) > 1 else "60d"
    update_market_data(period=period_arg)
