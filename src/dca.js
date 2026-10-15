import {
  mountLayout, revealSections, isSimple, onMode, drawInFor, loadData, priceLookup, liveBTC, intraday, scheduleDates, eachDay, downsample, lineChart, rangeBar, setTrend, roller,
  usd, usd0, pct, btc, stat, term, changeLine, signClass, prettyDate, prettyTime, addDays, toISO, todayISO, css, onTheme, FREQ_WORD,
} from './common.js';
import { LIVE_QUOTES_URL } from './config.js';
import { taxControls, taxRates, US_NOTE } from './tax.js';

mountLayout('bitcoin.html');

const $ = (id) => document.getElementById(id);
const big = roller($('big'));
const state = { amount: 100, freq: 'weekly', start: null, end: null };
let price, chart, lump = false, result, plan = '5Y', view = 'ALL', animateNext = true, liveNow = null, bars = {};

const QUICK = [10, 25, 50, 100, 250];
const YEARS_WORD = { '1Y': 'year', '2Y': '2 years', '3Y': '3 years', '5Y': '5 years', '10Y': '10 years' };
// 1D–3M zoom into the recent part of your plan; 1Y/5Y/10Y/Max set how long you've been buying.
const VIEWS = [['1D', '1D'], ['1W', '1W'], ['1M', '1M'], ['3M', '3M'], ['1Y', '1Y'], ['5Y', '5Y'], ['10Y', '10Y'], ['MAX', 'Max']];
const ZOOMS = new Set(['1D', '1W', '1M', '3M']);
const VIEW_LABEL = { '1D': 'Past day', '1W': 'Past week', '1M': 'Past month', '3M': 'Past 3 months', '1Y': 'Past year', '5Y': 'Past 5 years', '10Y': 'Past 10 years' };
const startFor = (r) => (r === 'MAX' ? price.first : addDays(state.end, -Math.round(365.25 * parseInt(r))));
const isLive = () => state.end === todayISO();

function simulate() {
  const { amount, freq, start, end } = state;
  const buys = new Set(scheduleDates(start, end, freq));
  const startPrice = price(start);
  let invested = 0, coins = 0;
  const rows = [], lots = [];
  for (const d of eachDay(start, end)) {
    const p = price(d);
    if (buys.has(d)) { invested += amount; coins += amount / p; lots.push({ d, amt: amount, coins: amount / p }); }
    rows.push({ d, invested, coins, value: coins * p, p });
  }
  const lumpCoins = invested / startPrice;
  rows.forEach((r) => { r.lump = lumpCoins * r.p; });
  const last = rows.at(-1);
  const byDate = new Map(rows.map((r) => [r.d, r]));
  return { rows, lots, byDate, lumpCoins, invested, coins, value: last.value, endPrice: last.p, avg: invested / coins, lumpValue: last.lump, startPrice, buys: buys.size };
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
  const days = { '1D': 2, '1W': 7, '1M': 30, '3M': 91 }[view];
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
  // the one sentence a beginner needs
  const period = plan && plan !== 'MAX' && isLive() ? `for the past ${YEARS_WORD[plan]}` : `from ${prettyDate(state.start)} to ${isLive() ? 'today' : prettyDate(state.end)}`;
  const howMuch = gain >= 0
    ? `That's <span class="pos">${usd0(gain)} more</span> than you put in${r.value >= r.invested * 1.95 ? `, about <b>${(r.value / r.invested).toFixed(1)}×</b> your money` : ''}.`
    : `That's <span class="neg">${usd0(-gain)} less</span> than you put in, because bitcoin's price is lower now than your average buy.`;
  $('summary').innerHTML = `If you'd bought <b>${usd0(state.amount)}</b> of bitcoin every ${{ daily: 'day', weekly: 'week', monthly: 'month' }[state.freq]} ${period}, you'd have put in <b>${usd0(r.invested)}</b> and it would be worth <b>${usd0(r.value)}</b> today. ${howMuch}`;
  $('sentence').textContent = `Buying ${usd0(state.amount)} of bitcoin ${FREQ_WORD[state.freq]} from ${prettyDate(state.start)} to ${isLive() ? 'today' : prettyDate(state.end)}.`;

  $('stats-h').textContent = isSimple() ? 'Your results' : 'Key statistics';
  $('stats').innerHTML = (isSimple() ? [
    stat('You put in', usd(r.invested)),
    stat('Worth today', usd(r.value)),
    stat(gain >= 0 ? 'You gained' : 'You lost', usd(Math.abs(gain)), signClass(gain)),
    stat(term('Bitcoin you own', 'You don\'t have to buy a whole bitcoin. Small buys add up to a piece of one. 1 bitcoin = 100,000,000 "sats".', 'bitcoin'), btc(r.coins)),
  ] : [
    stat(term('Total invested', 'Every purchase added together.'), usd(r.invested)),
    stat(term('Current value', 'Your bitcoin times the bitcoin price on the end date.'), usd(r.value)),
    stat('Total return', `${usd(gain)}`, signClass(gain)),
    stat('Return', pct((gain / r.invested) * 100), signClass(gain)),
    stat(term('BTC accumulated', '1 bitcoin = 100,000,000 sats, so small buys add up to fractions of a coin.', 'bitcoin'), btc(r.coins)),
    stat(term('Average cost', 'The average price you paid per bitcoin across every buy. Also called your cost basis.', 'dca'), usd(r.avg)),
    stat(isLive() ? 'Bitcoin price' : 'Price on end date', usd(r.endPrice)),
    stat('Purchases', r.buys.toLocaleString()),
  ]).join('');

  const max = Math.max(r.value, r.lumpValue, r.invested);
  const row = (k, v, color, sub) => `<div class="vs-row"><div class="vs-top"><b>${k}</b><span>${usd0(v)} <span class="${signClass(v - r.invested)}">${sub}</span></span></div><div class="track"><i style="width:${(v / max) * 100}%;background:${color}"></i></div></div>`;
  $('vs').innerHTML =
    row(`A little ${FREQ_WORD[state.freq]}`, r.value, 'var(--brand)', pct(((r.value - r.invested) / r.invested) * 100)) +
    row(`All at once on ${prettyDate(state.start)}`, r.lumpValue, 'var(--fg-2)', pct(((r.lumpValue - r.invested) / r.invested) * 100)) +
    row('Money put in', r.invested, 'var(--principal)', '');
  const diff = r.value - r.lumpValue;
  $('verdict').textContent = diff >= 0
    ? `Buying a little at a time came out ${usd0(diff)} ahead here. Spreading the buys out meant you didn't go all in at ${usd0(r.startPrice)}.`
    : `Putting it all in at once came out ${usd0(-diff)} ahead here, because bitcoin mostly rose after ${prettyDate(state.start)}. But that only works if you have the whole amount on day one, and nobody knows ahead of time which way prices will go.`;
  renderTax(r);
  draw();
}

/** US tax if you sold every bitcoin today: each weekly/monthly buy has its own holding period. */
function renderTax(r) {
  const R = taxRates();
  const yearAgo = addDays(state.end, -365);
  let lt = 0, st = 0, ltIn = 0;
  for (const l of r.lots) {
    const g = l.coins * r.endPrice - l.amt;
    if (l.d <= yearAgo) { lt += g; ltIn += l.amt; } else st += g;
  }
  // a loss on one side offsets the gain on the other, then each side is taxed at its own rate
  const net = lt + st;
  const tax = net <= 0 ? 0
    : lt >= 0 && st >= 0 ? lt * R.longTerm + st * R.ordinary
    : lt > 0 ? net * R.longTerm
    : net * R.ordinary;
  $('tax-stats').innerHTML = [
    stat(term('Long-term gain', 'Profit on bitcoin you\'ve held more than a year. Taxed at the lower long-term rate (0%, 15% or 20%).', 'taxes'), usd(lt), signClass(lt)),
    stat(term('Short-term gain', 'Profit on bitcoin held a year or less. Taxed like regular income.', 'taxes'), usd(st), signClass(st)),
    stat('Estimated tax', usd(tax), tax > 0 ? 'neg' : ''),
    stat('You\'d keep', usd(r.value - tax)),
  ].join('');
  $('tax-summary').innerHTML = net <= 0
    ? `Selling today would be a loss, so no tax. A loss can even lower taxes on other gains.`
    : `Selling everything today would cost about <b>${usd0(tax)}</b> in tax at your ${R.bracket}% bracket${R.state ? ` + ${R.state}% state` : ''}. ` +
      `<b>Not selling costs nothing</b>: holding bitcoin, or borrowing against it, isn't a taxable sale. That's one reason people use income to cover expenses instead of selling. <a class="o" href="learn.html#never-sell">How that works</a>`;
  $('tax-note').innerHTML = `${US_NOTE} Ignores fees and the 3.8% net investment income tax for high earners. <a href="learn.html#taxes">How taxes work here</a>`;
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

function syncRange() {
  const active = ZOOMS.has(view) ? view : plan;
  $('range').querySelectorAll('[data-r]').forEach((b) => b.classList.toggle('active', b.dataset.r === active));
}

function syncViews() {
  // intraday windows only make sense when the plan runs to today
  $('range').querySelectorAll('[data-r]').forEach((b) => { b.hidden = !isLive() && (b.dataset.r === '1D' || b.dataset.r === '1W'); });
  if (!isLive() && (view === '1D' || view === '1W')) {
    view = 'ALL';
  }
}

function sync() {
  $('amount').value = state.amount; $('freq').value = state.freq; $('start').value = state.start; $('end').value = state.end;
  $('howlong').value = plan || '';
  $('quick').querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.v === state.amount));
  syncViews();
  syncRange();
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

    $('quick').innerHTML = QUICK.map((v) => `<button data-v="${v}">$${v}</button>`).join('');
    $('quick').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; state.amount = +b.dataset.v; sync(); render(); };
    $('howlong').onchange = (e) => { if (!e.target.value) return; plan = e.target.value; view = 'ALL'; state.end = price.last; state.start = startFor(plan); animateNext = true; sync(); render(); };
    rangeBar($('range'), VIEWS, plan, (w) => {
      animateNext = true;
      if (ZOOMS.has(w)) { view = w; syncRange(); draw(); return; }
      // longer ranges change the plan itself: 10Y = ten years of buying
      plan = w; view = 'ALL'; state.end = price.last; state.start = startFor(plan);
      sync(); render();
    });
    $('lump-toggle').onclick = () => { lump = !lump; animateNext = true; $('lump-toggle').textContent = lump ? 'Hide lump sum' : 'Compare lump sum'; draw(); };
    $('amount').oninput = (e) => { state.amount = +e.target.value; $('quick').querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.v === state.amount)); render(); };
    $('freq').onchange = (e) => { state.freq = e.target.value; render(); };
    $('start').onchange = (e) => { if (e.target.value) { state.start = clamp(e.target.value); plan = null; sync(); render(); } };
    $('end').onchange = (e) => { if (e.target.value) { state.end = clamp(e.target.value); sync(); render(); } };
    for (const id of ['start', 'end']) { $(id).min = price.first; $(id).max = price.last; }
    taxControls($('tax-controls'), () => result && renderTax(result));
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
onMode(() => { if (!result) return; if (isSimple() && lump) { lump = false; $('lump-toggle').textContent = 'Compare lump sum'; } render(); });
