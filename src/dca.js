import {
  mountLayout, revealSections, drawInFor, loadData, priceLookup, liveBTC, scheduleDates, eachDay, downsample, lineChart, rangeBar, setTrend, roller,
  usd, usd0, pct, btc, stat, term, changeLine, signClass, prettyDate, addDays, todayISO, css, onTheme, FREQ_WORD,
} from './common.js';

mountLayout('index.html');

const $ = (id) => document.getElementById(id);
const big = roller($('big'));
const state = { amount: 100, freq: 'weekly', start: null, end: null };
let price, chart, lump = false, result, range = '5Y', animateNext = true;

const RANGES = [['1Y', '1Y'], ['2Y', '2Y'], ['5Y', '5Y'], ['10Y', '10Y'], ['MAX', 'Max']];
const startFor = (r) => (r === 'MAX' ? price.first : addDays(state.end, -Math.round(365.25 * parseInt(r))));

function simulate() {
  const { amount, freq, start, end } = state;
  const buys = new Set(scheduleDates(start, end, freq));
  const startPrice = price(start);
  let invested = 0, coins = 0;
  const rows = [];
  for (const d of eachDay(start, end)) {
    const p = price(d);
    if (buys.has(d)) { invested += amount; coins += amount / p; }
    rows.push({ d, invested, value: coins * p, p });
  }
  const lumpCoins = invested / startPrice;
  rows.forEach((r) => { r.lump = lumpCoins * r.p; });
  const last = rows.at(-1);
  return { rows, invested, coins, value: last.value, endPrice: last.p, avg: invested / coins, lumpValue: last.lump, startPrice, buys: buys.size };
}

function render() {
  if (!(state.amount > 0) || state.start >= state.end) return;
  const r = (result = simulate());
  const gain = r.value - r.invested;
  setTrend(gain >= 0);
  big(usd(r.value));
  changeLine($('change'), gain, r.invested, `vs. ${usd0(r.invested)} put in`);
  $('sentence').textContent = `Buying ${usd0(state.amount)} of bitcoin ${FREQ_WORD[state.freq]} from ${prettyDate(state.start)} to ${state.end === price.last ? 'today' : prettyDate(state.end)}.`;

  $('stats').innerHTML = [
    stat(term('Total invested', 'Every purchase added together.'), usd(r.invested)),
    stat(term('Current value', 'Your bitcoin times the bitcoin price on the end date.'), usd(r.value)),
    stat('Total return', `${usd(gain)}`, signClass(gain)),
    stat('Return', pct((gain / r.invested) * 100), signClass(gain)),
    stat(term('BTC accumulated', '1 bitcoin = 100,000,000 sats, so small buys add up to fractions of a coin.'), btc(r.coins)),
    stat(term('Average cost', 'The average price you paid per bitcoin across every buy. Also called your cost basis.'), usd(r.avg)),
    stat(state.end === price.last ? 'Bitcoin price' : 'Price on end date', usd(r.endPrice)),
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
  const rows = downsample(r.rows, 500);
  const up = r.value >= r.invested;
  const ds = [
    { label: 'Value', data: rows.map((x) => x.value), color: up ? css('--up') : css('--down') },
    { label: 'Put in', data: rows.map((x) => x.invested), color: css('--muted'), dashed: true },
  ];
  if (lump) ds.push({ label: 'Lump sum', data: rows.map((x) => x.lump), color: css('--fg-2'), width: 1.5, order: 1 });
  $('legend').innerHTML = `<span><i class="sw" style="background:${ds[0].color}"></i>Your DCA</span><span><i class="sw dash"></i>Money put in</span>${lump ? `<span><i class="sw" style="background:${css('--fg-2')}"></i>Lump sum</span>` : ''}`;
  const drawIn = drawInFor(chart, animateNext); animateNext = false;
  chart?.destroy();
  chart = lineChart($('chart'), {
    labels: rows.map((x) => x.d), datasets: ds,
    drawIn,
    pulse: state.end === price.last ? 0 : null,
    dateLabel: (i) => prettyDate(rows[i].d),
    onScrub: (i) => {
      if (i == null) { big(usd(r.value)); changeLine($('change'), r.value - r.invested, r.invested, `vs. ${usd0(r.invested)} put in`); return; }
      const x = rows[i];
      big(usd(x.value));
      changeLine($('change'), x.value - x.invested, x.invested, `vs. ${usd0(x.invested)} put in${lump ? ` · lump sum ${usd0(x.lump)}` : ''}`);
    },
  });
}

function sync() {
  $('amount').value = state.amount; $('freq').value = state.freq; $('start').value = state.start; $('end').value = state.end;
}

(async () => {
  try {
    const data = await loadData();
    price = priceLookup(data.series.BTC.prices);
    state.end = price.last;
    state.start = startFor(range);
    const clamp = (v) => (v < price.first ? price.first : v > price.last ? price.last : v);
    const clearRange = () => $('range').querySelectorAll('[data-r]').forEach((b) => b.classList.remove('active'));
    rangeBar($('range'), RANGES, range, (r) => { range = r; animateNext = true; state.start = startFor(r); sync(); render(); });
    $('lump-toggle').onclick = () => { lump = !lump; animateNext = true; $('lump-toggle').textContent = lump ? 'Hide lump sum' : 'Compare lump sum'; draw(); };
    $('amount').oninput = (e) => { state.amount = +e.target.value; render(); };
    $('freq').onchange = (e) => { state.freq = e.target.value; render(); };
    $('start').onchange = (e) => { if (e.target.value) { state.start = clamp(e.target.value); clearRange(); sync(); render(); } };
    $('end').onchange = (e) => { if (e.target.value) { state.end = clamp(e.target.value); sync(); render(); } };
    for (const id of ['start', 'end']) { $(id).min = price.first; $(id).max = price.last; }
    sync(); render();
    revealSections();

    const live = await liveBTC();
    if (live) {
      const wasLatest = state.end === price.last;
      price.set(todayISO(), live);
      if (wasLatest) state.end = price.last;
      for (const id of ['start', 'end']) $(id).max = price.last;
      $('panel-foot').textContent = `Bitcoin now ${usd0(live)} · live`;
      sync(); render();
    }
  } catch (err) {
    $('sentence').textContent = 'Could not load price data. Please refresh the page.';
    console.error(err);
  }
})();
onTheme(() => result && draw());
