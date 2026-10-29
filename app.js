"use strict";

/**
 * Penguin Volatility Lab — Nasdaq-100 Quantitative Terminal
 * Strict DTCG Tokens · Anti-Slop (Zero Emoji) · Zero-Click Precomputed Snapshot
 */

(function () {
  // Application State
  let rawSnapshot = null;
  let allStocks = [];
  let filteredStocks = [];
  let selectedTicker = null;
  let sortColumn = "total_score";
  let sortAscending = false;

  // Active Category Filters (Sets allow multi-select)
  const filters = {
    bbkc: new Set(["all"]),
    ema: new Set(["all"]),
    tier: new Set(["all"]),
    sector: new Set(["all"]),
    search: ""
  };

  // Helper DOM selector
  const $ = (id) => document.getElementById(id);

  // Theme Management
  function initTheme() {
    const saved = localStorage.getItem("penguin_theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);
    $("themeToggleBtn")?.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("penguin_theme", next);
      renderConeChart();
      renderDetailedForecast();
    });
  }

  // Formatting helpers
  const fmtNum = (val, d = 2) => (val == null || !Number.isFinite(val) ? "—" : Number(val).toFixed(d));
  const fmtMoney = (val) => (val == null || !Number.isFinite(val) ? "—" : "$" + Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const fmtPct = (val, d = 1) => (val == null || !Number.isFinite(val) ? "—" : (val > 0 ? "+" : "") + Number(val).toFixed(d) + "%");

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

    // Sort
    sortStocks();
    renderTable();
    updateFilterSummary();

    // If current selectedTicker is still in filtered, keep it; else select first
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

  // Render Table
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
        }
      });
    });
  }

  // Render Deep-Dive Studio
  function renderStudio(stock) {
    if (!stock) return;

    $("stTicker").textContent = stock.ticker;
    $("stName").textContent = stock.name;
    $("stSector").textContent = stock.sector;
    $("stPrice").textContent = fmtMoney(stock.price);

    const tagClass = (stock.tag_class || "neutral").replace("_", "-");
    $("stBadge").className = `tag-badge ${tagClass}`;
    $("stBadge").textContent = stock.tag;

    const scoreClass = `score-${stock.grade.toLowerCase()}`;
    $("stScoreBadge").className = `score-badge ${scoreClass}`;
    $("stScoreBadge").textContent = `Score: ${stock.total_score} / 100 (${stock.grade_label})`;

    // Pillars
    const bk = stock.breakdown || {};
    $("stScoreRegime").textContent = `${bk.regime || 0} / 30`;
    $("stBarRegime").style.width = `${((bk.regime || 0) / 30) * 100}%`;
    $("stReasonRegime").textContent = bk.regime_reason || "Regime timing based on BB-KC compression/release";

    $("stScoreTrend").textContent = `${bk.trend || 0} / 25`;
    $("stBarTrend").style.width = `${((bk.trend || 0) / 25) * 100}%`;
    $("stReasonTrend").textContent = bk.trend_reason || "Trend alignment & proximity to 40-day high";

    $("stScoreEda").textContent = `${bk.eda || 0} / 20`;
    $("stBarEda").style.width = `${((bk.eda || 0) / 20) * 100}%`;
    $("stReasonEda").textContent = bk.eda_reason || "Statistical volatility lift";

    $("stScoreStructural").textContent = `${bk.structural || 0} / 15`;
    $("stBarStructural").style.width = `${((bk.structural || 0) / 15) * 100}%`;

    $("stScoreQuality").textContent = `${bk.quality || 10} / 10`;
    $("stBarQuality").style.width = "100%";

    $("stPlaybook").textContent = stock.playbook || "เฝ้าระวังการพักตัว และรอจังหวะ Breakout ยืนยันโมเมนตัม";

    // Forward Cone Chart
    renderConeChart(stock);
  }

  function renderStudioPlaceholder() {
    $("stTicker").textContent = "—";
    $("stName").textContent = "ไม่มีหุ้นที่เลือก";
    $("stPrice").textContent = "—";
  }

  // Draw Forward 2SD Volatility Cone SVG
  function renderConeChart(stock) {
    const svg = $("coneSvgChart");
    if (!svg) return;

    if (!stock) {
      stock = allStocks.find(s => s.ticker === selectedTicker);
      if (!stock) return;
    }

    const cone = stock.cone;
    if (!cone || !cone.upper || cone.upper.length === 0) {
      svg.innerHTML = `<text x="300" y="130" text-anchor="middle" fill="var(--text-muted)">ไม่มีข้อมูล 2SD Cone</text>`;
      return;
    }

    const days = cone.days;
    const upper = cone.upper;
    const lower = cone.lower;
    const currentPrice = cone.current_price || stock.price;
    const sigmaAnn = cone.sigma_ann ? (cone.sigma_ann * 100).toFixed(1) : "—";

    $("stVolAnn").textContent = `Annualized Vol (&sigma;): ${sigmaAnn}%`;

    // 30d & 60d stats
    const p30High = upper[Math.min(29, upper.length - 1)];
    const p30Low = lower[Math.min(29, lower.length - 1)];
    const p60High = upper[upper.length - 1];
    const p60Low = lower[lower.length - 1];

    $("stRange30").textContent = `${fmtMoney(p30Low)} &ndash; ${fmtMoney(p30High)} (&plusmn;${fmtNum(((p30High - currentPrice) / currentPrice) * 100, 1)}%)`;
    $("stRange60").textContent = `${fmtMoney(p60Low)} &ndash; ${fmtMoney(p60High)} (&plusmn;${fmtNum(((p60High - currentPrice) / currentPrice) * 100, 1)}%)`;

    // Coordinates mapping
    const W = 600;
    const H = 260;
    const padX = 40;
    const padY = 24;

    const minP = Math.min(...lower) * 0.98;
    const maxP = Math.max(...upper) * 1.02;
    const n = days.length;

    const getX = (idx) => padX + (idx / (n - 1)) * (W - 2 * padX);
    const getY = (price) => H - padY - ((price - minP) / (maxP - minP)) * (H - 2 * padY);

    // Build upper path, lower path, mean path
    let upperPts = [];
    let lowerPts = [];
    let meanPts = [];

    // Day 0 anchor
    const x0 = getX(0);
    const y0 = getY(currentPrice);

    for (let i = 0; i < n; i++) {
      const x = getX(i);
      const yu = getY(upper[i]);
      const yl = getY(lower[i]);
      const ym = getY(currentPrice); // drift neutral mean
      upperPts.push(`${x.toFixed(1)},${yu.toFixed(1)}`);
      lowerPts.push(`${x.toFixed(1)},${yl.toFixed(1)}`);
      meanPts.push(`${x.toFixed(1)},${ym.toFixed(1)}`);
    }

    const areaPath = `M ${x0},${y0} L ${upperPts.join(" L ")} L ${lowerPts.slice().reverse().join(" L ")} Z`;
    const upperLine = `M ${x0},${y0} L ${upperPts.join(" L ")}`;
    const lowerLine = `M ${x0},${y0} L ${lowerPts.join(" L ")}`;
    const meanLine = `M ${x0},${y0} L ${meanPts.join(" L ")}`;

    svg.innerHTML = `
      <defs>
        <linearGradient id="coneGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.10"/>
        </linearGradient>
      </defs>

      <!-- Grid lines -->
      <line x1="${padX}" y1="${getY(maxP)}" x2="${W - padX}" y2="${getY(maxP)}" stroke="var(--border-subtle)" stroke-dasharray="3,3"/>
      <line x1="${padX}" y1="${y0}" x2="${W - padX}" y2="${y0}" stroke="var(--border-subtle)" stroke-dasharray="4,4"/>
      <line x1="${padX}" y1="${getY(minP)}" x2="${W - padX}" y2="${getY(minP)}" stroke="var(--border-subtle)" stroke-dasharray="3,3"/>

      <!-- Shaded 2SD Cone Area -->
      <path d="${areaPath}" fill="url(#coneGrad)" />

      <!-- Upper +2SD Bound -->
      <path d="${upperLine}" fill="none" stroke="#22d3ee" stroke-width="2" stroke-linecap="round"/>

      <!-- Lower -2SD Bound -->
      <path d="${lowerLine}" fill="none" stroke="#fb7185" stroke-width="2" stroke-linecap="round"/>

      <!-- Center Mean Line -->
      <path d="${meanLine}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,4"/>

      <!-- Price labels on right -->
      <text x="${W - padX + 6}" y="${getY(upper[upper.length - 1]) + 4}" fill="#22d3ee" font-size="10.5" font-family="var(--font-mono)" font-weight="750">+2SD ${fmtMoney(upper[upper.length - 1])}</text>
      <text x="${W - padX + 6}" y="${y0 + 4}" fill="#94a3b8" font-size="10" font-family="var(--font-mono)">S₀ ${fmtMoney(currentPrice)}</text>
      <text x="${W - padX + 6}" y="${getY(lower[lower.length - 1]) + 4}" fill="#fb7185" font-size="10.5" font-family="var(--font-mono)" font-weight="750">-2SD ${fmtMoney(lower[lower.length - 1])}</text>

      <!-- Day 0 Origin Dot -->
      <circle cx="${x0}" cy="${y0}" r="4" fill="#38bdf8"/>
    `;
  }

  // Render Detailed Forecast View
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

    // Render detailed SVG
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
      <!-- Reference lines -->
      <line x1="${padX}" y1="${y0}" x2="${W - padX}" y2="${y0}" stroke="var(--border-subtle)" stroke-dasharray="5,5"/>
      <path d="${area}" fill="url(#fcGrad)" />
      <path d="M ${x0},${y0} L ${uPts.join(" L ")}" fill="none" stroke="#22d3ee" stroke-width="2.5"/>
      <path d="M ${x0},${y0} L ${lPts.join(" L ")}" fill="none" stroke="#fb7185" stroke-width="2.5"/>
      <path d="M ${x0},${y0} L ${mPts.join(" L ")}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,4"/>

      <!-- End labels -->
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
