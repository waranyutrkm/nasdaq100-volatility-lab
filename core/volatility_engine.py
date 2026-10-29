"""Penguin Volatility Lab Indicator & Quant Scoring Engine for Nasdaq-100.

Faithful implementation of the Penguin Volatility Lab quantitative architecture:
1. BB vs KC spread dynamics (diff = (UpperBB - UpperKC) / UpperKC * 100).
2. Volatility Phase Classification: Squeeze, Fresh Release, Expansion, Cooling.
3. 5-Pillar Quant Composite Score (0–100):
   - Volatility Regime & Lifespan Timing (30 pts)
   - Trend Confluence & Macro Breakout (25 pts)
   - Statistical Volatility Lift (20 pts)
   - Structural S/R & Moving Average Health (15 pts)
   - Market Quality & Data Depth (10 pts)
4. Deterministic Signal Badges: [ALPHA BUY], [PRIME COIL], [EXPANDING], [COIL A+], [WATCHLIST], [BEAR TRAP].
5. 2SD Forward Volatility Cone (+- 2sigma * sqrt(t/252)).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

ANNUAL_SESSIONS = 252


def rma(values: np.ndarray, length: int) -> np.ndarray:
    """Wilder's Running Moving Average (RMA)."""
    n = len(values)
    out = np.full(n, np.nan, dtype=float)
    if n < length:
        return out

    # Seed with SMA of the first `length` valid elements
    seed = values[:length]
    if np.isnan(seed).any():
        return out

    out[length - 1] = np.mean(seed)
    for i in range(length, n):
        if np.isnan(values[i]):
            out[i] = out[i - 1]
        else:
            out[i] = (out[i - 1] * (length - 1) + values[i]) / length
    return out


def compute_forward_cone(
    current_price: float,
    sigma_ann: float,
    mu_ann: float = 0.0,
    horizon_days: int = 60,
) -> dict[str, Any]:
    """Compute forward Log-Normal Diffusion 2SD cone for given horizon."""
    cone_days = list(range(1, horizon_days + 1))
    cone_upper = []
    cone_expected = []
    cone_lower = []

    for t in cone_days:
        t_years = t / float(ANNUAL_SESSIONS)
        u_val = current_price * math.exp((mu_ann - 0.5 * sigma_ann * sigma_ann) * t_years + 2.0 * sigma_ann * math.sqrt(t_years))
        exp_val = current_price * math.exp(mu_ann * t_years)
        l_val = current_price * math.exp((mu_ann - 0.5 * sigma_ann * sigma_ann) * t_years - 2.0 * sigma_ann * math.sqrt(t_years))
        cone_upper.append(round(u_val, 2))
        cone_expected.append(round(exp_val, 2))
        cone_lower.append(round(l_val, 2))

    return {
        "days": cone_days,
        "upper": cone_upper,
        "expected": cone_expected,
        "lower": cone_lower,
        "current_price": round(current_price, 2),
        "sigma_ann": round(sigma_ann, 4),
    }


def compute_bb_kc_indicators(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    period: int = 20,
) -> dict[str, np.ndarray]:
    """Compute Bollinger Bands, Keltner Channels, spread diff, and RSI of diff."""
    n = len(close)

    # True Range
    tr = np.zeros(n, dtype=float)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))

    atr = rma(tr, period)

    # SMA20 and SD20 for Bollinger Bands
    close_series = pd.Series(close)
    basis = close_series.rolling(period, min_periods=period).mean().to_numpy()
    sd = close_series.rolling(period, min_periods=period).std(ddof=0).to_numpy()

    # EMA12 and EMA26
    ema12 = close_series.ewm(span=12, adjust=False, min_periods=12).mean().to_numpy()
    ema26 = close_series.ewm(span=26, adjust=False, min_periods=26).mean().to_numpy()

    # Upper/Lower Bands
    upper_bb = basis + 2.0 * sd
    lower_bb = basis - 2.0 * sd
    upper_kc = basis + 2.0 * atr
    lower_kc = basis - 2.0 * atr

    # Diff (% spread between BB and KC)
    diff = np.full(n, np.nan, dtype=float)
    valid_kc = (upper_kc != 0) & np.isfinite(upper_kc)
    diff[valid_kc] = (upper_bb[valid_kc] - upper_kc[valid_kc]) / upper_kc[valid_kc] * 100.0

    # ATR %
    atr_pct = np.full(n, np.nan, dtype=float)
    valid_c = (close != 0) & np.isfinite(close)
    atr_pct[valid_c] = atr[valid_c] / close[valid_c] * 100.0

    # RSI of diff (14 period)
    diff_change = np.diff(diff, prepend=np.nan)
    gains = np.where(diff_change > 0, diff_change, 0.0)
    losses = np.where(diff_change < 0, -diff_change, 0.0)

    avg_gain = rma(gains, 14)
    avg_loss = rma(losses, 14)

    rsi = np.full(n, np.nan, dtype=float)
    for i in range(n):
        if np.isfinite(avg_gain[i]) and np.isfinite(avg_loss[i]):
            if avg_loss[i] == 0:
                rsi[i] = 100.0
            elif avg_gain[i] == 0:
                rsi[i] = 0.0
            else:
                rsi[i] = 100.0 - 100.0 / (1.0 + avg_gain[i] / avg_loss[i])

    rsi_smooth = pd.Series(rsi).rolling(7, min_periods=7).mean().to_numpy()

    # Rolling 252-day percentile of diff
    percentile = np.full(n, np.nan, dtype=float)
    for i in range(period, n):
        from_idx = max(0, i - 251)
        sub = diff[from_idx : i + 1]
        valid_sub = sub[np.isfinite(sub)]
        if len(valid_sub) >= 40:
            below = np.sum(valid_sub <= diff[i])
            percentile[i] = below / len(valid_sub)

    return {
        "basis": basis,
        "upper_bb": upper_bb,
        "lower_bb": lower_bb,
        "upper_kc": upper_kc,
        "lower_kc": lower_kc,
        "diff": diff,
        "atr": atr,
        "atr_pct": atr_pct,
        "rsi": rsi,
        "rsi_smooth": rsi_smooth,
        "percentile": percentile,
        "ema12": ema12,
        "ema26": ema26,
    }


def classify_phase(diff_curr: float, diff_prev: float | None) -> dict[str, str]:
    """Classify volatility phase into squeeze, release, expand, or cool."""
    if np.isnan(diff_curr):
        return {"key": "na", "label": "รอข้อมูล", "badge": "[NO_DATA]"}
    if diff_curr <= 0:
        return {"key": "squeeze", "label": "บีบตัว (Compression)", "badge": "[SQUEEZE]"}
    if diff_prev is not None and diff_prev <= 0:
        return {"key": "release", "label": "เพิ่งข้ามศูนย์ (Fresh Release)", "badge": "[RELEASE]"}
    if diff_prev is not None and diff_curr > diff_prev:
        return {"key": "expand", "label": "ขยายตัวต่อ (Expansion)", "badge": "[EXPANDING]"}
    return {"key": "cool", "label": "เริ่มชะลอตัว (Cooling)", "badge": "[COOLING]"}


def compute_stock_quant_score(
    bars_df: pd.DataFrame,
    ind: dict[str, np.ndarray],
    symbol: str,
    company_name: str,
    sector: str,
) -> dict[str, Any]:
    """Calculate the 5-Pillar Quant Composite Score (0–100) and deterministic signal badges."""
    n = len(bars_df)
    i = n - 1

    close_arr = bars_df["close"].to_numpy()
    high_arr = bars_df["high"].to_numpy()
    low_arr = bars_df["low"].to_numpy()

    diff = ind["diff"]
    cur_diff = float(diff[i])
    prev_diff = float(diff[i - 1]) if i > 0 else None
    percentile = float(ind["percentile"][i]) if np.isfinite(ind["percentile"][i]) else None
    rsi = float(ind["rsi"][i]) if np.isfinite(ind["rsi"][i]) else None
    rsi_smooth = float(ind["rsi_smooth"][i]) if np.isfinite(ind["rsi_smooth"][i]) else None
    ema12 = float(ind["ema12"][i])
    ema26 = float(ind["ema26"][i])
    atr_pct = float(ind["atr_pct"][i]) if np.isfinite(ind["atr_pct"][i]) else 2.5
    close_price = float(close_arr[i])

    # Count expansion / squeeze age
    expansion_age = 0
    if cur_diff > 0:
        for k in range(i, -1, -1):
            if diff[k] > 0:
                expansion_age += 1
            else:
                break

    squeeze_age = 0
    if cur_diff <= 0:
        for k in range(i, -1, -1):
            if diff[k] <= 0:
                squeeze_age += 1
            else:
                break

    breakdown = {}
    score = 0.0

    # Pillar 1: Volatility Regime & Lifespan Timing (Max 30 pts)
    regime_pts = 0
    if cur_diff > 0 and prev_diff is not None and prev_diff <= 0:
        regime_pts = 30
        breakdown["regime_reason"] = "[FRESH RELEASE] D1 — จุดเริ่มต้นของการระเบิดความผันผวน"
    elif cur_diff > 0 and expansion_age <= 5 and prev_diff is not None and cur_diff > prev_diff:
        regime_pts = 26 if (rsi is not None and rsi_smooth is not None and rsi > rsi_smooth) else 22
        breakdown["regime_reason"] = f"[EXPANDING] ต้นรอบขยายตัว (D{expansion_age}) + โมเมนตัมเร่ง"
    elif cur_diff <= 0 and percentile is not None and percentile <= 0.20:
        regime_pts = 25
        breakdown["regime_reason"] = f"[DEEP SQUEEZE] บีบตัวลึกรอบปี ({int(percentile*100)}%) — สะสมพลัง {squeeze_age} วัน"
    elif cur_diff > 0 and expansion_age <= 12:
        regime_pts = 16
        breakdown["regime_reason"] = f"[MID EXPANSION] กลางรอบขยายตัว (D{expansion_age})"
    elif cur_diff <= 0:
        regime_pts = 12
        breakdown["regime_reason"] = f"[SQUEEZE] บีบตัวสะสมพลัง {squeeze_age} วัน"
    elif cur_diff > 0 and expansion_age > 12:
        regime_pts = 8
        breakdown["regime_reason"] = f"[EXTENDED] ขยายตัวนานเกิน 12 วัน ระวังแผ่วตัว"
    else:
        regime_pts = 5
        breakdown["regime_reason"] = "[COOLING] แผ่วตัว / ชะลอความผันผวน"

    breakdown["regime"] = regime_pts
    score += regime_pts

    # Pillar 2: Trend Confluence & Macro Breakout (Max 25 pts)
    trend_pts = 0
    is_ema_bull = ema12 > ema26
    ema_spread = ((ema12 / ema26) - 1.0) * 100.0 if ema26 > 0 else 0.0

    if is_ema_bull:
        trend_pts += 10
        if ema_spread >= 2.0:
            trend_pts += 4
        elif ema_spread >= 0.5:
            trend_pts += 2

    # Breakouts beyond 40-Day and 20-Day Highs
    lookback40 = max(0, i - 40)
    lookback20 = max(0, i - 20)
    high40 = np.max(high_arr[lookback40:i]) if i > lookback40 else high_arr[i]
    high20 = np.max(high_arr[lookback20:i]) if i > lookback20 else high_arr[i]

    if close_price > high40 and high40 > 0:
        trend_pts += 11
        breakdown["trend_reason"] = "[BREAKOUT 40D] ทะลุ New High 40 วัน"
    elif high40 > 0 and close_price >= high40 * 0.98:
        trend_pts += 8
        breakdown["trend_reason"] = "[NEAR BREAKOUT] จ่อเบรก High 40 วัน (<2%)"
    elif close_price > high20 and high20 > 0:
        trend_pts += 5
        breakdown["trend_reason"] = "[BREAKOUT 20D] ทะลุ High 20 วัน"
    elif is_ema_bull:
        trend_pts += 2
        breakdown["trend_reason"] = f"[EMA BULL] Spread +{ema_spread:.1f}%"
    else:
        breakdown["trend_reason"] = f"[EMA BEAR] Spread {ema_spread:.1f}% (ระวัง False Break)"

    breakdown["trend"] = trend_pts
    score += trend_pts

    # Pillar 3: Statistical Volatility Lift & Edge (Max 20 pts)
    # Measured by recent volatility momentum and realized expansion
    eda_pts = 0
    daily_ret = pd.Series(close_arr).pct_change().dropna()
    recent_vol = daily_ret.iloc[-20:].std() * np.sqrt(ANNUAL_SESSIONS) if len(daily_ret) >= 20 else 0.25
    annual_vol = daily_ret.iloc[-252:].std() * np.sqrt(ANNUAL_SESSIONS) if len(daily_ret) >= 60 else recent_vol

    vol_lift = (recent_vol / annual_vol - 1.0) if annual_vol > 0 else 0.0
    if vol_lift >= 0.25:
        eda_pts += 14
    elif vol_lift >= 0.10:
        eda_pts += 10
    elif vol_lift >= 0.0:
        eda_pts += 6
    else:
        eda_pts += 3

    # Trend consistency
    if len(daily_ret) >= 20:
        pos_ratio = (daily_ret.iloc[-20:] > 0).mean()
        if pos_ratio >= 0.60:
            eda_pts += 6
        elif pos_ratio >= 0.50:
            eda_pts += 4
        else:
            eda_pts += 2

    breakdown["eda"] = eda_pts
    breakdown["eda_reason"] = f"Vol Expansion {vol_lift*100:+.1f}% · Volatility {recent_vol*100:.1f}%"
    score += eda_pts

    # Pillar 4: Structural S/R & Moving Average Health (Max 15 pts)
    struct_pts = 0
    sma20 = float(np.mean(close_arr[max(0, i - 19) : i + 1]))
    if close_price > sma20:
        struct_pts += 5

    low20 = np.min(low_arr[lookback20:i]) if i > lookback20 else low_arr[i]
    if low20 > 0 and (close_price - low20) / low20 >= 0.05:
        struct_pts += 5

    above_count = sum(close_arr[k] >= sma20 for k in range(max(0, i - 4), i + 1))
    if above_count >= 4:
        struct_pts += 5
    elif above_count >= 2:
        struct_pts += 2

    breakdown["structural"] = struct_pts
    score += struct_pts

    # Pillar 5: Market Quality & Liquidity (Max 10 pts)
    quality_pts = 0
    if n >= 252:
        quality_pts += 5
    elif n >= 120:
        quality_pts += 3
    else:
        quality_pts += 1

    # Volume check
    avg_vol = float(bars_df["volume"].iloc[-20:].mean()) if "volume" in bars_df else 1_000_000
    if avg_vol > 500_000:
        quality_pts += 5
    else:
        quality_pts += 3

    breakdown["quality"] = quality_pts
    score += quality_pts

    total_score = int(min(100, max(0, round(score))))

    # Grade & Badges
    if total_score >= 85:
        grade = "S"
        grade_label = "S (Prime Setup)"
        if cur_diff > 0 and (close_price > high40 or close_price >= high40 * 0.98):
            tag = "[ALPHA BUY]"
            tag_class = "alpha-buy"
            playbook = "จังหวะเข้าซื้อที่ดีที่สุด (Release + 40D Breakout) ถือตามรันเวย์ขยายตัวเฉลี่ย 13 วัน"
        else:
            tag = "[PRIME COIL]"
            tag_class = "prime-coil"
            playbook = "บีบตัวลึกสะสมพลังอย่างมากใกล้ SMA20 รอจังหวะระเบิดความผันผวน"
    elif total_score >= 70:
        grade = "A"
        grade_label = "A (High Quality)"
        if cur_diff > 0:
            tag = "[EXPANDING]"
            tag_class = "expanding"
            playbook = "อยู่ในรอบขยายตัวของความผันผวน ปล่อยให้กำไรวิ่งตามเทรนด์"
        else:
            tag = "[COIL A+]"
            tag_class = "coil-a"
            playbook = "บีบตัวในแนวโน้มขาขึ้น (Bullish Squeeze) วางแผนเข้าก่อนการ Breakout"
    elif total_score >= 55:
        grade = "B"
        grade_label = "B (Watchlist)"
        tag = "[WATCHLIST]"
        tag_class = "watchlist"
        playbook = "สัญญาณกำลังก่อตัว รอการยืนยันของแท่งเทียนและเทรนด์"
    else:
        grade = "C"
        grade_label = "C (Neutral / Avoid)"
        if not is_ema_bull and cur_diff > 0:
            tag = "[BEAR TRAP]"
            tag_class = "bear-trap"
            playbook = "ระวังกับดักขาลง ความผันผวนพุ่งใต้แนวโน้มขาลง (EMA Bear)"
        else:
            tag = "[NEUTRAL]"
            tag_class = "neutral"
            playbook = "ไม่มีสัญญาณเด่นชัด ไม่แนะนำให้เปิดสถานะ"

    # Forward 2SD Volatility Cone (Next 30 Sessions)
    ret_20d = float((close_price / close_arr[max(0, i - 20)] - 1.0) * 100.0)
    mu = float(daily_ret.iloc[-63:].mean() * ANNUAL_SESSIONS) if len(daily_ret) >= 63 else 0.10
    sigma = float(recent_vol) if recent_vol > 0.05 else 0.25

    cone_res = compute_forward_cone(close_price, sigma_ann=sigma, mu_ann=mu, horizon_days=60)

    phase_info = classify_phase(cur_diff, prev_diff)

    # Extract last 180 daily bars for Candlestick & Sub-chart visualization (Compact tuple format)
    # Format: [time, open, high, low, close, volume, ema12, ema26, diff, rsi, rsi_smooth]
    lookback_bars = min(180, n)
    recent_bars = []
    for idx_b in range(n - lookback_bars, n):
        t_str = str(bars_df.index[idx_b].date())
        recent_bars.append([
            t_str,
            round(float(bars_df["open"].iloc[idx_b]), 2),
            round(float(bars_df["high"].iloc[idx_b]), 2),
            round(float(bars_df["low"].iloc[idx_b]), 2),
            round(float(bars_df["close"].iloc[idx_b]), 2),
            int(bars_df["volume"].iloc[idx_b]),
            round(float(ind["ema12"][idx_b]), 2) if np.isfinite(ind["ema12"][idx_b]) else None,
            round(float(ind["ema26"][idx_b]), 2) if np.isfinite(ind["ema26"][idx_b]) else None,
            round(float(ind["diff"][idx_b]), 2) if np.isfinite(ind["diff"][idx_b]) else None,
            round(float(ind["rsi"][idx_b]), 1) if np.isfinite(ind["rsi"][idx_b]) else None,
            round(float(ind["rsi_smooth"][idx_b]), 1) if np.isfinite(ind["rsi_smooth"][idx_b]) else None,
        ])

    return {
        "ticker": symbol,
        "name": company_name,
        "sector": sector,
        "price": round(close_price, 2),
        "diff": round(cur_diff, 2) if np.isfinite(cur_diff) else 0.0,
        "diff_prev": round(prev_diff, 2) if prev_diff is not None and np.isfinite(prev_diff) else 0.0,
        "percentile_252": round(percentile * 100, 1) if percentile is not None else None,
        "phase": phase_info["key"],
        "phase_label": phase_info["label"],
        "phase_badge": phase_info["badge"],
        "expansion_age": expansion_age,
        "squeeze_age": squeeze_age,
        "ema12": round(ema12, 2),
        "ema26": round(ema26, 2),
        "ema_spread": round(ema_spread, 2),
        "is_ema_bull": is_ema_bull,
        "atr_pct": round(atr_pct, 2),
        "ret_20d": round(ret_20d, 2),
        "dist_to_high40_pct": round(((close_price / high40) - 1.0) * 100.0, 2) if high40 > 0 else 0.0,
        "total_score": total_score,
        "grade": grade,
        "grade_label": grade_label,
        "tag": tag,
        "tag_class": tag_class,
        "breakdown": breakdown,
        "playbook": playbook,
        "cone": cone_res,
        "bars": recent_bars,
    }
