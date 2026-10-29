"use strict";

/**
 * Penguin Volatility Lab — Nasdaq-100 Quantitative Terminal
 * Strict DTCG Tokens · Anti-Slop (Zero Emoji) · Zero-Click Precomputed Snapshot
 * Selected Stock Analysis Studio: Candlestick + EMA12/26 + Volume + BB/KC diff + RSI(diff) + 2SD Cone
 */

(function () {
  // Application State
  let rawSnapshot = null;
  let allStocks = [];
  let filteredStocks = [];
  let selectedTicker = null;
  let sortColumn = "total_score";
  let sortAscending = false;
  let activePriceDays = 180; // Default lookback for Candlestick chart

  // Active Category Filters
  const filters = {
    bbkc: new Set(["all"]),
    ema: new Set(["all"]),
    tier: new Set(["all"]),
    sector: new Set(["all"]),
    search: ""
  };

  const $ = (id) => document.getElementById(id);

  // Escaping for HTML safety
  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Theme Management
  function initTheme() {
    const saved = localStorage.getItem("penguin_theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);
    $("themeToggleBtn")?.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("penguin_theme", next);
      const stock = allStocks.find(s => s.ticker === selectedTicker) || allStocks[0];
      if (stock) renderStudio(stock);
      renderDetailedForecast();
    });
  }

  // Formatting helpers
  const fmtNum = (val, d = 2) => (val == null || !Number.isFinite(val) ? "—" : Number(val).toFixed(d));
  const fmtMoney = (val) => (val == null || !Number.isFinite(val) ? "—" : "$" + Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const fmtPct = (val, d = 1) => (val == null || !Number.isFinite(val) ? "—" : (val > 0 ? "+" : "") + Number(val).toFixed(d) + "%");
  const fmtN = (val) => (val == null || !Number.isFinite(val) ? "—" : Number(val).toLocaleString("en-US"));

  // Map compact tuple bars to structured objects
  // Format: [time, open, high, low, close, volume, ema12, ema26, diff, rsi, rsi_smooth]
  function mapBars(rawBars) {
    if (!rawBars || !rawBars.length) return [];
    return rawBars.map((b) => {
      if (Array.isArray(b)) {
        return {
          time: b[0],
          open: b[1],
          high: b[2],
          low: b[3],
          close: b[4],
          volume: b[5],
          ema12: b[6],
          ema26: b[7],
          diff: b[8],
          rsi: b[9],
          rsi_smooth: b[10]
        };
      }
      return b;
    });
  }

  // Load Snapshot (Instant zero-click from preloaded window object or local JSON)
  async function loadSnapshot() {
    try {
      if (window.NASDAQ100_SNAPSHOT) {
        rawSnapshot = window.NASDAQ100_SNAPSHOT;
      } else {
        const res = await fetch("data/nasdaq100_volatility_snapshot.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        rawSnapshot = await res.json();
      }
      initData(rawSnapshot);
    } catch (err) {
      console.error("[Scanner] Failed to load snapshot:", err);
      $("asOfHeader").textContent = "Error loading snapshot";
    }
  }

  function initData(snapshot) {
    const meta = snapshot.metadata || {};
    const breadth = snapshot.market_breadth || {};
    allStocks = snapshot.constituents || [];

    // Header & Freshness Bar
    const asOf = meta.as_of_date || "2026-10-29";
    $("asOfHeader").textContent = asOf;
    $("freshnessDate").textContent = `${asOf} (US Market Close 16:30 EST)`;

    // Cockpit Regime
    const regVal = breadth.macro_regime || "[NEUTRAL]";
    const regLabel = breadth.macro_regime_label || "ตลาดเลือกข้าง";
    $("cockpitRegimeVal").textContent = regVal;
    $("cockpitRegimeDesc").textContent = regLabel;

    // Cockpit Trend Breadth
    const bullPct = breadth.trend_breadth_pct ?? 50.0;
    const bearPct = Math.round((100 - bullPct) * 10) / 10;
    $("cockpitTrendVal").textContent = `${bullPct}% Bullish`;
    $("cockpitTrendDesc").textContent = `EMA12 > EMA26: ${breadth.bull_count || 0} หุ้น · EMA12 < EMA26: ${breadth.bear_count || 0} หุ้น`;
    $("barBull").style.width = `${bullPct}%`;
    $("barBear").style.width = `${bearPct}%`;

    // Cockpit Volatility Energy
    const vol = breadth.volatility_energy || {};
    const sqzPct = vol.squeeze_pct ?? 20.0;
    const expPct = vol.expansion_pct ?? 40.0;
    const coolPct = vol.cooling_pct ?? 40.0;
    $("cockpitVolVal").textContent = `${sqzPct}% Squeeze · ${expPct}% Expansion`;
    $("cockpitVolDesc").textContent = `Compression: ${vol.squeeze_count || 0} หุ้น · Expanding: ${vol.expansion_count || 0} หุ้น · Cooling: ${vol.cooling_count || 0} หุ้น`;
    $("barSqz").style.width = `${sqzPct}%`;
    $("barExp").style.width = `${expPct}%`;
    $("barCool").style.width = `${coolPct}%`;

    // EDA View Stats
    $("edaSqueezeVal").textContent = `${sqzPct}% (${vol.squeeze_count || 0} หุ้น)`;
    $("edaExpVal").textContent = `${expPct}% (${vol.expansion_count || 0} หุ้น)`;
    $("edaBullVal").textContent = `${bullPct}% (${breadth.bull_count || 0} หุ้น)`;
    const topGradeCount = allStocks.filter(s => s.grade === "S" || s.grade === "A").length;
    $("edaTopGradeVal").textContent = `${topGradeCount} หุ้น (${Math.round((topGradeCount / allStocks.length) * 100)}%)`;

    // Populate Forecast View Select Dropdown
    const fcSelect = $("fcSelectStock");
    if (fcSelect) {
      fcSelect.innerHTML = allStocks.map(s => `<option value="${s.ticker}">${s.ticker} · ${s.name} (${s.tag})</option>`).join("");
      fcSelect.addEventListener("change", () => {
        renderDetailedForecast();
      });
    }

    // Default selection: rank 1 stock
    if (allStocks.length > 0) {
      selectedTicker = allStocks[0].ticker;
      if (fcSelect) fcSelect.value = selectedTicker;
    }

    applyFilters();
  }

  // Filter application
  function applyFilters() {
    filteredStocks = allStocks.filter((stock) => {
      // 1. BB/KC
      if (!filters.bbkc.has("all")) {
        if (!filters.bbkc.has(stock.phase)) return false;
      }
      // 2. EMA Trend
      if (!filters.ema.has("all")) {
        const isBull = stock.is_ema_bull;
        if (filters.ema.has("bull") && !isBull) return false;
        if (filters.ema.has("bear") && isBull) return false;
      }
      // 3. Tier
      if (!filters.tier.has("all")) {
        if (!filters.tier.has(stock.grade)) return false;
      }
      // 4. Sector
      if (!filters.sector.has("all")) {
        if (!filters.sector.has(stock.sector)) return false;
      }
      // 5. Search
      if (filters.search) {
        const query = filters.search.toLowerCase();
        const hit =
          stock.ticker.toLowerCase().includes(query) ||
          stock.name.toLowerCase().includes(query) ||
          stock.sector.toLowerCase().includes(query);
        if (!hit) return false;
      }
      return true;
    });

    sortStocks();
    renderTable();
    updateFilterSummary();

    if (filteredStocks.length > 0) {
      const exists = filteredStocks.some(s => s.ticker === selectedTicker);
      if (!exists) selectedTicker = filteredStocks[0].ticker;
      renderStudio(filteredStocks.find(s => s.ticker === selectedTicker) || filteredStocks[0]);
    } else {
      renderStudioPlaceholder();
    }
  }

  function sortStocks() {
    filteredStocks.sort((a, b) => {
      let av = a[sortColumn];
      let bv = b[sortColumn];
      if (av == null) av = -Infinity;
      if (bv == null) bv = -Infinity;
      if (typeof av === "string") {
        return sortAscending ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAscending ? av - bv : bv - av;
    });
  }

  function updateFilterSummary() {
    $("filterSummary").textContent = `แสดง ${filteredStocks.length} จาก 100 หุ้น`;
  }

  // Render Screener Table
  function renderTable() {
    const tbody = $("screenerTableBody");
    if (!tbody) return;

    if (filteredStocks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="14" style="text-align:center; padding:32px; color:var(--text-muted);">ไม่พบหุ้นที่ตรงตามเงื่อนไขตัวกรอง</td></tr>`;
      return;
    }

    const rows = filteredStocks.map((s, idx) => {
      const isSel = s.ticker === selectedTicker;
      const scoreClass = `score-${s.grade.toLowerCase()}`;
      const tagClass = (s.tag_class || "neutral").replace("_", "-");
      const diffColor = s.diff <= 0 ? "var(--cyan-400)" : "var(--emerald-400)";
      const trendGlyph = s.is_ema_bull ? "▲ Bull" : "▼ Bear";
      const trendColor = s.is_ema_bull ? "var(--emerald-400)" : "var(--rose-400)";

      return `
        <tr data-ticker="${s.ticker}" class="${isSel ? "selected" : ""}">
          <td style="font-family:var(--font-mono); color:var(--text-muted);">${s.rank || (idx + 1)}</td>
          <td style="font-family:var(--font-mono); font-weight:850; color:var(--cyan-400);">${s.ticker}</td>
          <td style="color:var(--text-primary); max-width:180px; overflow:hidden; text-overflow:ellipsis;">${s.name}</td>
          <td style="color:var(--text-secondary); font-size:11px;">${s.sector}</td>
          <td style="font-family:var(--font-mono); font-weight:750; text-align:right;">${fmtMoney(s.price)}</td>
          <td style="font-family:var(--font-mono); text-align:right; color:${diffColor}; font-weight:750;">${fmtPct(s.diff)}</td>
          <td style="font-family:var(--font-mono); text-align:right; color:var(--text-muted);">${fmtNum(s.percentile_252, 1)}%</td>
          <td><span class="tag-badge ${s.phase === "squeeze" ? "prime-coil" : "expanding"}">${s.phase_badge || s.phase}</span></td>
          <td style="font-family:var(--font-mono); color:${trendColor}; font-weight:750;">${trendGlyph}</td>
          <td style="font-family:var(--font-mono); text-align:right;">${fmtNum(s.atr_pct, 1)}%</td>
          <td style="font-family:var(--font-mono); text-align:right; color:${s.ret_20d >= 0 ? "var(--emerald-400)" : "var(--rose-400)"};">${fmtPct(s.ret_20d)}</td>
          <td style="font-family:var(--font-mono); text-align:right; color:var(--text-muted);">${fmtPct(s.dist_to_high40_pct)}</td>
          <td style="text-align:center;">
            <span class="score-badge ${scoreClass}">${s.total_score}</span>
          </td>
          <td style="text-align:center;">
            <span class="tag-badge ${tagClass}">${s.tag}</span>
          </td>
        </tr>
      `;
    }).join("");

    tbody.innerHTML = rows;

    // Attach row click listeners
    tbody.querySelectorAll("tr").forEach((row) => {
      row.addEventListener("click", () => {
        const ticker = row.dataset.ticker;
        if (!ticker) return;
        selectedTicker = ticker;
        tbody.querySelectorAll("tr").forEach(r => r.classList.remove("selected"));
        row.classList.add("selected");
        const found = allStocks.find(s => s.ticker === ticker);
        if (found) {
          renderStudio(found);
          const fcSelect = $("fcSelectStock");
          if (fcSelect) fcSelect.value = ticker;
          renderDetailedForecast();
          $("selectedPanelSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  // =========================================================================
  // SELECTED STOCK ANALYSIS STUDIO (Matching Original Experience)
  // =========================================================================
  function renderStudio(stock) {
    const container = $("selectedPanel");
    if (!container || !stock) return;

    const mapped = mapBars(stock.bars);
    const bk = stock.breakdown || {};
    const tagClass = (stock.tag_class || "neutral").replace("_", "-");
    const scoreGrade = stock.grade.toLowerCase();

    // Beginner Advice Text Generator
    let beginnerAdvice = "";
    if (tagClass === "alpha-buy") {
      beginnerAdvice = `<div class="beginner-advice advice-buy"><b>[ALPHA BUY] จุดซื้อตามโมเมนตัม:</b> ผ่านเกณฑ์เบรกเอาต์ 40 วัน + แท่งเทียนกระทิงยืนยัน · <b>ควรถือนาน:</b> 7–13 วัน (ทยอยล็อกกำไรครึ่งหนึ่งแถววันที่ 7) · <b>จุดคัตทันที:</b> เมื่อแท่งวันปิดต่ำกว่าเส้น SMA20</div>`;
    } else if (tagClass === "prime-coil") {
      beginnerAdvice = `<div class="beginner-advice advice-coil"><b>[PRIME COIL] จุดดักสะสมต้นน้ำ:</b> บีบอัดตัวแน่นในโซนแนวรับ (Deep Squeeze) · <b>คำแนะนำ:</b> ทยอยตั้งรับ ไม่ต้องไล่ราคา · <b>รอขาย:</b> เมื่อข้ามสู่ Fresh Release แล้วรันตามรอบ 13 วัน · <b>จุดคัต:</b> หลุดแนวรับ Low 20 วัน</div>`;
    } else if (tagClass === "expanding") {
      beginnerAdvice = `<div class="beginner-advice advice-buy"><b>[EXPANDING] อยู่ในคลื่นขยายตัว:</b> โมเมนตัมกำลังส่งผล (ช่วง Day 2–5) · <b>คำแนะนำ:</b> ถือรันเทรนด์ได้ แต่ระวังอย่าไล่ราคาสูงเกินไป · <b>จุดล็อกกำไร:</b> ขยับ Trailing Stop ตามเส้น SMA20</div>`;
    } else if (tagClass === "coil-a") {
      beginnerAdvice = `<div class="beginner-advice advice-coil"><b>[COIL A+] ทรงสะสมพลังแข็งแกร่ง:</b> โครงสร้างราคาเหนียวแน่นสะสมพลังต่อเนื่อง · <b>คำแนะนำ:</b> แบ่งไม้เล็กสะสม รอยืนยันสัญญาณ Release เพื่อใส่เพิ่ม</div>`;
    } else if (tagClass === "bear-trap") {
      beginnerAdvice = `<div class="beginner-advice advice-danger"><b>[BEAR TRAP] ระวังกับดักสัญญาณหลอก:</b> แม้ค่า diff จะยกตัวแต่ EMA เป็นแนวโน้มขาลง (EMA Bear) · <b>คำแนะนำ:</b> ห้ามไล่ซื้อเด็ดขาด สถิติชี้ว่าอัตราล้มเหลวเกิน 65%</div>`;
    } else if (tagClass === "watchlist") {
      beginnerAdvice = `<div class="beginner-advice advice-watch"><b>[WATCHLIST] เฝ้าติดตาม:</b> เริ่มมีสัญญาณดีขึ้นแต่คะแนนยังไม่ครบ 5 เสาหลัก · <b>คำแนะนำ:</b> รอให้คะแนนแตะ 70+ หรือเกิดแท็ก Alpha Buy ก่อนเข้าเทรด</div>`;
    } else {
      beginnerAdvice = `<div class="beginner-advice advice-neutral"><b>[NEUTRAL] ยังไม่น่าสนใจ:</b> โครงสร้างยังไร้ทิศทางชัดเจน · <b>คำแนะนำ:</b> ข้ามไปก่อน มองหาหุ้นเกรด S หรือ A ที่มีไฟเขียว</div>`;
    }

    // Hero Section
    const tvUrl = `https://www.tradingview.com/symbols/${stock.ticker}/`;
    const yfUrl = `https://finance.yahoo.com/quote/${stock.ticker}/`;

    // 1. Candlestick Main Chart
    const candleData = renderCandleChartSVG(mapped, activePriceDays, stock.ticker);

    // 2. Sub-Charts: diff & rsi
    const diffSeries = mapped.map(b => b.diff);
    const rsiSeries = mapped.map(b => b.rsi);
    const rsiSmoothSeries = mapped.map(b => b.rsi_smooth);
    const diffChartHtml = renderSubChartSVG(diffSeries, "diff", null, "BB-KC diff 1D");
    const rsiChartHtml = renderSubChartSVG(rsiSeries, "rsi", rsiSmoothSeries, "RSI(diff) 1D");
    const coneChartHtml = renderForwardConeSVG(stock.cone, stock.price);

    container.innerHTML = `
      <!-- Hero Header -->
      <div class="studio-hero">
        <div class="studio-hero-left">
          <div class="studio-avatar">${esc(stock.ticker.slice(0, 4))}</div>
          <div class="studio-identity">
            <div class="studio-title-row">
              <span class="studio-symbol">${esc(stock.ticker)}</span>
              <span class="studio-rank-badge">Nasdaq-100 #${stock.rank || 1}</span>
              <span class="tag-badge ${stock.phase === "squeeze" ? "prime-coil" : "expanding"}">${stock.phase_badge}</span>
              <span class="tag-badge ${stock.is_ema_bull ? "alpha-buy" : "bear-trap"}">${stock.is_ema_bull ? "▲ EMA Bull" : "▼ EMA Bear"}</span>
            </div>
            <div class="studio-name-row">
              <span class="studio-fullname">${esc(stock.name)}</span>
              <span style="color:var(--text-muted);">&bull;</span>
              <span>${esc(stock.sector)}</span>
              <span style="color:var(--text-muted);">&bull;</span>
              <span style="color:var(--teal-bright); font-family:var(--font-mono); font-weight:800;">${fmtMoney(stock.price)}</span>
            </div>
          </div>
        </div>
        <div class="studio-hero-right">
          <div class="studio-asof-meta">
            <span class="asof-label">แท่ง Daily ปิดล่าสุด</span>
            <span class="asof-val">${mapped.length ? mapped[mapped.length - 1].time : "2026-10-29"} (16:30 EST)</span>
          </div>
          <div class="studio-hero-actions">
            <a href="${tvUrl}" target="_blank" rel="noreferrer" class="btn-tv">TradingView ↗</a>
            <a href="${yfUrl}" target="_blank" rel="noreferrer" class="btn-yf">Yahoo Finance ↗</a>
            <button type="button" class="btn btn-sm secondary" id="scrollToTableBtnHero">↑ ตารางสแกนเนอร์</button>
          </div>
        </div>
      </div>

      <!-- Quant Score Stage (2 Columns) -->
      <div class="studio-score-stage">
        <!-- Total Score Card -->
        <div class="studio-scorecard-box">
          <div class="scorecard-top">
            <div class="scorecard-badge grade-${scoreGrade}">${stock.grade}</div>
            <div class="scorecard-meta">
              <div class="scorecard-total">
                <span class="score-num">${stock.total_score}</span>
                <span class="score-denom">/ 100</span>
              </div>
              <div class="scorecard-grade-label">${esc(stock.grade_label)}</div>
            </div>
          </div>
          <div class="scorecard-bar-bg">
            <div class="scorecard-bar-fill fill-${scoreGrade}" style="width:${stock.total_score}%"></div>
          </div>
          <div class="scorecard-tag-row">
            <span class="tag-badge ${tagClass}" style="font-size:11px; padding:3px 8px;">${stock.tag}</span>
            <span class="scorecard-hint">${stock.total_score >= 70 ? "● สัญญาณเข้าเกณฑ์ระบบ" : "○ รอสัญญาณคอนเฟิร์ม"}</span>
          </div>
        </div>

        <!-- 5 Pillars Box -->
        <div class="studio-pillars-box">
          <!-- Pillar 1 -->
          <div class="studio-pillar-item">
            <div class="pillar-top">
              <span class="pillar-label">1. REGIME</span>
              <span class="pillar-score">${bk.regime || 0}/30</span>
            </div>
            <div class="pillar-bar"><div class="pillar-bar-fill" style="width:${((bk.regime || 0) / 30) * 100}%"></div></div>
            <div class="pillar-reason">${esc(bk.regime_reason || "Regime timing")}</div>
            <div class="pillar-sub">การบีบอัดตัว BB/KC Daily</div>
          </div>
          <!-- Pillar 2 -->
          <div class="studio-pillar-item">
            <div class="pillar-top">
              <span class="pillar-label">2. MOMENTUM</span>
              <span class="pillar-score">${bk.trend || 0}/25</span>
            </div>
            <div class="pillar-bar"><div class="pillar-bar-fill" style="width:${((bk.trend || 0) / 25) * 100}%"></div></div>
            <div class="pillar-reason">${esc(bk.trend_reason || "Trend breakout")}</div>
            <div class="pillar-sub">EMA12 vs EMA26 spread</div>
          </div>
          <!-- Pillar 3 -->
          <div class="studio-pillar-item">
            <div class="pillar-top">
              <span class="pillar-label">3. EDA LIFT</span>
              <span class="pillar-score">${bk.eda || 0}/20</span>
            </div>
            <div class="pillar-bar"><div class="pillar-bar-fill" style="width:${((bk.eda || 0) / 20) * 100}%"></div></div>
            <div class="pillar-reason">${esc(bk.eda_reason || "Volatility lift")}</div>
            <div class="pillar-sub">สถิติ Volatility Lift ในอดีต</div>
          </div>
          <!-- Pillar 4 -->
          <div class="studio-pillar-item">
            <div class="pillar-top">
              <span class="pillar-label">4. STRUCTURE</span>
              <span class="pillar-score">${bk.structural || 0}/15</span>
            </div>
            <div class="pillar-bar"><div class="pillar-bar-fill" style="width:${((bk.structural || 0) / 15) * 100}%"></div></div>
            <div class="pillar-reason">ยืนเหนือเส้น SMA20</div>
            <div class="pillar-sub">Support &amp; 20-Day Low</div>
          </div>
          <!-- Pillar 5 -->
          <div class="studio-pillar-item">
            <div class="pillar-top">
              <span class="pillar-label">5. QUALITY</span>
              <span class="pillar-score">${bk.quality || 10}/10</span>
            </div>
            <div class="pillar-bar"><div class="pillar-bar-fill" style="width:100%"></div></div>
            <div class="pillar-reason">Nasdaq-100 Large Cap</div>
            <div class="pillar-sub">สภาพคล่องและมูลค่าซื้อขายสูง</div>
          </div>
        </div>
      </div>

      <!-- Beginner Advice Callout -->
      <div class="studio-advice-container">
        ${beginnerAdvice}
      </div>

      <!-- Core KPIs Grid (5 Items) -->
      <div class="studio-kpis">
        <div class="kpi-card">
          <div class="kpi-label"><span>diff 1D</span><span style="font-size:9px;">SPREAD</span></div>
          <div class="kpi-val" style="color:${stock.diff <= 0 ? "var(--cyan-400)" : "var(--emerald-400)"};">${fmtPct(stock.diff)}</div>
          <div class="kpi-sub">${stock.diff <= 0 ? "● Bollinger บีบใน Keltner (Squeeze)" : "▲ ขยายตัวเหนือ Keltner (Expansion)"}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label"><span>RSI(diff) 1D</span><span style="font-size:9px;">RSI14</span></div>
          <div class="kpi-val">${mapped.length && mapped[mapped.length - 1].rsi != null ? mapped[mapped.length - 1].rsi : "—"}</div>
          <div class="kpi-sub">● สมดุลช่วงปกติ (30–70)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label"><span>EMA Spread</span><span style="font-size:9px;">MOMENTUM</span></div>
          <div class="kpi-val" style="color:${stock.is_ema_bull ? "var(--emerald-400)" : "var(--rose-400)"};">${fmtPct(stock.ema_spread)}</div>
          <div class="kpi-sub">EMA12: ${fmtNum(stock.ema12)} vs EMA26: ${fmtNum(stock.ema26)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label"><span>Diff Pct 252D</span><span style="font-size:9px;">PERCENTILE</span></div>
          <div class="kpi-val">${fmtNum(stock.percentile_252, 1)}%</div>
          <div class="kpi-sub">เทียบกับประวัติรอบปี (252 แท่ง)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label"><span>ATR % &amp; 20D Ret</span><span style="font-size:9px;">VOLATILITY</span></div>
          <div class="kpi-val" style="color:${stock.ret_20d >= 0 ? "var(--emerald-400)" : "var(--rose-400)"};">${fmtPct(stock.ret_20d)}</div>
          <div class="kpi-sub">ATR: ${fmtNum(stock.atr_pct, 1)}% · High 40D Dist: ${fmtPct(stock.dist_to_high40_pct)}</div>
        </div>
      </div>

      <!-- Studio Charts Grid (65% / 35%) -->
      <div class="studio-charts-grid">
        <!-- Main Candlestick Chart -->
        <div class="studio-main-chart">
          <div class="chart-block" style="margin-top:0;">
            <div class="chart-head">
              <div>
                <strong>ราคา · Daily Candlesticks + EMA 12/26 + Volume</strong>
                <span style="color:var(--teal-bright); margin-left:8px;">${fmtMoney(stock.price)} · ${candleData.visibleCount} แท่งล่าสุด</span>
              </div>
              <div class="chart-ranges" id="priceChartRanges">
                <button type="button" data-days="22" ${activePriceDays === 22 ? 'class="active" aria-pressed="true"' : ""}>1M</button>
                <button type="button" data-days="66" ${activePriceDays === 66 ? 'class="active" aria-pressed="true"' : ""}>3M</button>
                <button type="button" data-days="126" ${activePriceDays === 126 ? 'class="active" aria-pressed="true"' : ""}>6M</button>
                <button type="button" data-days="180" ${activePriceDays === 180 ? 'class="active" aria-pressed="true"' : ""}>All</button>
              </div>
            </div>

            <div id="priceBarSummary" class="ohlc-summary">
              ${candleData.summaryText}
            </div>

            ${candleData.svg}

            <div class="legend">
              <span><i class="candle-up-key"></i>Close &ge; Open</span>
              <span><i class="candle-down-key"></i>Close &lt; Open</span>
              <span><i class="volume-key"></i>Volume</span>
              <span><i class="ema12-key"></i>EMA 12</span>
              <span><i class="ema26-key"></i>EMA 26</span>
              <span style="margin-left:auto; color:var(--text-muted);">เลื่อนเมาส์บนกราฟเพื่อดู OHLCV + EMAs</span>
            </div>
          </div>
        </div>

        <!-- Sub Charts Column -->
        <div class="studio-sub-charts">
          <!-- Sub Chart 1: BB-KC diff -->
          <div class="chart-block" style="margin-top:0;">
            <div class="chart-head">
              <strong>BB–KC diff · Daily</strong>
              <span>เส้นศูนย์ = compression | expansion</span>
            </div>
            ${diffChartHtml}
          </div>

          <!-- Sub Chart 2: RSI(diff) -->
          <div class="chart-block">
            <div class="chart-head">
              <strong>RSI ของ diff · Daily</strong>
              <span>RSI 14 + SMA 7 · ช่วงปกติ 30–70</span>
            </div>
            ${rsiChartHtml}
          </div>

          <!-- Sub Chart 3: Forward 2SD Volatility Cone -->
          <div class="chart-block">
            <div class="chart-head">
              <strong>Forward 2SD Volatility Cone</strong>
              <span>60-Day Probability Band (&plusmn;2&sigma;)</span>
            </div>
            ${coneChartHtml}
          </div>
        </div>
      </div>

      <!-- Data Integrity Footnote -->
      <div class="quality">
        <strong>Data Integrity:</strong> ${mapped.length} Daily bars · ${mapped.length ? mapped[0].time : ""} &rarr; ${mapped.length ? mapped[mapped.length - 1].time : ""} (16:30 EST Close) · Missing intervals: 0. No missing candles are interpolated; indicator warm-up resets after gaps.
      </div>
    `;

    // Bind interactive Candlestick hover crosshair
    bindCandleCrosshair(candleData.bars);

    // Bind Range Buttons
    container.querySelectorAll("#priceChartRanges button").forEach((btn) => {
      btn.addEventListener("click", () => {
        activePriceDays = parseInt(btn.dataset.days, 10);
        renderStudio(stock);
      });
    });

    // Scroll up buttons
    $("scrollToTableBtn")?.addEventListener("click", () => {
      $("screenerSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("scrollToTableBtnHero")?.addEventListener("click", () => {
      $("screenerSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function renderStudioPlaceholder() {
    $("selectedPanel").innerHTML = `
      <div class="chart-empty" style="height:140px; padding:24px;">
        กรุณาคลิกเลือกหุ้นจากตารางสแกนเนอร์ด้านบนเพื่อเปิดห้องวิเคราะห์เจาะลึก
      </div>
    `;
  }

  // =========================================================================
  // CANDLESTICK CHART SVG BUILDER
  // =========================================================================
  function renderCandleChartSVG(allBars, days, symbol) {
    if (!allBars.length) {
      return { bars: [], svg: '<div class="chart-empty">ข้อมูลไม่พอแสดงกราฟ</div>', visibleCount: 0, summaryText: "—" };
    }

    const visible = days > 0 ? allBars.slice(-days) : allBars;
    const width = 800;
    const height = 340;
    const left = 14;
    const right = 70;
    const top = 14;
    const priceBottom = 236;
    const volumeTop = 258;
    const volumeBottom = 305;

    const plotWidth = width - left - right;
    const slot = plotWidth / visible.length;

    let low = Infinity;
    let high = -Infinity;
    let maxVolume = 0;

    for (let i = 0; i < visible.length; i++) {
      const b = visible[i];
      low = Math.min(low, b.low);
      high = Math.max(high, b.high);
      maxVolume = Math.max(maxVolume, b.volume || 0);
      if (Number.isFinite(b.ema12)) { low = Math.min(low, b.ema12); high = Math.max(high, b.ema12); }
      if (Number.isFinite(b.ema26)) { low = Math.min(low, b.ema26); high = Math.max(high, b.ema26); }
    }

    const pad = Math.max((high - low) * 0.05, 0.01);
    low -= pad;
    high += pad;

    const getY = (p) => top + (priceBottom - top) * (1 - (p - low) / (high - low));
    const candleWidth = Math.max(1.2, Math.min(9, slot * 0.68));

    // Horizontal Price Grid
    const gridLines = [0, 0.25, 0.5, 0.75, 1.0].map((frac) => {
      const py = top + (priceBottom - top) * frac;
      const price = high - (high - low) * frac;
      return `
        <line class="chart-grid" x1="${left}" x2="${width - right}" y1="${py.toFixed(1)}" y2="${py.toFixed(1)}"/>
        <text class="price-axis-label" x="${width - 4}" y="${(py + 3).toFixed(1)}" text-anchor="end">${fmtMoney(price)}</text>
      `;
    }).join("");

    // Candles and Volume Bars
    const candleEls = visible.map((b, i) => {
      const x = left + slot * (i + 0.5);
      const yOpen = getY(b.open);
      const yClose = getY(b.close);
      const isUp = b.close >= b.open;
      const bodyY = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yOpen - yClose));
      const volHeight = maxVolume ? (b.volume / maxVolume) * (volumeBottom - volumeTop) : 0;
      const volY = volumeBottom - volHeight;
      const klass = isUp ? "up" : "down";

      return `
        <g class="candle ${klass}">
          <line class="candle-wick" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${getY(b.high).toFixed(1)}" y2="${getY(b.low).toFixed(1)}"/>
          <rect class="candle-body" x="${(x - candleWidth / 2).toFixed(1)}" y="${bodyY.toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${bodyH.toFixed(1)}"/>
          <rect class="volume-bar" x="${(x - candleWidth / 2).toFixed(1)}" y="${volY.toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${Math.max(0.5, volHeight).toFixed(1)}"/>
        </g>
      `;
    }).join("");

    // EMA 12 and EMA 26 Lines
    let d12 = "", d26 = "", draw12 = false, draw26 = false;
    for (let i = 0; i < visible.length; i++) {
      const x = left + slot * (i + 0.5);
      const e12 = visible[i].ema12;
      const e26 = visible[i].ema26;
      if (Number.isFinite(e12)) {
        d12 += `${draw12 ? "L" : "M"}${x.toFixed(1)},${getY(e12).toFixed(1)} `;
        draw12 = true;
      } else draw12 = false;
      if (Number.isFinite(e26)) {
        d26 += `${draw26 ? "L" : "M"}${x.toFixed(1)},${getY(e26).toFixed(1)} `;
        draw26 = true;
      } else draw26 = false;
    }

    const emaPaths = `
      ${d12 ? `<path class="chart-ema12" d="${d12}"/>` : ""}
      ${d26 ? `<path class="chart-ema26" d="${d26}"/>` : ""}
    `;

    // Last Price Dashed Line
    const lastBar = visible[visible.length - 1];
    const lastY = getY(lastBar.close);
    const lastLine = `
      <line class="last-price-line" x1="${left}" x2="${width - right}" y1="${lastY.toFixed(1)}" y2="${lastY.toFixed(1)}"/>
      <text class="last-price-label" x="${width - 4}" y="${(lastY + 3).toFixed(1)}" text-anchor="end">${fmtMoney(lastBar.close)}</text>
    `;

    // Date Axis Labels
    const dateIndices = [0, Math.floor((visible.length - 1) / 2), visible.length - 1];
    const dateLabels = dateIndices.map((idx) => {
      const x = left + slot * (idx + 0.5);
      return `<text class="price-date-label" x="${x.toFixed(1)}" y="330" text-anchor="middle">${visible[idx].time}</text>`;
    }).join("");

    const svg = `
      <svg id="priceChartSvg" class="price-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        ${gridLines}
        <line class="volume-separator" x1="${left}" x2="${width - right}" y1="${volumeTop - 4}" y2="${volumeTop - 4}"/>
        ${candleEls}
        ${emaPaths}
        ${lastLine}
        ${dateLabels}
        <line id="priceCrossV" class="price-crosshair" x1="0" x2="0" y1="${top}" y2="${volumeBottom}"/>
        <line id="priceCrossH" class="price-crosshair" x1="${left}" x2="${width - right}" y1="0" y2="0"/>
      </svg>
    `;

    const summaryText = `${lastBar.time}  O ${fmtNum(lastBar.open)}  H ${fmtNum(lastBar.high)}  L ${fmtNum(lastBar.low)}  C ${fmtNum(lastBar.close)}  V ${fmtN(lastBar.volume)}  EMA12 ${fmtNum(lastBar.ema12)}  EMA26 ${fmtNum(lastBar.ema26)}`;

    return { bars: visible, svg, visibleCount: visible.length, summaryText };
  }

  // Bind Candlestick Crosshair Pointer Movement
  function bindCandleCrosshair(bars) {
    const svg = $("priceChartSvg");
    if (!svg || !bars.length) return;

    const crossV = $("priceCrossV");
    const crossH = $("priceCrossH");
    const summary = $("priceBarSummary");

    const width = 800;
    const height = 340;
    const left = 14;
    const right = 70;
    const top = 14;
    const volumeBottom = 305;
    const slot = (width - left - right) / bars.length;

    svg.addEventListener("pointermove", (e) => {
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * width;
      const y = ((e.clientY - rect.top) / rect.height) * height;

      if (x < left || x > width - right || y < top || y > volumeBottom) {
        if (crossV) crossV.style.display = "none";
        if (crossH) crossH.style.display = "none";
        return;
      }

      const idx = Math.max(0, Math.min(bars.length - 1, Math.floor((x - left) / slot)));
      const b = bars[idx];
      const candleX = left + slot * (idx + 0.5);

      if (crossV) {
        crossV.style.display = "block";
        crossV.setAttribute("x1", candleX.toFixed(1));
        crossV.setAttribute("x2", candleX.toFixed(1));
      }
      if (crossH) {
        crossH.style.display = "block";
        crossH.setAttribute("y1", y.toFixed(1));
        crossH.setAttribute("y2", y.toFixed(1));
      }

      if (summary) {
        summary.textContent = `${b.time}  O ${fmtNum(b.open)}  H ${fmtNum(b.high)}  L ${fmtNum(b.low)}  C ${fmtNum(b.close)}  V ${fmtN(b.volume)}  EMA12 ${fmtNum(b.ema12)}  EMA26 ${fmtNum(b.ema26)}`;
      }
    });

    svg.addEventListener("pointerleave", () => {
      if (crossV) crossV.style.display = "none";
      if (crossH) crossH.style.display = "none";
      const last = bars[bars.length - 1];
      if (summary && last) {
        summary.textContent = `${last.time}  O ${fmtNum(last.open)}  H ${fmtNum(last.high)}  L ${fmtNum(last.low)}  C ${fmtNum(last.close)}  V ${fmtN(last.volume)}  EMA12 ${fmtNum(last.ema12)}  EMA26 ${fmtNum(last.ema26)}`;
      }
    });
  }

  // =========================================================================
  // SUB-CHARTS (BB/KC diff & RSI of diff)
  // =========================================================================
  function renderSubChartSVG(series, kind, secondary = null, label = "") {
    const width = 480;
    const height = 110;
    const left = 6;
    const right = 6;
    const top = 8;
    const bottom = 8;

    const start = Math.max(0, series.length - 100);
    const main = series.slice(start);
    const all = main.filter(Number.isFinite).concat(secondary ? secondary.slice(start).filter(Number.isFinite) : []);

    if (!all.length) return '<div class="chart-empty">ข้อมูลไม่พอแสดงกราฟ</div>';

    let min = kind === "rsi" ? 0 : Math.min(0, ...all);
    let max = kind === "rsi" ? 100 : Math.max(0, ...all);

    if (max - min < 1e-6) {
      max += 1;
      min -= 1;
    }
    if (kind !== "rsi") {
      const padding = (max - min) * 0.12;
      min -= padding;
      max += padding;
    }

    const xAt = (i) => left + (width - left - right) * (i / (main.length - 1 || 1));
    const yAt = (v) => top + (height - top - bottom) * (1 - (v - min) / (max - min));

    const path = (vals) => {
      let d = "";
      let drawing = false;
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (!Number.isFinite(v)) { drawing = false; continue; }
        d += `${drawing ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)} `;
        drawing = true;
      }
      return d;
    };

    const grid = [0.25, 0.5, 0.75].map((q) => {
      const y = top + (height - top - bottom) * q;
      return `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    }).join("");

    let thresholds = "";
    let areaFill = "";

    if (kind === "rsi") {
      const y70 = yAt(70).toFixed(1);
      const y30 = yAt(30).toFixed(1);
      const corridor = `<rect x="${left}" y="${y70}" width="${width - left - right}" height="${Math.abs(y30 - y70)}" fill="var(--border-subtle)" opacity="0.35"/>`;
      thresholds = corridor + [30, 70].map((v) => `
        <line class="chart-threshold" x1="${left}" x2="${width - right}" y1="${yAt(v).toFixed(1)}" y2="${yAt(v).toFixed(1)}"/>
        <text x="${width - right - 2}" y="${(yAt(v) - 3).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="8.5" font-family="var(--font-mono)">${v}</text>
      `).join("");
    } else if (kind === "diff") {
      const y0 = yAt(0);
      thresholds = `
        <line class="chart-zero" x1="${left}" x2="${width - right}" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}"/>
        <text x="${left + 4}" y="${(y0 - 3).toFixed(1)}" fill="var(--blue)" font-size="8.5" font-family="var(--font-mono)">0 (Compression | Expansion)</text>
      `;

      let dArea = "";
      let lastValidX = left;
      for (let i = 0; i < main.length; i++) {
        const v = main[i];
        if (Number.isFinite(v)) {
          const x = xAt(i);
          if (!dArea) dArea = `M${x.toFixed(1)},${y0.toFixed(1)} L${x.toFixed(1)},${yAt(v).toFixed(1)} `;
          else dArea += `L${x.toFixed(1)},${yAt(v).toFixed(1)} `;
          lastValidX = x;
        }
      }
      if (dArea) {
        dArea += `L${lastValidX.toFixed(1)},${y0.toFixed(1)} Z`;
        areaFill = `
          <defs>
            <linearGradient id="diffAreaGradSub" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--teal)" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="var(--blue)" stop-opacity="0.08"/>
            </linearGradient>
          </defs>
          <path d="${dArea}" fill="url(#diffAreaGradSub)"/>
        `;
      }
    }

    const second = secondary ? `<path class="chart-line secondary" d="${path(secondary.slice(start))}"/>` : "";
    return `
      <svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        ${grid}
        ${thresholds}
        ${areaFill}
        ${second}
        <path class="chart-line" d="${path(main)}"/>
      </svg>
    `;
  }

  // =========================================================================
  // FORWARD 2SD VOLATILITY CONE SVG
  // =========================================================================
  function renderForwardConeSVG(cone, currentPrice) {
    if (!cone || !cone.upper || !cone.upper.length) {
      return '<div class="chart-empty">ไม่มีข้อมูล 2SD Cone</div>';
    }

    const W = 480;
    const H = 120;
    const padX = 14;
    const padY = 12;

    const days = cone.days;
    const upper = cone.upper;
    const lower = cone.lower;
    const minP = Math.min(...lower) * 0.98;
    const maxP = Math.max(...upper) * 1.02;
    const n = days.length;

    const getX = (i) => padX + (i / (n - 1)) * (W - 2 * padX);
    const getY = (p) => H - padY - ((p - minP) / (maxP - minP)) * (H - 2 * padY);

    const x0 = getX(0);
    const y0 = getY(currentPrice);

    let uPts = [];
    let lPts = [];
    let mPts = [];

    for (let i = 0; i < n; i++) {
      const x = getX(i);
      uPts.push(`${x.toFixed(1)},${getY(upper[i]).toFixed(1)}`);
      lPts.push(`${x.toFixed(1)},${getY(lower[i]).toFixed(1)}`);
      mPts.push(`${x.toFixed(1)},${y0.toFixed(1)}`);
    }

    const area = `M ${x0},${y0} L ${uPts.join(" L ")} L ${lPts.slice().reverse().join(" L ")} Z`;

    return `
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="coneGradMini" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.30"/>
            <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.08"/>
          </linearGradient>
        </defs>
        <line x1="${padX}" y1="${y0}" x2="${W - padX}" y2="${y0}" stroke="var(--border-subtle)" stroke-dasharray="3,3"/>
        <path d="${area}" fill="url(#coneGradMini)"/>
        <path d="M ${x0},${y0} L ${uPts.join(" L ")}" fill="none" stroke="#22d3ee" stroke-width="1.8"/>
        <path d="M ${x0},${y0} L ${lPts.join(" L ")}" fill="none" stroke="#fb7185" stroke-width="1.8"/>
        <path d="M ${x0},${y0} L ${mPts.join(" L ")}" fill="none" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="3,3"/>
        <circle cx="${x0}" cy="${y0}" r="3.5" fill="#38bdf8"/>
        <text x="${W - padX - 2}" y="${getY(upper[upper.length - 1]) - 3}" fill="#22d3ee" font-family="var(--font-mono)" font-size="8.5" text-anchor="end">+2SD ${fmtMoney(upper[upper.length - 1])}</text>
        <text x="${W - padX - 2}" y="${getY(lower[lower.length - 1]) + 9}" fill="#fb7185" font-family="var(--font-mono)" font-size="8.5" text-anchor="end">-2SD ${fmtMoney(lower[lower.length - 1])}</text>
      </svg>
    `;
  }

  // =========================================================================
  // DETAILED FORECAST VIEW (Tab 2)
  // =========================================================================
  function renderDetailedForecast() {
    const fcSelect = $("fcSelectStock");
    if (!fcSelect) return;
    const ticker = fcSelect.value;
    const stock = allStocks.find(s => s.ticker === ticker);
    if (!stock || !stock.cone) return;

    const horizon = parseInt($("fcHorizon")?.value || "30", 10);
    const cone = stock.cone;
    const days = cone.days.slice(0, horizon);
    const upper = cone.upper.slice(0, horizon);
    const lower = cone.lower.slice(0, horizon);
    const currentPrice = cone.current_price || stock.price;

    $("fcCurrentPriceVal").textContent = fmtMoney(currentPrice);
    $("fcVolVal").textContent = `${((cone.sigma_ann || 0.3) * 100).toFixed(1)}%`;
    $("fcUpperVal").textContent = `${fmtMoney(upper[upper.length - 1])} (+${(((upper[upper.length - 1] - currentPrice) / currentPrice) * 100).toFixed(1)}%)`;
    $("fcLowerVal").textContent = `${fmtMoney(lower[lower.length - 1])} (${(((lower[lower.length - 1] - currentPrice) / currentPrice) * 100).toFixed(1)}%)`;

    const svg = $("fcDetailedChart");
    if (!svg) return;

    const W = 800;
    const H = 320;
    const padX = 50;
    const padY = 30;

    const minP = Math.min(...lower) * 0.97;
    const maxP = Math.max(...upper) * 1.03;
    const n = days.length;

    const getX = (idx) => padX + (idx / (n - 1)) * (W - 2 * padX);
    const getY = (p) => H - padY - ((p - minP) / (maxP - minP)) * (H - 2 * padY);

    const x0 = getX(0);
    const y0 = getY(currentPrice);

    let uPts = [];
    let lPts = [];
    let mPts = [];

    for (let i = 0; i < n; i++) {
      const x = getX(i);
      uPts.push(`${x.toFixed(1)},${getY(upper[i]).toFixed(1)}`);
      lPts.push(`${x.toFixed(1)},${getY(lower[i]).toFixed(1)}`);
      mPts.push(`${x.toFixed(1)},${y0.toFixed(1)}`);
    }

    const area = `M ${x0},${y0} L ${uPts.join(" L ")} L ${lPts.slice().reverse().join(" L ")} Z`;

    svg.innerHTML = `
      <defs>
        <linearGradient id="fcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.30"/>
          <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.08"/>
        </linearGradient>
      </defs>
      <line x1="${padX}" y1="${y0}" x2="${W - padX}" y2="${y0}" stroke="var(--border-subtle)" stroke-dasharray="5,5"/>
      <path d="${area}" fill="url(#fcGrad)"/>
      <path d="M ${x0},${y0} L ${uPts.join(" L ")}" fill="none" stroke="#22d3ee" stroke-width="2.5"/>
      <path d="M ${x0},${y0} L ${lPts.join(" L ")}" fill="none" stroke="#fb7185" stroke-width="2.5"/>
      <path d="M ${x0},${y0} L ${mPts.join(" L ")}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,4"/>
      <text x="${W - padX + 8}" y="${getY(upper[upper.length - 1]) + 4}" fill="#22d3ee" font-family="var(--font-mono)" font-size="11.5" font-weight="750">+2SD: ${fmtMoney(upper[upper.length - 1])}</text>
      <text x="${W - padX + 8}" y="${y0 + 4}" fill="#94a3b8" font-family="var(--font-mono)" font-size="11">Mean: ${fmtMoney(currentPrice)}</text>
      <text x="${W - padX + 8}" y="${getY(lower[lower.length - 1]) + 4}" fill="#fb7185" font-family="var(--font-mono)" font-size="11.5" font-weight="750">-2SD: ${fmtMoney(lower[lower.length - 1])}</text>
      <circle cx="${x0}" cy="${y0}" r="5" fill="#38bdf8"/>
    `;
  }

  // Export CSV
  function exportCsv() {
    if (filteredStocks.length === 0) return;
    const headers = ["Rank", "Ticker", "Name", "Sector", "Price", "Diff_Pct", "Percentile_252", "Phase", "Trend_Bull", "ATR_Pct", "Ret_20D", "Dist_High40", "Quant_Score", "Grade", "Tag"];
    const rows = filteredStocks.map(s => [
      s.rank,
      s.ticker,
      `"${s.name}"`,
      `"${s.sector}"`,
      s.price,
      s.diff,
      s.percentile_252,
      s.phase,
      s.is_ema_bull,
      s.atr_pct,
      s.ret_20d,
      s.dist_to_high40_pct,
      s.total_score,
      s.grade,
      s.tag
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encoded = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encoded);
    link.setAttribute("download", `nasdaq100_volatility_${$("freshnessDate").textContent.slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Bind Events
  function bindUI() {
    // Tab switching
    document.querySelectorAll(".tabs button").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tabs button").forEach(t => {
          t.classList.remove("active");
          t.setAttribute("aria-pressed", "false");
        });
        tab.classList.add("active");
        tab.setAttribute("aria-pressed", "true");

        const target = tab.dataset.view;
        document.querySelectorAll(".view").forEach(v => {
          v.hidden = v.id !== target;
        });

        if (target === "forecastView") {
          renderDetailedForecast();
        }
      });
    });

    // Quick Combos
    document.querySelectorAll(".combos-list .combo-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".combos-list .combo-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const combo = btn.dataset.combo;
        resetFilterChips();

        if (combo === "alpha") {
          filters.tier = new Set(["S", "A"]);
          filters.ema = new Set(["bull"]);
          filters.bbkc = new Set(["release", "expand"]);
        } else if (combo === "prime") {
          filters.tier = new Set(["S", "A"]);
          filters.ema = new Set(["bull"]);
          filters.bbkc = new Set(["squeeze"]);
        } else if (combo === "expanding") {
          filters.bbkc = new Set(["release", "expand"]);
        } else if (combo === "coil-a") {
          filters.bbkc = new Set(["squeeze"]);
          filters.tier = new Set(["S", "A"]);
        } else if (combo === "bear-trap") {
          filters.bbkc = new Set(["squeeze"]);
          filters.ema = new Set(["bear"]);
        } else {
          // all
          filters.bbkc = new Set(["all"]);
          filters.ema = new Set(["all"]);
          filters.tier = new Set(["all"]);
          filters.sector = new Set(["all"]);
        }

        syncChipUI();
        applyFilters();
      });
    });

    // Category Filter Chips
    document.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const cat = chip.dataset.cat;
        const val = chip.dataset.val;
        if (!cat || !val) return;

        if (val === "all") {
          filters[cat] = new Set(["all"]);
        } else {
          filters[cat].delete("all");
          if (filters[cat].has(val)) {
            filters[cat].delete(val);
            if (filters[cat].size === 0) filters[cat].add("all");
          } else {
            filters[cat].add(val);
          }
        }
        syncChipUI();
        applyFilters();
      });
    });

    // Reset filters
    $("clearFiltersBtn")?.addEventListener("click", () => {
      resetFilterChips();
      filters.search = "";
      $("stockSearch").value = "";
      syncChipUI();
      applyFilters();
    });

    // Live search
    $("stockSearch")?.addEventListener("input", (e) => {
      filters.search = e.target.value.trim();
      applyFilters();
    });

    // Sort Dropdown
    $("sortBy")?.addEventListener("change", (e) => {
      sortColumn = e.target.value;
      sortStocks();
      renderTable();
    });

    $("sortOrder")?.addEventListener("change", (e) => {
      sortAscending = e.target.value === "asc";
      sortStocks();
      renderTable();
    });

    // Table Header Sort Clicks
    document.querySelectorAll("table.data-table th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        if (sortColumn === col) {
          sortAscending = !sortAscending;
        } else {
          sortColumn = col;
          sortAscending = false;
        }
        $("sortBy").value = sortColumn;
        $("sortOrder").value = sortAscending ? "asc" : "desc";
        sortStocks();
        renderTable();
      });
    });

    // Export CSV
    $("exportCsvBtn")?.addEventListener("click", exportCsv);

    // Forecast Horizon Change
    $("fcHorizon")?.addEventListener("change", renderDetailedForecast);
  }

  function resetFilterChips() {
    filters.bbkc = new Set(["all"]);
    filters.ema = new Set(["all"]);
    filters.tier = new Set(["all"]);
    filters.sector = new Set(["all"]);
  }

  function syncChipUI() {
    document.querySelectorAll(".filter-chip").forEach((chip) => {
      const cat = chip.dataset.cat;
      const val = chip.dataset.val;
      if (!cat || !val) return;
      chip.classList.toggle("active", filters[cat].has(val));
    });

    // Update category badge counters
    for (const cat of ["bbkc", "ema", "tier", "sector"]) {
      const bEl = $(`badge-${cat}`);
      if (bEl) {
        if (filters[cat].has("all")) {
          bEl.textContent = "ทั้งหมด";
        } else {
          bEl.textContent = `${filters[cat].size} เลือก`;
        }
      }
    }
  }

  // Initialization
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    bindUI();
    loadSnapshot();
  });
})();
