(() => {
  // =========================
  // HARD SINGLETON GUARD
  // =========================
  const VERSION = "sim-portfolio v3.4 (animated play + overlay + active buttons)";
  if (window.__MICRODCA_SIM_PORTFOLIO_SINGLETON__) {
    console.warn("[MicroDCA Simulator] Duplicate load blocked:", VERSION);
    return;
  }
  window.__MICRODCA_SIM_PORTFOLIO_SINGLETON__ = { version: VERSION, ts: Date.now() };

  const PRICE_PROXY_BASE = (window.MICRODCA_PRICE_PROXY_BASE || "https://simulated-portfolio.microdca.com")
    .replace(/\/+$/, "");

  const $ = (id) => document.getElementById(id);

  const el = {
    name: $("spName"),
    startCash: $("spStartCash"),
    dcaAmt: $("spDcaAmt"),
    freq: $("spFreq"),
    startDate: $("spStartDate"),
    endDate: $("spEndDate"),
    rebalance: $("spRebalance"),

    rowsWrap: $("spAssetRows"),
    addAsset: $("spAddAsset"),
    updateAlloc: $("spUpdateAlloc"),
    totalEl: $("spWeightTotal"),
    legacyTickers: $("spTickers"),
    legacyWeights: $("spWeights"),
    allocPreview: $("spAllocPreview"),

    build: $("spBuild"),
    reset: $("spReset"),
    play: $("spPlay"),
    pause: $("spPause"),
    step: $("spStep"),
    toEnd: $("spToEnd"),
    dlPng: $("spDlPng"),
    dlCsv: $("spDlCsv"),

    badge: $("spBadge"),
    vizDesc: $("spVizDesc"),
    canvas: $("spCanvas"),
    chartFrame: $("spChartFrame"),
    log: $("spLog"),
    alert: $("spAlert"),

    kDate: $("kDate"),
    kEqCash: $("kEqCash"),
    kEqMargin: $("kEqMargin"),
    kDebt: $("kDebt"),
    kLTV: $("kLTV"),
    kCover: $("kCover"),
    kTax: $("kTax"),
    kBills: $("kBills"),

    speed: $("spSpeed"),
    speedLabel: $("spSpeedLabel"),
    mode: $("spMode"),
  };

  if (!el.canvas || !el.chartFrame || !el.build || !el.rowsWrap) {
    document.addEventListener("DOMContentLoaded", () => location.reload());
    return;
  }

  // -------------------------
  // Helpers
  // -------------------------
  const fmtUSD = (x) => {
    if (!isFinite(x)) return "—";
    const sign = x < 0 ? "-" : "";
    const v = Math.abs(x);
    return sign + v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  };
  const fmtPct = (x) => (isFinite(x) ? (x * 100).toFixed(2) + "%" : "—");
  const iso = (d) => d.toISOString().slice(0, 10);
  const isMarketDay = (d) => { const wd = d.getUTCDay(); return wd !== 0 && wd !== 6; };

  function log(msg) {
    const t = new Date();
    const stamp = t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    el.log.textContent = `[${stamp}] ${msg}\n` + el.log.textContent;
  }

  let alertTimer = null;
  function showAlert(msg) {
    if (!msg) {
      el.alert.style.display = "none";
      el.alert.textContent = "";
      return;
    }
    el.alert.textContent = msg;
    el.alert.style.display = "block";
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => (el.alert.style.display = "none"), 3000);
  }

  function normWeights(weightsRaw) {
    const clean = weightsRaw.map((x) => Math.max(0, Number(x) || 0));
    const s = clean.reduce((p, c) => p + c, 0);
    if (s <= 0) return clean.map(() => 0);
    return clean.map((x) => x / s);
  }

  // -------------------------
  // ACTIVE STATE FOR ANIMATION BUTTONS (adds .is-active to pressed/current)
  // -------------------------
  const animButtons = [el.play, el.pause, el.step, el.toEnd].filter(Boolean);

  function clearAnimActive() {
    animButtons.forEach((b) => b.classList.remove("is-active"));
  }
  function setAnimActive(btnElOrNull) {
    clearAnimActive();
    if (btnElOrNull) btnElOrNull.classList.add("is-active");
  }

  // -------------------------
  // "PRESS PLAY" OVERLAY (pure JS, no HTML changes needed)
  // -------------------------
  const overlay = (() => {
    const wrap = el.chartFrame;
    if (!wrap) return null;

    // ensure positioning works
    const cs = getComputedStyle(wrap);
    if (cs.position === "static") wrap.style.position = "relative";

    const o = document.createElement("div");
    o.id = "spPlayOverlay";
    o.style.position = "absolute";
    o.style.inset = "0";
    o.style.display = "none";
    o.style.alignItems = "center";
    o.style.justifyContent = "center";
    o.style.pointerEvents = "none";
    o.style.background = "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.22))";
    o.style.backdropFilter = "blur(1px)";
    o.style.borderRadius = "12px";

    o.innerHTML = `
      <div style="
        display:flex; flex-direction:column; gap:10px;
        align-items:center; justify-content:center;
        padding:14px 18px;
        border:1px solid rgba(255,255,255,0.10);
        background:rgba(0,0,0,0.55);
        border-radius:14px;
        box-shadow:0 14px 40px rgba(0,0,0,0.55);
        text-align:center;
        max-width:360px;
      ">
        <div style="font-weight:700; letter-spacing:.02em;">Press Play to animate</div>
        <div style="color:rgba(245,245,245,0.70); font-size:12px; line-height:1.35;">
          The gray curve shows the full backtest. Play draws the simulation forward day-by-day.
        </div>
      </div>
    `;

    wrap.appendChild(o);
    return o;
  })();

  function showOverlay(on) {
    if (!overlay) return;
    overlay.style.display = on ? "flex" : "none";
  }

  // -------------------------
  // Asset builder
  // -------------------------
  const MAX_ASSETS = 10;

  function parseLegacy() {
    const t = (el.legacyTickers?.value || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    const w = (el.legacyWeights?.value || "").split(",").map(s => Number(String(s).trim())).map(x => isFinite(x) ? x : 0);
    return { t, w };
  }

  function enforceRemoveButtons() {
    const rowEls = el.rowsWrap.querySelectorAll(".asset-row");
    rowEls.forEach((row) => {
      const btn = row.querySelector("button");
      if (!btn) return;
      btn.disabled = rowEls.length <= 1;
      btn.style.opacity = btn.disabled ? "0.45" : "1";
      btn.style.cursor = btn.disabled ? "not-allowed" : "pointer";
    });

    el.addAsset.disabled = rowEls.length >= MAX_ASSETS;
    el.addAsset.style.opacity = el.addAsset.disabled ? "0.45" : "1";
    el.addAsset.style.cursor = el.addAsset.disabled ? "not-allowed" : "pointer";
  }

  function writeLegacyFromRows() {
    const tickers = [];
    const weights = [];
    const rowEls = el.rowsWrap.querySelectorAll(".asset-row");

    rowEls.forEach((row) => {
      const t = row.querySelector('input[data-role="ticker"]')?.value?.trim()?.toUpperCase() || "";
      const w = Number(row.querySelector('input[data-role="weight"]')?.value || 0);
      if (!t) return;
      tickers.push(t);
      weights.push(isFinite(w) ? w : 0);
    });

    const seen = new Set();
    const dt = [];
    const dw = [];
    for (let i = 0; i < tickers.length; i++) {
      const k = tickers[i];
      if (seen.has(k)) continue;
      seen.add(k);
      dt.push(k);
      dw.push(weights[i] ?? 0);
    }

    el.legacyTickers.value = dt.join(",");
    el.legacyWeights.value = dw.join(",");

    const sum = dw.reduce((p, c) => p + c, 0);
    el.totalEl.textContent = isFinite(sum) ? sum.toFixed(0) : "—";
  }

  function previewAlloc() {
    const tickers = (el.legacyTickers.value || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    const weightsRaw = (el.legacyWeights.value || "").split(",").map(s => Number(String(s).trim()));
    const wNorm = normWeights(weightsRaw);

    el.allocPreview.innerHTML = "";

    if (!tickers.length) {
      el.allocPreview.innerHTML = `<tr><td colspan="3" style="padding:8px; color:rgba(245,245,245,0.55);">Add at least one ticker.</td></tr>`;
      return;
    }

    tickers.forEach((t, i) => {
      const w = wNorm[i] ?? (tickers.length ? 1 / tickers.length : 0);
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
      tr.innerHTML = `
        <td style="padding:8px;">${t}</td>
        <td style="padding:8px;">${(w * 100).toFixed(2)}%</td>
        <td style="padding:8px; color:rgba(245,245,245,0.65);">${i === 0 ? "Anchor position" : "Satellite / diversifier"}</td>
      `;
      el.allocPreview.appendChild(tr);
    });
  }

  function makeRow(ticker = "", weight = "") {
    const row = document.createElement("div");
    row.className = "asset-row";
    row.innerHTML = `
      <input data-role="ticker" placeholder="SPY" value="${ticker}" />
      <input data-role="weight" type="number" min="0" step="1" placeholder="50" value="${weight}" />
      <button class="icon-btn" type="button" title="Remove">−</button>
    `;

    const tIn = row.querySelector('input[data-role="ticker"]');
    const wIn = row.querySelector('input[data-role="weight"]');
    const rm  = row.querySelector("button");

    const onChange = () => { writeLegacyFromRows(); previewAlloc(); };
    tIn.addEventListener("input", onChange);
    wIn.addEventListener("input", onChange);

    rm.addEventListener("click", () => {
      row.remove();
      enforceRemoveButtons();
      writeLegacyFromRows();
      previewAlloc();
    });

    return row;
  }

  function initBuilder() {
    const { t, w } = parseLegacy();
    const seedTickers = t.length ? t : ["SPY", "QQQ"];
    const seedWeights = w.length ? w : [50, 50];

    el.rowsWrap.innerHTML = "";
    for (let i = 0; i < Math.min(seedTickers.length, MAX_ASSETS); i++) {
      el.rowsWrap.appendChild(makeRow(seedTickers[i], String(seedWeights[i] ?? "")));
    }
    enforceRemoveButtons();
    writeLegacyFromRows();
    previewAlloc();
  }

  el.addAsset.addEventListener("click", () => {
    const count = el.rowsWrap.querySelectorAll(".asset-row").length;
    if (count >= MAX_ASSETS) return;
    el.rowsWrap.appendChild(makeRow("", ""));
    enforceRemoveButtons();
    writeLegacyFromRows();
    previewAlloc();
  });

  el.updateAlloc.addEventListener("click", () => {
    writeLegacyFromRows();
    previewAlloc();
  });

  // -------------------------
  // Prices (with timeout)
  // -------------------------
  function parseCsv(text) {
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
  }

  async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { mode: "cors", signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchDailyCloses(ticker) {
    const t = String(ticker || "").trim().toUpperCase();
    const url = `${PRICE_PROXY_BASE}/api/prices?ticker=${encodeURIComponent(t)}`;
    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) throw new Error(`Worker fetch failed (${res.status})`);
    const text = await res.text();
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("No data returned");
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
        const filtered = rows.filter((r) => r.date >= startISO && r.date <= endISO && isFinite(r.close));
        if (filtered.length < 30) throw new Error("Too few rows in range");
        series[t] = filtered;
        log(`Loaded ${filtered.length} rows for ${t}.`);
      } catch (e) {
        log(`Fetch failed for ${t} (${e?.name === "AbortError" ? "timeout" : (e?.message || "error")}). Using synthetic series.`);
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

  // -------------------------
  // Simulation
  // -------------------------
  function buildBuySchedule(dates, freq) {
    const buy = new Array(dates.length).fill(false);
    if (freq === "daily") { for (let i = 0; i < dates.length; i++) buy[i] = true; return buy; }

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

  function simulateCashOnly({ dates, prices, tickers, weights, startCash, dcaAmt, freq, rebalanceBuys }) {
    const n = dates.length;
    const shares = {}; tickers.forEach((t) => (shares[t] = 0));
    let cash = startCash;

    const equityArr = new Array(n).fill(0);
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
      }
      if (Math.abs(cash) < 1e-8) cash = 0;
    }

    for (let i = 0; i < n; i++) {
      if (buySignal[i]) {
        cash += dcaAmt;
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
      taxReserveArr: new Array(n).fill(0),
      billsPaidArr: new Array(n).fill(0),
    };
  }

  // -------------------------
  // Canvas rendering
  // -------------------------
  const ctx = el.canvas.getContext("2d");

  function resizeCanvas() {
    const rect = el.chartFrame.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    el.canvas.width = w;
    el.canvas.height = h;
    return { w, h, dpr };
  }

  function clearAll(w, h) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
  }

  function drawGrid(w, h) {
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

  function minMaxAll(arr) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (!isFinite(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!isFinite(mn) || !isFinite(mx) || mn === mx) { mn = 0; mx = isFinite(mx) && mx > 0 ? mx : 1; }
    return { mn, mx };
  }

  function plotLine(arr, upto, w, h, pad, stroke, range, alpha = 1) {
    const n = arr.length;
    const u = Math.max(0, Math.min(Math.floor(upto), n - 1));
    if (n < 2) return;

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

  function plotFull(arr, w, h, pad, stroke, range, alpha = 1) {
    plotLine(arr, arr.length - 1, w, h, pad, stroke, range, alpha);
  }

  function drawCursor(i, w, h, pad, n) {
    if (n < 2) return;
    const x0 = pad, x1 = w - pad;
    const x = x0 + (x1 - x0) * (i / (n - 1));
    ctx.strokeStyle = "rgba(239,81,34,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, h - pad);
    ctx.stroke();
  }

  // -------------------------
  // State + playback
  // -------------------------
  const state = {
    built: false,
    playing: false,
    i: 0,
    lastTs: 0,
    sim: null,
    meta: { name: "" },
    easing: 0.18,
  };

  function setControlsBuilt(on) {
    el.play.disabled = !on;
    el.pause.disabled = !on;
    el.step.disabled = !on;
    el.toEnd.disabled = !on;
  }

  function drawFrame(i) {
    if (!state.built) return;

    const { w, h } = resizeCanvas();
    clearAll(w, h);
    drawGrid(w, h);

    const pad = Math.round(Math.min(w, h) * 0.05);
    const mode = el.mode.value;
    const n = state.sim.dates.length;

    const rEq = minMaxAll(state.sim.equityArr);

    if (mode === "equity") {
      plotFull(state.sim.equityArr, w, h, pad, "rgba(245,245,245,0.22)", rEq, 1);
      plotLine(state.sim.equityArr, i, w, h, pad, "rgba(239,81,34,0.95)", rEq, 1);
    } else if (mode === "debt") {
      const rD = minMaxAll(state.sim.debtArr);
      plotFull(state.sim.debtArr, w, h, pad, "rgba(245,245,245,0.22)", rD, 1);
      plotLine(state.sim.debtArr, i, w, h, pad, "rgba(245,245,245,0.85)", rD, 1);
    } else {
      plotFull(state.sim.equityArr, w, h, pad, "rgba(245,245,245,0.22)", rEq, 1);
      plotLine(state.sim.equityArr, i, w, h, pad, "rgba(239,81,34,0.95)", rEq, 1);
    }

    drawCursor(i, w, h, pad, n);

    const ii = Math.max(0, Math.min(Math.floor(i), n - 1));
    const date = state.sim.dates[ii] || "—";
    const eq = state.sim.equityArr[ii];
    const debt = state.sim.debtArr[ii];

    el.kDate.textContent = date;
    el.kEqCash.textContent = fmtUSD(eq);
    el.kEqMargin.textContent = fmtUSD(eq);
    el.kDebt.textContent = fmtUSD(debt);
    el.kLTV.textContent = fmtPct(state.sim.ltvArr[ii]);
    el.kCover.textContent = "—";
    el.kTax.textContent = fmtUSD(state.sim.taxReserveArr[ii]);
    el.kBills.textContent = fmtUSD(state.sim.billsPaidArr[ii]);

    const label = state.meta.name || "Simulated Account";
    el.vizDesc.textContent = `${label} • Day ${ii + 1} / ${state.sim.dates.length}`;
  }

  function tick(ts) {
    if (!state.playing) { state.lastTs = ts; return; }
    const dt = (ts - state.lastTs) / 1000;
    state.lastTs = ts;

    const speed = Number(el.speed.value); // days per second
    const rawAdvance = speed * dt;

    const n = state.sim.dates.length;
    const target = Math.min(n - 1, state.i + rawAdvance);

    state.i = state.i + (target - state.i) * (1 - Math.pow(1 - state.easing, 60 * dt));

    drawFrame(state.i);

    if (Math.floor(state.i) >= n - 1) {
      state.playing = false;
      setAnimActive(null); // <- clears orange button when done
      log("Reached end of simulation.");
      showOverlay(false);
      return;
    }

    requestAnimationFrame(tick);
  }

  // -------------------------
  // Build simulation
  // -------------------------
  async function buildSimulation() {
    el.log.textContent = "";
    log(`Loaded ${VERSION}`);
    log(`Worker base: ${PRICE_PROXY_BASE}`);

    writeLegacyFromRows();
    previewAlloc();

    const name = (el.name.value || "").trim();
    const startCash = Math.max(0, Number(el.startCash.value) || 0);
    const dcaAmt = Math.max(0, Number(el.dcaAmt.value) || 0);
    const freq = el.freq.value;
    const startISO = el.startDate.value;
    const endISO = el.endDate.value;
    const rebalanceBuys = !!el.rebalance.checked;

    if (!startISO || !endISO || startISO > endISO) {
      showAlert("Invalid date range.");
      log("Invalid date range.");
      return;
    }

    const tickers = (el.legacyTickers.value || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    const weightsRaw = (el.legacyWeights.value || "").split(",").map(s => Number(String(s).trim()));
    let weights = normWeights(weightsRaw);
    if (!tickers.length) { showAlert("Add at least one ticker."); return; }

    const sum = weights.reduce((p,c)=>p+c,0);
    if (sum <= 0) weights = tickers.map(() => 1 / tickers.length);

    log(`Loading prices for ${tickers.length} tickers... (${tickers.join(", ")})`);
    const series = await loadPricesForTickers(tickers, startISO, endISO);

    log("Aligning timelines...");
    const aligned = alignTimeline(series);

    if (aligned.dates.length < 40) {
      showAlert("Not enough overlapping history. Try wider dates or fewer tickers.");
      log("Not enough overlap.");
      return;
    }

    const prices = {};
    tickers.forEach((t) => (prices[t] = aligned.prices[t]));

    log("Running simulation...");
    const sim = simulateCashOnly({
      dates: aligned.dates,
      prices,
      tickers,
      weights,
      startCash,
      dcaAmt,
      freq,
      rebalanceBuys,
    });

    state.sim = sim;
    state.meta = { name };
    state.built = true;
    state.playing = false;
    state.i = 0;
    state.lastTs = performance.now();

    setControlsBuilt(true);
    setAnimActive(null);      // <- clears active state on new build
    drawFrame(0);

    // Show overlay prompt after build; hide it on Play.
    showOverlay(true);

    log(`Simulation built successfully (${aligned.dates.length} market days).`);
  }

  // -------------------------
  // Wiring
  // -------------------------
  el.build.addEventListener("click", () => {
    buildSimulation().catch((e) => {
      console.error(e);
      showAlert(`Build failed: ${e?.message || e}`);
      log(`Build failed: ${e?.message || e}`);
    });
  });

  el.play.addEventListener("click", () => {
    if (!state.built) return;
    const n = state.sim.dates.length;
    if (Math.floor(state.i) >= n - 1) state.i = 0;
    state.playing = true;
    state.lastTs = performance.now();
    setAnimActive(el.play); // <- ACTIVE
    log("Play.");
    showOverlay(false);
    requestAnimationFrame(tick);
  });

  el.pause.addEventListener("click", () => {
    if (!state.built) return;
    state.playing = false;
    setAnimActive(el.pause); // <- ACTIVE
    log("Pause.");
    if (Math.floor(state.i) < state.sim.dates.length - 1) showOverlay(true);
  });

  el.step.addEventListener("click", () => {
    if (!state.built) return;
    state.playing = false;
    setAnimActive(el.step); // <- ACTIVE
    showOverlay(false);
    const n = state.sim.dates.length;
    state.i = Math.min(n - 1, Math.floor(state.i) + 1);
    drawFrame(state.i);
  });

  el.toEnd.addEventListener("click", () => {
    if (!state.built) return;
    state.playing = false;
    setAnimActive(el.toEnd); // <- ACTIVE
    showOverlay(false);
    state.i = state.sim.dates.length - 1;
    drawFrame(state.i);
    log("Jumped to end.");
  });

  el.mode.addEventListener("change", () => {
    if (state.built) drawFrame(state.i);
  });

  el.speed.addEventListener("input", () => {
    el.speedLabel.textContent = `${el.speed.value} d/s`;
  });
  el.speedLabel.textContent = `${el.speed.value} d/s`;

  window.addEventListener("resize", () => {
    if (state.built) drawFrame(state.i);
    else {
      const { w, h } = resizeCanvas();
      clearAll(w, h);
    }
  });

  // Seed dates
  const today = new Date();
  const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const start = new Date(end.getTime() - 1000 * 60 * 60 * 24 * 365 * 3);
  if (el.startDate && !el.startDate.value) el.startDate.value = iso(start);
  if (el.endDate && !el.endDate.value) el.endDate.value = iso(end);

  // Initial UI state
  initBuilder();
  setControlsBuilt(false);
  setAnimActive(null);
  showOverlay(false);

  const { w, h } = resizeCanvas();
  clearAll(w, h);

  log(`Loaded ${VERSION}`);
})();
