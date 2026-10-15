import {
  mountLayout, revealSections, drawInFor, loadData, priceLookup, liveBTC, liveQuotes, applyQuotes, eachDay, scheduleDates, addDays, daysBetween,
  todayISO, downsample, lineChart, rangeBar, setTrend, riskTag, term, usd, usd0, btc, prettyDate, css, onTheme, onMode,
} from './common.js';
import { incomeAssets, STYLES, LIVE_QUOTES_URL } from './config.js';
import { taxControls, taxRates, US_NOTE } from './tax.js';

mountLayout('compare.html');
const $ = (id) => document.getElementById(id);
const COLOR_A = '#9AA4AE';

let A, prices = {}, events = {}, chart, view = 'worth', result, animateNext = true;
const state = { btc: 0.5, basis: 30000, need: 500, extra: 50000, style: 1, apr: 8, held: true };

/* ================= engine ================= */
function simulate() {
  const mix = STYLES[state.style].mix;
  const funds = Object.keys(mix).filter((t) => A[t] && mix[t] > 0);
  const wTotal = funds.reduce((s, t) => s + mix[t], 0);
  // start once every fund in the mix was trading
  const start = funds.reduce((m, t) => (prices[t].first > m ? prices[t].first : m), prices.BTC.first);
  const end = todayISO();
  const R = taxRates();
  const p0 = prices.BTC(start);
  const billDays = new Set(scheduleDates(addDays(start, 1), end, 'monthly'));

  /* ---- A: all bitcoin, sell oldest coins first ---- */
  const lots = [];
  if (state.btc > 0) lots.push({ coins: state.btc, basis: state.basis, from: state.held ? addDays(start, -400) : start });
  if (state.extra > 0) lots.push({ coins: state.extra / p0, basis: p0, from: start });
  const a = { sold: 0, tax: 0, ranOut: null, biggest: { coins: 0, d: null, price: 0 } };
  const coinsA = () => lots.reduce((s, l) => s + l.coins, 0);
  /** Sell enough bitcoin to net `need` after capital-gains tax. */
  function sellFor(need, d, price) {
    let left = need, coinsSold = 0;
    while (left > 0.005 && lots.length) {
      const l = lots[0];
      const rate = daysBetween(l.from, d) > 365 ? R.longTerm : R.ordinary;
      const taxPerCoin = Math.max(0, price - l.basis) * rate;
      const netPerCoin = price - taxPerCoin;
      const q = Math.min(l.coins, left / netPerCoin);
      l.coins -= q; coinsSold += q; left -= q * netPerCoin; a.tax += q * taxPerCoin;
      if (l.coins < 1e-12) lots.shift();
    }
    a.sold += coinsSold;
    if (coinsSold > a.biggest.coins) a.biggest = { coins: coinsSold, d, price };
    if (left > 0.005 && !a.ranOut) a.ranOut = d;
  }

  /* ---- B: keep bitcoin, income funds pay the bills ---- */
  const shares = {}, basis = {};
  for (const t of funds) { const amt = (state.extra * mix[t]) / wTotal; shares[t] = amt / prices[t](start); basis[t] = amt; }
  const b = { pot: 0, loan: 0, interest: 0, tax: 0, payouts: 0, roc: 0, borrowed: 0, maxLtv: 0, maxLtvDate: null, rocGain: 0 };
  const apr = state.apr / 100;
  const fundValue = (d) => funds.reduce((s, t) => s + shares[t] * prices[t](d), 0);

  const rows = [];
  for (const d of eachDay(start, end)) {
    const p = prices.BTC(d);
    // interest on the loan, added to what you owe
    if (b.loan > 0) { const i = (b.loan * apr) / 365; b.loan += i; b.interest += i; }
    // real payouts on their real dates
    for (const t of funds) {
      const per = events[t].get(d);
      if (!per) continue;
      const div = per * shares[t];
      const roc = div * (A[t].roc_estimate ?? 0);
      const fromBasis = Math.min(roc, basis[t]);
      basis[t] -= fromBasis; b.roc += fromBasis;
      const gain = roc - fromBasis; // ROC beyond basis is a capital gain
      const tax = (div - roc) * R.ordinary + gain * R.longTerm;
      b.tax += tax; b.payouts += div; b.rocGain += gain;
      b.pot += div - tax;
    }
    if (billDays.has(d)) {
      // A sells bitcoin
      if (lots.length) sellFor(state.need, d, p); else if (!a.ranOut) a.ranOut = d;
      // B pays from income, borrows the gap
      if (b.pot >= state.need) b.pot -= state.need;
      else { b.loan += state.need - b.pot; b.borrowed += state.need - b.pot; b.pot = 0; }
    }
    // extra income: pay the loan down first, then buy more income funds (at month end)
    if (b.pot > 0 && b.loan > 0) { const pay = Math.min(b.pot, b.loan); b.pot -= pay; b.loan -= pay; }
    if (b.pot > 1 && b.loan <= 0 && addDays(d, 1).slice(8) === '01') {
      for (const t of funds) { const amt = (b.pot * mix[t]) / wTotal; shares[t] += amt / prices[t](d); basis[t] += amt; }
      b.pot = 0;
    }
    const holdingsB = state.btc * p + fundValue(d);
    const ltv = holdingsB > 0 ? b.loan / holdingsB : 0;
    if (ltv > b.maxLtv) { b.maxLtv = ltv; b.maxLtvDate = d; }
    rows.push({ d, worthA: coinsA() * p, worthB: holdingsB + b.pot - b.loan, coinsA: coinsA(), coinsB: state.btc, loan: b.loan, p });
  }
  const last = rows.at(-1);
  b.fundValue = fundValue(end);
  b.annualIncome = funds.reduce((s, t) => s + shares[t] * A[t].annual, 0);
  // if you sold everything today: unrealized gains (simplified: long-term rates)
  const pEnd = last.p;
  a.unrealized = lots.reduce((s, l) => s + Math.max(0, pEnd - l.basis) * l.coins, 0);
  const basisB = funds.reduce((s, t) => s + basis[t], 0);
  b.unrealized = Math.max(0, state.btc * (pEnd - state.basis)) + Math.max(0, b.fundValue - basisB);
  return { start, end, rows, a, b, funds, last, months: billDays.size, R };
}

/* ================= rendering ================= */
const vrow = (k, v, cls = '') => `<div class="vrow"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;

function render() {
  if (!(state.need >= 0) || !(state.extra >= 0) || !(state.btc >= 0)) return;
  const r = (result = simulate());
  const { a, b, last } = r;
  const startCoins = state.btc + (state.extra / prices.BTC(r.start));
  const ltvPct = Math.round(b.maxLtv * 100);
  const ltvCls = ltvPct >= 40 ? 'neg' : ltvPct >= 25 ? 'warn' : 'pos';

  $('rows-a').innerHTML = [
    vrow('Bitcoin left', `${btc(last.coinsA)}`, last.coinsA < startCoins ? 'neg' : ''),
    vrow('Bitcoin sold', `${btc(a.sold)} <span class="muted">(${Math.round((a.sold / startCoins) * 100)}%)</span>`),
    vrow(term('Biggest forced sale', 'The most bitcoin you had to sell in a single month, and the price you sold at. Bills come due whether prices are up or down.'), a.biggest.d ? `${btc(a.biggest.coins)} <span class="muted">at ${usd0(a.biggest.price)}, ${prettyDate(a.biggest.d)}</span>` : '—'),
    vrow('Taxes paid', usd0(a.tax), a.tax > 0 ? 'neg' : ''),
    vrow('Loan owed', '$0'),
    vrow('Worth today', `<b>${usd0(last.worthA)}</b>`),
    a.ranOut ? vrow('Ran out of bitcoin', prettyDate(a.ranOut), 'neg') : '',
  ].join('');
  $('rows-b').innerHTML = [
    vrow('Bitcoin left', `${btc(last.coinsB)}`, 'pos'),
    vrow('Bitcoin sold', `${btc(0)} <span class="muted">(0%)</span>`, 'pos'),
    vrow(term('Income funds now', 'What the income funds are worth today, including any extra income that was reinvested.'), `${usd0(b.fundValue)} <span class="muted">paying ~${usd0(b.annualIncome / 12)}/mo</span>`),
    vrow(term('Taxes paid', 'Tax on the part of payouts that isn\'t return of capital. Return of capital isn\'t taxed now; it lowers your cost basis.', 'taxes'), usd0(b.tax), b.tax > 0 ? 'neg' : ''),
    vrow(term('Loan owed', `Borrowed to cover months when payouts fell short, at ${state.apr}% a year. Extra income paid it down.`, 'margin'), `${usd0(b.loan)}${b.loan > 0.5 ? ` <span class="muted">(${Math.round((b.loan / (state.btc * last.p + b.fundValue)) * 100)}% of holdings)</span>` : ''}`, b.loan > 0.5 ? 'warn' : ''),
    vrow('Worth today', `<b>${usd0(last.worthB)}</b> <span class="muted">after the loan</span>`),
    b.maxLtv > 0.0005 ? vrow(term('Highest loan vs. holdings', 'The most the loan ever was compared with what you owned. Brokers can force sales above roughly 30–50%, so lower is safer.', 'margin'), `${ltvPct}% <span class="muted">${prettyDate(b.maxLtvDate)}</span>`, ltvCls) : '',
  ].join('');

  const diff = last.worthB - last.worthA;
  const keepPct = Math.round((a.sold / startCoins) * 100);
  const st = STYLES[state.style];
  $('summary').innerHTML =
    `Paying <b>${usd0(state.need)} a month</b> for ${r.months} months since ${prettyDate(r.start)}: ` +
    (a.ranOut ? `selling bitcoin <span class="neg">ran out on ${prettyDate(a.ranOut)}</span>. ` : `selling bitcoin used up <b>${keepPct}%</b> of your coins, including <b>${btc(a.biggest.coins)}</b> sold at ${usd0(a.biggest.price)} in ${prettyDate(a.biggest.d).replace(/ \d+,/, '')}. `) +
    `Living off the <b>${st.label.toLowerCase()}</b> mix kept every coin` +
    (b.loan > 0.5 ? `, with a <b>${usd0(b.loan)}</b> loan outstanding. ` : ' and needed no loan. ') +
    (Math.abs(diff) < 1 ? 'Both end up worth about the same.'
      : diff > 0 ? `Plan B ends up <span class="pos">${usd0(diff)} ahead</span> overall.`
        : `Plan A ends up <span class="pos">${usd0(-diff)} ahead</span> overall, because bitcoin rose more than the income funds paid. But it took selling ${keepPct}% of your bitcoin to get there.`) +
    // be upfront about how much the starting point drives the result
    (() => {
      const move = (last.p / prices.BTC(r.start) - 1) * 100;
      return Math.abs(move) < 5 ? '' : move < 0
        ? ` <span class="muted">Note: bitcoin is down ${Math.abs(move).toFixed(0)}% since this period started, which favors living off income. When bitcoin climbs a lot, selling it usually ends up ahead on paper.</span>`
        : ` <span class="muted">Note: bitcoin is up ${move.toFixed(0)}% since this period started, which favors holding more bitcoin. The trade-off is how much of it you had to sell, and when.</span>`;
    })();

  const R = r.R;
  $('tax-summary').innerHTML = `Selling bitcoin triggered <b>${usd0(a.tax)}</b> in capital-gains tax. ` +
    `The income funds paid <b>${usd0(b.payouts)}</b>, and about <b>${usd0(b.roc)}</b> of that was return of capital (not taxed now; it lowers your cost basis), so tax on income was about <b>${usd0(b.tax)}</b>. ` +
    `If you sold everything today you'd owe roughly <b>${usd0(a.unrealized * R.longTerm)}</b> more under A and <b>${usd0(b.unrealized * R.longTerm)}</b> under B (long-term rates). Holding or borrowing isn't a sale, so neither is owed until you sell. ` +
    `Rates used: ${R.label}.`;
  $('tax-note').innerHTML = `${US_NOTE} Return-of-capital shares are estimates from each issuer's latest notices; check the fund's own website for the most accurate 19a-1 notices. Interest on money borrowed for living costs usually isn't tax-deductible. <a href="learn.html#taxes">How taxes work here</a>`;
  $('period').textContent = `Real prices and payouts, ${prettyDate(r.start)} to today`;
  syncStyles();
  draw();
}

function draw() {
  const r = result;
  const pts = downsample(r.rows, 420);
  const views = {
    worth: { a: pts.map((x) => x.worthA), b: pts.map((x) => x.worthB), fmt: (v) => usd0(v), la: 'A: sell bitcoin', lb: 'B: live off income' },
    coins: { a: pts.map((x) => x.coinsA), b: pts.map((x) => x.coinsB), fmt: (v) => btc(v), la: 'A: bitcoin left', lb: 'B: bitcoin left' },
    loan: { a: pts.map(() => 0), b: pts.map((x) => x.loan), fmt: (v) => usd0(v), la: 'A: no loan', lb: 'B: loan owed' },
  };
  const v = views[view];
  const colorB = css('--brand');
  $('legend').innerHTML = `<span><i class="sw" style="background:${COLOR_A}"></i>${v.la}</span><span><i class="sw" style="background:${colorB}"></i>${v.lb}</span>`;
  const drawIn = drawInFor(chart, animateNext); animateNext = false;
  chart?.destroy();
  const tl = (i) => `${prettyDate(pts[i].d)} · bitcoin ${usd0(pts[i].p)} · A ${v.fmt(v.a[i])} · B ${v.fmt(v.b[i])}`;
  chart = lineChart($('chart'), {
    labels: pts.map((x) => x.d),
    datasets: [
      { label: 'A', data: v.a, color: COLOR_A, width: 1.75 },
      { label: 'B', data: v.b, color: colorB },
    ],
    drawIn, pulse: 1,
    dateLabel: (i) => prettyDate(pts[i].d),
    onScrub: (i) => { $('tl').textContent = i == null ? defaultTl() : tl(i); },
  });
  $('tl').textContent = defaultTl();
}
const defaultTl = () => 'Drag across the chart to compare both plans on any day.';

/* ================= inputs ================= */
function renderStyles() {
  $('styles').innerHTML = STYLES.map((st, i) => `<button class="choice" data-i="${i}" type="button"><span class="radio"></span><span class="t">${st.label} ${riskTag({ level: st.risk, note: '' })}</span><span class="d">${st.blurb}</span></button>`).join('');
  $('styles').onclick = (e) => { const b = e.target.closest('.choice'); if (!b) return; state.style = +b.dataset.i; animateNext = true; render(); };
}
const syncStyles = () => $('styles').querySelectorAll('.choice').forEach((b) => b.classList.toggle('active', +b.dataset.i === state.style));

(async () => {
  try {
    const data = await loadData();
    A = incomeAssets(data);
    for (const t of [...Object.keys(A), 'BTC']) prices[t] = priceLookup(data.series[t].prices);
    for (const t of Object.keys(A)) events[t] = new Map(data.series[t].dividends);
    const [now, quotes] = await Promise.race([Promise.all([liveBTC(), liveQuotes(LIVE_QUOTES_URL)]), new Promise((r) => setTimeout(() => r([null, null]), 1500))]);
    if (now) prices.BTC.set(todayISO(), now);
    applyQuotes(prices, quotes);

    $('basis-lbl').innerHTML = term('I paid per bitcoin', 'Your average cost per bitcoin (your cost basis). Used to work out the tax when plan A sells.', 'taxes');
    $('extra-lbl').innerHTML = term('Extra savings', 'Money you have on top of your bitcoin. Plan A uses it to buy more bitcoin; plan B uses it to buy income funds.');
    $('apr-lbl').innerHTML = term('Borrowing rate', 'The yearly interest rate for borrowing against your holdings (margin) when plan B\'s income falls short.', 'margin');
    $('held-lbl').innerHTML = term('Held over a year', 'If you\'ve owned your bitcoin for more than a year, selling it is taxed at the lower long-term rate.', 'taxes');
    for (const id of ['btc', 'basis', 'need', 'extra', 'apr']) $(id).oninput = (e) => { state[id] = Math.max(0, +e.target.value || 0); render(); };
    $('held').onchange = (e) => { state.held = e.target.value === 'yes'; render(); };
    renderStyles();
    taxControls($('tax-controls'), () => result && render());
    rangeBar($('view'), [['worth', 'Total worth'], ['coins', 'Bitcoin held'], ['loan', 'Loan']], view, (v) => { view = v; animateNext = true; draw(); });
    render();
    revealSections();
  } catch (err) {
    $('summary').textContent = 'Could not load price data. Please refresh the page.';
    console.error(err);
  }
})();
onTheme(() => result && draw());
onMode(() => result && render());
