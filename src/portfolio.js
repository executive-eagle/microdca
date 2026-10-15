import {
  mountLayout, loadData, priceLookup, liveBTC, eachDay, addDays, lineChart, rangeBar, setTrend, roller, downsample, sparkline, rgba,
  usd, usd0, pct, num, btc, term, changeLine, signClass, prettyDate, todayISO, daysBetween, css, onTheme,
} from './common.js';
import { incomeAssets, colorOf, isPayDay, PORTFOLIO, BITCOIN } from './config.js';

mountLayout('portfolio.html');

const $ = (id) => document.getElementById(id);
const big = roller($('big'));
const earnRoll = roller($('earn'));
const ASSETS = Object.keys(PORTFOLIO.allocation);
const START = PORTFOLIO.startValue;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let A = {}, INCOME = [], prices = {}, sched = 'daily', horizon = 'NOW', chart, base, playing = null, liveBtc = null;

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
  const years = { '1Y': 1, '5Y': 5, '10Y': 10 }[horizon];
  return simulate(addDays(base.today, Math.round(365.25 * years)));
}
function rowsForView() {
  if (horizon !== 'NOW') return projection();
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
  [...tmp.children].forEach((n, i) => {
    const cur = el.children[i];
    for (const sel of ['.sub', '.note', '.chip-val']) cur.querySelector(sel).outerHTML = n.querySelector(sel).outerHTML;
    cur.querySelector('svg.spark').outerHTML = n.querySelector('svg.spark').outerHTML;
    const [a, b] = cur.querySelectorAll('.bar i'), [na, nb] = n.querySelectorAll('.bar i');
    a.style.width = na.style.width; b.style.width = nb.style.width;
    const t = cur.dataset.t;
    if (prev && row.reinv[t] > prev.reinv[t]) pulse(cur, `+${num(row.reinv[t] - prev.reinv[t], 4)} sh`);
  });
}

function pulse(rowEl, text) {
  if (reduceMotion) return;
  const plus = rowEl.querySelector('.plus');
  plus.textContent = text;
  plus.classList.add('show');
  rowEl.classList.remove('tick'); void rowEl.offsetWidth; rowEl.classList.add('tick');
  clearTimeout(plus._t);
  plus._t = setTimeout(() => plus.classList.remove('show'), 700);
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
  if (chart && chart.$key === horizon + sched + pts.length) {
    chart.data.datasets[1].data = divLine;
    chart.data.datasets[2].data = value;
    chart.update('none');
    return;
  }
  chart?.destroy();
  const up = pts.at(-1).value >= START;
  chart = lineChart($('chart'), {
    labels: pts.map((r) => r.d),
    yRange: { min: lo - pad, max: hi + pad },
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
  const ms = horizon === 'NOW' ? 1800 : horizon === '1Y' ? 5000 : 7500;
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
  if (horizon === 'NOW') {
    const v = live();
    headline(v.value, 'since Oct 15, 2026');
    split(v.value, v.earned);
  } else if (force) {
    const r = projection().at(-1);
    headline(r.value, `in ${horizon.replace('Y', '')} year${horizon === '1Y' ? '' : 's'} if prices stay flat`);
    split(r.value, r.earned);
  }
}

function tickEarn() {
  if (!playing && base) {
    const v = live();
    earnRoll(usd(v.earned, 4));
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
  chart?.destroy(); chart = null;
  draw(rowsForView());
  refresh(true);
  $('tl').innerHTML = horizon === 'NOW'
    ? `Day <b>${Math.max(1, daysBetween(PORTFOLIO.priceDate, base.today))}</b> · stock prices update daily, bitcoin live`
    : 'Projection holds every price flat at today\'s level, so only reinvested dividends grow it. Press play to watch.';
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
    rangeBar($('range'), [['NOW', 'Live'], ['1Y', '1Y'], ['5Y', '5Y'], ['10Y', '10Y']], 'NOW', (h) => { horizon = h; stop(); if (h !== 'NOW') play(); });
    $('play').onclick = () => (playing ? stop() : play());
    $('sched').onchange = (e) => { sched = e.target.value; stop(); };
    rebuild();
    setInterval(() => refresh(false), 1000);
    setInterval(tickEarn, 500);
    tickEarn();
    const pull = async () => { const p = await liveBTC(); if (p) { liveBtc = p; if (!playing) rebuild(); } };
    pull();
    setInterval(pull, 60_000);
  } catch (err) {
    $('change').textContent = 'Could not load price data. Please refresh the page.';
    console.error(err);
  }
})();
onTheme(() => { if (base && !playing) { chart?.destroy(); chart = null; draw(rowsForView()); holdings(base.last, base.px); } });
