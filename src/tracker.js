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

/** Today: 5-minute bars at or above par, plus any volume since the last bar if it's trading at par right now. */
function todayEstimate(t) {
  const par = A[t].atm.par, q = quotes?.quotes?.[t];
  const day = todayISO();
  const list = (bars?.[t] || []).filter(([ms]) => new Date(ms).toISOString().slice(0, 10) === day);
  const btcBars = bars?.BTC || [];
  let j = 0;
  const btcAt = (ms) => { while (j + 1 < btcBars.length && btcBars[j + 1][0] <= ms) j++; return btcBars[j]?.[1] || liveBtc || btcDaily(day); };
  let vol = 0, elig = 0, raised = 0, btc = 0;
  for (const [ms, close, v] of list) {
    vol += v;
    if (close >= par) { elig += v; const r = v * close * part; raised += r; btc += r / btcAt(ms); }
  }
  // live tail: volume reported since the last 5-minute bar
  if (q && q.date === day && q.volume > vol) {
    const extra = q.volume - vol;
    vol = q.volume;
    if (q.price >= par) { elig += extra; const r = extra * q.price * part; raised += r; btc += r / (liveBtc || btcAt(Date.now())); }
  }
  const price = q?.price ?? data.series[t].prices.at(-1)[1];
  return { price, vol, elig, raised, btc, state: q?.state || 'closed', atPar: price >= par };
}

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
  if (fromPoll) {
    // coins hit the stack when new ATM-eligible volume shows up
    for (const t of T) {
      const prev = lastToday[t]?.btc ?? today[t].btc, d = today[t].btc - prev;
      if (d > 0.005) stack.sparkle(t, `+${num(d, 2)} BTC`);
    }
  }
  lastToday = Object.fromEntries(T.map((t) => [t, { ...today[t] }]));
}

(async () => {
  try {
    data = await loadData();
    A = incomeAssets(data);
    T = Object.keys(A).filter((t) => A[t].atm);
    btcDaily = priceLookup(data.series.BTC.prices);
    const [p, q, b] = await Promise.all([liveBTC(), liveQuotes(LIVE_QUOTES_URL), intraday(LIVE_QUOTES_URL, '1d', [...T, 'BTC'])]);
    liveBtc = p; quotes = q; bars = b;
    for (const t of T) hist[t] = history(t);
    stack.init();
    recompute();
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
      const [p2, q2, b2] = await Promise.all([liveBTC(), liveQuotes(LIVE_QUOTES_URL), intraday(LIVE_QUOTES_URL, '1d', [...T, 'BTC'])]);
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
onTheme(() => { if (data) { drawHistory(); drawDaily(); stack.fill({}); replay(); } });
