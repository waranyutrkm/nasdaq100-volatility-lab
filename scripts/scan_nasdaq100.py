#!/usr/bin/env python3
"""Batch Volatility & Quant Scoring Scanner for 101 Nasdaq-100 Constituents.

Pre-computes all BB-KC spreads, volatility phases, 5-pillar composite scores,
deterministic badges, forward 2SD cones, and macro breadth metrics.
Saves pre-calculated results into data/nasdaq100_volatility_snapshot.json so the web
terminal requires ZERO click-to-scan overhead and loads instantly.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from core.volatility_engine import (
    compute_bb_kc_indicators,
    compute_stock_quant_score,
)

DATA_DIR = ROOT / "data"


def load_universe_meta() -> tuple[list[str], dict[str, dict[str, str]]]:
    """Load active constituents and company meta."""
    snap_path = DATA_DIR / "local_snapshot_universe.csv"
    if not snap_path.exists():
        raise FileNotFoundError(f"Missing {snap_path}")
    tickers = pd.read_csv(snap_path)["ticker"].dropna().unique().tolist()

    meta_path = DATA_DIR / "universe_constituents.csv"
    meta_dict = {}
    if meta_path.exists():
        m_df = pd.read_csv(meta_path)
        for _, r in m_df.iterrows():
            meta_dict[r["ticker"]] = {
                "name": str(r.get("name", f"{r['ticker']} Corporation")),
                "sector": str(r.get("sector", "Technology")),
            }
    return tickers, meta_dict


def run_scanner() -> dict:
    print("[*] Starting Penguin Volatility Scanner for Nasdaq-100...")

    tickers, meta_dict = load_universe_meta()

    # Load matrix files
    close_df = pd.read_csv(DATA_DIR / "close.csv", index_col=0, parse_dates=True)
    open_df = pd.read_csv(DATA_DIR / "open.csv", index_col=0, parse_dates=True)
    high_df = pd.read_csv(DATA_DIR / "high.csv", index_col=0, parse_dates=True)
    low_df = pd.read_csv(DATA_DIR / "low.csv", index_col=0, parse_dates=True)
    vol_df = pd.read_csv(DATA_DIR / "volume.csv", index_col=0, parse_dates=True)

    as_of_date = str(close_df.index[-1].date())
    print(f"[*] Processing dataset up to as-of date: {as_of_date}")

    scanned_stocks = []
    bull_count = 0
    squeeze_count = 0
    expansion_count = 0
    cooling_count = 0

    for ticker in tickers:
        if ticker not in close_df.columns:
            continue

        c_series = close_df[ticker].dropna()
        if len(c_series) < 60:
            continue

        sub_idx = c_series.index
        h_series = high_df[ticker].reindex(sub_idx).ffill()
        l_series = low_df[ticker].reindex(sub_idx).ffill()
        o_series = open_df[ticker].reindex(sub_idx).ffill()
        v_series = vol_df[ticker].reindex(sub_idx).fillna(0.0)

        bars_df = pd.DataFrame({
            "open": o_series,
            "high": h_series,
            "low": l_series,
            "close": c_series,
            "volume": v_series,
        })

        # Calculate indicators
        ind = compute_bb_kc_indicators(
            high=bars_df["high"].to_numpy(),
            low=bars_df["low"].to_numpy(),
            close=bars_df["close"].to_numpy(),
            period=20,
        )

        info = meta_dict.get(ticker, {"name": f"{ticker} Corporation", "sector": "Technology"})

        record = compute_stock_quant_score(
            bars_df=bars_df,
            ind=ind,
            symbol=ticker,
            company_name=info["name"],
            sector=info["sector"],
        )

        scanned_stocks.append(record)

        if record["is_ema_bull"]:
            bull_count += 1
        if record["phase"] == "squeeze":
            squeeze_count += 1
        elif record["phase"] in {"release", "expand"}:
            expansion_count += 1
        else:
            cooling_count += 1

    # Sort by total quant score descending
    scanned_stocks.sort(key=lambda x: (x["total_score"], x["diff"]), reverse=True)
    for rank, item in enumerate(scanned_stocks, start=1):
        item["rank"] = rank

    total_scanned = len(scanned_stocks)
    trend_breadth_pct = round((bull_count / total_scanned) * 100.0, 1) if total_scanned > 0 else 0.0
    squeeze_pct = round((squeeze_count / total_scanned) * 100.0, 1) if total_scanned > 0 else 0.0
    expansion_pct = round((expansion_count / total_scanned) * 100.0, 1) if total_scanned > 0 else 0.0
    cooling_pct = round((cooling_count / total_scanned) * 100.0, 1) if total_scanned > 0 else 0.0

    # Macro breadth regime
    if trend_breadth_pct >= 55.0:
        macro_regime = "[RISK-ON]"
        macro_regime_label = "ตลาดกระทิงแข็งแกร่ง (Trend Breakout Favorable)"
    elif trend_breadth_pct >= 40.0:
        macro_regime = "[NEUTRAL]"
        macro_regime_label = "ตลาดเลือกข้าง คัดเฉพาะเกรด S/A (Selective Setups)"
    else:
        macro_regime = "[RISK-OFF]"
        macro_regime_label = "ตลาดความเสี่ยงสูง ระวัง False Breakout"

    snapshot = {
        "metadata": {
            "title": "Penguin Volatility Lab — Nasdaq-100 Quantitative Terminal",
            "as_of_date": as_of_date,
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "total_constituents": total_scanned,
        },
        "market_breadth": {
            "macro_regime": macro_regime,
            "macro_regime_label": macro_regime_label,
            "trend_breadth_pct": trend_breadth_pct,
            "bull_count": bull_count,
            "bear_count": total_scanned - bull_count,
            "volatility_energy": {
                "squeeze_pct": squeeze_pct,
                "squeeze_count": squeeze_count,
                "expansion_pct": expansion_pct,
                "expansion_count": expansion_count,
                "cooling_pct": cooling_pct,
                "cooling_count": cooling_count,
            },
        },
        "constituents": scanned_stocks,
    }

    out_file = DATA_DIR / "nasdaq100_volatility_snapshot.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)

    js_file = DATA_DIR / "snapshot_data.js"
    with open(js_file, "w", encoding="utf-8") as f:
        f.write("window.NASDAQ100_SNAPSHOT = " + json.dumps(snapshot, indent=2, ensure_ascii=False) + ";\n")

    print(f"[+] Successfully scanned {total_scanned} stocks! Saved to {out_file} and {js_file}")
    print(f"    Macro Regime: {macro_regime} ({trend_breadth_pct}% EMA Bull) | Squeeze: {squeeze_pct}% | Expansion: {expansion_pct}%")
    return snapshot


if __name__ == "__main__":
    run_scanner()
