(() => {
  // Prevent double-load
  if (window.__microdcaSimulatedPortfolioLoaded) return;
  window.__microdcaSimulatedPortfolioLoaded = true;

  const $ = (id) => document.getElementById(id);

  // =========================
  // PRICE PROXY (Cloudflare Worker)
  // =========================
  const PRICE_PROXY_BASE =
    (window.MICRODCA_PRICE_PROXY_BASE || "https://simulated-portfolio.microdca3.workers.dev").replace(/\/+$/, "");

  // =========================
  // Formatting helpers
  // =========================
  const fmtUSD = (x) => {
    if (!isFinite(x)) return "—";
    const sign = x < 0 ? "-" : "";
    const v = Math.abs(x);
    return sign + v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  };
  const fmtPct = (x) => (isFinite(x) ? (x * 100).toFixed(2) + "%" : "—");
  const iso = (d) => d.toISOString().slice(0, 10);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const normWeights = (arr) => {
    const clean = arr.map((x) => Math.max(0, Number(x) || 0));
    const s = clean.reduce((p, c) => p + c, 0);
    if (s <= 0) return clean.map(() => 0);
    return clean.map((x) => x / s);
  };

  const isMarketDay = (dateObj) => {
    const d = dateObj.getUTCDay();
    return d !== 0 && d !== 6;
  };

  const parseCsv = (text) => {
    const lines = text.trim().split(/\r?\n/);
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length < 5) continue;
      const date = parts[0];
      const close = Number(parts[4]);
      if (!date || !isFinite(close)) continue;
      out.push({ date, close });
    }
    return out;
  };

  // =========================
  // Element map (MATCHES YOUR CURRENT WEBFLOW HTML)
  // =========================
  const el = {
    // Account basics
    name: $("spName"),
    startCash: $("spStartCash"),
    dcaAmt: $("spDcaAmt"),
    freq: $("spFreq"),
    startDate: $("spStartDate"),
    endDate: $("spEndDate"),
    rebalance: $("spRebalance"),

    // Core allocation (hidden legacy inputs; builder maintains these)
    coreTickersHidden: $("spTickers"),
    coreWeightsHidden: $("spWeights"),

    // Margin
    useMargin: $("spUseMargin"),
    marginRate: $("spMarginRate"),
    maxLTV: $("spMaxLTV"),
    marginPolicy: $("spMarginPolicy"),
    dayCount: $("spDayCount"),

    // Income
    incomeOn: $("spIncomeOn"),
    incomeTickers: $("spIncomeTickers"),
    incomeWeights: $("spIncomeWeights"),
    incomeSplit: $("spIncomeSplit"),
    incomeYield: $("spIncomeYield"),
    incomeMode: $("spIncomeMode"),
    adjustFreq: $("spAdjustFreq"),
    targetRatio: $("spTargetRatio"),
    targetBorrow: $("spTargetBorrow"),
    bandMin: $("spBandMin"),
    bandMax: $("spBandMax"),

    // Bills + Taxes
    billsOn: $("spBillsOn"),
    billsMonthly: $("spBillsMonthly"),
    taxRate: $("spTaxRate"),
    billsFallback: $("spBillsFallback"),
    taxHandling: $("spTaxHandling"),

    // Controls
    build: $("spBuild"),
    reset: $("spReset"),
    play: $("spPlay"),
    pause: $("spPause"),
    step: $("spStep"),
    toEnd: $("spToEnd"),
    speed: $("spSpeed"),
    speedLabel: $("spSpeedLabel"),
    mode: $("spMode"),

    // Status
    badge: $("spBadge"),
    vizDesc: $("spVizDesc"),
    log: $("spLog"),
    alert: $("spAlert"),

    // KPIs
    kDate: $("kDate"),
    kEqCash: $("kEqCash"),
    kEqMargin: $("kEqMargin"),
    kDebt: $("kDebt"),
    kLTV: $("kLTV"),
    kCover: $("kCover"),
    kTax: $("kTax"),
    kBills: $("kBills"),

    // Risk
    riskGrade: $("riskGrade"),
    riskFill: $("riskFill"),
    riskProx: $("riskProx"),
    riskDev: $("riskDev"),
    riskSignal: $("riskSignal"),

    // Downloads + canvas
    dlPng: $("spDlPng"),
    dlCsv: $("spDlCsv"),
    canvas: $("spCanvas"),
  };

  // Hard guard: if these are missing, nothing can work.
  if (!el.canvas || !el.build || !el.reset || !el.log) return;

  // =========================
  // Logging + error surfacing
  // =========================
  function log(msg) {
    const t = new Date();
    const stamp = t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    el.log.textContent = `[${stamp}] ${msg}\n` + el.log.textContent;
  }

  let alertTimer = null;
  function showAlert(msg) {
    if (!el.alert) return;
    if (!msg) {
      el.alert.style.display = "none";
      el.alert.textContent = "";
      return;
    }
    el.alert.textContent = msg;
    el.alert.style.display = "block";
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => {
      el.alert.style.display = "none";
    }, 3500);
  }

  // Global error hooks (so you never get “nothing happens” again)
  window.addEventListener("error", (e) => {
    const m = e?.message || "Unknown error";
    log(`ERROR: ${m}`);
    showAlert(`Error: ${m}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const m = e?.reason?.message || String(e?.reason || "Unhandled rejection");
    log(`PROMISE: ${m}`);
    showAlert(`Build failed: ${m}`);
  });

  log("Engine loaded.");

  // =========================
  // Defaults: date range
  // =========================
  const today = new Date();
  const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const start = new Date(end.getTime() - 1000 * 60 * 60 * 24 * 365 * 3);
  if (el.startDate) el.startDate.value = iso(start);
  if (el.endDate) el.endDate.value = iso(end);

  // =========================
  // Core allocation parsing (from hidden inputs)
  // =========================
  function parseCommaList(v) {
    return String(v || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function getCoreAllocFromHidden() {
    const tickers = parseCommaList(el.coreTickersHidden?.value || "").map((t) => t.toUpperCase());
    const weightsRaw = parseCommaList(el.coreWeightsHidden?.value || "").map((x) => Number(x));

    // De-duplicate tickers (keep first)
    const seen = new Set();
    const t2 = [];
    const w2 = [];
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      if (!t) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      t2.push(t);
      w2.push(isFinite(weightsRaw[i]) ? weightsRaw[i] : 0);
    }

    if (!t2.length) return { tickers: [], weights: [] };

    const sum = w2.reduce((p, c) => p + (isFinite(c) ? c : 0), 0);
    const wNorm = sum > 0 ? normWeights(w2) : t2.map(() => 1 / t2.length);
    return { tickers: t2, weights: wNorm };
  }

  // =========================
  // Worker price fetch
  // =========================
  async function fetchDailyCloses(ticker) {
    const t = String(ticker || "").trim().toUpperCase();
    if (!t) throw new Error("Missing ticker");
    const url = `${PRICE_PROXY_BASE}/api/prices?ticker=${encodeURIComponent(t)}`;
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`Price fetch failed (${t})`);
    const text = await res.text();
    const rows = parseCsv(text);
    if (!rows.length) throw new Error(`No data returned (${t})`);
    return rows;
  }

  function syntheticPrices(ticker, startISO, endISO) {
    let seed = 0;
    for (let i = 0; i < ticker.length; i++) seed = (seed * 31 + ticker.charCodeAt(i)) >>> 0;
    const rand = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);

    const start = new Date(startISO + "T00:00:00Z");
    const end = new Date(endISO + "T00:00:00Z");
    const out = [];
    let px = 60 + rand() * 180;

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (!isMarketDay(d)) continue;
      const drift = 0.00025;
      const vol = 0.012;
      const shock = (rand() * 2 - 1) * vol;
      px = Math.max(1, px * (1 + drift + shock));
      out.push({ date: iso(d), close: px });
    }
    return out;
  }

  async function loadPricesForTickers(tickers, startISO, endISO) {
    const series = {};
    for (const t of tickers) {
      try {
        log(`Loading price history for ${t}...`);
        const rows = await fetchDailyCloses(t);
        const filtered = rows
          .filter((r) => r.date >= startISO && r.date <= endISO)
          .filter((r) => !!r.close && isFinite(r.close));
        if (filtered.length < 30) throw new Error("Too few rows in range");
        series[t] = filtered;
        log(`Loaded ${filtered.length} rows for ${t}.`);
      } catch (e) {
        log(`Could not load ${t}. Using synthetic series. (${e.message})`);
        series[t] = syntheticPrices(t, startISO, endISO);
      }
    }
    return series;
  }

  function alignTimeline(seriesByTicker) {
    const tickers = Object.keys(seriesByTicker);
    const maps = {};
    tickers.forEach((t) => {
      const m = new Map();
      seriesByTicker[t].forEach((r) => m.set(r.date, r.close));
      maps[t] = m;
    });

    // Choose shortest history as base
    let base = tickers[0];
    for (const t of tickers) if (seriesByTicker[t].length < seriesByTicker[base].length) base = t;

    const dates = [];
    for (const r of seriesByTicker[base]) {
      const d = r.date;
      let ok = true;
      for (const t of tickers) {
        if (!maps[t].has(d)) { ok = false; break; }
      }
      if (ok) dates.push(d);
    }

    const prices = {};
    tickers.forEach((t) => (prices[t] = dates.map((d) => maps[t].get(d))));
    return { dates, prices, tickers };
  }

  function buildBuySchedule(dates, freq) {
    const buy = new Array(dates.length).fill(false);

    if (freq === "daily") {
      for (let i = 0; i < dates.length; i++) buy[i] = true;
      return buy;
    }

    if (freq === "weekly") {
      let lastKey = null;
      for (let i = 0; i < dates.length; i++) {
        const d = new Date(dates[i] + "T00:00:00Z");
        const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const week = Math.floor((((d - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
        const key = `${d.getUTCFullYear()}-${week}`;
        if (key !== lastKey) { buy[i] = true; lastKey = key; }
      }
      return buy;
    }

    let lastMonth = null;
    for (let i = 0; i < dates.length; i++) {
      const d = new Date(dates[i] + "T00:00:00Z");
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
      if (key !== lastMonth) { buy[i] = true; lastMonth = key; }
    }
    return buy;
  }

  function buildAdjustSchedule(dates, freq) {
    if (freq === "daily") return new Array(dates.length).fill(true);
    if (freq === "weekly") return buildBuySchedule(dates, "weekly");
    if (freq === "monthly") return buildBuySchedule(dates, "monthly");
    return new Array(dates.length).fill(true);
  }

  function buildMonthEndSchedule(dates) {
    const isMonthEnd = new Array(dates.length).fill(false);
    for (let i = 0; i < dates.length; i++) {
      const d = new Date(dates[i] + "T00:00:00Z");
      const next = i < dates.length - 1 ? new Date(dates[i + 1] + "T00:00:00Z") : null;
      if (!next) isMonthEnd[i] = true;
      else if (d.getUTCMonth() !== next.getUTCMonth()) isMonthEnd[i] = true;
    }
    return isMonthEnd;
  }

  // =========================
  // Simulation engines
  // =========================
  function simulateCashOnly(params) {
    const { dates, prices, tickers, weights, startCash, dcaAmt, freq, rebalanceBuys } = params;
    const n = dates.length;

    const shares = {};
    tickers.forEach((t) => (shares[t] = 0));
    let cash = startCash;

    const equityArr = new Array(n).fill(0);
    const events = { dep: new Array(n).fill(0), buy: new Array(n).fill(0) };
    const buySignal = buildBuySchedule(dates, freq);

    function pv(i) {
      let v = 0;
      for (const t of tickers) v += shares[t] * prices[t][i];
      return v;
    }

    function curWeights(i) {
      const v = pv(i);
      const w = {};
      if (v <= 0) { tickers.forEach((t) => (w[t] = 0)); return w; }
      for (const t of tickers) w[t] = (shares[t] * prices[t][i]) / v;
      return w;
    }

    function allocate(i, amt) {
      if (amt <= 0) return;
      let w = weights.slice();

      if (rebalanceBuys) {
        const cw = curWeights(i);
        const raw = tickers.map((t, idx) => Math.max(0, weights[idx] - (cw[t] || 0)));
        const sum = raw.reduce((p, c) => p + c, 0);
        if (sum > 0) w = raw.map((x) => x / sum);
      }

      for (let k = 0; k < tickers.length; k++) {
        const t = tickers[k];
        const a = amt * (w[k] || 0);
        if (a <= 0) continue;
        shares[t] += a / prices[t][i];
        cash -= a;
        events.buy[i] += a;
      }
      if (Math.abs(cash) < 1e-8) cash = 0;
    }

    for (let i = 0; i < n; i++) {
      if (buySignal[i]) {
        cash += dcaAmt;
        events.dep[i] = dcaAmt;
        allocate(i, cash);
      }
      equityArr[i] = pv(i) + cash;
    }

    return {
      dates,
      equityArr,
      debtArr: new Array(n).fill(0),
      ltvArr: new Array(n).fill(0),
      coverArr: new Array(n).fill(NaN),
      targetDevArr: new Array(n).fill(0),
      taxReserveArr: new Array(n).fill(0),
      billsPaidArr: new Array(n).fill(0),
      events,
    };
  }

  function simulateMarginWithIncome(params) {
    const {
      dates, prices,
      coreTickers, coreWeights,
      incTickers, incWeights,
      startCash, dcaAmt, freq,
      useMargin, marginRateAPR, maxLTV, marginPolicy, dayCount,
      rebalanceBuys,
      incomeOn, incomeYieldAPR, incomeSplit, incomeMode, adjustFreq, targetRatio, allowTargetBorrow, bandMin, bandMax,
      billsOn, billsMonthly, taxRatePct, billsFallback, taxHandling,
    } = params;

    const n = dates.length;
    const allTickers = [...coreTickers, ...incTickers];
    const shares = {};
    allTickers.forEach((t) => (shares[t] = 0));

    let cash = startCash;
    let debt = 0;

    let taxReserve = 0;
    let billsPaidCum = 0;

    const equityArr = new Array(n).fill(0);
    const debtArr = new Array(n).fill(0);
    const ltvArr = new Array(n).fill(0);
    const coverArr = new Array(n).fill(NaN);
    const targetDevArr = new Array(n).fill(0);
    const taxReserveArr = new Array(n).fill(0);
    const billsPaidArr = new Array(n).fill(0);

    const ev = {
      dep: new Array(n).fill(0),
      buy: new Array(n).fill(0),
      income: new Array(n).fill(0),
      interest: new Array(n).fill(0),
      paydown: new Array(n).fill(0),
      borrowAdj: new Array(n).fill(0),
      borrowBuy: new Array(n).fill(0),
      dist: new Array(n).fill(0),
      tax: new Array(n).fill(0),
      bills: new Array(n).fill(0),
      billsShort: new Array(n).fill(0),
    };

    const buySignal = buildBuySchedule(dates, freq);
    const monthEnd = buildMonthEndSchedule(dates);
    const adjustSignal = buildAdjustSchedule(dates, adjustFreq);

    const dailyRate = (marginRateAPR / 100) / (Number(dayCount) || 365);
    const dailyIncomeRate = (incomeYieldAPR / 100) / (Number(dayCount) || 365);
    const monthlyIncomeRate = (incomeYieldAPR / 100) / 12;

    const split = clamp((Number(incomeSplit) || 0) / 100, 0, 1);
    const taxRate = clamp((Number(taxRatePct) || 0) / 100, 0, 0.95);

    function valueOf(ticker, i) { return shares[ticker] * prices[ticker][i]; }
    function pv(i) { let v = 0; for (const t of allTickers) v += valueOf(t, i); return v; }
    function incValue(i) { let v = 0; for (const t of incTickers) v += valueOf(t, i); return v; }

    function sleeveWeightsForRebalance(i, sleeveTickers, sleeveWeights) {
      let w = sleeveWeights.slice();
      if (!rebalanceBuys) return w;

      let sleeveV = 0;
      const curV = {};
      sleeveTickers.forEach((t) => { curV[t] = valueOf(t, i); sleeveV += curV[t]; });
      if (sleeveV <= 0) return w;

      const curW = {};
      sleeveTickers.forEach((t) => (curW[t] = curV[t] / sleeveV));

      const raw = sleeveTickers.map((t, idx) => Math.max(0, sleeveWeights[idx] - (curW[t] || 0)));
      const sum = raw.reduce((p, c) => p + c, 0);
      if (sum > 0) w = raw.map((x) => x / sum);
      return w;
    }

    function maxBorrowAllowed(i) {
      const v = pv(i);
      return Math.max(0, maxLTV * v);
    }

    function borrowToCash(i, amount, bucket) {
      if (!useMargin) return 0;
      if (marginPolicy === "off") return 0;
      if (amount <= 0) return 0;

      const allowed = maxBorrowAllowed(i);
      const headroom = Math.max(0, allowed - debt);
      const b = clamp(amount, 0, headroom);

      if (b > 0) {
        debt += b;
        cash += b;
        if (bucket === "buy") ev.borrowBuy[i] += b;
        else ev.borrowAdj[i] += b;
      }
      return b;
    }

    function payDownDebt(i, amount) {
      const p = clamp(amount, 0, Math.min(cash, debt));
      if (p > 0) {
        debt -= p;
        cash -= p;
        ev.paydown[i] += p;
      }
      return p;
    }

    function allocateToSleeve(i, amt, sleeveTickers, sleeveWeights) {
      if (amt <= 0 || sleeveTickers.length === 0) return;
      const w = sleeveWeightsForRebalance(i, sleeveTickers, sleeveWeights);

      for (let k = 0; k < sleeveTickers.length; k++) {
        const t = sleeveTickers[k];
        const a = amt * (w[k] || 0);
        if (a <= 0) continue;
        shares[t] += a / prices[t][i];
        cash -= a;
        ev.buy[i] += a;
      }
      if (Math.abs(cash) < 1e-8) cash = 0;
    }

    function computeTargetRatio(i) {
      if (incomeMode !== "price_band") return targetRatio;
      const v = pv(i);
      const minV = Math.max(0, Number(bandMin) || 0);
      const maxV = Math.max(0, Number(bandMax) || 0);
      if (maxV <= 0) return 0;
      if (v >= minV && v <= maxV) return targetRatio;
      return 0;
    }

    function applyMonthEndRouting(i, interestToday) {
      if (!billsOn) return;

      let dist = 0;
      if (incomeOn && incTickers.length > 0 && monthEnd[i]) {
        dist = incValue(i) * monthlyIncomeRate;
        if (dist > 0) { cash += dist; ev.dist[i] = dist; }
      }

      if (!monthEnd[i] || dist <= 0) return;

      if (useMargin && interestToday > 0) {
        payDownDebt(i, Math.min(cash, interestToday));
      }

      const taxAmt = Math.max(0, dist * taxRate);
      const taxPay = Math.min(cash, taxAmt);

      if (taxPay > 0) {
        if (taxHandling === "reserve") taxReserve += taxPay;
        cash -= taxPay;
        ev.tax[i] = taxPay;
      }

      const billsNeed = Math.max(0, Number(billsMonthly) || 0);
      if (billsNeed > 0) {
        const pay = Math.min(cash, billsNeed);
        if (pay > 0) { cash -= pay; ev.bills[i] = pay; billsPaidCum += pay; }
        const short = billsNeed - pay;
        if (short > 0) ev.billsShort[i] = short;
      }
    }

    function marginManagementStep(i, incomeToday, interestToday) {
      if (!useMargin || marginPolicy === "off") return;

      const v = pv(i);
      const ltv = v > 0 ? debt / v : 0;
      coverArr[i] = interestToday > 0 ? incomeToday / interestToday : incomeToday > 0 ? Infinity : NaN;

      if (!incomeOn) { targetDevArr[i] = 0; return; }
      if (incomeMode === "interest_only") { targetDevArr[i] = 0; return; }
      if (incomeMode === "interest_plus_principal") {
        payDownDebt(i, cash);
        targetDevArr[i] = 0;
        return;
      }

      const target = computeTargetRatio(i);
      targetDevArr[i] = ltv - target;

      if (!adjustSignal[i]) return;

      const desiredDebt = Math.max(0, target * v);
      const delta = desiredDebt - debt;

      if (delta < 0) payDownDebt(i, Math.min(cash, Math.abs(delta)));
      else if (delta > 0) { if (allowTargetBorrow) borrowToCash(i, delta, "adj"); }
    }

    for (let i = 0; i < n; i++) {
      let interestToday = 0;
      if (useMargin && debt > 0 && dailyRate > 0) {
        interestToday = debt * dailyRate;
        debt += interestToday;
        ev.interest[i] = interestToday;
      }

      let incomeToday = 0;
      if (incomeOn && incTickers.length > 0 && dailyIncomeRate > 0) {
        incomeToday = incValue(i) * dailyIncomeRate;
        ev.income[i] = incomeToday;
      }

      applyMonthEndRouting(i, interestToday);
      marginManagementStep(i, incomeToday, interestToday);

      if (buySignal[i]) {
        cash += dcaAmt;
        ev.dep[i] = dcaAmt;

        if (useMargin && marginPolicy === "always") {
          const v = pv(i);
          const desiredDebt = maxLTV * v;
          const extra = Math.max(0, desiredDebt - debt);
          borrowToCash(i, extra, "buy");
        }

        if (useMargin && marginPolicy === "assist") {
          const minInvest = Math.max(0, dcaAmt);
          if (cash < minInvest) borrowToCash(i, minInvest - cash, "buy");
        }

        const investable = cash;
        if (incTickers.length === 0) {
          allocateToSleeve(i, investable, coreTickers, coreWeights);
        } else {
          const toIncome = investable * split;
          const toCore = investable - toIncome;
          allocateToSleeve(i, toIncome, incTickers, incWeights);
          allocateToSleeve(i, toCore, coreTickers, coreWeights);
        }
      }

      const v = pv(i);
      const equity = v + cash - debt;
      const ltv = v > 0 ? debt / v : 0;

      equityArr[i] = equity;
      debtArr[i] = debt;
      ltvArr[i] = ltv;

      taxReserveArr[i] = taxReserve;
      billsPaidArr[i] = billsPaidCum;

      if (!isFinite(coverArr[i])) {
        coverArr[i] = ev.interest[i] > 0 ? ev.income[i] / ev.interest[i] : ev.income[i] > 0 ? Infinity : NaN;
      }
    }

    return { dates, equityArr, debtArr, ltvArr, coverArr, targetDevArr, taxReserveArr, billsPaidArr, events: ev };
  }

  // =========================
  // Canvas rendering
  // =========================
  const ctx = el.canvas.getContext("2d");

  function resizeCanvasToCSS() {
    const rect = el.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    el.canvas.width = Math.round(rect.width * dpr);
    el.canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawGrid(w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    const stepY = h / 7;
    for (let i = 1; i < 7; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * stepY); ctx.lineTo(w, i * stepY); ctx.stroke();
    }
    const stepX = w / 10;
    for (let i = 1; i < 10; i++) {
      ctx.beginPath(); ctx.moveTo(i * stepX, 0); ctx.lineTo(i * stepX, h); ctx.stroke();
    }
  }

  function minMax(arr, upto) {
    const a = arr.slice(0, Math.max(1, upto + 1));
    let mn = Infinity, mx = -Infinity;
    for (const v of a) {
      if (!isFinite(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!isFinite(mn) || !isFinite(mx) || mn === mx) { mn = 0; mx = (isFinite(mx) ? mx : 1) || 1; }
    return { mn, mx };
  }

  function plotLine(arr, upto, w, h, pad, stroke, range, alpha = 1) {
    const n = arr.length;
    if (!n) return;
    const u = Math.max(0, Math.min(Math.floor(upto), n - 1));

    const x0 = pad, x1 = w - pad;
    const y0 = pad, y1 = h - pad;
    const mn = range.mn, mx = range.mx;
    const span = (mx - mn) || 1;

    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = alpha;

    let started = false;
    ctx.beginPath();
    for (let i = 0; i <= u; i++) {
      const v = arr[i];
      if (!isFinite(v)) { started = false; continue; }
      const x = x0 + (x1 - x0) * (i / (n - 1));
      const y = y1 - (y1 - y0) * ((v - mn) / span);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawCursor(i, w, h, pad, n) {
    const x0 = pad, x1 = w - pad;
    const x = x0 + (x1 - x0) * (i / (n - 1));
    ctx.strokeStyle = "rgba(239,81,34,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, h - pad); ctx.stroke();
  }

  function drawTimelineTicks(i, w, h, pad) {
    const zoneH = 64;
    const baseY = h - pad - 6;
    const topY = baseY - zoneH;
    const x0 = pad, x1 = w - pad;
    const n = state.cashSim.dates.length;

    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(x0, topY, x1 - x0, zoneH);

    const ev = state.marginSim.events;

    const maxDep = Math.max(...ev.dep.slice(0, i + 1), 1);
    const maxBuy = Math.max(...ev.buy.slice(0, i + 1), 1);
    const maxDist = Math.max(...ev.dist.slice(0, i + 1), 1);
    const maxTax = Math.max(...ev.tax.slice(0, i + 1), 1);
    const maxBills = Math.max(...ev.bills.slice(0, i + 1), 1);

    for (let k = 0; k <= i; k++) {
      const x = x0 + (x1 - x0) * (k / (n - 1));

      if (ev.dep[k] > 0) {
        const hh = 10 * (ev.dep[k] / maxDep);
        ctx.strokeStyle = "rgba(245,245,245,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(x, baseY - hh); ctx.stroke();
      }
      if (ev.buy[k] > 0) {
        const hh = 14 * (ev.buy[k] / maxBuy);
        ctx.strokeStyle = "rgba(239,81,34,0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, baseY - 12); ctx.lineTo(x, baseY - 12 - hh); ctx.stroke();
      }
      if (ev.dist[k] > 0) {
        const hh = 10 * (ev.dist[k] / maxDist);
        ctx.strokeStyle = "rgba(245,245,245,0.40)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, baseY - 28); ctx.lineTo(x, baseY - 28 - hh); ctx.stroke();
      }
      if (ev.tax[k] > 0) {
        const hh = 10 * (ev.tax[k] / maxTax);
        ctx.strokeStyle = "rgba(245,245,245,0.22)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, baseY - 40); ctx.lineTo(x, baseY - 40 - hh); ctx.stroke();
      }
      if (ev.bills[k] > 0) {
        const hh = 10 * (ev.bills[k] / maxBills);
        ctx.strokeStyle = "rgba(245,245,245,0.80)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, baseY - 52); ctx.lineTo(x, baseY - 52 - hh); ctx.stroke();
      }
    }
  }

  function updateRiskUI(i) {
    const maxLTV = state.meta.maxLTV;
    const ltv = state.marginSim.ltvArr[i];
    const cover = state.marginSim.coverArr[i];
    const dev = state.marginSim.targetDevArr[i];

    const marginActive = state.meta.useMargin;
    if (!marginActive || maxLTV <= 0) {
      if (el.riskGrade) el.riskGrade.textContent = "OFF";
      if (el.riskFill) el.riskFill.style.width = "0%";
      if (el.riskProx) el.riskProx.textContent = "—";
      if (el.riskDev) el.riskDev.textContent = "—";
      if (el.riskSignal) el.riskSignal.textContent = "Margin disabled";
      return;
    }

    const prox = clamp(ltv / maxLTV, 0, 1.25);
    if (el.riskFill) el.riskFill.style.width = (clamp(prox, 0, 1) * 100).toFixed(1) + "%";
    if (el.riskProx) el.riskProx.textContent = (prox * 100).toFixed(1) + "%";
    if (el.riskDev) el.riskDev.textContent = isFinite(dev) ? (dev >= 0 ? "+" : "") + fmtPct(dev) : "—";

    let grade = "LOW";
    let signal = "Healthy buffer";

    if (prox >= 0.5) { grade = "MODERATE"; signal = "Leverage is material"; }
    if (prox >= 0.7) { grade = "ELEVATED"; signal = "Stress can accelerate risk"; }
    if (prox >= 0.85) { grade = "HIGH"; signal = "Close to limit"; }
    if (prox >= 0.95) { grade = "CRITICAL"; signal = "Very low buffer"; }
    if (prox >= 1.0) { grade = "LIMIT"; signal = "At or beyond max LTV"; }

    if (isFinite(cover) && cover >= 1 && prox < 0.95) signal = "Income covers interest";
    if (isFinite(cover) && cover < 1 && prox >= 0.7) signal = "Income does not cover interest";

    if (el.riskGrade) el.riskGrade.textContent = grade;
    if (el.riskSignal) el.riskSignal.textContent = signal;
  }

  const state = {
    built: false,
    playing: false,
    i: 0,
    lastTs: 0,
    cashSim: null,
    marginSim: null,
    meta: { name: "", useMargin: false, maxLTV: 0 },
  };

  function setControlsBuilt(on) {
    if (el.play) el.play.disabled = !on;
    if (el.pause) el.pause.disabled = !on;
    if (el.step) el.step.disabled = !on;
    if (el.toEnd) el.toEnd.disabled = !on;
  }

  function drawFrame(i) {
    if (!state.built) return;

    resizeCanvasToCSS();

    const rect = el.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const pad = 18;

    drawGrid(w, h);

    const mode = el.mode?.value || "equity";

    const rCash = minMax(state.cashSim.equityArr, i);
    const rMar = minMax(state.marginSim.equityArr, i);
    const rangeEq = { mn: Math.min(rCash.mn, rMar.mn), mx: Math.max(rCash.mx, rMar.mx) };

    if (mode === "equity") {
      plotLine(state.cashSim.equityArr, i, w, h, pad, "rgba(245,245,245,0.75)", rangeEq);
      plotLine(state.marginSim.equityArr, i, w, h, pad, "rgba(239,81,34,0.95)", rangeEq);
    } else if (mode === "debt") {
      const rD = minMax(state.marginSim.debtArr, i);
      plotLine(state.marginSim.debtArr, i, w, h, pad, "rgba(245,245,245,0.85)", rD);
    } else {
      plotLine(state.cashSim.equityArr, i, w, h, pad, "rgba(245,245,245,0.75)", rangeEq);
      plotLine(state.marginSim.equityArr, i, w, h, pad, "rgba(239,81,34,0.95)", rangeEq);
      const rD = minMax(state.marginSim.debtArr, i);
      plotLine(state.marginSim.debtArr, i, w, h, pad, "rgba(245,245,245,0.85)", rD, 0.5);
    }

    drawCursor(i, w, h, pad, state.cashSim.dates.length);
    drawTimelineTicks(i, w, h, pad);

    const date = state.cashSim.dates[i] || "—";
    const eqCash = state.cashSim.equityArr[i];
    const eqMar = state.marginSim.equityArr[i];
    const debt = state.marginSim.debtArr[i];
    const ltv = state.marginSim.ltvArr[i];
    const cover = state.marginSim.coverArr[i];
    const taxRes = state.marginSim.taxReserveArr[i];
    const billsP = state.marginSim.billsPaidArr[i];

    if (el.kDate) el.kDate.textContent = date;
    if (el.kEqCash) el.kEqCash.textContent = fmtUSD(eqCash);
    if (el.kEqMargin) el.kEqMargin.textContent = fmtUSD(eqMar);
    if (el.kDebt) el.kDebt.textContent = fmtUSD(debt);
    if (el.kLTV) el.kLTV.textContent = fmtPct(ltv);
    if (el.kCover) el.kCover.textContent = isFinite(cover) ? (cover === Infinity ? "∞" : cover.toFixed(2) + "x") : "—";
    if (el.kTax) el.kTax.textContent = fmtUSD(taxRes);
    if (el.kBills) el.kBills.textContent = fmtUSD(billsP);

    updateRiskUI(i);

    const totalDays = state.cashSim.dates.length;
    const label = state.meta.name || "Simulated Account";
    if (el.vizDesc) el.vizDesc.textContent = `${label} • Day ${i + 1} / ${totalDays}`;
  }

  function tick(ts) {
    if (!state.playing) { state.lastTs = ts; return; }
    const dt = (ts - state.lastTs) / 1000;
    state.lastTs = ts;

    const speed = Number(el.speed?.value || 60);
    const advance = speed * dt;

    const n = state.cashSim.dates.length;
    state.i = Math.min(n - 1, state.i + advance);

    drawFrame(Math.floor(state.i));

    if (Math.floor(state.i) >= n - 1) {
      state.playing = false;
      log("Reached end of simulation.");
    } else {
      requestAnimationFrame(tick);
    }
  }

  function safeFileBase() {
    const name = (state.meta?.name || "simulated-portfolio").trim() || "simulated-portfolio";
    const clean = name.replace(/[^a-z0-9\-_]+/gi, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "");
    const start = state.cashSim?.dates?.[0] || "";
    const end = state.cashSim?.dates?.[state.cashSim.dates.length - 1] || "";
    return `${clean}_${start}_to_${end}`.replace(/__+/g, "_");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadCanvasPNG() {
    if (!state.built) { showAlert("Build a simulation first."); return; }
    drawFrame(Math.floor(state.i));
    const filename = `${safeFileBase()}.png`;
    el.canvas.toBlob((blob) => {
      if (!blob) { showAlert("PNG export failed."); return; }
      downloadBlob(blob, filename);
      log(`Exported PNG: ${filename}`);
    }, "image/png");
  }

  function downloadSimulationCSV() {
    if (!state.built) { showAlert("Build a simulation first."); return; }

    const dates = state.cashSim.dates;
    const eqCash = state.cashSim.equityArr;
    const eqMar = state.marginSim.equityArr;
    const debt = state.marginSim.debtArr;
    const ltv = state.marginSim.ltvArr;
    const cover = state.marginSim.coverArr;
    const taxRes = state.marginSim.taxReserveArr;
    const billsPaid = state.marginSim.billsPaidArr;

    const ev = state.marginSim.events || {};
    const dep = ev.dep || [];
    const buy = ev.buy || [];
    const income = ev.income || [];
    const interest = ev.interest || [];
    const paydown = ev.paydown || [];
    const borrowAdj = ev.borrowAdj || [];
    const borrowBuy = ev.borrowBuy || [];
    const dist = ev.dist || [];
    const tax = ev.tax || [];
    const bills = ev.bills || [];
    const billsShort = ev.billsShort || [];

    const header = [
      "date","equity_cash_only","equity_with_margin","debt","ltv","income_coverage","tax_reserve","bills_paid_cum",
      "event_deposit","event_buy","event_income_daily","event_interest","event_paydown","event_borrow_adjust","event_borrow_buy",
      "event_dist_monthly","event_tax","event_bills","event_bills_short",
    ].join(",");

    const rows = [header];

    for (let i = 0; i < dates.length; i++) {
      const line = [
        dates[i],
        isFinite(eqCash[i]) ? eqCash[i] : "",
        isFinite(eqMar[i]) ? eqMar[i] : "",
        isFinite(debt[i]) ? debt[i] : "",
        isFinite(ltv[i]) ? ltv[i] : "",
        cover[i] === Infinity ? "Infinity" : isFinite(cover[i]) ? cover[i] : "",
        isFinite(taxRes[i]) ? taxRes[i] : "",
        isFinite(billsPaid[i]) ? billsPaid[i] : "",
        isFinite(dep[i]) ? dep[i] : 0,
        isFinite(buy[i]) ? buy[i] : 0,
        isFinite(income[i]) ? income[i] : 0,
        isFinite(interest[i]) ? interest[i] : 0,
        isFinite(paydown[i]) ? paydown[i] : 0,
        isFinite(borrowAdj[i]) ? borrowAdj[i] : 0,
        isFinite(borrowBuy[i]) ? borrowBuy[i] : 0,
        isFinite(dist[i]) ? dist[i] : 0,
        isFinite(tax[i]) ? tax[i] : 0,
        isFinite(bills[i]) ? bills[i] : 0,
        isFinite(billsShort[i]) ? billsShort[i] : 0,
      ].join(",");
      rows.push(line);
    }

    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const filename = `${safeFileBase()}.csv`;
    downloadBlob(blob, filename);
    log(`Exported CSV: ${filename}`);
  }

  async function buildSimulation() {
    el.log.textContent = "Building simulation...\n";
    showAlert(null);

    const name = (el.name?.value || "").trim();
    const startCash = Math.max(0, Number(el.startCash?.value) || 0);
    const dcaAmt = Math.max(0, Number(el.dcaAmt?.value) || 0);
    const freq = el.freq?.value || "daily";
    const startISO = el.startDate?.value;
    const endISO = el.endDate?.value;

    if (!startISO || !endISO || startISO > endISO) {
      log("Invalid date range.");
      showAlert("Invalid date range.");
      return;
    }

    // Core allocation: read from hidden fields (builder maintains these)
    const coreAlloc = getCoreAllocFromHidden();
    const coreTickers = coreAlloc.tickers;
    const coreW = coreAlloc.weights;

    if (!coreTickers.length) {
      log("Core tickers are empty. Add at least one core ticker.");
      showAlert("Add at least one core ticker.");
      return;
    }

    // Income (only if enabled)
    const incomeOn = !!el.incomeOn?.checked;
    const incTickers = incomeOn
      ? String(el.incomeTickers?.value || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
      : [];
    const incWeightsRaw = incomeOn ? normWeights(String(el.incomeWeights?.value || "").split(",").map((s) => s.trim())) : [];

    const incomeSplit = clamp(Number(el.incomeSplit?.value) || 0, 0, 100);
    const incomeYieldAPR = Math.max(0, Number(el.incomeYield?.value) || 0);

    // Margin
    const marginPolicy = el.marginPolicy?.value || "assist";
    const useMargin = !!el.useMargin?.checked && marginPolicy !== "off";
    const marginRateAPR = Math.max(0, Number(el.marginRate?.value) || 0);
    const maxLTV = clamp((Number(el.maxLTV?.value) || 0) / 100, 0, 0.95);
    const dayCount = Number(el.dayCount?.value) || 365;

    const incomeMode = el.incomeMode?.value || "interest_only";
    const adjustFreq = el.adjustFreq?.value || "weekly";
    const targetRatio = clamp((Number(el.targetRatio?.value) || 0) / 100, 0, 0.95);
    const allowTargetBorrow = (el.targetBorrow?.value || "no") === "yes";
    const bandMin = Math.max(0, Number(el.bandMin?.value) || 0);
    const bandMax = Math.max(0, Number(el.bandMax?.value) || 0);

    const rebalanceBuys = !!el.rebalance?.checked;

    const billsOn = !!el.billsOn?.checked;
    const billsMonthly = Math.max(0, Number(el.billsMonthly?.value) || 0);
    const taxRatePct = clamp(Number(el.taxRate?.value) || 0, 0, 80);
    const billsFallback = el.billsFallback?.value || "cash";
    const taxHandling = el.taxHandling?.value || "reserve";

    // Income weights normalized with fallback
    const incWeights = incTickers.map((_, i) => incWeightsRaw[i] ?? (incTickers.length ? 1 / incTickers.length : 0));
    const incSum = incWeights.reduce((p, c) => p + c, 0) || 1;
    const incW = incTickers.length ? incWeights.map((x) => x / incSum) : [];

    const allTickers = [...new Set([...coreTickers, ...incTickers])];

    log(`Loading prices for ${allTickers.length} ticker(s)...`);
    const series = await loadPricesForTickers(allTickers, startISO, endISO);
    const aligned = alignTimeline(series);

    if (aligned.dates.length < 80) {
      log("Not enough overlapping history across tickers. Try a wider range or fewer tickers.");
      showAlert("Not enough overlapping history. Try a wider range or fewer tickers.");
      return;
    }

    // Keyed by ticker
    const prices = {};
    for (const t of allTickers) {
      const seriesArr = aligned?.prices?.[t];
      if (!seriesArr || !Array.isArray(seriesArr) || seriesArr.length === 0) {
        throw new Error(`Aligned timeline missing ticker: ${t}. Try a wider date range or remove the shortest-history ticker.`);
      }
      if (seriesArr.length !== aligned.dates.length) {
        throw new Error(`Aligned series length mismatch for ${t}: ${seriesArr.length} vs dates ${aligned.dates.length}`);
      }
      prices[t] = seriesArr;
    }

    const cashSim = simulateCashOnly({
      dates: aligned.dates,
      prices,
      tickers: coreTickers,
      weights: coreW,
      startCash,
      dcaAmt,
      freq,
      rebalanceBuys,
    });

    const marginSim = simulateMarginWithIncome({
      dates: aligned.dates,
      prices,
      coreTickers,
      coreWeights: coreW,
      incTickers,
      incWeights: incW,
      startCash,
      dcaAmt,
      freq,
      useMargin,
      marginRateAPR,
      maxLTV,
      marginPolicy,
      dayCount,
      rebalanceBuys,
      incomeOn,
      incomeYieldAPR,
      incomeSplit,
      incomeMode,
      adjustFreq,
      targetRatio,
      allowTargetBorrow,
      bandMin,
      bandMax,
      billsOn,
      billsMonthly,
      taxRatePct,
      billsFallback,
      taxHandling,
    });

    state.cashSim = cashSim;
    state.marginSim = marginSim;
    state.meta = { name, useMargin, maxLTV };
    state.built = true;
    state.playing = false;
    state.i = 0;
    state.lastTs = performance.now();

    if (el.badge) el.badge.textContent = useMargin ? "SIMULATED (COMPARE + MARGIN)" : "SIMULATED (COMPARE)";
    setControlsBuilt(true);
    drawFrame(0);

    log(`Built: ${aligned.dates.length} market days.`);
    log(`With margin: ${useMargin ? "ON" : "OFF"} • income: ${incomeOn ? "ON" : "OFF"} • bills/taxes: ${billsOn ? "ON" : "OFF"}.`);
  }

  // =========================
  // Wiring
  // =========================
  if (el.speed && el.speedLabel) {
    el.speed.addEventListener("input", () => { el.speedLabel.textContent = `${el.speed.value} d/s`; });
    el.speedLabel.textContent = `${el.speed.value} d/s`;
  }

  el.build.addEventListener("click", () => {
    buildSimulation()
      .then(() => {})
      .catch((e) => {
        console.error(e);
        log(`Build failed: ${e?.message || e}`);
        showAlert(`Build failed: ${e?.message || e}`);
      });
  });

  el.reset.addEventListener("click", () => {
    state.built = false;
    state.playing = false;
    state.i = 0;
    state.cashSim = null;
    state.marginSim = null;
    state.meta = { name: "", useMargin: false, maxLTV: 0 };
    showAlert(null);

    setControlsBuilt(false);

    if (el.kDate) el.kDate.textContent = "—";
    if (el.kEqCash) el.kEqCash.textContent = "—";
    if (el.kEqMargin) el.kEqMargin.textContent = "—";
    if (el.kDebt) el.kDebt.textContent = "—";
    if (el.kLTV) el.kLTV.textContent = "—";
    if (el.kCover) el.kCover.textContent = "—";
    if (el.kTax) el.kTax.textContent = "—";
    if (el.kBills) el.kBills.textContent = "—";

    if (el.riskGrade) el.riskGrade.textContent = "—";
    if (el.riskFill) el.riskFill.style.width = "0%";
    if (el.riskProx) el.riskProx.textContent = "—";
    if (el.riskDev) el.riskDev.textContent = "—";
    if (el.riskSignal) el.riskSignal.textContent = "—";

    if (el.vizDesc) el.vizDesc.textContent = "Build a simulation to begin.";
    if (el.badge) el.badge.textContent = "SIMULATED";
    el.log.textContent = "Ready.";

    resizeCanvasToCSS();
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
  });

  if (el.play) el.play.addEventListener("click", () => {
    if (!state.built) return;
    const n = state.cashSim.dates.length;
    if (Math.floor(state.i) >= n - 1) state.i = 0;
    state.playing = true;
    state.lastTs = performance.now();
    log("Play.");
    requestAnimationFrame(tick);
  });

  if (el.pause) el.pause.addEventListener("click", () => {
    if (!state.built) return;
    state.playing = false;
    log("Pause.");
  });

  if (el.step) el.step.addEventListener("click", () => {
    if (!state.built) return;
    state.playing = false;
    const n = state.cashSim.dates.length;
    state.i = Math.min(n - 1, Math.floor(state.i) + 1);
    drawFrame(Math.floor(state.i));
  });

  if (el.toEnd) el.toEnd.addEventListener("click", () => {
    if (!state.built) return;
    state.playing = false;
    state.i = state.cashSim.dates.length - 1;
    drawFrame(Math.floor(state.i));
    log("Jumped to end.");
  });

  if (el.mode) el.mode.addEventListener("change", () => {
    if (state.built) drawFrame(Math.floor(state.i));
  });

  if (el.dlPng) el.dlPng.addEventListener("click", downloadCanvasPNG);
  if (el.dlCsv) el.dlCsv.addEventListener("click", downloadSimulationCSV);

  window.addEventListener("resize", () => {
    if (state.built) drawFrame(Math.floor(state.i));
  });

  resizeCanvasToCSS();
})();
