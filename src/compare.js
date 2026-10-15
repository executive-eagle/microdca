import {
  mountLayout, revealSections, drawInFor, loadData, priceLookup, liveBTC, liveQuotes, applyQuotes, eachDay, scheduleDates, addDays, daysBetween,
  todayISO, downsample, lineChart, rangeBar, riskTag, term, usd0, btc, prettyDate, css, onTheme, onMode, isSimple,
} from './common.js';
import { incomeAssets, STYLES, LIVE_QUOTES_URL } from './config.js';
import { taxControls, taxRates, US_NOTE } from './tax.js';

mountLayout('compare.html');
const $ = (id) => document.getElementById(id);
const COLOR_A = '#9AA4AE';

let A, prices = {}, events = {}, chart, view = 'worth', result, animateNext = true;
const state = { money: 10000, need: 50, pctA: 100, pctB: 50, style: 1, toBtc: 50, apr: 8, basis: null, held: false };
const LEFTOVER = [
  { v: 0, label: 'Buy more income', d: 'Reinvest it, so the income keeps growing.' },
  { v: 50, label: 'Half and half', d: 'Half buys bitcoin, half buys more income.' },
  { v: 100, label: 'Stack sats', d: 'All of it buys more bitcoin.' },
];

/* ================= engine ================= */
/**
 * One plan, replayed day by day.
 * rule 'sell': income pays bills first, then bitcoin is sold (oldest first, grossed up for capital-gains tax).
 * rule 'borrow': income pays bills; any shortfall is borrowed; bitcoin is never sold.
 * Leftover income pays down any loan, then at month end is split between bitcoin and income funds.
 */
function runPlan({ btcPct, rule }, ctx) {
  const { start, end, funds, mix, wTotal, billDays, R } = ctx;
  const p0 = prices.BTC(start);
  const btcMoney = (state.money * btcPct) / 100, fundMoney = state.money - btcMoney;
  const basis0 = state.basis || p0;
  const lots = btcMoney > 0 ? [{ coins: btcMoney / p0, basis: basis0, from: state.held ? addDays(start, -400) : start }] : [];
  const shares = {}, fBasis = {};
  for (const t of funds) { const amt = (fundMoney * mix[t]) / wTotal; shares[t] = amt / prices[t](start); fBasis[t] = amt; }
  const s = { pot: 0, loan: 0, interest: 0, taxSales: 0, taxIncome: 0, payouts: 0, roc: 0, sold: 0, stacked: 0, biggest: { coins: 0, d: null, price: 0 }, ranOut: null, maxLtv: 0, maxLtvDate: null, startCoins: btcMoney / p0 };
  const coins = () => lots.reduce((a, l) => a + l.coins, 0);
  const fundValue = (d) => funds.reduce((a, t) => a + shares[t] * prices[t](d), 0);
  const apr = state.apr / 100;

  function sellBitcoin(need, d, price) {
    let left = need, q0 = 0;
    while (left > 0.005 && lots.length) {
      const l = lots[0];
      const rate = daysBetween(l.from, d) > 365 ? R.longTerm : R.ordinary;
      const taxPer = Math.max(0, price - l.basis) * rate;
      const q = Math.min(l.coins, left / (price - taxPer));
      l.coins -= q; q0 += q; left -= q * (price - taxPer); s.taxSales += q * taxPer;
      if (l.coins < 1e-12) lots.shift();
    }
    s.sold += q0;
    if (q0 > s.biggest.coins) s.biggest = { coins: q0, d, price };
    return left;
  }

  const rows = [];
  for (const d of eachDay(start, end)) {
    const p = prices.BTC(d);
    if (s.loan > 0) { const i = (s.loan * apr) / 365; s.loan += i; s.interest += i; }
    for (const t of funds) {
      const per = events[t].get(d);
      if (!per) continue;
      const div = per * shares[t];
      const roc = div * (A[t].roc_estimate ?? 0);
      const fromBasis = Math.min(roc, fBasis[t]);
      fBasis[t] -= fromBasis; s.roc += fromBasis;
      const tax = (div - roc) * R.ordinary + (roc - fromBasis) * R.longTerm;
      s.taxIncome += tax; s.payouts += div; s.pot += div - tax;
    }
    if (billDays.has(d)) {
      const fromPot = Math.min(s.pot, state.need);
      s.pot -= fromPot;
      let short = state.need - fromPot;
      if (short > 0.005) {
        if (rule === 'sell') short = sellBitcoin(short, d, p);
        if (short > 0.005) {
          if (rule === 'sell' && !s.ranOut) s.ranOut = d; // nothing left to sell
          s.loan += short; // 'borrow' plans (or an empty 'sell' plan) borrow the gap
        }
      }
    }
    if (s.pot > 0 && s.loan > 0) { const pay = Math.min(s.pot, s.loan); s.pot -= pay; s.loan -= pay; }
    if (s.pot > 1 && s.loan <= 0 && addDays(d, 1).slice(8) === '01') {
      const toBtc = (s.pot * state.toBtc) / 100, toFunds = s.pot - toBtc;
      if (toBtc > 0) { lots.push({ coins: toBtc / p, basis: p, from: d }); s.stacked += toBtc / p; }
      if (toFunds > 0 && funds.length) for (const t of funds) { const amt = (toFunds * mix[t]) / wTotal; shares[t] += amt / prices[t](d); fBasis[t] += amt; }
      s.pot = funds.length || toBtc > 0 ? 0 : s.pot;
    }
    const holdings = coins() * p + fundValue(d);
    const ltv = holdings > 0 ? s.loan / holdings : 0;
    if (ltv > s.maxLtv) { s.maxLtv = ltv; s.maxLtvDate = d; }
    rows.push({ d, p, worth: holdings + s.pot - s.loan, coins: coins(), loan: s.loan });
  }
  s.coins = coins();
  s.fundValue = fundValue(end);
  s.annualIncome = funds.reduce((a, t) => a + shares[t] * A[t].annual, 0);
  const pEnd = rows.at(-1).p;
  s.unrealized = lots.reduce((a, l) => a + Math.max(0, pEnd - l.basis) * l.coins, 0) + Math.max(0, s.fundValue - funds.reduce((a, t) => a + fBasis[t], 0));
  s.worth = rows.at(-1).worth;
  s.rows = rows;
  return s;
}

function simulate() {
  const mix = STYLES[state.style].mix;
  const funds = Object.keys(mix).filter((t) => A[t] && mix[t] > 0);
  const wTotal = funds.reduce((a, t) => a + mix[t], 0);
  const start = funds.reduce((m, t) => (prices[t].first > m ? prices[t].first : m), prices.BTC.first);
  const end = todayISO();
  const ctx = { start, end, funds, mix, wTotal, billDays: new Set(scheduleDates(addDays(start, 1), end, 'monthly')), R: taxRates() };
  const a = runPlan({ btcPct: state.pctA, rule: 'sell' }, ctx);
  const b = runPlan({ btcPct: state.pctB, rule: 'borrow' }, ctx);
  return { ...ctx, a, b, months: ctx.billDays.size, pStart: prices.BTC(start), pEnd: a.rows.at(-1).p };
}

/* ================= rendering ================= */
const short = (v) => v.toFixed(v >= 1 ? 4 : 6) + ' BTC';
const signed = (v) => (Math.abs(v) < 1e-8 ? '' : `<div class="cs ${v > 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : '−'}${short(Math.abs(v))}</div>`);

/** One Robinhood-style comparison table instead of two boxes. */
function table(r) {
  const { a, b } = r;
  const mixLabel = (pct) => (pct >= 100 ? '100% bitcoin' : pct <= 0 ? '100% income' : `${pct}% bitcoin, ${100 - pct}% income`);
  const row = (k, va, vb, opts = {}) => (opts.hide ? '' : `<tr${opts.cls ? ` class="${opts.cls}"` : ''}><th scope="row">${k}</th><td>${va}</td><td>${vb}</td></tr>`);
  const sale = (s) => (s.biggest.d ? `${short(s.biggest.coins)}<div class="cs muted">at ${usd0(s.biggest.price)}, ${prettyDate(s.biggest.d).replace(/, \d{4}$/, '')}</div>` : '<span class="muted">None</span>');
  const ltv = (s) => (s.maxLtv > 0.0005 ? `${Math.round(s.maxLtv * 100)}%` : '<span class="muted">0%</span>');
  const win = a.worth >= b.worth ? 'a' : 'b';
  $('ctable').innerHTML = `
    <thead><tr><th></th>
      <th><span class="dot" style="background:${COLOR_A}"></span>Sell bitcoin<div class="cs muted">${mixLabel(state.pctA)}</div></th>
      <th><span class="dot" style="background:${css('--brand')}"></span>Keep bitcoin<div class="cs muted">${mixLabel(state.pctB)}</div></th></tr></thead>
    <tbody>
      ${row('Bitcoin now', `${short(a.coins)}${signed(a.coins - a.startCoins)}`, `${short(b.coins)}${signed(b.coins - b.startCoins)}`)}
      ${row(term('Biggest forced sale', 'The most bitcoin sold in a single month, and the price. Bills come due whether prices are up or down.'), sale(a), sale(b), { hide: !a.sold && !b.sold })}
      ${row(term('Bought with income', 'Leftover income (after bills and any loan) that went into more bitcoin.'), a.stacked ? `+${short(a.stacked)}` : '<span class="muted">None</span>', b.stacked ? `+${short(b.stacked)}` : '<span class="muted">None</span>', { hide: !a.stacked && !b.stacked })}
      ${row('Income funds', a.fundValue > 0.5 ? usd0(a.fundValue) : '<span class="muted">None</span>', b.fundValue > 0.5 ? usd0(b.fundValue) : '<span class="muted">None</span>')}
      ${row('Income now', a.annualIncome ? `${usd0(a.annualIncome / 12)}/mo` : '<span class="muted">$0</span>', b.annualIncome ? `${usd0(b.annualIncome / 12)}/mo` : '<span class="muted">$0</span>')}
      ${row(term('Taxes paid', 'Capital-gains tax on bitcoin sold, plus tax on income that isn\'t return of capital.', 'taxes'), usd0(a.taxSales + a.taxIncome), usd0(b.taxSales + b.taxIncome))}
      ${row(term('Loan owed', `Borrowed when income fell short, at ${state.apr}% a year. Leftover income pays it down.`, 'margin'), usd0(a.loan), usd0(b.loan))}
      ${row(term('Highest loan vs. holdings', 'The most the loan ever was compared with what you owned. Brokers can force sales above roughly 30–50%.', 'margin'), ltv(a), ltv(b), { hide: isSimple() })}
      ${row('Ran out of bitcoin', a.ranOut ? prettyDate(a.ranOut) : '<span class="muted">No</span>', '<span class="muted">Never sells</span>', { hide: !a.ranOut })}
      ${row('Worth today', `<span class="${win === 'a' ? 'pos' : ''}">${usd0(a.worth)}</span>`, `<span class="${win === 'b' ? 'pos' : ''}">${usd0(b.worth)}</span>`, { cls: 'total' })}
    </tbody>`;
}

function render() {
  if (!(state.money > 0) || !(state.need >= 0)) return;
  const r = (result = simulate());
  const { a, b } = r;
  $('split-note').innerHTML = `Sell: ${usd0((state.money * state.pctA) / 100)} bitcoin + ${usd0(state.money - (state.money * state.pctA) / 100)} income. Keep: ${usd0((state.money * state.pctB) / 100)} bitcoin + ${usd0(state.money - (state.money * state.pctB) / 100)} income.`;
  table(r);

  const diff = b.worth - a.worth;
  const move = (r.pEnd / r.pStart - 1) * 100;
  const bCoins = b.coins - b.startCoins, aCoins = a.coins - a.startCoins;
  $('summary').innerHTML =
    `Starting with <b>${usd0(state.money)}</b> and paying <b>${usd0(state.need)} a month</b> for ${r.months} months since ${prettyDate(r.start)}: ` +
    `selling ${aCoins < -1e-8 ? `meant giving up <b>${short(-aCoins)}</b>` : aCoins > 1e-8 ? `still grew bitcoin by <b>${short(aCoins)}</b>` : 'kept all its bitcoin'}` +
    `${a.ranOut ? ` and ran out of bitcoin on ${prettyDate(a.ranOut)}` : ''}, ` +
    `while keeping ${bCoins > 1e-8 ? `<b>added ${short(bCoins)}</b> from leftover income` : 'held every coin'}${b.loan > 0.5 ? ` and owes <b>${usd0(b.loan)}</b>` : ''}. ` +
    (Math.abs(diff) < 1 ? 'Both end up worth about the same.' : `<b>${diff > 0 ? 'Keeping' : 'Selling'}</b> ends up <span class="pos">${usd0(Math.abs(diff))} ahead</span>.`) +
    (Math.abs(move) < 5 ? '' : move < 0
      ? ` <span class="muted">Bitcoin is down ${Math.abs(move).toFixed(0)}% since this period started, which favors holding less of it. In a strong rally, more bitcoin usually wins on paper.</span>`
      : ` <span class="muted">Bitcoin is up ${move.toFixed(0)}% since this period started, which favors holding more of it. The trade-off is how much you had to sell, and when.</span>`);

  const R = r.R;
  $('tax-summary').innerHTML =
    `Selling paid about <b>${usd0(a.taxSales + a.taxIncome)}</b> in tax${a.taxSales > 0.5 ? `, mostly capital-gains tax on the bitcoin it sold` : ''}. ` +
    `Keeping paid about <b>${usd0(b.taxSales + b.taxIncome)}</b>: of its <b>${usd0(b.payouts)}</b> in payouts, about <b>${usd0(b.roc)}</b> was return of capital (not taxed now; it lowers your cost basis). ` +
    `Selling everything today would add roughly <b>${usd0(a.unrealized * R.longTerm)}</b> and <b>${usd0(b.unrealized * R.longTerm)}</b> at long-term rates. Holding or borrowing isn't a sale. Rates used: ${R.label}.`;
  $('tax-note').innerHTML = `${US_NOTE} Return-of-capital shares are estimates from each issuer's latest notices; check the fund's own website for the most accurate 19a-1 notices. Interest on money borrowed for living costs usually isn't tax-deductible. <a href="learn.html#taxes">How taxes work here</a>`;
  $('period').textContent = `Real prices and payouts, ${prettyDate(r.start)} to today`;
  syncInputs();
  draw();
}

function draw() {
  const r = result;
  const pa = downsample(r.a.rows, 420), pb = downsample(r.b.rows, 420);
  const views = {
    worth: { a: pa.map((x) => x.worth), b: pb.map((x) => x.worth), fmt: usd0, la: 'Sell bitcoin', lb: 'Keep bitcoin' },
    coins: { a: pa.map((x) => x.coins), b: pb.map((x) => x.coins), fmt: btc, la: 'Sell: bitcoin held', lb: 'Keep: bitcoin held' },
    loan: { a: pa.map((x) => x.loan), b: pb.map((x) => x.loan), fmt: usd0, la: 'Sell: loan', lb: 'Keep: loan' },
  };
  const v = views[view];
  const colorB = css('--brand');
  $('legend').innerHTML = `<span><i class="sw" style="background:${COLOR_A}"></i>${v.la}</span><span><i class="sw" style="background:${colorB}"></i>${v.lb}</span>`;
  const drawIn = drawInFor(chart, animateNext); animateNext = false;
  chart?.destroy();
  chart = lineChart($('chart'), {
    labels: pa.map((x) => x.d),
    datasets: [{ label: 'A', data: v.a, color: COLOR_A, width: 1.75 }, { label: 'B', data: v.b, color: colorB }],
    drawIn, pulse: 1,
    dateLabel: (i) => prettyDate(pa[i].d),
    onScrub: (i) => { $('tl').textContent = i == null ? defaultTl : `${prettyDate(pa[i].d)} · bitcoin ${usd0(pa[i].p)} · Sell ${v.fmt(v.a[i])} · Keep ${v.fmt(v.b[i])}`; },
  });
  $('tl').textContent = defaultTl;
}
const defaultTl = 'Drag across the chart to compare both plans on any day.';

/* ================= inputs ================= */
function syncInputs() {
  $('out-a').textContent = state.pctA + '%';
  $('out-b').textContent = state.pctB + '%';
  $('out-btc').textContent = state.toBtc + '%';
  $('styles').querySelectorAll('.choice').forEach((b) => b.classList.toggle('active', +b.dataset.i === state.style));
  $('leftover').querySelectorAll('.choice').forEach((b) => b.classList.toggle('active', +b.dataset.v === state.toBtc));
  $('quick').querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.v === state.money));
}

(async () => {
  try {
    const data = await loadData();
    A = incomeAssets(data);
    for (const t of [...Object.keys(A), 'BTC']) prices[t] = priceLookup(data.series[t].prices);
    for (const t of Object.keys(A)) events[t] = new Map(data.series[t].dividends);
    const [now, quotes] = await Promise.race([Promise.all([liveBTC(), liveQuotes(LIVE_QUOTES_URL)]), new Promise((r) => setTimeout(() => r([null, null]), 1500))]);
    if (now) prices.BTC.set(todayISO(), now);
    applyQuotes(prices, quotes);

    $('money-lbl').innerHTML = term('Starting money', 'Both plans start with exactly this much on the same day. You choose how each one splits it between bitcoin and income funds.');
    $('apr-lbl').innerHTML = term('Borrowing rate', 'Yearly interest for borrowing against your holdings (margin) when income falls short.', 'margin');
    $('basis-lbl').innerHTML = term('Bitcoin cost basis', 'What you paid per bitcoin, if you bought it earlier. Leave blank to use the price on the start date. Only affects taxes when plan A sells.', 'taxes');
    $('held-lbl').innerHTML = term('Held over a year', 'If your bitcoin was bought more than a year before the start, sales are taxed at the lower long-term rate.', 'taxes');

    $('quick').innerHTML = [1000, 10000, 50000, 100000].map((v) => `<button data-v="${v}">${usd0(v).replace(',000', 'K')}</button>`).join('');
    $('quick').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; state.money = +b.dataset.v; $('money').value = state.money; render(); };
    $('styles').innerHTML = STYLES.map((st, i) => `<button class="choice" data-i="${i}" type="button"><span class="radio"></span><span class="t">${st.label} ${riskTag({ level: st.risk, note: '' })}</span><span class="d">${st.blurb}</span></button>`).join('');
    $('styles').onclick = (e) => { const b = e.target.closest('.choice'); if (!b) return; state.style = +b.dataset.i; animateNext = true; render(); };
    $('leftover').innerHTML = LEFTOVER.map((o) => `<button class="choice" data-v="${o.v}" type="button"><span class="radio"></span><span class="t">${o.label}</span><span class="d">${o.d}</span></button>`).join('');
    $('leftover').onclick = (e) => { const b = e.target.closest('.choice'); if (!b) return; state.toBtc = +b.dataset.v; $('to-btc').value = state.toBtc; render(); };

    $('money').oninput = (e) => { state.money = Math.max(0, +e.target.value || 0); render(); };
    $('need').oninput = (e) => { state.need = Math.max(0, +e.target.value || 0); render(); };
    $('apr').oninput = (e) => { state.apr = Math.max(0, +e.target.value || 0); render(); };
    $('basis').oninput = (e) => { state.basis = +e.target.value > 0 ? +e.target.value : null; render(); };
    $('held').onchange = (e) => { state.held = e.target.value === 'yes'; render(); };
    $('pct-a').oninput = (e) => { state.pctA = +e.target.value; render(); };
    $('pct-b').oninput = (e) => { state.pctB = +e.target.value; render(); };
    $('to-btc').oninput = (e) => { state.toBtc = +e.target.value; render(); };

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
