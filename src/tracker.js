import {
  mountLayout, revealSections, loadData, priceLookup, liveBTC, liveQuotes, intraday, lineChart, rangeBar, roller, Chart, css, rgba,
  usd, usd0, num, term, prettyDate, todayISO, addDays, onTheme, reduceMotion, drawInFor,
} from './common.js';
import { incomeAssets, LIVE_QUOTES_URL } from './config.js';

mountLayout('tracker.html');
const $ = (id) => document.getElementById(id);
const big = roller($('big'));
const histBig = roller($('hist-big'));
const fmtBTC = (v, dp = 0) => `${num(v, dp)} BTC`;
const compactUsd = (v) => '$' + Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);

let A, T = [], data, btcDaily, liveBtc = null, quotes = null, bars = null;
let hist = {}, today = {}, histChart, dailyChart, histRange = 'ALL', animateHist = true;
let part = 0.45;

/* ================= estimates ================= */
/** Daily estimate for every past trading day: at-or-above-par volume × participation × price ÷ bitcoin price. */
function history(t) {
  const par = A[t].atm.par, out = [];
  const cutoff = todayISO();
  for (const row of data.series[t].prices) {
    const [d, close, vol = 0, high = close] = row;
    if (d >= cutoff) continue; // today is estimated live
    const share = close >= par ? 1 : high >= par ? 0.5 : 0;
    const raised = vol * share * close * part;
    out.push({ d, raised, btc: raised ? raised / btcDaily(d) : 0, open: share > 0 });
  }
  return out;
}

/** US Eastern offset in minutes for a timestamp (handles daylight saving). */
function etOffsetMin(ms) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value || 'GMT-5';
  const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? +m[1] * 60 + Math.sign(+m[1]) * (+m[2] || 0) : -300;
}
const etDate = (ms) => new Date(ms + etOffsetMin(ms) * 60000).toISOString().slice(0, 10);
/** The trading session shown: the ET date of the latest STRC/SATA minute bar (or today). */
function sessionInfo() {
  const lastBar = Math.max(0, ...T.map((t) => bars?.[t]?.at(-1)?.[0] || 0));
  const date = lastBar ? etDate(lastBar) : etDate(Date.now());
  const off = etOffsetMin(Date.parse(date + 'T12:00:00Z'));
  const start = Date.parse(date + 'T04:00:00Z') - off * 60000; // 4:00 AM ET
  return { date, start, end: start + 16 * 3600000 }; // through 8:00 PM ET
}

/**
 * Today, minute by minute: volume in minutes that traded at or above par × participation × price ÷ bitcoin price that minute.
 * Plus a live tail from the quote's running volume since the last minute bar.
 */
function todayEstimate(t) {
  const par = A[t].atm.par, q = quotes?.quotes?.[t];
  const sess = sessionInfo();
  const list = (bars?.[t] || []).filter(([ms]) => ms >= sess.start && ms < sess.end);
  const btcBars = bars?.BTC || [];
  let j = 0;
  const btcAt = (ms) => { while (j + 1 < btcBars.length && btcBars[j + 1][0] <= ms) j++; return btcBars[j]?.[1] || liveBtc || btcDaily(sess.date); };
  const minutes = new Map();
  let vol = 0, elig = 0, raised = 0, btc = 0;
  for (const [ms, close, v] of list) {
    vol += v;
    if (close >= par && v > 0) {
      elig += v;
      const r = v * close * part, b = r / btcAt(ms);
      raised += r; btc += b;
      minutes.set(Math.floor((ms - sess.start) / 60000), b);
    }
  }
  // live tail: quote volume reported since the last minute bar
  if (q && q.date === sess.date && q.volume > vol && (q.state === 'live' || q.state === 'pre' || q.state === 'post')) {
    const extra = q.volume - vol;
    vol = q.volume;
    if (q.price >= par) {
      elig += extra;
      const r = extra * q.price * part, b = r / (liveBtc || btcAt(Date.now()));
      raised += r; btc += b;
      const slot = Math.floor((Date.now() - sess.start) / 60000);
      minutes.set(slot, (minutes.get(slot) || 0) + b);
    }
  }
  const price = q?.price ?? data.series[t].prices.at(-1)[1];
  return { price, vol, elig, raised, btc, minutes, state: q?.state || 'closed', atPar: price >= par };
}

/* ================= today's jar: coins pile up as the ATM buys ================= */
const sound = (() => {
  const KEY = 'microdca-coin-sound';
  let on = false, ac = null, last = 0;
  try { on = localStorage.getItem(KEY) === '1'; } catch {}
  const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7"/><path d="M19 6a8.5 8.5 0 010 12"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6"/><path d="M22 9l-5 6"/></svg>';
  const btn = document.getElementById('sound');
  const sync = () => { btn.innerHTML = on ? ICON_ON : ICON_OFF; btn.setAttribute('aria-label', on ? 'Turn coin sounds off' : 'Turn coin sounds on'); btn.classList.toggle('on', on); };
  btn.onclick = () => { on = !on; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} if (on) { ac ??= new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); clink(); } sync(); };
  sync();
  /** A short, quiet two-tone "clink". */
  function clink() {
    if (!on || !ac) return;
    const now = ac.currentTime;
    if (now - last < 0.07) return;
    last = now;
    for (const [f, g] of [[2093, 0.05], [3136, 0.03]]) {
      const o = ac.createOscillator(), v = ac.createGain();
      o.type = 'sine'; o.frequency.value = f * (0.97 + Math.random() * 0.06);
      v.gain.setValueAtTime(g, now); v.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      o.connect(v).connect(ac.destination); o.start(now); o.stop(now + 0.17);
    }
  }
  return { clink };
})();

const jar = (() => {
  const cv = $('jar'), ctx = cv.getContext('2d');
  const CW = 30, CH = 10, TH = 4; // coin width, face height, thickness
  let W = 0, H = 0, unit = 5, cols = [], coins = [], falling = [], pops = [], raf = null;
  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuild();
  }
  const ncols = () => Math.max(8, Math.floor((W - 24) / (CW * 0.5)));
  const colX = (i) => 12 + CW / 2 + i * ((W - 24 - CW) / (ncols() - 1));
  const capacity = () => Math.floor(ncols() * ((H * 0.42) / TH) * 0.5); // a mound, not a full box
  /** Where a coin dropped at column i comes to rest: it slides downhill like sand. */
  function settle(i) {
    for (let step = 0; step < 40; step++) {
      const h = cols[i], l = i > 0 ? cols[i - 1] : Infinity, r = i < cols.length - 1 ? cols[i + 1] : Infinity;
      if (l < h - 1 && l <= r) i--; else if (r < h - 1) i++; else break;
    }
    return i;
  }
  function place(t, animate, delay = 0) {
    if (!cols.length) cols = new Array(ncols()).fill(0);
    // drop near the middle, spreading out as the pile grows
    const spread = Math.min(0.95, 0.12 + (coins.length + falling.length) / 500);
    let i = Math.round((cols.length - 1) / 2 + (Math.random() - 0.5) * spread * (cols.length - 1));
    i = settle(Math.max(0, Math.min(cols.length - 1, i)));
    const y = H - 10 - cols[i] * TH - CH / 2;
    cols[i]++;
    const c = { t, x: colX(i) + (Math.random() - 0.5) * 4, y };
    if (animate && !reduceMotion) falling.push({ ...c, y0: -12, t0: performance.now() + delay, ms: 520 + Math.random() * 220 });
    else coins.push(c);
    kick();
  }
  function coin(x, y, color, a = 1) {
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = '#9A5605';
    ctx.beginPath(); ctx.ellipse(x, y + TH, CW / 2, CH / 2, 0, 0, Math.PI); ctx.lineTo(x - CW / 2, y); ctx.ellipse(x, y, CW / 2, CH / 2, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(x - CW / 2, 0, x + CW / 2, 0);
    g.addColorStop(0, '#FFB955'); g.addColorStop(0.55, '#F7931A'); g.addColorStop(1, '#D5760A');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, CW / 2, CH / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();
  }
  function frame(now) {
    ctx.clearRect(0, 0, W, H);
    // the glow rises with the pile
    const top = cols.length ? Math.max(...cols) * TH : 0;
    if (top > 0) {
      const y = H - 10 - top - 14;
      const g = ctx.createLinearGradient(0, y, 0, H);
      g.addColorStop(0, 'rgba(247,147,26,0)'); g.addColorStop(1, 'rgba(247,147,26,0.16)');
      ctx.fillStyle = g; ctx.fillRect(0, y, W, H - y);
    }
    ctx.strokeStyle = 'rgba(247,147,26,0.25)'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(0, H - 9.5); ctx.lineTo(W, H - 9.5); ctx.stroke(); ctx.setLineDash([]);
    coins.sort((a, b) => a.y - b.y);
    for (const c of coins) coin(c.x, c.y, A[c.t].color);
    let busy = false;
    falling = falling.filter((f) => {
      if (now < f.t0) { busy = true; return true; }
      const k = Math.min(1, (now - f.t0) / f.ms), e = k * k;
      coin(f.x, f.y0 + (f.y - f.y0) * e, A[f.t].color);
      if (k >= 1) { coins.push({ t: f.t, x: f.x, y: f.y }); sound.clink(); busy = true; return false; }
      busy = true; return true;
    });
    pops = pops.filter((p) => {
      const k = (now - p.t0) / 1800;
      if (k < 0) { busy = true; return true; }
      if (k >= 1) return false;
      ctx.save(); ctx.globalAlpha = Math.min(1, (1 - k) * 1.6); ctx.fillStyle = A[p.t].color; ctx.font = '700 15px DM Sans, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y - k * 22); ctx.restore();
      busy = true; return true;
    });
    raf = busy ? requestAnimationFrame(frame) : null;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  let counts = {};
  function rebuild(animate = false) {
    cols = new Array(ncols()).fill(0); coins = []; falling = [];
    const seq = [];
    for (const t of T) for (let i = 0; i < (counts[t] || 0); i++) seq.push(t);
    seq.sort(() => Math.random() - 0.5);
    seq.forEach((t, i) => place(t, animate, i * Math.min(60, 2000 / (seq.length || 1))));
    kick();
  }
  addEventListener('resize', resize);
  return {
    init() { resize(); },
    /** Show `btcByFund` worth of coins (re-scaling the coin size if the pile would overflow). */
    set(btcByFund, { animate = false } = {}) {
      const total = Object.values(btcByFund).reduce((a, b) => a + b, 0);
      while (total / unit > capacity()) unit *= 2;
      counts = Object.fromEntries(T.map((t) => [t, Math.floor((btcByFund[t] || 0) / unit)]));
      rebuild(animate);
      $('jar-unit').textContent = `Each coin ≈ ${num(unit, unit < 1 ? 2 : 0)} BTC`;
    },
    setUnit(u) { unit = u; },
    /** New bitcoin bought by `t`: add coins (if a full coin's worth) and pop a "+x BTC" label. */
    add(t, btc, prevBtc) {
      const before = Math.floor(prevBtc / unit), after = Math.floor((prevBtc + btc) / unit);
      for (let i = 0; i < after - before; i++) { counts[t] = (counts[t] || 0) + 1; place(t, true, i * 90); }
      // the "+x BTC" pops rise from just above the pile, below the big number
      const pileTop = H - 10 - Math.max(0, ...cols) * TH;
      const x = W * (0.2 + Math.random() * 0.6);
      if (pops.length >= 3) pops.shift(); // at most three labels at once
      pops.push({ t, x, y: Math.max(H * 0.64, pileTop - 18) + (Math.random() - 0.5) * 24, text: `+${num(btc, btc < 1 ? 3 : 2)} BTC ${t}`, t0: performance.now() + 200 });
      kick();
    },
    get unit() { return unit; },
  };
})();

/* ================= coin stack (canvas) ================= */
const stack = (() => {
  const cv = $('stack'), ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, unit = 1, piles = {}, falling = [], floats = [], raf = null, labels = {};
  const COIN_W = 50, COIN_H = 15, STEP = 7.5;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kick();
  }
  const perCol = () => Math.max(6, Math.min(11, Math.floor((H - 90) / STEP)));
  function slot(t, i) {
    const idx = T.indexOf(t), cx = W * (T.length === 1 ? 0.5 : idx === 0 ? 0.3 : 0.7);
    const col = Math.floor(i / perCol()), row = i % perCol();
    // columns fan out left and right of the center, each a little shorter, so the pile looks like a heap
    const off = col === 0 ? 0 : (col % 2 ? 1 : -1) * Math.ceil(col / 2) * (COIN_W * 0.62);
    return { x: cx + off, y: H - 58 - row * STEP + (col ? 3 : 0) };
  }
  function coin(x, y, color, alpha = 1, scale = 1) {
    const w = COIN_W * scale, h = COIN_H * scale, th = 5 * scale;
    ctx.save(); ctx.globalAlpha = alpha;
    // rim
    ctx.fillStyle = '#A65F08';
    ctx.beginPath(); ctx.ellipse(x, y + th, w / 2, h / 2, 0, 0, Math.PI); ctx.lineTo(x - w / 2, y); ctx.ellipse(x, y, w / 2, h / 2, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    // face
    const g = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y);
    g.addColorStop(0, '#FFB347'); g.addColorStop(0.5, '#F7931A'); g.addColorStop(1, '#D97A0A');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.2 * scale; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.font = `700 ${9 * scale}px DM Sans, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('₿', x, y + 0.5);
    ctx.restore();
  }
  function frame(now) {
    ctx.clearRect(0, 0, W, H);
    for (const t of T) {
      const { x } = slot(t, 0);
      const n = piles[t] || 0, cols = Math.max(1, Math.ceil(n / perCol()));
      // soft shadow under the pile
      const sg = ctx.createRadialGradient(x, H - 50, 2, x, H - 50, 30 + cols * 18);
      sg.addColorStop(0, rgba(A[t].color, 0.28)); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(x, H - 50, 30 + cols * 18, 10, 0, 0, Math.PI * 2); ctx.fill();
      // label: ticker + running total
      ctx.textAlign = 'center';
      ctx.fillStyle = css('--fg'); ctx.font = '600 13px DM Sans, sans-serif';
      ctx.fillText(t, x, H - 24);
      ctx.fillStyle = css('--muted'); ctx.font = '500 12px DM Sans, sans-serif';
      const L = labels[t]; // exact total once the pile is complete, running count while it builds
      ctx.fillText(`${num(L && n >= L.count ? L.exact : n * unit, 0)} BTC`, x, H - 8);
      ctx.fillStyle = A[t].color; ctx.beginPath(); ctx.arc(x - 24, H - 28, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // draw bottom rows first so coins sit on top of each other
    const all = [];
    for (const t of T) for (let i = 0; i < (piles[t] || 0); i++) all.push({ t, ...slot(t, i), i });
    all.sort((a, b) => b.y - a.y).forEach((s) => coin(s.x, s.y, A[s.t].color));
    let busy = false;
    falling = falling.filter((f) => {
      if (now < f.t0) { busy = true; return true; } // not its turn yet
      const k = Math.min(1, (now - f.t0) / f.ms);
      const e = k < 1 ? k * k : 1;
      const y = f.y0 + (f.y1 - f.y0) * e;
      coin(f.x, y, A[f.t].color, f.ghost ? 1 - k * 0.6 : 1, f.ghost ? 0.7 : 1);
      if (k >= 1) { if (!f.ghost) piles[f.t] = (piles[f.t] || 0) + 1; busy = true; return false; } // one more frame to redraw labels
      busy = true; return true;
    });
    floats = floats.filter((f) => {
      const k = (now - f.t0) / 1600;
      if (k >= 1) return false;
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = css('--up'); ctx.font = '600 12px DM Sans, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y - k * 26); ctx.restore();
      busy = true; return true;
    });
    raf = busy ? requestAnimationFrame(frame) : null;
    cv.dataset.piles = JSON.stringify({ piles, unit, labels }); // handy for checking the totals in devtools
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener('resize', resize);
  return {
    init() { resize(); },
    setUnit(u) { unit = u; },
    setLabels(l) { labels = l; },
    get unit() { return unit; },
    reset() { piles = {}; falling = []; kick(); },
    fill(counts) { piles = { ...counts }; falling = []; kick(); },
    /** A coin drops onto `t`'s pile (counts toward the pile). */
    drop(t, delay = 0) {
      const i = (piles[t] || 0) + falling.filter((f) => f.t === t && !f.ghost).length;
      const s = slot(t, i);
      falling.push({ t, x: s.x, y0: -20, y1: s.y, t0: performance.now() + delay, ms: 650 });
      kick();
    },
    /** Live sale: a small coin falls in with a "+0.42 BTC" label (doesn't change pile size). */
    sparkle(t, text) {
      const s = slot(t, piles[t] || 0);
      falling.push({ t, x: s.x, y0: -20, y1: s.y - 8, t0: performance.now(), ms: 700, ghost: true });
      floats.push({ x: s.x, y: s.y - 30, text, t0: performance.now() + 500 });
      kick();
    },
  };
})();

/* ================= today: readout + per-minute chart ================= */
const todayBig = roller($('today-big'));
let preview = null; // when running, the readout shows preview numbers instead of real ones

function renderTodayReadout() {
  if (preview) return;
  const sum = T.reduce((a, t) => a + today[t].btc, 0);
  const raised = T.reduce((a, t) => a + today[t].raised, 0);
  todayBig(`+${num(sum, sum >= 100 ? 2 : 4)} BTC`);
  $('today-sub').textContent = 'Estimated bitcoin bought today';
  $('today-split').innerHTML = T.map((t) => `<span><i class="dot" style="background:${A[t].color}"></i>${t} ${num(today[t].btc, today[t].btc >= 100 ? 1 : 3)}</span>`).join('') + `<span class="muted">≈ ${compactUsd(raised * 1)} raised</span>`;
  const sess = sessionInfo();
  $('jar-date').textContent = prettyDate(sess.date);
  const live = T.some((t) => today[t].state === 'live' || today[t].state === 'pre' || today[t].state === 'post');
  const open = T.some((t) => today[t].atPar && live);
  $('jar-badge').textContent = open ? 'ATM open' : live ? 'Below par' : 'Market closed';
  $('jar-badge').classList.toggle('closed', !open);
  $('preview').hidden = open;
}

let pmChart;
/** Shades the part of the trading day that hasn't happened yet. */
const restOfDay = {
  id: 'restOfDay',
  beforeDatasetsDraw(chart) {
    const nowSlot = chart.$nowSlot;
    if (nowSlot == null || nowSlot >= chart.data.labels.length) return;
    const x0 = chart.scales.x.getPixelForValue(Math.max(0, nowSlot)), { top, bottom, right } = chart.chartArea;
    chart.ctx.save(); chart.ctx.fillStyle = rgba(css('--fg'), 0.04); chart.ctx.fillRect(x0, top, right - x0, bottom - top); chart.ctx.restore();
  },
};
function drawPerMinute() {
  const sess = sessionInfo();
  const N = 960, labels = Array.from({ length: N }, (_, i) => sess.start + i * 60000);
  const fmt = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const per = Object.fromEntries(T.map((t) => [t, labels.map((_, i) => today[t].minutes.get(i) || 0)]));
  const btcBars = bars?.BTC || [];
  let j = 0;
  const btcLine = labels.map((ms) => { if (ms > Date.now()) return null; while (j + 1 < btcBars.length && btcBars[j + 1][0] <= ms) j++; return btcBars[j] && btcBars[j][0] <= ms + 60000 ? btcBars[j][1] : null; });
  const nowSlot = Math.floor((Date.now() - sess.start) / 60000);
  const any = T.some((t) => today[t].btc > 0);
  $('pm-note').textContent = any
    ? 'Each bar is one minute of estimated buying. Taller bar, more bitcoin. The line is bitcoin\'s price (right side). The shaded area is the rest of today\'s trading hours.'
    : `Neither has traded at or above $100 ${sess.date === etDate(Date.now()) ? 'yet today' : `on ${prettyDate(sess.date)}`}, so there's nothing to estimate${sess.date === etDate(Date.now()) ? ' so far' : ''}. Bars appear here the moment one does. The line is bitcoin's price.`;
  $('pm-legend').innerHTML = T.map((t) => `<span><i class="sw" style="background:${A[t].color}"></i>${t} bitcoin bought</span>`).join('') + `<span><i class="sw dash" style="border-color:${css('--fg-2')}"></i>Bitcoin price</span>`;
  const maxBar = Math.max(0.0001, ...labels.map((_, i) => T.reduce((a, t) => a + per[t][i], 0)));
  pmChart?.destroy();
  pmChart = new Chart($('perminute'), {
    data: {
      labels,
      datasets: [
        ...T.map((t) => ({ type: 'bar', label: t, data: per[t], backgroundColor: A[t].color, stack: 's', yAxisID: 'y', barPercentage: 1, categoryPercentage: 1, order: 2 })),
        { type: 'line', label: 'BTC', data: btcLine, borderColor: css('--fg-2'), borderWidth: 1.25, pointRadius: 0, tension: 0, yAxisID: 'y2', order: 1, spanGaps: true },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: css('--muted'), autoSkip: false, maxRotation: 0, font: { family: css('--font'), size: 11 }, callback: (_, i) => (i % 120 === 0 ? fmt(labels[i]).replace(':00', '') : '') } },
        y: { stacked: true, beginAtZero: true, suggestedMax: maxBar * 1.15, position: 'left', grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 4, font: { family: css('--font'), size: 11 }, callback: (v) => `${num(v, v < 1 ? 2 : 0)} ₿` } },
        y2: { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 4, font: { family: css('--font'), size: 11 }, callback: (v) => compactUsd(v) } },
      },
      onHover: (_e, els) => {
        if (!els.length) { $('pm-tl').innerHTML = '&nbsp;'; return; }
        const i = els[0].index;
        $('pm-tl').innerHTML = `<b>${fmt(labels[i])} ET</b> · ${T.map((t) => `${t} ${num(per[t][i], 3)} BTC`).join(' · ')}${btcLine[i] ? ` · bitcoin ${usd0(btcLine[i])}` : ''}`;
      },
    },
    plugins: [restOfDay],
  });
  pmChart.$nowSlot = nowSlot;
  pmChart.update('none');
  $('perminute').onmouseleave = () => { $('pm-tl').innerHTML = '&nbsp;'; };
}

/* ================= rendering ================= */
const totals = () => {
  const out = { btc: 0, raised: 0, by: {} };
  for (const t of T) {
    const h = hist[t].reduce((a, r) => ({ btc: a.btc + r.btc, raised: a.raised + r.raised, days: a.days + (r.open ? 1 : 0) }), { btc: 0, raised: 0, days: 0 });
    h.btc += today[t].btc; h.raised += today[t].raised; h.days += today[t].elig > 0 ? 1 : 0;
    out.by[t] = h; out.btc += h.btc; out.raised += h.raised;
  }
  return out;
};

function renderHead() {
  const tot = totals();
  const px = liveBtc || btcDaily(todayISO());
  big(fmtBTC(tot.btc));
  const todayBtc = T.reduce((a, t) => a + today[t].btc, 0);
  $('change').innerHTML = `<span class="o">≈ ${compactUsd(tot.raised)} raised</span> <span class="when">· worth ${compactUsd(tot.btc * px)} today · ${todayBtc > 0 ? `<span class="pos">+${fmtBTC(todayBtc, 2)} today</span>` : 'no ATM sales today'}</span>`;
  $('tiles').innerHTML = T.map((t) => {
    const x = today[t], par = A[t].atm.par, diff = x.price - par;
    const live = x.state === 'live' || x.state === 'pre' || x.state === 'post';
    const status = x.atPar && live ? '<span class="atm on">ATM open</span>' : x.atPar ? '<span class="atm">At par · market closed</span>' : `<span class="atm off">ATM paused · ${usd(-diff)} below par</span>`;
    return `<div class="tile"><div class="tile-top"><span class="dot" style="background:${A[t].color}"></span><b>${t}</b><span class="muted">${A[t].atm.issuer}</span></div>
      <div class="tile-price">${usd(x.price)}</div>${status}
      <div class="tile-sub">Today <b>${x.btc > 0 ? '+' + fmtBTC(x.btc, 2) : '0 BTC'}</b> · Since launch <b>${fmtBTC(tot.by[t].btc)}</b></div></div>`;
  }).join('');
  const anyLive = T.some((t) => today[t].state === 'live');
  $('badge').textContent = anyLive ? 'Live' : 'Market closed';
  $('badge').classList.toggle('closed', !anyLive);
}

function renderToday() {
  const tot = totals();
  const cell = (t, f) => f(today[t], A[t], tot.by[t]);
  const row = (k, f, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><th scope="row">${k}</th>${T.map((t) => `<td>${cell(t, f)}</td>`).join('')}</tr>`;
  $('today').innerHTML = `
    <thead><tr><th></th>${T.map((t) => `<th><span class="dot" style="background:${A[t].color}"></span>${t}<div class="cs muted">${A[t].atm.issuer}</div></th>`).join('')}</tr></thead>
    <tbody>
      ${row('Price', (x) => usd(x.price))}
      ${row(term('vs. par', 'How far the price is from the $100 par value. The company can only sell new shares at or above par.'), (x, a) => { const d = x.price - a.atm.par; return `<span class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : '−'}${usd(Math.abs(d))}</span>`; })}
      ${row(term('Yield', 'Yearly dividend ÷ current price.', 'dividends'), (x, a) => `${((a.annual / x.price) * 100).toFixed(2)}%`)}
      ${row('Volume today', (x) => `${num(x.vol, 0)} sh`)}
      ${row(term('At or above par', 'Shares that traded at $100 or more today. These are the only ones the company could have sold.'), (x) => (x.vol ? `${num(x.elig, 0)} sh <div class="cs muted">${Math.round((x.elig / x.vol) * 100)}% of volume</div>` : '—'))}
      ${row('Est. sold by company', (x) => (x.raised ? compactUsd(x.raised) : '$0'))}
      ${row('Est. bitcoin today', (x) => (x.btc ? `<span class="pos">+${fmtBTC(x.btc, 2)}</span>` : '0 BTC'))}
      ${row('Days ATM open', (x, a, h) => `${h.days}`)}
      ${row('Est. raised since launch', (x, a, h) => compactUsd(h.raised))}
      ${row('Est. bitcoin since launch', (x, a, h) => fmtBTC(h.btc), 'total')}
    </tbody>`;
}

/** Cumulative estimated BTC per fund on one shared timeline. */
function cumulative() {
  const start = T.map((t) => hist[t][0]?.d).filter(Boolean).sort()[0];
  const maps = Object.fromEntries(T.map((t) => [t, new Map(hist[t].map((r) => [r.d, r.btc]))]));
  const rows = [];
  const run = Object.fromEntries(T.map((t) => [t, 0]));
  for (let d = start; d <= todayISO(); d = addDays(d, 1)) {
    for (const t of T) run[t] += maps[t].get(d) || 0;
    if (d === todayISO()) for (const t of T) run[t] += today[t].btc;
    rows.push({ d, ...run, total: T.reduce((a, t) => a + run[t], 0) });
  }
  return rows;
}

function drawHistory() {
  let rows = cumulative();
  const days = { '3M': 91, '6M': 182, '1Y': 365 }[histRange];
  if (days) rows = rows.filter((r) => r.d >= addDays(todayISO(), -days));
  const [t1, t2] = T;
  const base = rows[0];
  const head = (r) => {
    histBig(fmtBTC(r.total), true);
    const added = r.total - base.total;
    $('hist-change').innerHTML = `${T.map((t) => `<span class="dot" style="background:${A[t].color}"></span> ${t} ${fmtBTC(r[t])}`).join('&nbsp;&nbsp;')} <span class="when">· ${prettyDate(r.d)}${histRange !== 'ALL' ? ` · +${fmtBTC(added)} in this period` : ''}</span>`;
  };
  head(rows.at(-1));
  $('hist-legend').innerHTML = T.map((t) => `<span><i class="sw" style="background:${A[t].color}"></i>${A[t].plain_name || t} (${t})</span>`).join('');
  const drawIn = drawInFor(histChart, animateHist); animateHist = false;
  histChart?.destroy();
  // stacked look: the lower fund fills to the axis, the total fills down to it
  histChart = lineChart($('hist'), {
    labels: rows.map((r) => r.d),
    datasets: [
      { label: t2, data: rows.map((r) => r[t2] || 0), color: A[t2]?.color || css('--muted'), width: 1.5, order: 2, fill: { target: 'origin', above: rgba(A[t2]?.color || '#888888', 0.35) } },
      { label: 'Total', data: rows.map((r) => r.total), color: A[t1].color, order: 1, fill: { target: 0, above: rgba(A[t1].color, 0.3) } },
    ],
    drawIn, pulse: 1,
    yRange: { min: 0 },
    dateLabel: (i) => prettyDate(rows[i].d),
    onScrub: (i) => head(i == null ? rows.at(-1) : rows[i]),
  });
}

function drawDaily() {
  const days = [...new Set(T.flatMap((t) => hist[t].filter((r) => r.btc > 0).map((r) => r.d)))].sort();
  if (T.some((t) => today[t].btc > 0)) days.push(todayISO());
  const val = (t, d) => (d === todayISO() ? today[t].btc : hist[t].find((r) => r.d === d)?.btc || 0);
  dailyChart?.destroy();
  dailyChart = new Chart($('daily'), {
    type: 'bar',
    data: { labels: days, datasets: T.map((t) => ({ label: t, data: days.map((d) => val(t, d)), backgroundColor: A[t].color, borderRadius: 2, maxBarThickness: 14, stack: 's' })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: reduceMotion ? false : { duration: 700, delay: (c) => (c.type === 'data' && c.mode === 'default' ? c.dataIndex * 6 : 0) },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 6, maxRotation: 0, font: { family: css('--font'), size: 11 }, callback: (_, i) => prettyDate(days[i]).replace(/ \d+,/, '') } },
        y: { stacked: true, display: false, beginAtZero: true },
      },
      onHover: (_e, els) => {
        if (!els.length) { $('daily-tl').innerHTML = dailyDefault(days.length); return; }
        const d = days[els[0].index];
        $('daily-tl').innerHTML = `<b>${prettyDate(d)}</b> · ${T.map((t) => `${t} ${fmtBTC(val(t, d), 1)}`).join(' · ')}`;
      },
    },
  });
  $('daily').onmouseleave = () => { $('daily-tl').innerHTML = dailyDefault(days.length); };
  $('daily-tl').innerHTML = dailyDefault(days.length);
}
const dailyDefault = (n) => `${n} trading days with the ATM open. Hover a bar for the details.`;

/* ================= coins ================= */
function niceUnit(total) {
  const raw = total / 60, p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((u) => u >= raw) || p * 10;
}
/** Replays every past ATM day as coins dropping onto each fund's pile, with the total counting up. */
function replay() {
  const tot = totals();
  const unit = niceUnit(tot.btc);
  stack.setUnit(unit); stack.reset();
  $('stack-unit').textContent = `Each coin ≈ ${num(unit, 0)} BTC`;
  const events = [];
  for (const t of T) {
    let run = 0, dropped = 0;
    const list = [...hist[t], { d: todayISO(), btc: today[t].btc }];
    for (const r of list) { run += r.btc; while (Math.floor(run / unit) > dropped) { dropped++; events.push({ t, d: r.d }); } }
  }
  events.sort((a, b) => a.d.localeCompare(b.d));
  stack.setLabels(Object.fromEntries(T.map((t) => [t, { count: events.filter((e) => e.t === t).length, exact: tot.by[t].btc }])));
  if (reduceMotion) { const c = {}; for (const e of events) c[e.t] = (c[e.t] || 0) + 1; stack.fill(c); return; }
  const span = 3200, gap = events.length ? span / events.length : 0;
  events.forEach((e, i) => stack.drop(e.t, i * gap));
}

/* ================= live loop ================= */
let lastToday = {};
function recompute(fromPoll = false) {
  for (const t of T) today[t] = todayEstimate(t);
  renderHead();
  renderToday();
  renderTodayReadout();
  if (fromPoll && !preview) {
    // new at-par volume → coins fall into today's jar (and sparkle on the since-launch heap)
    for (const t of T) {
      const prev = lastToday[t]?.btc ?? today[t].btc, d = today[t].btc - prev;
      if (d > 0.0005) { jar.add(t, d, prev); stack.sparkle(t, `+${num(d, 2)} BTC`); }
    }
    drawPerMinute();
  }
  lastToday = Object.fromEntries(T.map((t) => [t, { ...today[t] }]));
}

(async () => {
  try {
    data = await loadData();
    A = incomeAssets(data);
    T = Object.keys(A).filter((t) => A[t].atm);
    btcDaily = priceLookup(data.series.BTC.prices);
    const [p, q, b] = await Promise.all([liveBTC(), liveQuotes(LIVE_QUOTES_URL), intraday(LIVE_QUOTES_URL, 'today', [...T, 'BTC'])]);
    liveBtc = p; quotes = q; bars = b;
    for (const t of T) hist[t] = history(t);
    stack.init();
    jar.init();
    recompute();
    // a typical ATM day sets the coin size, so a normal day fills the jar nicely
    const activeDays = T.flatMap((t) => hist[t].filter((r) => r.btc > 0)).length || 1;
    const avgDay = T.reduce((a, t) => a + hist[t].reduce((x, r) => x + r.btc, 0), 0) / activeDays;
    jar.setUnit(niceUnit(avgDay * 0.3)); // ≈ 200 coins on a typical ATM day
    jar.set(Object.fromEntries(T.map((t) => [t, today[t].btc])), { animate: true });
    drawPerMinute();
    $('preview').onclick = runPreview;
    drawHistory();
    drawDaily();
    replay();
    $('replay').onclick = replay;
    $('filings').innerHTML = T.map((t) => `<a class="o" href="${A[t].atm.filings_url}" target="_blank" rel="noopener">${A[t].atm.filings_label}</a>`).join(' and ');
    $('total-lbl').innerHTML = term('Estimated bitcoin bought since launch', 'Our estimate of the bitcoin bought with money raised by selling these preferreds at the market. The real totals are in the companies\' SEC filings.');
    rangeBar($('hist-range'), [['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['ALL', 'All']], histRange, (r) => { histRange = r; animateHist = true; drawHistory(); });
    $('part').oninput = (e) => {
      const v = Math.max(1, Math.min(100, +e.target.value || 45));
      part = v / 100; $('part-word').textContent = v + '%';
      for (const t of T) hist[t] = history(t);
      recompute(); drawHistory(); drawDaily(); replay();
    };
    revealSections();
    // poll: every 15s while the market is open, every minute otherwise; paused in background tabs
    let timer;
    const poll = async () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const [p2, q2, b2] = await Promise.all([liveBTC(), liveQuotes(LIVE_QUOTES_URL), intraday(LIVE_QUOTES_URL, 'today', [...T, 'BTC'])]);
      if (p2) liveBtc = p2; if (q2) quotes = q2; if (b2) bars = b2;
      recompute(true);
      timer = setTimeout(poll, quotes?.open && quotes.open !== 'closed' ? 15_000 : 60_000);
    };
    timer = setTimeout(poll, 15_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  } catch (err) {
    $('change').textContent = 'Could not load data. Please refresh the page.';
    console.error(err);
  }
})();
onTheme(() => { if (data) { drawHistory(); drawDaily(); drawPerMinute(); stack.fill({}); replay(); } });

/* ================= preview: what an open ATM looks like ================= */
function runPreview() {
  if (preview) return;
  const fake = Object.fromEntries(T.map((t) => [t, 0]));
  preview = { t0: performance.now() };
  $('preview').disabled = true;
  $('today-sub').innerHTML = '<b class="o">Preview</b> · made-up numbers, not real data';
  jar.set(fake);
  const step = () => {
    const el = performance.now() - preview.t0;
    if (el > 16000) {
      preview = null; $('preview').disabled = false;
      jar.set(Object.fromEntries(T.map((t) => [t, today[t].btc])));
      renderTodayReadout();
      return;
    }
    const t = Math.random() < 0.7 ? T[0] : T[1] || T[0];
    const d = jar.unit * (0.4 + Math.random() * 2.2);
    jar.add(t, d, fake[t]); fake[t] += d;
    const sum = Object.values(fake).reduce((a, b) => a + b, 0);
    todayBig(`+${num(sum, sum >= 100 ? 2 : 4)} BTC`);
    $('today-split').innerHTML = T.map((x) => `<span><i class="dot" style="background:${A[x].color}"></i>${x} ${num(fake[x], 1)}</span>`).join('');
    setTimeout(step, 260 + Math.random() * 420);
  };
  step();
}
