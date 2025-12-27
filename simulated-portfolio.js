(() => {
  // ========= Guard =========
  if (window.__microdcaSimPortfolioLoaded) return;
  window.__microdcaSimPortfolioLoaded = true;

  // ===================== Utilities =====================
  const $ = (id) => document.getElementById(id);
  const fmtUSD = (x) => {
    if (!isFinite(x)) return "—";
    const sign = x < 0 ? "-" : "";
    const v = Math.abs(x);
    return sign + v.toLocaleString(undefined, { style:"currency", currency:"USD", maximumFractionDigits:2 });
  };
  const fmtPct = (x) => isFinite(x) ? (x*100).toFixed(2) + "%" : "—";
  const iso = (d) => d.toISOString().slice(0,10);
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const normWeights = (arr) => {
    const clean = arr.map(x => Math.max(0, Number(x) || 0));
    const s = clean.reduce((p,c)=>p+c,0);
    if (s <= 0) return clean.map(_=>0);
    return clean.map(x => x / s);
  };
  const isMarketDay = (dateObj) => {
    const d = dateObj.getUTCDay();
    return d !== 0 && d !== 6;
  };
  const parseCsv = (text) => {
    const lines = text.trim().split(/\r?\n/);
    const out = [];
    for (let i=1;i<lines.length;i++){
      const parts = lines[i].split(",");
      if (parts.length < 5) continue;
      const date = parts[0];
      const close = Number(parts[4]);
      if (!date || !isFinite(close)) continue;
      out.push({ date, close });
    }
    return out;
  };

  // ===================== DOM (expects Webflow markup present) =====================
  const el = {
    name: $("spName"),
    startCash: $("spStartCash"),
    dcaAmt: $("spDcaAmt"),
    freq: $("spFreq"),
    startDate: $("spStartDate"),
    endDate: $("spEndDate"),
    rebalance: $("spRebalance"),

    useMargin: $("spUseMargin"),
    marginRate: $("spMarginRate"),
    maxLTV: $("spMaxLTV"),
    marginPolicy: $("spMarginPolicy"),
    dayCount: $("spDayCount"),

    coreTickers: $("spTickers"),
    coreWeights: $("spWeights"),
    allocPreview: $("spAllocPreview")?.querySelector("tbody"),
    updateAlloc: $("spUpdateAlloc"),

    incomeOn: $("spIncomeOn"),
    incomeTickers: $("spIncomeTickers"),
    incomeWeights: $("spIncomeWeights"),
    incomeSplit: $("spIncomeSplit"),
    incomeYield: $("spIncomeYield"),
    incomeMode: $("spIncomeMode"),
    adjustFreq: $("spAdjustFreq"),
    targetRatio: $("spTargetRatio"),
    targetBorrow: $("spTargetBorrow"),
    targetRow: $("spTargetRow"),
    bandRow: $("spBandRow"),
    bandMin: $("spBandMin"),
    bandMax: $("spBandMax"),

    build: $("spBuild"),
    reset: $("spReset"),
    play: $("spPlay"),
    pause: $("spPause"),
    step: $("spStep"),
    toEnd: $("spToEnd"),

    speed: $("spSpeed"),
    speedLabel: $("spSpeedLabel"),
    mode: $("spMode"),

    badge: $("spBadge"),
    vizDesc: $("spVizDesc"),
    log: $("spLog"),
    alert: $("spAlert"),

    kDate: $("kDate"),
    kEqCash: $("kEqCash"),
    kEqMargin: $("kEqMargin"),
    kDebt: $("kDebt"),
    kLTV: $("kLTV"),
    kCover: $("kCover"),

    riskGrade: $("riskGrade"),
    riskFill: $("riskFill"),
    riskProx: $("riskProx"),
    riskDev: $("riskDev"),
    riskSignal: $("riskSignal"),

    canvas: $("spCanvas")
  };

  // If this page does not contain the widget, exit safely.
  if (!el.canvas || !el.build || !el.reset) return;

  // Default dates (~3 years)
  const today = new Date();
  const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const start = new Date(end.getTime() - 1000*60*60*24*365*3);
  el.startDate.value = iso(start);
  el.endDate.value = iso(end);

  // ===================== UI helpers =====================
  function syncIncomeModeUI(){
    const mode = el.incomeMode.value;
    if (mode === "price_band"){
      el.bandRow?.classList.remove("hidden");
      el.targetRow?.classList.add("hidden");
    } else if (mode === "target_ratio"){
      el.bandRow?.classList.add("hidden");
      el.targetRow?.classList.remove("hidden");
    } else {
      el.bandRow?.classList.add("hidden");
      el.targetRow?.classList.add("hidden");
    }
  }
  el.incomeMode.addEventListener("change", syncIncomeModeUI);
  syncIncomeModeUI();

  function log(msg){
    const t = new Date();
    const stamp = t.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });
    el.log.textContent = `[${stamp}] ${msg}\n` + el.log.textContent;
  }

  let alertTimer = null;
  function showAlert(msg){
    if (!msg){ el.alert.style.display = "none"; el.alert.textContent = ""; return; }
    el.alert.textContent = msg;
    el.alert.style.display = "block";
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => { el.alert.style.display = "none"; }, 2600);
  }

  function previewAlloc(){
    const tickers = el.coreTickers.value.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    const weights = normWeights(el.coreWeights.value.split(",").map(s => s.trim()));
    if (!el.allocPreview) return;

    el.allocPreview.innerHTML = "";
    tickers.forEach((t,i) => {
      const w = weights[i] ?? 0;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${t}</td>
        <td class="mono">${(w*100).toFixed(2)}%</td>
        <td>${i === 0 ? "Anchor position" : "Satellite / diversifier"}</td>
      `;
      el.allocPreview.appendChild(tr);
    });

    if (!tickers.length){
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="3">Add tickers to preview allocation.</td>`;
      el.allocPreview.appendChild(tr);
    }
  }
  el.updateAlloc?.addEventListener("click", previewAlloc);
  previewAlloc();

  // ===================== Price loader =====================
  async function fetchDailyCloses(ticker){
    // Default demo source: Stooq
    // If you prefer, swap this to your Cloudflare Worker endpoint used by backtesting.
    const t = ticker.toLowerCase();
    const stooqSymbol = t.includes(".") ? t : `${t}.us`;
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`Price fetch failed (${ticker})`);
    const text = await res.text();
    const rows = parseCsv(text);
    if (!rows.length) throw new Error(`No data returned (${ticker})`);
    return rows;
  }

  function syntheticPrices(ticker, startISO, endISO){
    let seed = 0;
    for (let i=0;i<ticker.length;i++) seed = (seed*31 + ticker.charCodeAt(i)) >>> 0;
    const rand = () => ((seed = (1664525*seed + 1013904223)>>>0) / 4294967296);

    const start = new Date(startISO + "T00:00:00Z");
    const end = new Date(endISO + "T00:00:00Z");
    const out = [];
    let px = 60 + rand()*180;

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)){
      if (!isMarketDay(d)) continue;
      const drift = 0.00025;
      const vol = 0.012;
      const shock = (rand()*2 - 1) * vol;
      px = Math.max(1, px * (1 + drift + shock));
      out.push({ date: iso(d), close: px });
    }
    return out;
  }

  async function loadPricesForTickers(tickers, startISO, endISO){
    const series = {};
    for (const t of tickers){
      try{
        log(`Loading price history for ${t}...`);
        const rows = await fetchDailyCloses(t);
        const filtered = rows
          .filter(r => r.date >= startISO && r.date <= endISO)
          .filter(r => !!r.close && isFinite(r.close));
        if (filtered.length < 30) throw new Error("Too few rows in range");
        series[t] = filtered;
        log(`Loaded ${filtered.length} rows for ${t}.`);
      }catch(e){
        log(`Could not load ${t}. Using synthetic series. (${e.message})`);
        series[t] = syntheticPrices(t, startISO, endISO);
      }
    }
    return series;
  }

  function alignTimeline(seriesByTicker){
    const tickers = Object.keys(seriesByTicker);
    const maps = {};
    tickers.forEach(t => {
      const m = new Map();
      seriesByTicker[t].forEach(r => m.set(r.date, r.close));
      maps[t] = m;
    });

    let base = tickers[0];
    for (const t of tickers) if (seriesByTicker[t].length < seriesByTicker[base].length) base = t;

    const dates = [];
    for (const r of seriesByTicker[base]){
      const d = r.date;
      let ok = true;
      for (const t of tickers){
        if (!maps[t].has(d)) { ok = false; break; }
      }
      if (ok) dates.push(d);
    }

    const prices = {};
    tickers.forEach(t => prices[t] = dates.map(d => maps[t].get(d)));
    return { dates, prices, tickers };
  }

  // ===================== Schedules =====================
  function buildBuySchedule(dates, freq){
    const buy = new Array(dates.length).fill(false);

    if (freq === "daily"){
      for (let i=0;i<dates.length;i++) buy[i] = true;
      return buy;
    }

    if (freq === "weekly"){
      let lastKey = null;
      for (let i=0;i<dates.length;i++){
        const d = new Date(dates[i] + "T00:00:00Z");
        const onejan = new Date(Date.UTC(d.getUTCFullYear(),0,1));
        const week = Math.floor((((d - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
        const key = `${d.getUTCFullYear()}-${week}`;
        if (key !== lastKey){ buy[i] = true; lastKey = key; }
      }
      return buy;
    }

    // monthly
    let lastMonth = null;
    for (let i=0;i<dates.length;i++){
      const d = new Date(dates[i] + "T00:00:00Z");
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()+1}`;
      if (key !== lastMonth){ buy[i] = true; lastMonth = key; }
    }
    return buy;
  }

  function isAdjustDay(i, dates, freq){
    if (freq === "daily") return true;
    if (freq === "weekly") return buildBuySchedule(dates, "weekly")[i] === true;
    if (freq === "monthly") return buildBuySchedule(dates, "monthly")[i] === true;
    return true;
  }

  // ===================== Simulation: Cash-only baseline =====================
  function simulateCashOnly(params){
    const { dates, prices, tickers, weights, startCash, dcaAmt, freq, rebalanceBuys } = params;
    const n = dates.length;

    const shares = {};
    tickers.forEach(t => shares[t] = 0);
    let cash = startCash;

    const equityArr = new Array(n).fill(0);
    const events = { dep: new Array(n).fill(0), buy: new Array(n).fill(0) };
    const buySignal = buildBuySchedule(dates, freq);

    function pv(i){
      let v = 0;
      for (const t of tickers) v += shares[t] * prices[t][i];
      return v;
    }

    function curWeights(i){
      const v = pv(i);
      const w = {};
      if (v <= 0){ tickers.forEach(t => w[t]=0); return w; }
      for (const t of tickers) w[t] = (shares[t] * prices[t][i]) / v;
      return w;
    }

    function allocate(i, amt){
      if (amt <= 0) return;
      let w = weights.slice();

      if (rebalanceBuys){
        const cw = curWeights(i);
        const raw = tickers.map((t,idx) => Math.max(0, weights[idx] - (cw[t] || 0)));
        const sum = raw.reduce((p,c)=>p+c,0);
        if (sum > 0) w = raw.map(x => x/sum);
      }

      for (let k=0;k<tickers.length;k++){
        const t = tickers[k];
        const a = amt * (w[k] || 0);
        if (a <= 0) continue;
        shares[t] += a / prices[t][i];
        cash -= a;
        events.buy[i] += a;
      }
      if (Math.abs(cash) < 1e-8) cash = 0;
    }

    for (let i=0;i<n;i++){
      if (buySignal[i]){
        cash += dcaAmt;
        events.dep[i] = dcaAmt;
        allocate(i, cash);
      }
      equityArr[i] = pv(i) + cash;
    }

    return { dates, equityArr, debtArr: new Array(n).fill(0), ltvArr: new Array(n).fill(0), coverArr: new Array(n).fill(NaN), targetDevArr: new Array(n).fill(0), events };
  }

  // ===================== Simulation: Margin + Income management =====================
  function simulateMarginWithIncome(params){
    const {
      dates, prices,
      coreTickers, coreWeights,
      incTickers, incWeights,
      startCash, dcaAmt, freq,
      useMargin, marginRateAPR, maxLTV, marginPolicy, dayCount,
      rebalanceBuys,
      incomeOn, incomeYieldAPR, incomeSplit,
      incomeMode, adjustFreq,
      targetRatio, allowTargetBorrow,
      bandMin, bandMax
    } = params;

    const n = dates.length;
    const allTickers = [...coreTickers, ...incTickers];
    const shares = {};
    allTickers.forEach(t => shares[t] = 0);

    let cash = startCash;
    let debt = 0;

    const equityArr = new Array(n).fill(0);
    const debtArr = new Array(n).fill(0);
    const ltvArr = new Array(n).fill(0);
    const coverArr = new Array(n).fill(NaN);
    const targetDevArr = new Array(n).fill(0);

    const ev = {
      dep: new Array(n).fill(0),
      buy: new Array(n).fill(0),
      income: new Array(n).fill(0),
      interest: new Array(n).fill(0),
      paydown: new Array(n).fill(0),
      borrowAdj: new Array(n).fill(0),
      borrowBuy: new Array(n).fill(0)
    };

    const buySignal = buildBuySchedule(dates, freq);
    const dailyRate = (marginRateAPR/100) / (Number(dayCount) || 365);
    const dailyIncomeRate = (incomeYieldAPR/100) / (Number(dayCount) || 365);
    const split = clamp((Number(incomeSplit) || 0)/100, 0, 1);

    function valueOf(ticker, i){ return shares[ticker] * prices[ticker][i]; }
    function pv(i){
      let v = 0;
      for (const t of allTickers) v += valueOf(t, i);
      return v;
    }
    function incValue(i){
      let v = 0;
      for (const t of incTickers) v += valueOf(t, i);
      return v;
    }
    function sleeveWeightsForRebalance(i, sleeveTickers, sleeveWeights){
      let w = sleeveWeights.slice();
      if (!rebalanceBuys) return w;

      let sleeveV = 0;
      const curV = {};
      sleeveTickers.forEach(t => { curV[t] = valueOf(t, i); sleeveV += curV[t]; });

      if (sleeveV <= 0) return w;

      const curW = {};
      sleeveTickers.forEach(t => curW[t] = curV[t] / sleeveV);

      const raw = sleeveTickers.map((t,idx) => Math.max(0, sleeveWeights[idx] - (curW[t] || 0)));
      const sum = raw.reduce((p,c)=>p+c,0);
      if (sum > 0) w = raw.map(x => x/sum);

      return w;
    }

    function maxBorrowAllowed(i){
      const v = pv(i);
      return Math.max(0, maxLTV * v);
    }

    function borrowToCash(i, amount, bucket){
      if (!useMargin) return 0;
      if (marginPolicy === "off") return 0;
      if (amount <= 0) return 0;

      const allowed = maxBorrowAllowed(i);
      const headroom = Math.max(0, allowed - debt);
      const b = clamp(amount, 0, headroom);

      if (b > 0){
        debt += b;
        cash += b;
        if (bucket === "buy") ev.borrowBuy[i] += b;
        else ev.borrowAdj[i] += b;
      }
      return b;
    }

    function payDownDebt(i, amount){
      const p = clamp(amount, 0, Math.min(cash, debt));
      if (p > 0){
        debt -= p;
        cash -= p;
        ev.paydown[i] += p;
      }
      return p;
    }

    function allocateToSleeve(i, amt, sleeveTickers, sleeveWeights){
      if (amt <= 0 || sleeveTickers.length === 0) return;

      const w = sleeveWeightsForRebalance(i, sleeveTickers, sleeveWeights);

      for (let k=0;k<sleeveTickers.length;k++){
        const t = sleeveTickers[k];
        const a = amt * (w[k] || 0);
        if (a <= 0) continue;
        shares[t] += a / prices[t][i];
        cash -= a;
        ev.buy[i] += a;
      }
      if (Math.abs(cash) < 1e-8) cash = 0;
    }

    function computeTargetRatio(i){
      if (incomeMode !== "price_band") return targetRatio;
      const v = pv(i);
      const minV = Math.max(0, Number(bandMin) || 0);
      const maxV = Math.max(0, Number(bandMax) || 0);
      if (maxV <= 0) return 0;
      if (v >= minV && v <= maxV) return targetRatio;
      return 0;
    }

    function marginManagementStep(i, incomeToday, interestToday){
      if (!useMargin || marginPolicy === "off") return;

      const v = pv(i);
      const ltv = (v > 0) ? (debt / v) : 0;
      coverArr[i] = (interestToday > 0) ? (incomeToday / interestToday) : (incomeToday > 0 ? Infinity : NaN);

      if (!incomeOn){ targetDevArr[i] = 0; return; }

      if (incomeMode === "interest_only"){
        payDownDebt(i, Math.min(cash, interestToday));
        targetDevArr[i] = 0;
        return;
      }

      if (incomeMode === "interest_plus_principal"){
        payDownDebt(i, cash);
        targetDevArr[i] = 0;
        return;
      }

      const target = computeTargetRatio(i);
      targetDevArr[i] = ltv - target;

      if (!isAdjustDay(i, dates, adjustFreq)) return;

      const desiredDebt = Math.max(0, target * v);
      const delta = desiredDebt - debt; // + => add debt, - => pay down debt

      if (delta < 0){
        payDownDebt(i, Math.min(cash, Math.abs(delta)));
      } else if (delta > 0){
        if (allowTargetBorrow) borrowToCash(i, delta, "adj");
      }
    }

    for (let i=0;i<n;i++){
      // Interest accrual
      let interestToday = 0;
      if (useMargin && debt > 0 && dailyRate > 0){
        interestToday = debt * dailyRate;
        debt += interestToday;
        ev.interest[i] = interestToday;
      }

      // Income generation
      let incomeToday = 0;
      if (incomeOn && incTickers.length > 0 && dailyIncomeRate > 0){
        incomeToday = incValue(i) * dailyIncomeRate;
        cash += incomeToday;
        ev.income[i] = incomeToday;
      }

      // Income routing / margin management (before buys)
      marginManagementStep(i, incomeToday, interestToday);

      // DCA buy day
      if (buySignal[i]){
        cash += dcaAmt;
        ev.dep[i] = dcaAmt;

        // Borrowing policy during buys
        if (useMargin && marginPolicy === "always"){
          const v = pv(i);
          const desiredDebt = maxLTV * v;
          const extra = Math.max(0, desiredDebt - debt);
          borrowToCash(i, extra, "buy");
        }

        if (useMargin && marginPolicy === "assist"){
          const minInvest = Math.max(0, dcaAmt);
          if (cash < minInvest) borrowToCash(i, (minInvest - cash), "buy");
        }

        const investable = cash;
        if (incTickers.length === 0){
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
      const ltv = (v > 0) ? (debt / v) : 0;

      equityArr[i] = equity;
      debtArr[i] = debt;
      ltvArr[i] = ltv;

      if (!isFinite(coverArr[i])){
        coverArr[i] = (ev.interest[i] > 0) ? (ev.income[i] / ev.interest[i]) : (ev.income[i] > 0 ? Infinity : NaN);
      }
    }

    return { dates, equityArr, debtArr, ltvArr, coverArr, targetDevArr, events: ev };
  }

  // ===================== Canvas rendering =====================
  const ctx = el.canvas.getContext("2d");

  function resizeCanvasToCSS(){
    const rect = el.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    el.canvas.width = Math.round(rect.width * dpr);
    el.canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawGrid(w,h){
    ctx.clearRect(0,0,w,h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    const stepY = h / 7;
    for (let i=1;i<7;i++){
      ctx.beginPath();
      ctx.moveTo(0, i*stepY);
      ctx.lineTo(w, i*stepY);
      ctx.stroke();
    }
    const stepX = w / 10;
    for (let i=1;i<10;i++){
      ctx.beginPath();
      ctx.moveTo(i*stepX, 0);
      ctx.lineTo(i*stepX, h);
      ctx.stroke();
    }
  }

  function minMax(arr, upto){
    const a = arr.slice(0, Math.max(1, upto+1));
    let mn = Infinity, mx = -Infinity;
    for (const v of a){
      if (!isFinite(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!isFinite(mn) || !isFinite(mx) || mn === mx){
      mn = 0; mx = (isFinite(mx) ? mx : 1) || 1;
    }
    return { mn, mx };
  }

  function plotLine(arr, upto, w, h, pad, stroke, range, alpha=1){
    const n = arr.length;
    if (!n) return;
    const x0 = pad, x1 = w - pad;
    const y0 = pad, y1 = h - pad;
    const mn = range.mn, mx = range.mx;
    const span = (mx - mn) || 1;

    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    for (let i=0;i<=upto;i++){
      const x = x0 + (x1-x0) * (i / (n-1));
      const y = y1 - (y1-y0) * ((arr[i]-mn)/span);
      if (i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawCursor(i, w, h, pad, n){
    const x0 = pad, x1 = w - pad;
    const x = x0 + (x1-x0) * (i / (n-1));
    ctx.strokeStyle = "rgba(239,81,34,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, h-pad);
    ctx.stroke();
  }

  function drawTimelineTicks(i, w, h, pad){
    const zoneH = 64;
    const baseY = h - pad - 6;
    const topY = baseY - zoneH;
    const x0 = pad, x1 = w - pad;
    const n = state.cashSim.dates.length;

    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(x0, topY, x1-x0, zoneH);

    const ev = state.marginSim.events;

    const maxDep = Math.max(...ev.dep.slice(0,i+1), 1);
    const maxBuy = Math.max(...ev.buy.slice(0,i+1), 1);
    const maxInc = Math.max(...ev.income.slice(0,i+1), 1);
    const maxInt = Math.max(...ev.interest.slice(0,i+1), 1);
    const maxPay = Math.max(...ev.paydown.slice(0,i+1), 1);
    const maxAdj = Math.max(...ev.borrowAdj.slice(0,i+1), 1);

    for (let k=0;k<=i;k++){
      const x = x0 + (x1-x0) * (k/(n-1));

      if (ev.dep[k] > 0){
        const hh = 10 * (ev.dep[k]/maxDep);
        ctx.strokeStyle = "rgba(245,245,245,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(x, baseY-hh); ctx.stroke();
      }
      if (ev.buy[k] > 0){
        const hh = 14 * (ev.buy[k]/maxBuy);
        ctx.strokeStyle = "rgba(239,81,34,0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, baseY-12); ctx.lineTo(x, baseY-12-hh); ctx.stroke();
      }
      if (ev.income[k] > 0){
        const hh = 10 * (ev.income[k]/maxInc);
        ctx.strokeStyle = "rgba(245,245,245,0.40)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, baseY-28); ctx.lineTo(x, baseY-28-hh); ctx.stroke();
      }
      if (ev.interest[k] > 0){
        const hh = 10 * (ev.interest[k]/maxInt);
        ctx.strokeStyle = "rgba(245,245,245,0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, baseY-40); ctx.lineTo(x, baseY-40-hh); ctx.stroke();
      }
      if (ev.paydown[k] > 0){
        const hh = 12 * (ev.paydown[k]/maxPay);
        ctx.strokeStyle = "rgba(245,245,245,0.80)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, baseY-52); ctx.lineTo(x, baseY-52-hh); ctx.stroke();
      }
      if (ev.borrowAdj[k] > 0){
        const hh = 12 * (ev.borrowAdj[k]/maxAdj);
        ctx.strokeStyle = "rgba(239,81,34,0.45)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, baseY-60); ctx.lineTo(x, baseY-60-hh); ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(245,245,245,0.55)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace";
    ctx.fillText("Deposit", x0+8, topY+16);
    ctx.fillStyle = "rgba(239,81,34,0.85)";
    ctx.fillText("Buy", x0+86, topY+16);
    ctx.fillStyle = "rgba(245,245,245,0.40)";
    ctx.fillText("Income", x0+126, topY+16);
    ctx.fillStyle = "rgba(245,245,245,0.22)";
    ctx.fillText("Interest", x0+196, topY+16);
    ctx.fillStyle = "rgba(245,245,245,0.80)";
    ctx.fillText("Paydown", x0+276, topY+16);
    ctx.fillStyle = "rgba(239,81,34,0.55)";
    ctx.fillText("Adj", x0+364, topY+16);
  }

  // ===================== Risk meter =====================
  function updateRiskUI(i){
    const maxLTV = state.meta.maxLTV;
    const ltv = state.marginSim.ltvArr[i];
    const cover = state.marginSim.coverArr[i];
    const dev = state.marginSim.targetDevArr[i];

    const marginActive = state.meta.useMargin;
    if (!marginActive || maxLTV <= 0){
      el.riskGrade.textContent = "OFF";
      el.riskFill.style.width = "0%";
      el.riskProx.textContent = "—";
      el.riskDev.textContent = "—";
      el.riskSignal.textContent = "Margin disabled";
      return;
    }

    const prox = clamp(ltv / maxLTV, 0, 1.25);
    el.riskFill.style.width = (clamp(prox,0,1) * 100).toFixed(1) + "%";
    el.riskProx.textContent = (prox*100).toFixed(1) + "%";
    el.riskDev.textContent = isFinite(dev) ? (dev >= 0 ? "+" : "") + fmtPct(dev) : "—";

    let grade = "LOW";
    let signal = "Healthy buffer";

    if (prox >= 0.50){ grade = "MODERATE"; signal = "Leverage is material"; }
    if (prox >= 0.70){ grade = "ELEVATED"; signal = "Stress can accelerate risk"; }
    if (prox >= 0.85){ grade = "HIGH"; signal = "Close to limit"; }
    if (prox >= 0.95){ grade = "CRITICAL"; signal = "Very low buffer"; }
    if (prox >= 1.00){ grade = "LIMIT"; signal = "At or beyond max LTV"; }

    if (isFinite(cover) && cover >= 1 && prox < 0.95){
      signal = "Income covers interest";
    }
    if (isFinite(cover) && cover < 1 && prox >= 0.70){
      signal = "Income does not cover interest";
    }

    el.riskGrade.textContent = grade;
    el.riskSignal.textContent = signal;

    if (state.calloutsOn){
      if (prox >= 0.95 && !state.alerted95){
        state.alerted95 = true;
        showAlert("Risk Alert: LTV is above 95% of max. Buffer is very low.");
      } else if (prox >= 0.85 && !state.alerted85){
        state.alerted85 = true;
        showAlert("Risk Alert: LTV above 85% of max. You are close to the limit.");
      } else if (prox >= 0.70 && !state.alerted70){
        state.alerted70 = true;
        showAlert("Risk Alert: LTV above 70% of max. Stress events matter more now.");
      }
    }
  }

  // ===================== State + animation =====================
  const state = {
    built: false,
    playing: false,
    i: 0,
    lastTs: 0,

    cashSim: null,
    marginSim: null,

    meta: { name:"", useMargin:false, maxLTV:0 },
    calloutsOn: true,

    alerted70: false,
    alerted85: false,
    alerted95: false
  };

  function setControlsBuilt(on){
    el.play.disabled = !on;
    el.pause.disabled = !on;
    el.step.disabled = !on;
    el.toEnd.disabled = !on;
  }

  function drawFrame(i){
    if (!state.built) return;

    resizeCanvasToCSS();

    const rect = el.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const pad = 18;

    drawGrid(w,h);

    const mode = el.mode.value;

    const rCash = minMax(state.cashSim.equityArr, i);
    const rMar  = minMax(state.marginSim.equityArr, i);
    const rangeEq = { mn: Math.min(rCash.mn, rMar.mn), mx: Math.max(rCash.mx, rMar.mx) };

    if (mode === "equity"){
      plotLine(state.cashSim.equityArr, i, w, h, pad, "rgba(245,245,245,0.75)", rangeEq);
      plotLine(state.marginSim.equityArr, i, w, h, pad, "rgba(239,81,34,0.95)", rangeEq);
    } else if (mode === "debt"){
      const rD = minMax(state.marginSim.debtArr, i);
      plotLine(state.marginSim.debtArr, i, w, h, pad, "rgba(245,245,245,0.85)", rD);
    } else {
      plotLine(state.cashSim.equityArr, i, w, h, pad, "rgba(245,245,245,0.75)", rangeEq);
      plotLine(state.marginSim.equityArr, i, w, h, pad, "rgba(239,81,34,0.95)", rangeEq);
      const rD = minMax(state.marginSim.debtArr, i);
      plotLine(state.marginSim.debtArr, i, w, h, pad, "rgba(245,245,245,0.85)", rD, 0.50);
    }

    drawCursor(i, w, h, pad, state.cashSim.dates.length);
    drawTimelineTicks(i, w, h, pad);

    const date = state.cashSim.dates[i] || "—";
    const eqCash = state.cashSim.equityArr[i];
    const eqMar  = state.marginSim.equityArr[i];
    const debt   = state.marginSim.debtArr[i];
    const ltv    = state.marginSim.ltvArr[i];
    const cover  = state.marginSim.coverArr[i];

    el.kDate.textContent = date;
    el.kEqCash.textContent = fmtUSD(eqCash);
    el.kEqMargin.textContent = fmtUSD(eqMar);
    el.kDebt.textContent = fmtUSD(debt);
    el.kLTV.textContent = fmtPct(ltv);
    el.kCover.textContent = (isFinite(cover) ? (cover === Infinity ? "∞" : cover.toFixed(2) + "x") : "—");

    updateRiskUI(i);

    const totalDays = state.cashSim.dates.length;
    const label = state.meta.name || "Simulated Account";
    el.vizDesc.textContent = `${label} • Day ${i+1} / ${totalDays}`;
  }

  function tick(ts){
    if (!state.playing){ state.lastTs = ts; return; }
    const dt = (ts - state.lastTs) / 1000;
    state.lastTs = ts;

    const speed = Number(el.speed.value);
    const advance = speed * dt;

    const n = state.cashSim.dates.length;
    state.i = Math.min(n-1, state.i + advance);

    drawFrame(Math.floor(state.i));

    if (Math.floor(state.i) >= n-1){
      state.playing = false;
      log("Reached end of simulation.");
    } else {
      requestAnimationFrame(tick);
    }
  }

  // ===================== Build =====================
  async function buildSimulation(){
    el.log.textContent = "Building simulation...\n";
    showAlert(null);
    state.alerted70 = state.alerted85 = state.alerted95 = false;

    const name = (el.name.value || "").trim();
    const startCash = Math.max(0, Number(el.startCash.value) || 0);
    const dcaAmt = Math.max(0, Number(el.dcaAmt.value) || 0);
    const freq = el.freq.value;
    const startISO = el.startDate.value;
    const endISO = el.endDate.value;

    if (!startISO || !endISO || startISO > endISO){ log("Invalid date range."); return; }

    const coreTickers = el.coreTickers.value.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    const coreWeightsRaw = normWeights(el.coreWeights.value.split(",").map(s => s.trim()));
    if (!coreTickers.length){ log("Add at least one core ticker."); return; }

    const incomeOn = !!el.incomeOn.checked;
    const incTickers = incomeOn ? el.incomeTickers.value.split(",").map(s => s.trim().toUpperCase()).filter(Boolean) : [];
    const incWeightsRaw = incomeOn ? normWeights(el.incomeWeights.value.split(",").map(s => s.trim())) : [];

    const incomeSplit = clamp(Number(el.incomeSplit.value) || 0, 0, 100);
    const incomeYieldAPR = Math.max(0, Number(el.incomeYield.value) || 0);

    const useMargin = !!el.useMargin.checked && (el.marginPolicy.value !== "off");
    const marginRateAPR = Math.max(0, Number(el.marginRate.value) || 0);
    const maxLTV = clamp((Number(el.maxLTV.value) || 0)/100, 0, 0.95);
    const marginPolicy = el.marginPolicy.value;
    const dayCount = Number(el.dayCount.value) || 365;

    const incomeMode = el.incomeMode.value;
    const adjustFreq = el.adjustFreq.value;
    const targetRatio = clamp((Number(el.targetRatio.value) || 0)/100, 0, 0.95);
    const allowTargetBorrow = (el.targetBorrow.value === "yes");
    const bandMin = Math.max(0, Number(el.bandMin.value) || 0);
    const bandMax = Math.max(0, Number(el.bandMax.value) || 0);

    const rebalanceBuys = !!el.rebalance.checked;

    previewAlloc();

    const allTickers = [...new Set([...coreTickers, ...incTickers])];
    log(`Loading prices for ${allTickers.length} tickers...`);
    const series = await loadPricesForTickers(allTickers, startISO, endISO);
    const aligned = alignTimeline(series);
    if (aligned.dates.length < 80){
      log("Not enough overlapping history across tickers. Try a wider range or fewer tickers.");
      return;
    }

    // prices map
    const prices = {};
    aligned.tickers.forEach(t => { prices[t] = aligned.prices[t]; });

    // normalize core weights
    const coreWeights = coreTickers.map((_,i) => coreWeightsRaw[i] ?? (1/coreTickers.length));
    const coreSum = coreWeights.reduce((p,c)=>p+c,0) || 1;
    const coreW = coreWeights.map(x => x/coreSum);

    // normalize income weights
    const incWeights = incTickers.map((_,i) => incWeightsRaw[i] ?? (incTickers.length ? 1/incTickers.length : 0));
    const incSum = incWeights.reduce((p,c)=>p+c,0) || 1;
    const incW = incTickers.length ? incWeights.map(x => x/incSum) : [];

    const cashSim = simulateCashOnly({
      dates: aligned.dates,
      prices,
      tickers: coreTickers,
      weights: coreW,
      startCash, dcaAmt, freq,
      rebalanceBuys
    });

    const marginSim = simulateMarginWithIncome({
      dates: aligned.dates,
      prices,
      coreTickers, coreWeights: coreW,
      incTickers, incWeights: incW,
      startCash, dcaAmt, freq,
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
      bandMin, bandMax
    });

    state.cashSim = cashSim;
    state.marginSim = marginSim;
    state.meta = { name, useMargin, maxLTV };
    state.built = true;
    state.playing = false;
    state.i = 0;
    state.lastTs = performance.now();

    el.badge.textContent = useMargin ? "SIMULATED (COMPARE + MARGIN)" : "SIMULATED (COMPARE)";
    setControlsBuilt(true);
    drawFrame(0);

    log(`Built: ${aligned.dates.length} market days.`);
    log(`Cash-only: core sleeve only.`);
    log(`With margin: ${useMargin ? "ON" : "OFF"} • income engine: ${incomeOn ? "ON" : "OFF"} • mode: ${incomeMode}.`);
  }

  // ===================== Wiring =====================
  el.speed.addEventListener("input", () => { el.speedLabel.textContent = `${el.speed.value} d/s`; });
  el.speedLabel.textContent = `${el.speed.value} d/s`;

  el.build.addEventListener("click", () => {
    buildSimulation().catch(e => { console.error(e); log("Build failed. Check console."); });
  });

  el.reset.addEventListener("click", () => {
    state.built = false;
    state.playing = false;
    state.i = 0;
    state.cashSim = null;
    state.marginSim = null;
    state.meta = { name:"", useMargin:false, maxLTV:0 };
    showAlert(null);

    setControlsBuilt(false);

    el.kDate.textContent = "—";
    el.kEqCash.textContent = "—";
    el.kEqMargin.textContent = "—";
    el.kDebt.textContent = "—";
    el.kLTV.textContent = "—";
    el.kCover.textContent = "—";

    el.riskGrade.textContent = "—";
    el.riskFill.style.width = "0%";
    el.riskProx.textContent = "—";
    el.riskDev.textContent = "—";
    el.riskSignal.textContent = "—";

    el.vizDesc.textContent = "Build a simulation to begin.";
    el.badge.textContent = "SIMULATED";
    el.log.textContent = "Ready.";

    resizeCanvasToCSS();
    ctx.clearRect(0,0,el.canvas.width, el.canvas.height);
  });

  el.play.addEventListener("click", () => {
    if (!state.built) return;
    const n = state.cashSim.dates.length;
    if (Math.floor(state.i) >= n-1) state.i = 0;
    state.playing = true;
    state.lastTs = performance.now();
    log("Play.");
    requestAnimationFrame(tick);
  });

  el.pause.addEventListener("click", () => {
    if (!state.built) return;
    state.playing = false;
    log("Pause.");
  });

  el.step.addEventListener("click", () => {
    if (!state.built) return;
    state.playing = false;
    const n = state.cashSim.dates.length;
    state.i = Math.min(n-1, Math.floor(state.i) + 1);
    drawFrame(Math.floor(state.i));
  });

  el.toEnd.addEventListener("click", () => {
    if (!state.built) return;
    state.playing = false;
    state.i = state.cashSim.dates.length - 1;
    drawFrame(Math.floor(state.i));
    log("Jumped to end.");
  });

  el.mode.addEventListener("change", () => { if (state.built) drawFrame(Math.floor(state.i)); });

  window.addEventListener("resize", () => { if (state.built) drawFrame(Math.floor(state.i)); });
  resizeCanvasToCSS();
})();
