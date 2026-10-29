# Penguin Volatility Lab · Nasdaq-100 Quantitative Terminal

Institutional-grade volatility compression & expansion scanner for the **Nasdaq-100** universe (100 constituents). Adapts the exact TradingView Pine Script-compatible BB–KC spread mathematics from `penguin-volatility-lab`, powered by a zero-click precomputed batch engine and daily automated GitHub Actions sync.

Live Terminal: **[https://waranyutrkm.github.io/nasdaq100-volatility-lab/](https://waranyutrkm.github.io/nasdaq100-volatility-lab/)**

---

## 1. Mathematical Architecture & Pine Script Compatibility

### A. Bollinger Bands vs. Keltner Channels Spread
Volatility compression and expansion are calculated via the percentage difference between the upper Bollinger Band (20, 2.0 SD) and the upper Keltner Channel (20, 2.0 ATR via RMA):

$$\text{diff}_t = \frac{\text{UpperBB}_t - \text{UpperKC}_t}{\text{UpperKC}_t} \times 100$$

Where:
- $\text{UpperBB}_t = \text{SMA}_{20}(\text{Close}) + 2.0 \times \sigma_{20}(\text{Close})$
- $\text{UpperKC}_t = \text{SMA}_{20}(\text{Close}) + 2.0 \times \text{ATR}_{20}(\text{RMA})$
- $\text{ATR}$ uses Running Moving Average (RMA / Wilder's Smoothing) with $\alpha = 1 / 20$, strictly matching TradingView Pine Script standards.

### B. Volatility Regimes
- **Squeeze (Compression):** $\text{diff}_t \le 0$ (Bollinger Bands sit entirely inside Keltner Channels).
- **Fresh Release:** $\text{diff}_{t-1} \le 0 \land \text{diff}_t > 0$ (The first expansion bar crossing zero).
- **Active Expansion:** $\text{diff}_t > 0 \land \text{diff}_t > \text{diff}_{t-1}$ (Volatility bands actively widening).
- **Cooling:** $\text{diff}_t > 0 \land \text{RSI}_{14}(\text{diff}) < \text{SMA}_7(\text{RSI}_{14}(\text{diff}))$ (Momentum of volatility begins decelerating).

### C. 5-Pillar Quantitative Composite Score (0–100)
Every constituent is graded deterministically across 5 quantitative dimensions:
1. **Volatility Regime & Lifespan Timing (30 pts):** Highest score awarded to Fresh Releases or Deep Squeezes ($\text{Percentile}_{252} \le 20\%$) with adequate compression duration.
2. **Trend Confluence & Macro Breakout (25 pts):** Trend momentum confluence ($\text{EMA}_{12} > \text{EMA}_{26}$) and proximity to 40-day high ($< 2\%$ distance).
3. **Statistical Volatility Lift & EDA (20 pts):** Historical forward performance lift after compression releases.
4. **Structural Support & SMA20 (15 pts):** Price sustained above $\text{SMA}_{20}$ base.
5. **Market Quality & Institutional Liquidity (10 pts):** Top-tier liquidity and transaction quality in the Nasdaq-100.

### D. Forward 2SD Volatility Cone
Projected 60-day price dispersion boundaries using the standard Log-Normal Diffusion Model (Brownian Motion) calibrated to US Equities (252 trading sessions per year):

$$\text{Upper / Lower}(t) = S_0 \times \exp\left(\pm 2 \cdot \sigma_{\text{ann}} \sqrt{\frac{t}{252}}\right)$$

Covering a $95.4\%$ statistical confidence interval forward path.

---

## 2. Zero-Click Automated Architecture

Unlike manual scanners that require client-side API polling or sequential fetch loops:
1. **Precomputed Snapshot:** The Python pipeline (`scripts/scan_nasdaq100.py`) precomputes all indicators, scores, 2SD forward cones, and macro breadth metrics into `data/nasdaq100_volatility_snapshot.json` and `data/snapshot_data.js`.
2. **Instant Web Render:** Opening the terminal renders all 100 constituents and the Deep-Dive Studio immediately with zero latency.
3. **Automated Market Sync:** A scheduled GitHub Actions workflow (`daily_sync.yml`) runs Mon–Fri at 21:30 UTC (16:30 EST), 30 minutes after US market close:
   - Fetches updated OHLCV bars via `scripts/fetch_latest_nasdaq.py`.
   - Recomputes all volatility metrics and 5-pillar scores.
   - Commits updated data and deploys automatically to GitHub Pages.

---

## 3. Repository Structure

```
nasdaq100-volatility-lab/
├── .github/
│   └── workflows/
│       └── daily_sync.yml         # Daily 16:30 EST GitHub Actions automation
├── core/
│   └── volatility_engine.py      # Pine-compatible BB-KC, RMA, Quant scoring & 2SD cones
├── data/
│   ├── close.csv                 # Adjusted daily closing prices
│   ├── high.csv                  # Daily highs
│   ├── low.csv                   # Daily lows
│   ├── open.csv                  # Daily opens
│   ├── volume.csv                # Daily volumes
│   ├── local_snapshot_universe.csv # Nasdaq-100 ticker list (101 constituents)
│   ├── nasdaq100_volatility_snapshot.json # Precomputed JSON payload
│   └── snapshot_data.js          # Direct window preloader script
├── scripts/
│   ├── fetch_latest_nasdaq.py    # Downloads latest US equity data & triggers scanner
│   └── scan_nasdaq100.py         # Batch scoring & indicator generation
├── tests/
│   └── test_engine.py            # Unit tests for volatility calculations
├── AGENTS.md                     # UX/UI mandate & Anti-Slop doctrine
├── DESIGN.md                     # Obsidian Quant Terminal DTCG tokens
├── index.html                    # Institutional terminal web UI
├── app.js                        # Client-side reactivity, SVG cone renderer & filters
├── research.js                   # Client-side research & event study engine
├── requirements.txt              # Python dependencies
└── README.md
```

---

## 4. Local Development & Manual Execution

### Prerequisites
- Python 3.10+
- Dependencies: `pip install -r requirements.txt`

### Update Market Data & Re-run Scanner
```bash
# Fetch latest 15-day bars from Yahoo Finance and regenerate snapshot
python3 scripts/fetch_latest_nasdaq.py 15d

# Or recompute snapshot from existing local price matrices
python3 scripts/scan_nasdaq100.py
```

### Launch Web Terminal
Open `index.html` directly in any web browser, or serve with a local server:
```bash
python3 -m http.server 8000
# Open http://localhost:8000 in your browser
```

---

## 5. Design Standards & Compliance

- **Design Tokens:** Strict adherence to `DESIGN.md` (Obsidian Quant Terminal 3-tier DTCG tokens).
- **Anti-Slop Doctrine:** Zero casual emojis in the interface. Status indicators use semantic badges (`[ALPHA BUY]`, `[PRIME COIL]`, `[COIL A+]`, `[EXPANDING]`, `[WATCHLIST]`, `[BEAR TRAP]`) and geometric glyphs (`▲`, `▼`, `●`).
- **Tabular Numerics:** All prices, scores, and percentages enforce `tabular-nums` alignment.
- **Accessibility:** WCAG 2.2 AA compliant with minimum 4.5:1 text contrast and zero horizontal viewport overflow down to 320px.

---

## License

MIT License. Copyright (c) 2026 waranyutrkm.
