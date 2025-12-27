/* ===========================================================================================
   MICRODCA Simulated Portfolio Engine (External)
   - Beginner/Advanced toggle + per-card show/hide works
   - Core asset builder writes to hidden legacy inputs
   - Simulation runs end-to-end (no “Building simulation…” hang)
   - Worker price fetch with multi-endpoint probing + synthetic fallback
   =========================================================================================== */
(() => {
  if (window.__microdcaSimPortfolioLoaded) return;
  window.__microdcaSimPortfolioLoaded = true;

  const $ = (id) => document.getElementById(id);

  // -------------------------
  // Utilities
  // -------------------------
  const pad2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parseISO = (s) => {
    const [y, m, d] = String(s || "").split("-").map(Number);
    if (!y || !m || !d) return null;
    const dt = new Date(y, m - 1, d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  };
  const fmtUSD = (x) => (isFinite(x) ? x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }) : "—");

  // -------------------------
  // DOM guards
  // -------------------------
  const root = $("simPortfolio");
  if (!root) return;

  // -------------------------
  // Log + alert
  // -------------------------
  const logEl = $("spLog");
  const alertEl = $("spAlert");
  const vizDesc = $("spVizDesc");

  function log(msg) {
    const t = new Date();
    const stamp = `[${pad2(t.getHours())}:${pad2(t.getMinutes())}]`;
    if (logEl) {
      logEl.textContent += `\n${stamp} ${msg}`;
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
  function setAlert(msg) {
    if (!alertEl) return;
    if (!msg) {
      alertEl.style.display = "none";
      alertEl.textContent = "";
      return;
    }
    alertEl.style.display = "block";
    alertEl.textContent = msg;
  }

  // -------------------------
  // Toggle wiring (Beginner/Advanced + card toggles)
  // -------------------------
  const advMode = $("spAdvancedMode");
  const modeLabel = $("spModeLabel");
  const modeSub = $("spModeSub");
  const advToggles = $("spAdvancedToggles");

  const showMarginCard = $("spShowMarginCard");
  const showMarginAdv = $("spShowMarginAdvanced");
  const showIncomeCard = $("spShowIncomeCard");
  const showIncomeAdv = $("spShowIncomeAdvanced");
  const showBillsCard = $("spShowBillsCard");

  const marginCard = $("spMarginCard");
  const incomeCard = $("spIncomeCard");
  const billsCard = $("spBillsCard");

  const advMarginRows = root.querySelectorAll('.adv-only[data-adv="margin"]');
  const advIncomeRows = root.querySelectorAll('.adv-only[data-adv="income"]');

  const incomeOn = $("spIncomeOn");
  const billsOn = $("spBillsOn");

  const incomeFields = [
    $("spIncomeTickers"), $("spIncomeWeights"), $("spIncomeSplit"), $("spIncomeYield"),
    $("spIncomeMode"), $("spAdjustFreq"),
    $("spTargetRatio"), $("spTargetBorrow"),
    $("spBandMin"), $("spBandMax")
  ].filter(Boolean);

  const billsFields = [
    $("spBillsMonthly"), $("spTaxRate"), $("spBillsFallback"), $("spTaxHandling")
  ].filter(Boolean);

  const setCardVisible = (el, on) => { if (el) el.classList.toggle("is-hidden", !on); };
  const setAdvRows = (nodeList, on) => nodeList.forEach((el) => el.classList.toggle("adv-show", !!on));

  function hardDisableIncomeBillsIfHidden() {
    const isAdv = !!advMode?.checked;

    const incomeVisible = isAdv && !!showIncomeCard?.checked && incomeCard && !incomeCard.classList.contains("is-hidden");
    if (!incomeVisible || !incomeOn?.checked) {
      if (incomeOn) incomeOn.checked = false;
      incomeFields.forEach((f) => (f.disabled = true));
    } else {
      incomeFields.forEach((f) => (f.disabled = false));
    }

    const billsVisible = isAdv && !!showBillsCard?.checked && billsCard && !billsCard.classList.contains("is-hidden");
    if (!billsVisible || !billsOn?.checked) {
      if (billsOn) billsOn.checked = false;
      billsFields.forEach((f) => (f.disabled = true));
    } else {
      billsFields.forEach((f) => (f.disabled = false));
    }
  }

  function applyModeUI() {
    const isAdv = !!advMode?.checked;

    if (isAdv) {
      if (modeLabel) modeLabel.textContent = "Advanced";
      if (modeSub) modeSub.textContent = "Unhide optional blocks and controls as needed.";
      if (advToggles) advToggles.classList.remove("hidden");

      setCardVisible(marginCard, !!showMarginCard?.checked);
      setCardVisible(incomeCard, !!showIncomeCard?.checked);
      setCardVisible(billsCard, !!showBillsCard?.checked);

      setAdvRows(advMarginRows, !!showMarginCard?.checked && !!showMarginAdv?.checked);
      setAdvRows(advIncomeRows, !!showIncomeCard?.checked && !!showIncomeAdv?.checked);

      if (!showMarginCard?.checked) setAdvRows(advMarginRows, false);
      if (!showIncomeCard?.checked) setAdvRows(advIncomeRows, false);
    } else {
      if (modeLabel) modeLabel.textContent = "Beginner";
      if (modeSub) modeSub.textContent = "Simple setup only.";
      if (advToggles) advToggles.classList.add("hidden");

      setCardVisible(marginCard, false);
      setCardVisible(incomeCard, false);
      setCardVisible(billsCard, false);

      setAdvRows(advMarginRows, false);
      setAdvRows(advIncomeRows, false);
    }

    hardDisableIncomeBillsIfHidden();
  }

  advMode?.addEventListener("change", applyModeUI);
  [showMarginCard, showMarginAdv, showIncomeCard, showIncomeAdv, showBillsCard].forEach((el) => el?.addEventListener("change", applyModeUI));
  incomeOn?.addEventListener("change", hardDisableIncomeBillsIfHidden);
  billsOn?.addEventListener("change", hardDisableIncomeBillsIfHidden);

  // Defaults
  if (advMode) advMode.checked = false;
  if (showMarginCard) showMarginCard.checked = true;
  if (showMarginAdv) showMarginAdv.checked = false;
  if (showIncomeCard) showIncomeCard.checked = false;
  if (showIncomeAdv) showIncomeAdv.checked = false;
  if (showBillsCard) showBillsCard.checked = false;

  // -------------------------
  // Core asset builder -> hidden legacy inputs (spTickers/spWeights)
  // -------------------------
  const rowsWrap = $("spAssetRows");
  const addBtn = $("spAddAsset");
  const updateBtn = $("spUpdateAlloc");
  const totalEl = $("spWeightTotal");
  const legacyTickers = $("spTickers");
  const legacyWeights = $("spWeights");
  const MAX_ASSETS = 10;

  function parseLegacy() {
    const t = (legacyTickers?.value || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const w = (legacyWeights?.value || "").split(",").map((s) => Number(String(s).trim())).map((x) => (isFinite(x) ? x : 0));
    return { t, w };
  }

  function writeLegacyFromRows() {
    const tickers = [];
    const weights = [];

    rowsWrap?.querySelectorAll(".asset-row")?.forEach((row) => {
      const t = row.querySelector('[data-role="ticker"]')?.value?.trim()?.toUpperCase() || "";
      const w = Number(row.querySelector('[data-role="weight"]')?.value || 0);
      if (!t) return;
      tickers.push(t);
      weights.push(isFinite(w) ? w : 0);
    });

    if (legacyTickers) legacyTickers.value = tickers.join(",");
    if (legacyWeights) legacyWeights.value = weights.join(",");

    const sum = weights.reduce((p, c) => p + c, 0);
    if (totalEl) totalEl.textContent = isFinite(sum) ? sum.toFixed(0) : "—";

    // Preview table
    const tb = $("spAllocPreview");
    if (tb) {
      tb.innerHTML = "";
      if (!tickers.length) {
        tb.innerHTML = `<tr><td colspan="3" style="padding:8px; color:rgba(245,245,245,0.55);">Add tickers to preview allocation.</td></tr>`;
      } else {
        const wsum = weights.reduce((a, b) => a + b, 0) || 1;
        tickers.forEach((tk, i) => {
          const pct = (weights[i] / wsum) * 100;
          tb.insertAdjacentHTML("beforeend", `
            <tr>
              <td style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.06);">${tk}</td>
              <td style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.06);">${pct.toFixed(2)}%</td>
              <td style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.06); color:rgba(245,245,245,0.55);">Normalized</td>
            </tr>
          `);
        });
      }
    }
  }

  function makeRow(ticker = "", weight = "") {
    const row = document.createElement("div");
    row.className = "asset-row";
    row.innerHTML = `
      <input data-role="ticker" placeholder="SPY" value="${ticker}" />
      <input data-role="weight" type="number" min="0" step="1" placeholder="50" value="${weight}" />
      <button class="icon-btn" type="button" title="Remove">−</button>
    `;

    const tIn = row.querySelector('[data-role="ticker"]');
    const wIn = row.querySelector('[data-role="weight"]');
    const rm = row.querySelector("button");

    const onChange = () => writeLegacyFromRows();
    tIn.addEventListener("input", onChange);
    wIn.addEventListener("input", onChange);

    rm.addEventListener("click", () => {
      row.remove();
      enforceRemoveButtons();
      writeLegacyFromRows();
    });

    return row;
  }

  function enforceRemoveButtons() {
    const rowEls = rowsWrap?.querySelectorAll(".asset-row") || [];
    rowEls.forEach((row) => {
      const btn = row.querySelector("button");
      if (!btn) return;
      btn.disabled = rowEls.length <= 1;
      btn.style.opacity = btn.disabled ? "0.45" : "1";
      btn.style.cursor = btn.disabled ? "not-allowed" : "pointer";
    });

    if (addBtn) {
      addBtn.disabled = rowEls.length >= MAX_ASSETS;
      addBtn.style.opacity = addBtn.disabled ? "0.45" : "1";
      addBtn.style.cursor = addBtn.disabled ? "not-allowed" : "pointer";
    }
  }

  function initBuilder() {
    if (!rowsWrap) return;

    const { t, w } = parseLegacy();
    const seedTickers = t.length ? t : ["SPY", "QQQ"];
    const seedWeights = w.length ? w : [50, 50];

    rowsWrap.innerHTML = "";
    for (let i = 0; i < Math.min(seedTickers.length, MAX_ASSETS); i++) {
      rowsWrap.appendChild(makeRow(seedTickers[i], (seedWeights[i] ?? "")));
    }
    enforceRemoveButtons();
    writeLegacyFromRows();
  }

  addBtn?.addEventListener("click", () => {
    const rowEls = rowsWrap.querySelectorAll(".asset-row");
    if (rowEls.length >= MAX_ASSETS) return;
    rowsWrap.appendChild(makeRow("", ""));
    enforceRemoveButtons();
    writeLegacyFromRows();
  });

  updateBtn?.addEventListener("click", () => writeLegacyFromRows());

  // Build safeguard: sync builder BEFORE any reads
  $("spBuild")?.addEventListener("click", () => { try { writeLegacyFromRows(); } catch (e) {} }, true);

  initBuilder();
  applyModeUI();

  // Seed dates if empty
  const sd = $("spStartDate");
  const ed = $("spEndDate");
  if (sd && !sd.value) sd.value = "2022-12-28";
  if (ed && !ed.value) ed.value = "2025-12-27";

  // -------------------------
  // Price loader (Worker first, synthetic fallback)
  // -------------------------
  const PRICE_BASE = String(window.MICRODCA_PRICE_PROXY_BASE || "").replace(/\/+$/, "");

  async function fetchFromWorker(ticker, startISO, endISO) {
    const candidates = [
      `${PRICE_BASE}/api/prices?ticker=${encodeURIComponent(ticker)}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
      `${PRICE_BASE}/prices?ticker=${encodeURIComponent(ticker)}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
      `${PRICE_BASE}/api/history?ticker=${encodeURIComponent(ticker)}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
      `${PRICE_BASE}/history?ticker=${encodeURIComponent(ticker)}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`
    ];

    let lastErr = null;
    for (const url of candidates) {
      try {
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const rowsRaw = Array.isArray(data) ? data : (data.rows || data.data || data.prices || []);
        if (!Array.isArray(rowsRaw) || rowsRaw.length < 10) throw new Error("Bad/empty series");

        const rows = rowsRaw.map((r) => {
          const d = r.date || r.t || r.time || r.dt;
          const c = r.close ?? r.c ?? r.price ?? r.p;
          return { date: String(d).slice(0, 10), close: Number(c) };
        }).filter((r) => r.date && isFinite(r.close));

        if (rows.length < 10) throw new Error("Series parse failed");
        return rows;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Worker fetch failed");
  }

  function syntheticSeries(startDt, endDt, seed = 100) {
    const rows = [];
    let px = seed;
    const d = new Date(startDt);
    while (d <= endDt) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) {
        const drift = 0.0002;
        const noise = (Math.random() - 0.5) * 0.01;
        px = Math.max(1, px * (1 + drift + noise));
        rows.push({ date: toISO(d), close: px });
      }
      d.setDate(d.getDate() + 1);
    }
    return rows;
  }

  function intersectDates(seriesByTicker) {
    const tickers = Object.keys(seriesByTicker);
    if (!tickers.length) return [];
    const sets = tickers.map((tk) => new Set(seriesByTicker[tk].map((r) => r.date)));
    const first = [...sets[0]];
    const common = first.filter((d) => sets.every((s) => s.has(d)));
    common.sort();
    return common;
  }

  // -------------------------
  // Simulation + Chart.js
  // -------------------------
  const canvas = $("spCanvas");
  let chart = null;

  function ensureChart() {
    if (!canvas || chart) return;
    chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Cash-only", data: [], borderWidth: 2, pointRadius: 0 },
          { label: "With margin + income mgmt", data: [], borderWidth: 2, pointRadius: 0 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
        interaction: { mode: "index", intersect: false },
        scales: { x: { display: false }, y: { display: true } }
      }
    });
  }

  // KPIs
  const kDate = $("kDate");
  const kEqCash = $("kEqCash");
  const kEqMargin = $("kEqMargin");
  const kDebt = $("kDebt");
  const kLTV = $("kLTV");
  const kCover = $("kCover");
  const kTax = $("kTax");
  const kBills = $("kBills");

  function setKpis(row) {
    if (!row) return;
    if (kDate) kDate.textContent = row.date || "—";
    if (kEqCash) kEqCash.textContent = fmtUSD(row.eq_cash);
    if (kEqMargin) kEqMargin.textContent = fmtUSD(row.eq_margin);
    if (kDebt) kDebt.textContent = fmtUSD(row.debt);
    if (kLTV) kLTV.textContent = isFinite(row.ltv) ? `${(row.ltv * 100).toFixed(2)}%` : "—";
    if (kCover) kCover.textContent = (row.income_coverage == null) ? "—" : `${row.income_coverage.toFixed(2)}x`;
    if (kTax) kTax.textContent = fmtUSD(row.tax_reserve);
    if (kBills) kBills.textContent = fmtUSD(row.bills_paid_cum);
  }

  // Risk UI
  const riskFill = $("riskFill");
  const riskGrade = $("riskGrade");
  const riskProx = $("riskProx");
  const riskDev = $("riskDev");
  const riskSignal = $("riskSignal");

  function gradeRisk(prox) {
    if (!isFinite(prox)) return "—";
    if (prox < 0.40) return "LOW";
    if (prox < 0.70) return "MED";
    if (prox < 0.90) return "HIGH";
    return "MAX";
  }

  function setRiskUI(ltv, maxLtv) {
    const max = Math.max(1e-9, maxLtv);
    const prox = Math.min(1, Math.max(0, ltv / max));
    if (riskFill) riskFill.style.width = `${Math.round(prox * 100)}%`;
    if (riskGrade) riskGrade.textContent = gradeRisk(prox);
    if (riskProx) riskProx.textContent = `${Math.round(prox * 100)}%`;
    if (riskDev) riskDev.textContent = "—";
    if (riskSignal) riskSignal.textContent = prox >= 0.90 ? "Near max LTV" : "OK";
  }

  // Animation controls
  const playBtn = $("spPlay");
  const pauseBtn = $("spPause");
  const stepBtn = $("spStep");
  const toEndBtn = $("spToEnd");
  const speedRange = $("spSpeed");
  const speedLabel = $("spSpeedLabel");

  const dlPng = $("spDlPng");
  const dlCsv = $("spDlCsv");

  let sim = { series: [], cursor: 0, playing: false, raf: null, lastTs: 0, maxLtv: 0.35 };

  function setAnimButtons(enabled) {
    [playBtn, pauseBtn, stepBtn, toEndBtn].forEach((b) => { if (b) b.disabled = !enabled; });
  }
  function stopAnim() {
    sim.playing = false;
    sim.lastTs = 0;
    if (sim.raf) cancelAnimationFrame(sim.raf);
    sim.raf = null;
  }
  function redrawChart(uptoIndex) {
    if (!chart) return;
    const n = Math.max(0, Math.min(sim.series.length, uptoIndex + 1));
    chart.data.labels = sim.series.slice(0, n).map((r) => r.date);
    chart.data.datasets[0].data = sim.series.slice(0, n).map((r) => r.eq_cash);
    chart.data.datasets[1].data = sim.series.slice(0, n).map((r) => r.eq_margin);
    chart.update("none");
  }
  function tick(ts) {
    if (!sim.playing) return;
    const speed = Number(speedRange?.value || 60);
    if (!sim.lastTs) sim.lastTs = ts;
    const dt = (ts - sim.lastTs) / 1000;
    const stepDays = dt * speed;
    if (stepDays <= 0) { sim.raf = requestAnimationFrame(tick); return; }

    sim.lastTs = ts;
    sim.cursor = Math.min(sim.series.length - 1, sim.cursor + Math.max(1, Math.floor(stepDays)));

    redrawChart(sim.cursor);
    const row = sim.series[sim.cursor];
    setKpis(row);
    setRiskUI(row.ltv, sim.maxLtv);

    if (vizDesc) vizDesc.textContent = `Day ${sim.cursor + 1} / ${sim.series.length}`;

    if (sim.cursor >= sim.series.length - 1) {
      stopAnim();
      if (vizDesc) vizDesc.textContent = "Completed.";
    } else {
      sim.raf = requestAnimationFrame(tick);
    }
  }

  if (speedRange && speedLabel) {
    const upd = () => (speedLabel.textContent = `${speedRange.value} d/s`);
    speedRange.addEventListener("input", upd);
    upd();
  }

  playBtn?.addEventListener("click", () => {
    if (!sim.series.length) return;
    sim.playing = true;
    sim.lastTs = 0;
    sim.raf = requestAnimationFrame(tick);
  });
  pauseBtn?.addEventListener("click", () => stopAnim());
  stepBtn?.addEventListener("click", () => {
    if (!sim.series.length) return;
    stopAnim();
    sim.cursor = Math.min(sim.series.length - 1, sim.cursor + 1);
    redrawChart(sim.cursor);
    const row = sim.series[sim.cursor];
    setKpis(row);
    setRiskUI(row.ltv, sim.maxLtv);
    if (vizDesc) vizDesc.textContent = `Day ${sim.cursor + 1} / ${sim.series.length}`;
  });
  toEndBtn?.addEventListener("click", () => {
    if (!sim.series.length) return;
    stopAnim();
    sim.cursor = sim.series.length - 1;
    redrawChart(sim.cursor);
    const row = sim.series[sim.cursor];
    setKpis(row);
    setRiskUI(row.ltv, sim.maxLtv);
    if (vizDesc) vizDesc.textContent = "Completed.";
  });

  // Downloads
  dlPng?.addEventListener("click", () => {
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = "simulated-portfolio.png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  });

  dlCsv?.addEventListener("click", () => {
    if (!sim.series.length) return;
    const headers = ["date", "eq_cash", "eq_margin", "debt", "ltv", "tax_reserve", "bills_paid_cum", "income_coverage"];
    const lines = [headers.join(",")];
    for (const r of sim.series) {
      lines.push([
        r.date,
        (r.eq_cash ?? 0).toFixed(2),
        (r.eq_margin ?? 0).toFixed(2),
        (r.debt ?? 0).toFixed(2),
        (r.ltv ?? 0).toFixed(6),
        (r.tax_reserve ?? 0).toFixed(2),
        (r.bills_paid_cum ?? 0).toFixed(2),
        (r.income_coverage == null ? "" : r.income_coverage.toFixed(6))
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "simulated-portfolio.csv";
    a.click();
    URL.revokeObjectURL(url);
  });

  // Reset
  $("spReset")?.addEventListener("click", () => {
    stopAnim();
    sim.series = [];
    sim.cursor = 0;
    setAnimButtons(false);
    setAlert("");
    if (vizDesc) vizDesc.textContent = "Build a simulation to begin.";
    if (logEl) logEl.textContent = "Ready.";
    if (chart) {
      chart.data.labels = [];
      chart.data.datasets[0].data = [];
      chart.data.datasets[1].data = [];
      chart.update("none");
    }
    if (riskFill) riskFill.style.width = "0%";
    if (riskGrade) riskGrade.textContent = "—";
    if (riskProx) riskProx.textContent = "—";
    if (riskDev) riskDev.textContent = "—";
    if (riskSignal) riskSignal.textContent = "—";
  });

  // -------------------------
  // Simulation helpers
  // -------------------------
  function parseTickersWeights() {
    writeLegacyFromRows();
    const tickers = (legacyTickers?.value || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const weightsRaw = (legacyWeights?.value || "").split(",").map((s) => Number(String(s).trim())).map((x) => (isFinite(x) ? x : 0));
    if (!tickers.length) return { tickers: [], weights: [] };
    const wsum = weightsRaw.reduce((a, b) => a + b, 0) || 1;
    return { tickers, weights: weightsRaw.map((w) => w / wsum) };
  }

  function shouldDcaToday(dateStr, freq) {
    const d = parseISO(dateStr);
    if (!d) return false;
    if (freq === "daily") return true;
    if (freq === "weekly") return d.getDay() === 1; // Monday
    if (freq === "monthly") return d.getDate() <= 3; // approx first trading day
    return true;
  }

  function portfolioValue(holdings, prices) {
    let v = 0;
    for (const tk of Object.keys(holdings)) {
      const sh = holdings[tk] || 0;
      const px = prices[tk];
      if (isFinite(sh) && isFinite(px)) v += sh * px;
    }
    return v;
  }

  function buyWithWeights({ amount, tickers, targetW, holdings, prices, rebalance }) {
    if (amount <= 0) return;

    let alloc = targetW.slice();
    if (rebalance) {
      const pv = portfolioValue(holdings, prices);
      if (pv > 0) {
        const curVals = tickers.map((tk) => (holdings[tk] || 0) * (prices[tk] || 0));
        const curW = curVals.map((v) => v / pv);
        const gaps = curW.map((w, i) => Math.max(0, targetW[i] - w));
        const gsum = gaps.reduce((a, b) => a + b, 0);
        alloc = (gsum > 0) ? gaps.map((g) => g / gsum) : targetW.slice();
      }
    }

    tickers.forEach((tk, i) => {
      const px = prices[tk];
      if (!isFinite(px) || px <= 0) return;
      const dollars = amount * (alloc[i] ?? 0);
      const shares = dollars / px;
      holdings[tk] = (holdings[tk] || 0) + shares;
    });
  }

  function parseIncomeSleeve() {
    if (!incomeOn?.checked) return null;

    const t = ($("spIncomeTickers")?.value || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const wRaw = ($("spIncomeWeights")?.value || "").split(",").map((s) => Number(String(s).trim())).map((x) => (isFinite(x) ? x : 0));
    const wsum = wRaw.reduce((a, b) => a + b, 0) || 1;

    const splitPct = Number($("spIncomeSplit")?.value || 0);
    const yieldPct = Number($("spIncomeYield")?.value || 0);

    return {
      tickers: t,
      weights: wRaw.map((x) => x / wsum),
      split: Math.min(1, Math.max(0, splitPct / 100)),
      yieldAnnual: Math.max(0, yieldPct / 100)
    };
  }

  // -------------------------
  // Build simulation (main)
  // -------------------------
  async function buildSimulation() {
    setAlert("");
    if (logEl) logEl.textContent = "Ready.";
    log("Starting build…");

    ensureChart();

    const startDt = parseISO($("spStartDate")?.value) || parseISO("2022-12-28");
    const endDt = parseISO($("spEndDate")?.value) || parseISO("2025-12-27");
    if (!startDt || !endDt || endDt <= startDt) {
      setAlert("Invalid date range. Please set Start date < End date.");
      return;
    }
    const startISO = toISO(startDt);
    const endISO = toISO(endDt);

    const { tickers, weights } = parseTickersWeights();
    if (!tickers.length) {
      setAlert("Add at least one core asset ticker.");
      return;
    }

    const startCash = Number($("spStartCash")?.value || 0);
    const dcaAmt = Number($("spDcaAmt")?.value || 0);
    const freq = $("spFreq")?.value || "daily";
    const rebalance = !!$("spRebalance")?.checked;

    // Margin settings (only if margin card visible AND enabled)
    const useMargin = !!$("spUseMargin")?.checked && !!advMode?.checked && !!showMarginCard?.checked && marginCard && !marginCard.classList.contains("is-hidden");
    const marginRate = Math.max(0, Number($("spMarginRate")?.value || 0)) / 100;
    const maxLtv = Math.min(0.95, Math.max(0, Number($("spMaxLTV")?.value || 0) / 100));
    const marginPolicy = $("spMarginPolicy")?.value || "assist";
    const dayCount = Number($("spDayCount")?.value || 365) === 360 ? 360 : 365;

    sim.maxLtv = maxLtv;

    const income = parseIncomeSleeve();
    const billsEnabled = !!billsOn?.checked && !!advMode?.checked && !!showBillsCard?.checked && billsCard && !billsCard.classList.contains("is-hidden");

    const billsMonthly = Math.max(0, Number($("spBillsMonthly")?.value || 0));
    const taxRate = Math.min(0.8, Math.max(0, Number($("spTaxRate")?.value || 0) / 100));
    const taxHandling = $("spTaxHandling")?.value || "reserve";

    // Load prices
    const allTickers = new Set(tickers);
    if (income?.tickers?.length) income.tickers.forEach((t) => allTickers.add(t));

    const seriesByTicker = {};
    for (const tk of allTickers) {
      try {
        log(`Loading price history for ${tk}…`);
        const rows = await fetchFromWorker(tk, startISO, endISO);
        seriesByTicker[tk] = rows;
        log(`Loaded ${rows.length} rows for ${tk}.`);
      } catch (e) {
        log(`Worker fetch failed for ${tk}. Using synthetic series.`);
        seriesByTicker[tk] = syntheticSeries(startDt, endDt, 50 + Math.random() * 200);
      }
    }

    const dates = intersectDates(seriesByTicker);
    if (dates.length < 30) {
      setAlert("Not enough overlapping price history for selected tickers/dates.");
      return;
    }

    // date->close map
    const pxMap = {};
    for (const tk of Object.keys(seriesByTicker)) {
      pxMap[tk] = new Map(seriesByTicker[tk].map((r) => [r.date, r.close]));
    }

    const holdingsCash = {};
    const holdingsMargin = {};
    tickers.forEach((tk) => { holdingsCash[tk] = 0; holdingsMargin[tk] = 0; });

    const incomeHold = {};
    if (income?.tickers?.length) income.tickers.forEach((tk) => { incomeHold[tk] = 0; });

    let cashCash = startCash;
    let cashMargin = startCash;
    let debt = 0;
    let taxReserve = 0;
    let billsPaidCum = 0;

    let lastMonth = null;
    let lastDist = 0;

    log(`Running simulation for ${dates.length} market days…`);

    const out = [];

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];

      // Prices today
      const prices = {};
      for (const tk of allTickers) prices[tk] = pxMap[tk].get(date);

      // Interest accrual (margin)
      const dailyRate = marginRate / dayCount;
      if (useMargin && debt > 0 && dailyRate > 0) {
        const interest = debt * dailyRate;
        if (cashMargin >= interest) cashMargin -= interest;
        else { debt += (interest - cashMargin); cashMargin = 0; }
      }

      // DCA
      const doDca = shouldDcaToday(date, freq);
      if (doDca && dcaAmt > 0) {
        // cash-only
        const spendCash = Math.min(cashCash, dcaAmt);
        cashCash -= spendCash;
        buyWithWeights({ amount: spendCash, tickers, targetW: weights, holdings: holdingsCash, prices, rebalance });

        // margin line
        let spendTotal = dcaAmt;
        let fromCash = Math.min(cashMargin, spendTotal);
        cashMargin -= fromCash;
        let remaining = spendTotal - fromCash;

        if (useMargin) {
          const coreVal = portfolioValue(holdingsMargin, prices);
          const incVal = income ? portfolioValue(incomeHold, prices) : 0;
          const assetVal = coreVal + incVal;
          const maxDebtAllowed = assetVal * maxLtv;
          const canBorrow = Math.max(0, maxDebtAllowed - debt);

          const wantBorrow = (marginPolicy === "always") ? remaining
            : (marginPolicy === "assist") ? remaining
            : 0;

          const borrowNow = Math.min(canBorrow, wantBorrow);
          debt += borrowNow;
          remaining -= borrowNow;
        }

        const invested = spendTotal - Math.max(0, remaining);
        if (invested > 0) {
          const incPart = income ? invested * income.split : 0;
          const corePart = invested - incPart;

          buyWithWeights({ amount: corePart, tickers, targetW: weights, holdings: holdingsMargin, prices, rebalance });

          if (income && income.tickers.length) {
            buyWithWeights({ amount: incPart, tickers: income.tickers, targetW: income.weights, holdings: incomeHold, prices, rebalance: false });
          }
        }
      }

      // Month-end distribution: trigger on month change OR last day
      const dObj = parseISO(date);
      const monthKey = `${dObj.getFullYear()}-${pad2(dObj.getMonth() + 1)}`;
      const isMonthEnd = (lastMonth !== null && monthKey !== lastMonth);
      const isLast = (i === dates.length - 1);

      if (income && (isMonthEnd || isLast)) {
        const incVal = portfolioValue(incomeHold, prices);
        const dist = incVal * (income.yieldAnnual / 12);
        lastDist = dist;

        let available = dist;

        const tax = dist * taxRate;
        if (taxHandling === "reserve") {
          taxReserve += tax;
          available -= tax;
        }

        if (billsEnabled) {
          const pay = Math.min(available, billsMonthly);
          billsPaidCum += pay;
          available -= pay;
        }

        if (useMargin && debt > 0 && available > 0) {
          const payDown = Math.min(debt, available);
          debt -= payDown;
          available -= payDown;
        }

        cashMargin += Math.max(0, available);
      }

      lastMonth = monthKey;

      // Values
      const pvCash = portfolioValue(holdingsCash, prices);
      const pvMarginCore = portfolioValue(holdingsMargin, prices);
      const pvIncome = income ? portfolioValue(incomeHold, prices) : 0;

      const eqCash = cashCash + pvCash;
      const grossAssets = cashMargin + pvMarginCore + pvIncome;
      const eqMargin = grossAssets - debt;

      const ltv = grossAssets > 0 ? (debt / grossAssets) : 0;

      // Coverage metric (simplified)
      const monthlyInterestApprox = (useMargin && debt > 0) ? (debt * marginRate / 12) : 0;
      const denom = Math.max(1e-9, monthlyInterestApprox + (billsEnabled ? billsMonthly : 0) + (taxHandling === "reserve" ? lastDist * taxRate : 0));
      const incomeCoverage = income ? (lastDist / denom) : null;

      out.push({
        date,
        eq_cash: eqCash,
        eq_margin: eqMargin,
        debt,
        ltv,
        tax_reserve: taxReserve,
        bills_paid_cum: billsPaidCum,
        income_coverage: incomeCoverage
      });
    }

    // Finalize
    sim.series = out;
    sim.cursor = 0;
    stopAnim();

    redrawChart(0);
    setKpis(sim.series[0]);
    setRiskUI(sim.series[0].ltv, sim.maxLtv);

    setAnimButtons(true);
    if (vizDesc) vizDesc.textContent = `Day 1 / ${sim.series.length}`;
    log("Simulation built successfully.");
  }

  // Build click
  $("spBuild")?.addEventListener("click", async () => {
    try {
      await buildSimulation();
    } catch (e) {
      console.error(e);
      setAlert(`Build failed: ${e?.message || e}`);
      log(`ERROR: ${e?.message || e}`);
      stopAnim();
      setAnimButtons(false);
    }
  });

  // Initial
  setAnimButtons(false);
})();
