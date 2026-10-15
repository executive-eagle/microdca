import {
  mountLayout, revealSections, drawInFor, loadData, priceLookup, liveBTC, liveQuotes, applyQuotes, intraday, prettyTime, toISO, eachDay, addDays, lineChart, rangeBar, setTrend, roller, downsample, sparkline, rgba,
  usd, usd0, pct, num, btc, term, changeLine, signClass, prettyDate, todayISO, daysBetween, css, onTheme,
} from './common.js';
import { incomeAssets, colorOf, isPayDay, PORTFOLIO, BITCOIN, LIVE_QUOTES_URL } from './config.js';

mountLayout('portfolio.html');

const $ = (id) => document.getElementById(id);
const big = roller($('big'));
const earnRoll = roller($('earn'));
const ASSETS = Object.keys(PORTFOLIO.allocation);
const START = PORTFOLIO.startValue;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let A = {}, INCOME = [], prices = {}, sched = 'daily', horizon = '1D', bars = {}, chart, base, playing = null, liveBtc = null, animateNext = true;

/* ================= engine ================= */
const priceOn = (t, d) => (t === BITCOIN.ticker && liveBtc && d >= todayISO() ? liveBtc : prices[t](d));

/**
 * Walks every calendar day from inception through `end` (complete days).
 * Each income holding earns (annual dividend ÷ 365) per share per day.
 *  - daily: reinvested the same day at that day's close
 *  - actual: held as pending cash until the fund's real pay date, then reinvested
 */
function simulate(end) {
  const shares = Object.fromEntries(ASSETS.map((t) => [t, (START * PORTFOLIO.allocation[t]) / 100 / PORTFOLIO.startPrices[t]]));
  const reinv = Object.fromEntries(ASSETS.map((t) => [t, 0]));
  const pending = Object.fromEntries(ASSETS.map((t) => [t, 0]));
  let earned = 0;
  const rows = [{ d: PORTFOLIO.priceDate, value: START, earned: 0, pending: 0, shares: { ...shares }, reinv: { ...reinv }, px: { ...PORTFOLIO.startPrices } }];
  for (const d of eachDay(PORTFOLIO.inception, end)) {
    const px = Object.fromEntries(ASSETS.map((t) => [t, priceOn(t, d)]));
    for (const t of INCOME) {
      const div = (shares[t] * A[t].annual) / 365;
      earned += div;
      pending[t] += div;
      if (sched === 'daily' || isPayDay(A[t], d)) {
        const s = pending[t] / px[t];
        shares[t] += s; reinv[t] += s; pending[t] = 0;
      }
    }
    const pend = INCOME.reduce((s, t) => s + pending[t], 0);
    rows.push({ d, value: ASSETS.reduce((s, t) => s + shares[t] * px[t], 0) + pend, earned, pending: pend, shares: { ...shares }, reinv: { ...reinv }, px });
  }
  return rows;
}

const perSecond = (shares) => INCOME.reduce((s, t) => s + (shares[t] * A[t].annual) / 365 / 86400, 0);
const secIntoDay = () => { const n = new Date(); return n.getUTCHours() * 3600 + n.getUTCMinutes() * 60 + n.getUTCSeconds() + n.getUTCMilliseconds() / 1000; };

/** Complete days through yesterday, plus today's live partial accrual. */
function computeNow() {
  const today = todayISO();
  const rows = simulate(addDays(today, -1));
  const last = rows.at(-1);
  const px = Object.fromEntries(ASSETS.map((t) => [t, priceOn(t, today)]));
  return { today, rows, last, px, rate: perSecond(last.shares), holdings: ASSETS.reduce((s, t) => s + last.shares[t] * px[t], 0) };
}
function live() {
  const partial = base.rate * secIntoDay();
  return { earned: base.last.earned + partial, value: base.holdings + base.last.pending + partial, partial };
}

function projection() {
  const years = { '5Y': 5, '10Y': 10 }[horizon];
  return simulate(addDays(base.today, Math.round(365.25 * years)));
}
function rowsForView() {
  if (!isLiveView()) return projection();
  const v = live();
  return [...base.rows, { d: base.today, value: v.value, earned: v.earned, shares: base.last.shares, reinv: base.last.reinv, px: base.px }];
}

/* ================= rendering ================= */
function headline(value, when, instant = false) {
  big(usd(value), instant);
  changeLine($('change'), value - START, START, when);
  setTrend(value >= START);
}

function split(value, earned) {
  const market = value - START - earned;
  const gain = Math.max(market, 0), loss = Math.max(-market, 0);
  // losses are drawn as a hatched slice taken out of your money
  const total = START + earned + gain;
  $('b-p').style.width = ((START - loss) / total) * 100 + '%';
  $('b-l').style.width = (loss / total) * 100 + '%';
  $('b-r').style.width = (earned / total) * 100 + '%';
  $('b-g').style.width = (gain / total) * 100 + '%';
  $('b-l').style.order = 1; $('b-r').style.order = 2; $('b-g').style.order = 3;
  $('v-p').textContent = usd(START);
  $('v-r').textContent = '+' + usd(earned);
  $('v-g').textContent = (market >= 0 ? '+' : '-') + usd(Math.abs(market));
  $('v-g').className = 'v ' + (signClass(market) || 'pos');
  $('sw-g').style.background = market >= 0 ? 'var(--up)' : 'var(--down)';
  const share = ((earned / START) * 100).toFixed(earned / START < 0.01 ? 3 : 2);
  $('story').innerHTML = market >= 0
    ? `Of the ${usd(value)} total, ${usd0(START)} is your original money, <span class="o">${usd(earned)}</span> came from dividends (${share}% on top of your money), and <span class="pos">${usd(market)}</span> came from prices rising.`
    : `Of the ${usd(value)} total, ${usd0(START)} is your original money and <span class="o">${usd(earned)}</span> came from dividends (${share}% on top of your money), but prices are down <span class="neg">${usd(-market)}</span> since you bought.`;
}

function holdingsHTML(row, px) {
  return ASSETS.map((t) => {
    const sh = row.shares[t], re = row.reinv[t], val = sh * px[t];
    const cost = (START * PORTFOLIO.allocation[t]) / 100;
    const spark = prices[t].between(PORTFOLIO.priceDate, base.today);
    const sp = [PORTFOLIO.startPrices[t], ...spark.slice(1), px[t]];
    const reW = (re / sh) * 100;
    const inc = A[t];
    const label = inc ? term(t, `${inc.name}. ${inc.about}`) : term(t, 'Bitcoin. Pays no dividends, so it only grows or shrinks with its price.');
    const perHr = inc ? (sh * inc.annual) / 365 / 24 : 0;
    return `<div class="li" data-t="${t}">
      <div><div class="name"><span class="dot" style="background:${colorOf(t)}"></span>${label}<span class="plus"></span></div>
      <div class="sub">${t === BITCOIN.ticker ? btc(sh) : num(sh, 4) + ' sh'} · ${inc ? `earning ${usd(perHr, 4)}/hr` : 'no dividends'}</div></div>
      ${sparkline(sp, sp.at(-1) >= sp[0] ? css('--up') : css('--down'))}
      <div class="chip-val ${val >= cost ? '' : 'down'}">${usd(val)}</div>
      <div class="bar"><i style="width:${100 - reW}%;background:var(--principal)"></i><i style="width:${reW}%;background:var(--reinvest)"></i></div>
      <div class="note">${inc ? `<span class="o">+${num(re, 4)} sh</span> from dividends (${reW.toFixed(reW < 1 ? 3 : 1)}% of position)` : `${pct((px[t] / PORTFOLIO.startPrices[t] - 1) * 100)} since buying at ${usd0(PORTFOLIO.startPrices[t])}`}</div>
    </div>`;
  }).join('');
}

/** Updates holdings in place (so bars/plus labels animate instead of re-rendering). */
function holdings(row, px, prev) {
  const el = $('holdings');
  const tmp = document.createElement('div');
  tmp.innerHTML = holdingsHTML(row, px);
  if (el.children.length !== tmp.children.length) { el.innerHTML = tmp.innerHTML; return; }
  const money = (t) => parseFloat(t.replace(/[^0-9.-]/g, ''));
  [...tmp.children].forEach((n, i) => {
    const cur = el.children[i];
    const before = money(cur.querySelector('.chip-val').textContent);
    for (const sel of ['.sub', '.note', '.chip-val']) cur.querySelector(sel).outerHTML = n.querySelector(sel).outerHTML;
    const after = money(cur.querySelector('.chip-val').textContent);
    if (!prev && !playing && !reduceMotion && Math.abs(after - before) >= 0.01) cur.querySelector('.chip-val').classList.add(after > before ? 'flash-up' : 'flash-down');
    cur.querySelector('svg.spark').outerHTML = n.querySelector('svg.spark').outerHTML;
    const [a, b] = cur.querySelectorAll('.bar i'), [na, nb] = n.querySelectorAll('.bar i');
    a.style.width = na.style.width; b.style.width = nb.style.width;
    const t = cur.dataset.t;
    if (prev && row.reinv[t] > prev.reinv[t]) pulse(cur, `+${num(row.reinv[t] - prev.reinv[t], 4)} sh`);
  });
}

/** Soft "+$0.0123/min" hint next to an income holding's name. */
function hint(rowEl, text) {
  if (reduceMotion || !rowEl) return;
  const plus = rowEl.querySelector('.plus');
  plus.textContent = text;
  plus.classList.add('show', 'hint');
  clearTimeout(plus._t);
  plus._t = setTimeout(() => plus.classList.remove('show'), 1300);
}

/** A small amount floats up off the dividend counter. */
function drop(amount) {
  if (reduceMotion || document.hidden) return;
  const card = document.querySelector('.earn');
  const d = document.createElement('span');
  d.className = 'drop';
  d.textContent = '+' + usd(amount, 6);
  card.append(d);
  d.addEventListener('animationend', () => d.remove());
  card.classList.remove('bump'); void card.offsetWidth; card.classList.add('bump');
}

function pulse(rowEl, text) {
  if (reduceMotion) return;
  const plus = rowEl.querySelector('.plus');
  plus.classList.remove('hint');
  plus.textContent = text;
  plus.classList.add('show');
  rowEl.classList.remove('tick'); void rowEl.offsetWidth; rowEl.classList.add('tick');
  clearTimeout(plus._t);
  plus._t = setTimeout(() => plus.classList.remove('show'), 700);
}

/* ================= history windows (1D–1Y) ================= */
const WINDOWS = { '1D': 1, '1W': 7, '1M': 30, '3M': 91, '1Y': 365 };
const WINDOW_LABEL = { '1D': 'Past day', '1W': 'Past week', '1M': 'Past month', '3M': 'Past 3 months', '1Y': 'Past year' };
const isWindow = () => horizon in WINDOWS;
const isProjection = () => horizon === '5Y' || horizon === '10Y';
const isLiveView = () => !isProjection();
const BOUGHT_AT = Date.parse(PORTFOLIO.priceDate + 'T20:00:00Z'); // 4pm ET close the portfolio was bought at
const ACCRUES_FROM = Date.parse(PORTFOLIO.inception + 'T00:00:00Z'); // dividends start on the first day
let winCache = null;

/** Which data a window needs: 5-minute bars up to 2 days, hourly up to a month, daily beyond that. */
function windowSource(h = horizon) {
  const from = Math.max(Date.now() - WINDOWS[h] * 864e5, BOUGHT_AT);
  const dur = Date.now() - from;
  return { from, clipped: from === BOUGHT_AT, res: dur <= 2 * 864e5 ? '1d' : dur <= 31 * 864e5 ? '1mo' : 'daily' };
}

/**
 * Portfolio value over the window, priced from every holding's intraday bars (or daily closes for long windows).
 * Shares are the ones actually held that day (dividends get reinvested daily), so the line is exact, not estimated.
 */
function windowRows() {
  if (!base) return null;
  const { from, clipped, res } = windowSource();
  const now = Date.now();
  const v = live();
  const byDate = new Map(base.rows.map((r) => [r.d, r]));
  const held = (t) => byDate.get(addDays(toISO(new Date(t)), -1)) || base.last; // holdings at the start of that day
  let rows;
  const set = res === 'daily' ? null : bars[res];
  if (set?.BTC) {
    const grid = set.BTC.map(([t]) => t).filter((t) => t >= from);
    const idx = Object.fromEntries(ASSETS.map((a) => [a, 0]));
    rows = grid.map((t) => {
      const h = held(t);
      let val = 0;
      for (const a of ASSETS) {
        const b = set[a] || [];
        while (idx[a] + 1 < b.length && b[idx[a] + 1][0] <= t) idx[a]++;
        // before a stock's first bar (overnight / weekends), use its last daily close
        const p = b.length && b[idx[a]][0] <= t ? b[idx[a]][1] : prices[a](toISO(new Date(t - 864e5)));
        val += h.shares[a] * p;
      }
      // dividends accrue smoothly through the day
      const intoDay = t < ACCRUES_FROM ? 0 : (t - Date.parse(toISO(new Date(t)) + 'T00:00:00Z')) / 1000;
      return { t, value: val + (h.pending || 0) + perSecond(h.shares) * intoDay };
    });
  } else {
    const fromDay = toISO(new Date(from));
    rows = base.rows.filter((r) => r.d >= fromDay).map((r) => ({ t: Date.parse(r.d + 'T20:00:00Z'), value: r.value }));
  }
  rows.push({ t: now, value: v.value });
  if (rows.length < 2) return null;
  const span = res === '1d' ? 'day' : now - from <= 8 * 864e5 ? 'week' : 'month';
  return { rows, clipped, span, daily: res === 'daily' || !set?.BTC };
}

function windowHeadline(value, at = null) {
  const w = winCache;
  if (!w) return headline(value, 'since Oct 15, 2026');
  const start = w.rows[0].value;
  big(usd(value));
  const when = at ? (w.daily ? prettyDate(toISO(new Date(at))) : prettyTime(at, w.span)) : w.clipped ? 'since Oct 14 close' : WINDOW_LABEL[horizon];
  changeLine($('change'), value - start, start, when);
  setTrend(value >= start);
}

function drawWindow() {
  const w = (winCache = windowRows());
  if (!w) return draw(rowsForView()); // no data yet → fall back to the since-start chart
  const rows = w.rows;
  const up = rows.at(-1).value >= rows[0].value;
  const color = up ? css('--up') : css('--down');
  const key = horizon + sched + rows.length;
  if (chart && chart.$key === key) {
    chart.data.datasets[0].data = rows.map((r) => r.value);
    chart.data.datasets[0].borderColor = color;
    chart.update('none');
    return;
  }
  const drawIn = drawInFor(chart, animateNext);
  animateNext = false;
  chart?.destroy();
  const lo = Math.min(...rows.map((r) => r.value)), hi = Math.max(...rows.map((r) => r.value));
  const pad = Math.max((hi - lo) * 0.12, START * 0.0015);
  chart = lineChart($('chart'), {
    labels: rows.map((_, i) => i),
    yRange: { min: lo - pad, max: hi + pad },
    drawIn,
    pulse: 0,
    dateLabel: (i) => (w.daily ? prettyDate(toISO(new Date(rows[i].t))) : prettyTime(rows[i].t, w.span)),
    datasets: [
      { label: 'Value', data: rows.map((r) => r.value), color },
      { label: 'Start', data: rows.map(() => rows[0].value), color: css('--muted'), dashed: true },
    ],
    onScrub: (i) => {
      if (i == null) return refresh(true);
      windowHeadline(rows[i].value, i === rows.length - 1 ? null : rows[i].t);
    },
  });
  chart.$key = key;
}

/** Fetch the intraday bars the current window needs (the worker and the page both cache them). */
async function loadBars(h = horizon) {
  if (!(h in WINDOWS)) return;
  const { res } = windowSource(h);
  if (res === 'daily') return;
  const b = await intraday(LIVE_QUOTES_URL, res, ASSETS);
  if (b) bars[res] = b;
}

const LEGEND_LAYERS = document.querySelector('.legend')?.innerHTML;
function setLegend() {
  const el = document.querySelector('.legend');
  if (!isWindow()) { el.innerHTML = LEGEND_LAYERS; return; }
  const res = windowSource().res;
  const every = res === '1d' ? 'every 5 min' : res === '1mo' ? 'hourly' : 'daily';
  el.innerHTML = `<span><i class="sw" style="background:var(--accent, var(--up))"></i>Portfolio value</span><span><i class="sw dash"></i>Value at start of period</span><span class="muted">· ${every}, live</span>`;
}

/* ================= chart ================= */
function draw(rows, upto = rows.length - 1) {
  const pts = rows.length > 400 ? downsample(rows, 365) : rows;
  const cut = pts.findIndex((r) => r.d >= rows[upto].d);
  const show = (i) => i <= cut;
  const lo = Math.min(START, ...pts.map((r) => r.value)), hi = Math.max(...pts.map((r) => Math.max(r.value, START + r.earned)));
  // keep at least a ±1.5% window so a tiny day-one move doesn't look like a crash
  const minSpan = START * 0.03, span = Math.max(hi - lo, minSpan);
  const pad = span * 0.1 + (span - (hi - lo)) / 2;
  const value = pts.map((r, i) => (show(i) ? r.value : null));
  const divLine = pts.map((r, i) => (show(i) ? START + r.earned : null));
  const up = pts.at(-1).value >= START;
  if (chart && chart.$key === horizon + sched + pts.length) {
    chart.data.datasets[1].data = divLine;
    chart.data.datasets[2].data = value;
    chart.data.datasets[2].borderColor = up ? css('--up') : css('--down');
    chart.update('none');
    return;
  }
  const drawIn = playing ? false : drawInFor(chart, animateNext);
  animateNext = false;
  chart?.destroy();
  chart = lineChart($('chart'), {
    labels: pts.map((r) => r.d),
    yRange: { min: lo - pad, max: hi + pad },
    drawIn,
    pulse: isLiveView() ? 2 : null,
    dateLabel: (i) => prettyDate(pts[i].d),
    datasets: [
      { label: 'Your $10K', data: pts.map(() => START), color: css('--muted'), dashed: true, order: 3 },
      { label: 'Dividends', data: divLine, color: css('--reinvest'), width: 1.5, dot: false, order: 2, fill: { target: 0, above: rgba(css('--reinvest'), 0.32), below: 'transparent' } },
      { label: 'Value', data: value, color: up ? css('--up') : css('--down'), order: 1, fill: { target: 1, above: rgba(css('--up'), 0.16), below: rgba(css('--down'), 0.2) } },
    ],
    onScrub: (i) => {
      if (playing) return;
      if (i == null || value[i] == null) return refresh(true);
      const r = pts[i];
      headline(r.value, prettyDate(r.d) + (r.d > base.today ? ' · projected' : ''));
      split(r.value, r.earned);
    },
  });
  chart.$key = horizon + sched + pts.length;
}

/* ================= time-lapse ================= */
function play() {
  stop(false);
  const rows = rowsForView();
  const n = rows.length;
  const ms = isLiveView() ? 1800 : horizon === '5Y' ? 6000 : 7500;
  const t0 = performance.now();
  let prev = rows[0], lastPulse = 0;
  $('play').textContent = 'Pause';
  const frame = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const i = Math.max(1, Math.round(e * (n - 1)));
    const r = rows[i];
    draw(rows, i);
    headline(r.value, (r.d > base.today ? 'Projected · ' : '') + prettyDate(r.d), true);
    split(r.value, r.earned);
    earnRoll(usd(r.earned, 2), true);
    $('earn-since').textContent = prettyDate(r.d);
    $('tl').innerHTML = `Day <b>${daysBetween(PORTFOLIO.priceDate, r.d).toLocaleString()}</b> · ${prettyDate(r.d)}${r.d > base.today ? ' · prices held flat' : ''}`;
    if (now - lastPulse > 420) { holdings(r, r.px, prev); prev = r; lastPulse = now; }
    if (k < 1) playing = requestAnimationFrame(frame);
    else { playing = null; holdings(r, r.px, prev); $('play').textContent = 'Replay'; }
  };
  playing = requestAnimationFrame(frame);
}
function stop(restore = true) {
  if (playing) cancelAnimationFrame(playing);
  playing = null;
  $('play').textContent = 'Play time-lapse';
  if (restore) rebuild();
}

/* ================= live loop ================= */
function refresh(force) {
  if (playing) return;
  if (isWindow()) {
    const v = live();
    windowHeadline(v.value);
    split(v.value, v.earned);
  } else if (horizon === 'NOW') {
    const v = live();
    headline(v.value, 'since Oct 15, 2026');
    split(v.value, v.earned);
  } else if (force) {
    const r = projection().at(-1);
    headline(r.value, `in ${horizon.replace('Y', '')} years if prices stay flat`);
    split(r.value, r.earned);
  }
}

function tickEarn() {
  if (!playing && base) {
    const v = live();
    earnRoll(usd(v.earned, 6));
    const frac = secIntoDay() / 86400;
    $('drip').style.width = (sched === 'daily' ? frac * 100 : 100 * Math.min(1, v.partial / Math.max(base.rate * 86400, 1e-9))) + '%';
    const left = 86400 - secIntoDay(), h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
    $('next').textContent = sched === 'daily'
      ? `Today's ${usd(v.partial)} gets reinvested in ${h}h ${m}m`
      : `${usd(base.last.pending + v.partial)} waiting for the next pay dates`;
  }
}

function rebuild() {
  base = computeNow();
  $('rate').innerHTML = `${usd(base.rate * 86400)}/day · ${usd(base.rate * 3600, 4)}/hr · ${usd(base.rate * 86400 * 365)}/yr`;
  $('earn-since').textContent = 'since Oct 15';
  holdings(base.last, base.px);
  setLegend();
  if (isWindow() && !playing) drawWindow(); else draw(rowsForView());
  refresh(true);
  $('tl').innerHTML = isWindow()
    ? (winCache?.clipped
      ? `The portfolio started Oct 15, 2026, so this shows everything since the Oct 14 close. Longer windows fill in as it ages.`
      : `${WINDOW_LABEL[horizon]} · stock prices only move while the market is open, bitcoin trades 24/7`)
    : horizon === 'NOW'
    ? `Day <b>${Math.max(1, daysBetween(PORTFOLIO.priceDate, base.today))}</b> · prices update every 15 seconds while the market is open`
    : 'Projection holds every price flat at today\'s level, so only reinvested dividends grow it. Press play to watch.';
}

function marketBadge(live) {
  const el = $('badge');
  const state = live?.open || 'closed';
  el.textContent = { live: 'Live', pre: 'Pre-market', post: 'After hours', closed: live ? 'Market closed · BTC live' : 'BTC live' }[state];
  el.classList.toggle('closed', state !== 'live');
}

/* ================= boot ================= */
(async () => {
  try {
    const data = await loadData();
    A = Object.fromEntries(Object.entries(incomeAssets(data)).filter(([t]) => ASSETS.includes(t)));
    INCOME = Object.keys(A);
    for (const t of ASSETS) prices[t] = priceLookup(data.series[t].prices);
    $('mix').innerHTML = ASSETS.map((t) => `<div class="prow"><span><span class="dot" style="background:${colorOf(t)}"></span> ${t} ${PORTFOLIO.allocation[t]}%</span><span class="muted">${usd0((START * PORTFOLIO.allocation[t]) / 100)} at ${usd(PORTFOLIO.startPrices[t])}</span></div>`).join('');
    $('sched-lbl').innerHTML = term('Payouts', 'Daily (proposed): Strategy shareholders vote Oct 28, 2026 on paying every calendar day (STRC from Nov 2, 2026; STRF, STRK, STRD from Jan 4, 2027). Every holding here reinvests daily. Actual schedule: money still accrues daily, but is only reinvested on real pay dates (STRC twice a month, STRF/STRK/STRD quarterly, BTCI monthly).');
    $('earn-lbl').innerHTML = term('Dividends earned', 'Each income holding earns its yearly dividend ÷ 365 per share every day. This counter adds it up second by second.');
    $('split-h').innerHTML = `Where your ${term('money', 'Your money = the $10K you started with. Dividends = income paid to you and reinvested. Market move = how much prices have gone up or down.')} came from`;
    rangeBar($('range'), [['1D', '1D'], ['1W', '1W'], ['1M', '1M'], ['3M', '3M'], ['1Y', '1Y'], ['5Y', '5Y'], ['10Y', '10Y'], ['NOW', 'Max']], horizon, async (h) => {
      horizon = h; animateNext = isLiveView();
      await loadBars(h);
      stop(); if (isProjection()) play();
    });
    $('play').onclick = () => (playing ? stop() : play());
    $('sched').onchange = (e) => { sched = e.target.value; animateNext = true; stop(); };
    rebuild();
    revealSections();
    setInterval(() => refresh(false), 1000);
    setInterval(tickEarn, 1000);
    tickEarn();
    // every 2s: dividends drip off the counter; holdings take turns showing what they earn per minute
    let turn = 0;
    setInterval(() => {
      if (playing || !isLiveView() || !base) return;
      drop(base.rate * 2);
      const t = INCOME[turn++ % INCOME.length];
      const perHr = (base.last.shares[t] * A[t].annual) / 365 / 24;
      hint(document.querySelector(`.li[data-t="${t}"]`), `+${usd(perHr, 3)}/hr`);
    }, 2000);
    // live prices: every 15s while the stock market is open (pre/after hours too), every minute otherwise
    // paused while the tab is in the background (saves the free request quota); refreshes the moment you come back
    let timer;
    const pull = async () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const [p, live] = await Promise.all([liveBTC(), liveQuotes(LIVE_QUOTES_URL), loadBars()]);
      if (p) liveBtc = p;
      applyQuotes(prices, live);
      marketBadge(live);
      if (!playing) rebuild();
      timer = setTimeout(pull, live && live.open !== 'closed' ? 15_000 : 60_000);
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
    pull();
  } catch (err) {
    $('change').textContent = 'Could not load price data. Please refresh the page.';
    console.error(err);
  }
})();
onTheme(() => { if (base && !playing) { chart?.destroy(); chart = null; if (isWindow()) drawWindow(); else draw(rowsForView()); holdings(base.last, base.px); } });
