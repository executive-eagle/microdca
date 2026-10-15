import {
  mountLayout, revealSections, drawInFor, loadData, priceLookup, liveBTC, intraday, scheduleDates, eachDay, downsample, lineChart, rangeBar, setTrend, roller,
  usd, usd0, pct, btc, stat, term, changeLine, signClass, prettyDate, prettyTime, addDays, toISO, todayISO, css, onTheme, FREQ_WORD,
} from './common.js';
import { LIVE_QUOTES_URL } from './config.js';

mountLayout('index.html');

const $ = (id) => document.getElementById(id);
const big = roller($('big'));
const state = { amount: 100, freq: 'weekly', start: null, end: null };
let price, chart, lump = false, result, plan = '5Y', view = 'ALL', animateNext = true, liveNow = null, bars = {};

const PLAN_LENGTHS = [['1Y', '1Y'], ['2Y', '2Y'], ['5Y', '5Y'], ['10Y', '10Y'], ['MAX', 'Max']];
const VIEWS = [['1D', '1D'], ['1W', '1W'], ['1M', '1M'], ['3M', '3M'], ['1Y', '1Y'], ['5Y', '5Y'], ['10Y', '10Y'], ['ALL', 'Max']];
const VIEW_LABEL = { '1D': 'Past day', '1W': 'Past week', '1M': 'Past month', '3M': 'Past 3 months', '1Y': 'Past year', '5Y': 'Past 5 years', '10Y': 'Past 10 years' };
const startFor = (r) => (r === 'MAX' ? price.first : addDays(state.end, -Math.round(365.25 * parseInt(r))));
const isLive = () => state.end === todayISO();

function simulate() {
  const { amount, freq, start, end } = state;
  const buys = new Set(scheduleDates(start, end, freq));
  const startPrice = price(start);
  let invested = 0, coins = 0;
  const rows = [];
  for (const d of eachDay(start, end)) {
    const p = price(d);
    if (buys.has(d)) { invested += amount; coins += amount / p; }
    rows.push({ d, invested, coins, value: coins * p, p });
  }
  const lumpCoins = invested / startPrice;
  rows.forEach((r) => { r.lump = lumpCoins * r.p; });
  const last = rows.at(-1);
  const byDate = new Map(rows.map((r) => [r.d, r]));
  return { rows, byDate, lumpCoins, invested, coins, value: last.value, endPrice: last.p, avg: invested / coins, lumpValue: last.lump, startPrice, buys: buys.size };
}

/**
 * Points for the selected view window. Intraday views use 5-minute (1D) or hourly (1W/1M) bitcoin prices,
 * valued with however much bitcoin the plan had bought by that day.
 */
function viewRows(r) {
  const intra = isLive() && (view === '1D' || view === '1W' || view === '1M') && bars[view === '1D' ? '1d' : '1mo'];
  if (intra) {
    const span = { '1D': 1, '1W': 7, '1M': 30 }[view] * 864e5;
    const from = Date.now() - span;
    const pts = intra.filter(([t]) => t >= from).map(([t, p]) => {
      const day = r.byDate.get(toISO(new Date(t))) || (toISO(new Date(t)) < state.start ? null : r.rows.at(-1));
      return day && { t, invested: day.invested, value: day.coins * p, lump: r.lumpCoins * p };
    }).filter(Boolean);
    if (liveNow && pts.length) { const last = r.rows.at(-1); pts.push({ t: Date.now(), invested: last.invested, value: last.coins * liveNow, lump: r.lumpCoins * liveNow }); }
    if (pts.length > 1) return { pts, intraday: true, span: view === '1D' ? 'day' : view === '1W' ? 'week' : 'month' };
  }
  const days = { '1D': 2, '1W': 7, '1M': 30, '3M': 91, '1Y': 365, '5Y': 1826, '10Y': 3652 }[view];
  const from = days ? addDays(state.end, -days) : '0000';
  return { pts: downsample(r.rows.filter((x) => x.d >= from), 500), intraday: false, clipped: days && from < state.start };
}

/** Gain over the window from price moves only (new purchases inside the window aren't counted as gains). */
function windowChange(pts) {
  const a = pts[0], b = pts.at(-1);
  const added = b.invested - a.invested;
  const change = b.value - a.value - added;
  return { change, base: a.value + added };
}

function headline(r, v = viewRows(r)) {
  big(usd(r.value));
  if (view === 'ALL') return changeLine($('change'), r.value - r.invested, r.invested, `vs. ${usd0(r.invested)} put in`);
  const { change, base } = windowChange(v.pts);
  changeLine($('change'), change, base, v.clipped ? `since ${prettyDate(state.start)}` : VIEW_LABEL[view]);
}

function render() {
  if (!(state.amount > 0) || state.start >= state.end) return;
  const r = (result = simulate());
  const gain = r.value - r.invested;
  $('sentence').textContent = `Buying ${usd0(state.amount)} of bitcoin ${FREQ_WORD[state.freq]} from ${prettyDate(state.start)} to ${isLive() ? 'today' : prettyDate(state.end)}.`;

  $('stats').innerHTML = [
    stat(term('Total invested', 'Every purchase added together.'), usd(r.invested)),
    stat(term('Current value', 'Your bitcoin times the bitcoin price on the end date.'), usd(r.value)),
    stat('Total return', `${usd(gain)}`, signClass(gain)),
    stat('Return', pct((gain / r.invested) * 100), signClass(gain)),
    stat(term('BTC accumulated', '1 bitcoin = 100,000,000 sats, so small buys add up to fractions of a coin.'), btc(r.coins)),
    stat(term('Average cost', 'The average price you paid per bitcoin across every buy. Also called your cost basis.'), usd(r.avg)),
    stat(isLive() ? 'Bitcoin price' : 'Price on end date', usd(r.endPrice)),
    stat('Purchases', r.buys.toLocaleString()),
  ].join('');

  const max = Math.max(r.value, r.lumpValue, r.invested);
  const row = (k, v, color, sub) => `<div class="vs-row"><div class="vs-top"><b>${k}</b><span>${usd0(v)} <span class="${signClass(v - r.invested)}">${sub}</span></span></div><div class="track"><i style="width:${(v / max) * 100}%;background:${color}"></i></div></div>`;
  $('vs').innerHTML =
    row(`DCA ${FREQ_WORD[state.freq]}`, r.value, 'var(--brand)', pct(((r.value - r.invested) / r.invested) * 100)) +
    row(`Lump sum on ${prettyDate(state.start)}`, r.lumpValue, 'var(--fg-2)', pct(((r.lumpValue - r.invested) / r.invested) * 100)) +
    row('Money put in', r.invested, 'var(--principal)', '');
  const diff = r.value - r.lumpValue;
  $('verdict').textContent = diff >= 0
    ? `DCA came out ${usd0(diff)} ahead. Spreading the buys out avoided going all in at ${usd0(r.startPrice)}.`
    : `Lump sum came out ${usd0(-diff)} ahead because bitcoin mostly rose after ${prettyDate(state.start)}. DCA still meant never having to time the market.`;
  draw();
}

function draw() {
  const r = result;
  const v = viewRows(r);
  const pts = v.pts;
  const up = view === 'ALL' ? r.value >= r.invested : windowChange(pts).change >= 0;
  setTrend(up);
  headline(r, v);
  // All: dotted line = money put in. Shorter windows: dotted line = value at the start of the window
  // (plus any buys made since), like Robinhood's previous-close line, so the chart zooms into the move.
  const a = pts[0];
  const baseline = view === 'ALL' ? pts.map((x) => x.invested) : pts.map((x) => a.value + (x.invested - a.invested));
  const ds = [
    { label: 'Value', data: pts.map((x) => x.value), color: up ? css('--up') : css('--down') },
    { label: 'Baseline', data: baseline, color: css('--muted'), dashed: true },
  ];
  if (lump) ds.push({ label: 'Lump sum', data: pts.map((x) => x.lump), color: css('--fg-2'), width: 1.5, order: 1 });
  const baseLabel = view === 'ALL' ? 'Money put in' : 'Value at start of period';
  $('legend').innerHTML = `<span><i class="sw" style="background:${ds[0].color}"></i>Your DCA</span><span><i class="sw dash"></i>${baseLabel}</span>${lump ? `<span><i class="sw" style="background:${css('--fg-2')}"></i>Lump sum</span>` : ''}${v.intraday ? '<span class="muted">· live</span>' : ''}`;
  const when = (x) => (v.intraday ? prettyTime(x.t, v.span) : prettyDate(x.d));
  const drawIn = drawInFor(chart, animateNext); animateNext = false;
  chart?.destroy();
  chart = lineChart($('chart'), {
    labels: pts.map((x, i) => i), datasets: ds,
    drawIn,
    pulse: isLive() ? 0 : null,
    dateLabel: (i) => when(pts[i]),
    onScrub: (i) => {
      if (i == null) return headline(r, v);
      const x = pts[i];
      big(usd(x.value));
      if (view === 'ALL') changeLine($('change'), x.value - x.invested, x.invested, `${when(x)} · put in ${usd0(x.invested)}${lump ? ` · lump sum ${usd0(x.lump)}` : ''}`);
      else { const c = windowChange(pts.slice(0, i + 1)); changeLine($('change'), c.change, c.base, when(x)); }
    },
  });
}

/* ---------- live data ---------- */
async function loadBars() {
  const [d, m] = await Promise.all([intraday(LIVE_QUOTES_URL, '1d', ['BTC']), intraday(LIVE_QUOTES_URL, '1mo', ['BTC'])]);
  if (d?.BTC) bars['1d'] = d.BTC;
  if (m?.BTC) bars['1mo'] = m.BTC;
}

function syncViews() {
  // intraday windows only make sense when the plan runs to today
  $('range').querySelectorAll('[data-r]').forEach((b) => { b.hidden = !isLive() && (b.dataset.r === '1D' || b.dataset.r === '1W'); });
  if (!isLive() && (view === '1D' || view === '1W')) {
    view = 'ALL';
    $('range').querySelectorAll('[data-r]').forEach((b) => b.classList.toggle('active', b.dataset.r === 'ALL'));
  }
}

function sync() {
  $('amount').value = state.amount; $('freq').value = state.freq; $('start').value = state.start; $('end').value = state.end;
  $('plan-len').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.p === plan));
  syncViews();
}

(async () => {
  try {
    const data = await loadData();
    price = priceLookup(data.series.BTC.prices);
    // live BTC + intraday bars first (max 1.5s) so the intro draws once with current numbers
    const [now] = await Promise.race([Promise.all([liveBTC(), loadBars()]), new Promise((res) => setTimeout(() => res([null]), 1500))]);
    if (now) { liveNow = now; price.set(todayISO(), now); $('panel-foot').textContent = `Bitcoin now ${usd0(now)} · live`; }
    state.end = price.last;
    state.start = startFor(plan);
    const clamp = (v) => (v < price.first ? price.first : v > price.last ? price.last : v);

    $('plan-len').innerHTML = PLAN_LENGTHS.map(([k, l]) => `<button data-p="${k}">Last ${l}</button>`).join('');
    $('plan-len').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; plan = b.dataset.p; state.end = price.last; state.start = startFor(plan); animateNext = true; sync(); render(); };
    rangeBar($('range'), VIEWS, view, (w) => { view = w; animateNext = true; draw(); });
    $('lump-toggle').onclick = () => { lump = !lump; animateNext = true; $('lump-toggle').textContent = lump ? 'Hide lump sum' : 'Compare lump sum'; draw(); };
    $('amount').oninput = (e) => { state.amount = +e.target.value; render(); };
    $('freq').onchange = (e) => { state.freq = e.target.value; render(); };
    $('start').onchange = (e) => { if (e.target.value) { state.start = clamp(e.target.value); plan = null; sync(); render(); } };
    $('end').onchange = (e) => { if (e.target.value) { state.end = clamp(e.target.value); sync(); render(); } };
    for (const id of ['start', 'end']) { $(id).min = price.first; $(id).max = price.last; }
    sync(); render();
    revealSections();

    // keep it live: BTC every 30s, intraday bars every 5 minutes (paused while the tab is hidden)
    const tick = async () => {
      if (document.hidden) return;
      const p = await liveBTC();
      if (!p) return;
      const wasLive = isLive();
      liveNow = p; price.set(todayISO(), p);
      if (wasLive) state.end = price.last;
      $('panel-foot').textContent = `Bitcoin now ${usd0(p)} · live`;
      for (const id of ['start', 'end']) $(id).max = price.last;
      if (wasLive) { sync(); render(); }
    };
    if (!liveNow) tick();
    setInterval(tick, 30_000);
    setInterval(async () => { if (!document.hidden && isLive()) { await loadBars(); draw(); } }, 300_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  } catch (err) {
    $('sentence').textContent = 'Could not load price data. Please refresh the page.';
    console.error(err);
  }
})();
onTheme(() => result && draw());
