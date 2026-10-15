import {
  mountLayout, revealSections, drawInFor, reduceMotion, loadData, priceLookup, liveBTC, scheduleDates, eachDay, downsample, lineChart, rangeBar, setTrend, roller, Chart,
  usd, usd0, pct, btc, num, stat, term, changeLine, signClass, prettyDate, parseISO, addDays, daysBetween, todayISO, sparkline, css, onTheme, FREQ_WORD,
} from './common.js';
import { incomeAssets, buyTargets, colorOf, nameOf, PRESETS, PAYOUT_PRESETS, BITCOIN } from './config.js';

mountLayout('income.html');

const $ = (id) => document.getElementById(id);
const big = roller($('big'));
const SAVE_KEY = 'microdca-income-v1';
const BUCKET_COLORS = { same: '#F7931A', margin: '#7C8CF8', bills: '#F2716B', cash: '#4FB0C6' };
const WINDOWS = [['1M', '1M', 30], ['3M', '3M', 91], ['6M', '6M', 182], ['1Y', '1Y', 365], ['ALL', 'All', 1e5]];

let A, TICKERS, TARGETS, data, prices = {}, events = {}, rates = {}, chart, view = 'income', win = 'ALL', result, animateNext = true;
const state = {
  amount: 500, freq: 'monthly', start: null, end: null, mix: {}, sched: 'actual',
  buckets: [{ key: 'same', pct: 100 }], route: 'paid', compare: 'BTC', margin: { balance: 5000, apr: 8.5 },
};

/* ---------- persistence (per-browser convenience only) ---------- */
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ buckets: state.buckets, route: state.route, compare: state.compare, margin: state.margin })); } catch {} }
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s?.buckets?.length) Object.assign(state, { buckets: s.buckets, route: s.route || 'paid', compare: s.compare || 'BTC', margin: s.margin || state.margin });
  } catch {}
}

/* ---------- bucket helpers ---------- */
const bucketKey = (b) => b.key ?? (b.kind === 'buy' ? 'buy:' + b.target : b.kind);
const kindOf = (key) => key.split(':')[0];
const targetOf = (key) => key.split(':')[1];
function bucketLabel(key) {
  const k = kindOf(key);
  if (k === 'same') return 'Reinvest in same fund';
  if (k === 'buy') return `Buy ${targetOf(key)}`;
  return { margin: 'Pay down margin', bills: 'Bills & spending', cash: 'Savings (cash)' }[k];
}
const bucketColor = (key) => (kindOf(key) === 'buy' ? colorOf(targetOf(key)) : BUCKET_COLORS[kindOf(key)]);
const bucketOptions = () => [
  ['same', 'Reinvest in same fund'],
  ...TARGETS.map((t) => [`buy:${t.ticker}`, `Buy ${t.ticker}`]),
  ['margin', 'Pay down margin'], ['bills', 'Bills & spending'], ['cash', 'Savings (cash)'],
];

/* ---------- engine ---------- */
/** Spreads each real payout evenly across the days it covered → per-share daily rate for "daily" mode. */
function dailyRate(t) {
  const ranges = [];
  let prev = data.series[t].prices[0][0];
  for (const [d, amt] of data.series[t].dividends) {
    ranges.push({ from: prev, to: d, perDay: amt / Math.max(1, daysBetween(prev, d)) });
    prev = d;
  }
  const fwd = A[t].annual / 365;
  return (iso) => {
    for (const r of ranges) if (iso > r.from && iso <= r.to) return r.perDay;
    return iso > prev ? fwd : 0;
  };
}

const active = () => TICKERS.filter((t) => state.mix[t] > 0);
function effectiveStart() {
  const min = active().reduce((m, t) => (prices[t].first > m ? prices[t].first : m), '0000');
  return state.start < min ? min : state.start;
}

function simulate() {
  const start = effectiveStart(), end = state.end;
  const mixTotal = active().reduce((s, t) => s + state.mix[t], 0);
  const buys = new Set(scheduleDates(start, end, state.freq));
  const routeDays = state.route === 'paid' ? null : new Set(scheduleDates(start, end, state.route));
  const all = [...new Set([...TICKERS, ...TARGETS.map((t) => t.ticker)])];
  const zero = () => Object.fromEntries(all.map((t) => [t, 0]));
  const shares = zero(), fromPayouts = zero(), paidBy = zero(), costBy = zero(), pot = zero();
  const bTotal = state.buckets.reduce((s, b) => s + (b.pct || 0), 0) || 1;
  const B = state.buckets.map((b) => ({ key: bucketKey(b), w: (b.pct || 0) / bTotal, sent: 0, lots: [], shadow: [], overflow: [] }));
  const hasMargin = B.some((b) => kindOf(b.key) === 'margin');
  let bal = hasMargin ? state.margin.balance : 0, shadowBal = bal, interest = 0, paidDown = 0, payoffDate = null;
  const apr = state.margin.apr / 100;
  let invested = 0, cash = 0, spent = 0, totalDiv = 0;
  const months = new Map(), rows = [];
  const px = (t, d) => prices[t](d);

  const buyInto = (t, amt, d) => { const s = amt / px(t, d); shares[t] += s; fromPayouts[t] += s; return s; };

  for (const d of eachDay(start, end)) {
    // margin interest accrues daily
    if (bal > 0) { const i = (bal * apr) / 365; bal += i; interest += i; }
    if (shadowBal > 0) shadowBal += (shadowBal * apr) / 365;

    // 1) payouts on shares held coming into today go into each fund's pot
    for (const t of TICKERS) {
      if (!shares[t]) continue;
      const daily = state.sched === 'daily' && A[t].dailyFrom;
      const div = daily ? shares[t] * rates[t](d) : (events[t].get(d) || 0) * shares[t];
      if (!div) continue;
      pot[t] += div; paidBy[t] += div; totalDiv += div;
    }

    // 2) split the pots across buckets
    if (!routeDays || routeDays.has(d)) {
      const m = d.slice(0, 7);
      if (!months.has(m)) months.set(m, Object.fromEntries(B.map((_, i) => [i, 0])));
      for (const t of TICKERS) {
        if (!pot[t]) continue;
        const amt = pot[t]; pot[t] = 0;
        B.forEach((b, i) => {
          const x = amt * b.w;
          if (!x) return;
          b.sent += x;
          months.get(m)[i] += x;
          const k = kindOf(b.key);
          if (k === 'same' || k === 'buy') {
            const tk = k === 'same' ? t : targetOf(b.key);
            b.lots.push({ d, amt: x, t: tk, sh: buyInto(tk, x, d) });
            return;
          }
          // money that leaves the market: track what it would have bought instead
          b.shadow.push({ d, amt: x, sh: x / px(state.compare, d) });
          if (k === 'margin') {
            const pay = Math.min(x, bal);
            bal -= pay; paidDown += pay;
            if (bal <= 0.005 && !payoffDate && pay > 0) payoffDate = d;
            if (x - pay > 0) b.overflow.push({ d, amt: x - pay, t, sh: buyInto(t, x - pay, d) });
          } else if (k === 'bills') spent += x;
          else cash += x;
        });
      }
    }

    // 3) scheduled purchase
    if (buys.has(d)) {
      invested += state.amount;
      for (const t of active()) { const amt = (state.amount * state.mix[t]) / mixTotal; shares[t] += amt / px(t, d); costBy[t] += amt; }
    }
    const pending = Object.values(pot).reduce((s, v) => s + v, 0);
    const value = all.reduce((s, t) => s + (shares[t] ? shares[t] * px(t, d) : 0), 0) + cash + pending;
    rows.push({ d, invested, totalDiv, value, net: value - bal, debt: bal });
  }
  const annual = TICKERS.reduce((s, t) => s + shares[t] * A[t].annual, 0);
  const last = rows.at(-1);
  return {
    start, end, rows, months: [...months], B, invested, totalDiv, annual, monthly: annual / 12, value: last.value, net: last.net,
    shares, fromPayouts, paidBy, costBy, cash, spent, all, buys: buys.size,
    margin: hasMargin ? { start: state.margin.balance, bal, interest, paidDown, saved: shadowBal - bal - paidDown, payoffDate, shadowBal } : null,
  };
}

/* ---------- bucket analytics ---------- */
const lotValue = (lots, end) => lots.reduce((s, l) => s + l.sh * prices[l.t](end), 0);
function bucketStats(b, r, days) {
  const from = addDays(r.end, -days);
  const inWin = (l) => l.d > from;
  const k = kindOf(b.key);
  const cmpNow = prices[state.compare](r.end);
  const sent = (k === 'same' || k === 'buy' ? b.lots : b.shadow).filter(inWin).reduce((s, l) => s + l.amt, 0);
  const ifInvested = b.shadow.filter(inWin).reduce((s, l) => s + l.sh * cmpNow, 0);
  if (k === 'same' || k === 'buy') {
    const worth = lotValue(b.lots.filter(inWin), r.end);
    return { sent, worth, gain: worth - sent };
  }
  if (k === 'margin') {
    // value of paying down debt = dollars paid + interest you no longer owe (+ any overflow reinvested)
    const share = r.margin && r.margin.paidDown ? Math.min(1, sent / Math.max(b.sent, 1e-9)) : 0;
    const worth = Math.min(sent, r.margin.paidDown) + r.margin.saved * share + lotValue(b.overflow.filter(inWin), r.end);
    return { sent, worth, gain: worth - sent, ifInvested };
  }
  if (k === 'bills') return { sent, worth: 0, gain: -sent, ifInvested, spent: true };
  return { sent, worth: sent, gain: 0, ifInvested };
}
function priceChange(t, days, end, simStart) {
  let from = addDays(end, -days);
  if (from < simStart) from = simStart;
  const a = prices[t](from < prices[t].first ? prices[t].first : from), b = prices[t](end);
  return (b / a - 1) * 100;
}

/* ---------- rendering ---------- */
function headline() {
  const r = result;
  big(usd(r.monthly));
  $('change').innerHTML = `<span class="pos">+${usd(r.totalDiv)}</span> <span class="when">paid to you so far · ${((r.annual / r.invested) * 100).toFixed(2)}% yield on cost</span>`;
}

function render() {
  const mixTotal = TICKERS.reduce((s, t) => s + (state.mix[t] || 0), 0);
  $('mix-total').innerHTML = mixTotal === 100 ? 'Total 100%' : `<span class="neg">Total ${mixTotal}%</span> · scaled to 100%`;
  const bTotal = state.buckets.reduce((s, b) => s + (b.pct || 0), 0);
  $('bucket-total').innerHTML = bTotal === 100 ? 'Total 100%' : `<span class="neg">Total ${bTotal}%</span> · scaled to 100%`;
  document.querySelectorAll('.margin-opt').forEach((el) => { el.hidden = !state.buckets.some((b) => kindOf(bucketKey(b)) === 'margin'); });
  renderFlow();
  if (!mixTotal || !bTotal || !(state.amount > 0) || state.start >= state.end) return;
  const r = (result = simulate());
  // paying down an existing loan counts as a gain: value + debt removed − money put in
  const gain = r.value + (r.margin ? r.margin.start - r.margin.bal : 0) - r.invested;
  setTrend(true);
  headline();
  const late = r.start !== state.start ? ` (from ${prettyDate(r.start)}, once everything you picked was trading)` : ` from ${prettyDate(r.start)}`;
  $('sentence').innerHTML = `Investing ${usd0(state.amount)} ${FREQ_WORD[state.freq]}${late}. Monthly income is an ${term('estimate', 'What you own today × each fund\'s current yearly payout, divided by 12. Rates can change or stop.')} at today's rates.`;

  const stats = [
    stat(term('Total invested', 'Every scheduled purchase added together.'), usd(r.invested)),
    stat(term('Current value', 'Everything you own today, including anything bought with payouts and any savings cash.'), usd(r.value)),
    stat(term('Total return', r.margin ? 'Current value, plus how much your margin loan shrank (or minus how much it grew), minus what you put in.' : 'Current value minus what you put in.'), `${usd(gain)} (${pct((gain / r.invested) * 100)})`, signClass(gain)),
    stat(term('Payouts received', 'Every dividend and distribution paid to you over the whole period.'), usd(r.totalDiv), 'pos'),
    stat('Monthly income', usd(r.monthly)),
    stat('Yearly income', usd(r.annual)),
    stat(term('Yield on cost', 'Yearly income divided by the money you put in.'), ((r.annual / r.invested) * 100).toFixed(2) + '%'),
    stat('Purchases', r.buys.toLocaleString()),
  ];
  if (r.spent) stats.push(stat('Spent on bills', usd(r.spent)));
  if (r.cash) stats.push(stat('Savings cash', usd(r.cash)));
  if (r.margin) stats.push(stat(term('Value after margin', 'Current value minus what you still owe on margin.'), usd(r.net)));
  $('stats').innerHTML = stats.join('');

  renderBuckets(r);
  renderMargin(r);
  holdings(r);
  draw();
  save();
}

function renderFlow() {
  const total = state.buckets.reduce((s, b) => s + (b.pct || 0), 0) || 1;
  $('flow').innerHTML = state.buckets.map((b) => `<i style="width:${(b.pct / total) * 100}%;background:${bucketColor(bucketKey(b))}" title="${bucketLabel(bucketKey(b))} ${b.pct}%"></i>`).join('');
}

function renderBucketEditor() {
  const opts = bucketOptions();
  $('buckets').innerHTML = state.buckets.map((b, i) => {
    const key = bucketKey(b);
    return `<div class="bucket" data-i="${i}">
      <span class="dot" style="background:${bucketColor(key)}"></span>
      <select class="field" data-f="key" aria-label="Bucket ${i + 1} destination">${opts.map(([v, l]) => `<option value="${v}" ${v === key ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="pct-in"><input class="field" data-f="pct" type="number" inputmode="decimal" min="0" max="100" step="5" value="${b.pct}" aria-label="Bucket ${i + 1} percent" /></div>
      <button class="rm" data-f="rm" aria-label="Remove bucket" ${state.buckets.length === 1 ? 'disabled' : ''}>×</button>
    </div>`;
  }).join('');
  $('route-presets').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
}

function renderBuckets(r) {
  const days = WINDOWS.find((w) => w[0] === win)[2];
  const cmp = state.compare;
  const lines = r.B.map((b) => {
    const s = bucketStats(b, r, days);
    const k = kindOf(b.key);
    const label = bucketLabel(b.key);
    const tk = k === 'buy' ? targetOf(b.key) : null;
    const pc = tk ? priceChange(tk, days, r.end, r.start) : null;
    const ret = s.sent ? (s.gain / s.sent) * 100 : 0;
    const chip = s.spent ? `<div class="chip-val" style="background:var(--fg-2)">${usd(s.sent)}</div>` : `<div class="chip-val ${s.gain >= 0 ? '' : 'down'}">${usd(s.worth)}</div>`;
    let sub = `Sent ${usd(s.sent)} ${win === 'ALL' ? 'in total' : `in the last ${win}`}`;
    if (k === 'same' || k === 'buy') sub += ` · <span class="${signClass(s.gain)}">${s.gain >= 0 ? '+' : '-'}${usd(Math.abs(s.gain))} (${pct(ret)})</span>`;
    if (tk) sub += ` · ${tk} price ${pct(pc)} over ${win === 'ALL' ? 'the period' : win}`;
    let sub2 = '';
    if (s.ifInvested != null) {
      const opp = s.ifInvested - s.worth;
      sub2 = `<div class="sub2">${k === 'bills' ? 'Spent' : k === 'margin' ? `Worth ${usd(s.worth)} counting interest saved` : 'Held as cash'}. If it had bought ${cmp}: <b>${usd(s.ifInvested)}</b> · ${term('opportunity cost', `How much more (or less) this money would be worth today if it had been used to buy ${cmp} on the same days instead.`)} <span class="${opp > 0 ? 'neg' : 'pos'}">${opp >= 0 ? usd(opp) : '-' + usd(-opp)}</span></div>`;
    }
    return `<div class="li bucket-res"><div><div class="name"><span class="dot" style="background:${bucketColor(b.key)}"></span>${label}<span class="muted" style="font-weight:400">&nbsp;${Math.round(b.w * 100)}%</span></div><div class="sub">${sub}</div></div><span></span>${chip}${sub2}</div>`;
  });
  $('bucket-results').innerHTML = lines.join('');

  const out = r.B.filter((b) => ['bills', 'margin', 'cash'].includes(kindOf(b.key)));
  if (out.length) {
    const tot = out.reduce((s, b) => { const x = bucketStats(b, r, days); return { sent: s.sent + x.sent, worth: s.worth + x.worth, alt: s.alt + x.ifInvested }; }, { sent: 0, worth: 0, alt: 0 });
    $('opportunity').innerHTML = `${usd(tot.sent)} of payouts left the market ${win === 'ALL' ? 'overall' : `in the last ${win}`}. Had it all bought ${cmp} instead, it would be worth ${usd(tot.alt)} today, ${tot.alt >= tot.worth ? `<span class="neg">${usd(tot.alt - tot.worth)} more</span>` : `<span class="pos">${usd(tot.worth - tot.alt)} less</span>`} than what it's worth to you now.`;
  } else $('opportunity').textContent = 'Every payout stays invested, so nothing is left on the table.';
}

function renderMargin(r) {
  $('margin-block').hidden = !r.margin;
  if (!r.margin) return;
  const m = r.margin;
  $('margin-stats').innerHTML = [
    stat('Starting balance', usd(m.start)),
    stat('Balance now', usd(m.bal), m.bal > 0 ? 'neg' : 'pos'),
    stat('Paid down', usd(m.paidDown)),
    stat('Paid off', m.payoffDate ? prettyDate(m.payoffDate) : m.bal > 0 ? 'Not yet' : '—'),
    stat(term('Interest charged', `Interest added to the loan at ${state.margin.apr}% APR, charged daily.`), usd(m.interest)),
    stat(term('Interest saved', 'Interest you avoided by paying the loan down, compared with never paying it.'), usd(m.saved), 'pos'),
    stat(term('Owed if never paid', 'What the balance would have grown to with no paydowns.'), usd(m.shadowBal)),
    stat('Value after margin', usd(r.net)),
  ].join('');
}

function holdings(r) {
  const items = r.all.filter((t) => r.shares[t] > 1e-9).map((t) => {
    const p = prices[t](r.end), val = r.shares[t] * p;
    const spark = prices[t].between(r.start, r.end);
    const isInc = !!A[t];
    const cost = r.costBy[t] || 0;
    const up = isInc ? val + 0 >= cost : spark.at(-1) >= spark[0];
    const re = (r.fromPayouts[t] / r.shares[t]) * 100;
    return `<div class="li">
      <div><div class="name"><span class="dot" style="background:${colorOf(t)}"></span>${term(t, nameOf(t) + (A[t] ? '. ' + A[t].about : ''))}</div>
      <div class="sub">${t === BITCOIN.ticker ? btc(r.shares[t]) : num(r.shares[t], 3) + ' shares'}${isInc ? ` · ${usd((r.shares[t] * A[t].annual) / 12)}/mo` : ''}${cost ? ` · put in ${usd0(cost)}` : ''}</div></div>
      ${sparkline(downsample(spark, 60), spark.at(-1) >= spark[0] ? css('--up') : css('--down'))}
      <div class="chip-val ${up ? '' : 'down'}">${usd(val)}</div>
      <div class="bar"><i style="width:${100 - re}%;background:var(--principal)"></i><i style="width:${re}%;background:var(--reinvest)"></i></div>
      <div class="note"><span class="o">${re.toFixed(1)}%</span> bought with payouts${isInc ? ` · ${usd(r.paidBy[t])} paid out` : ''}</div>
    </div>`;
  });
  if (r.cash) items.push(`<div class="li"><div><div class="name"><span class="dot" style="background:${BUCKET_COLORS.cash}"></span>Savings</div><div class="sub">payouts kept as cash</div></div><span></span><div class="chip-val" style="background:var(--fg-2)">${usd(r.cash)}</div></div>`);
  $('holdings').innerHTML = items.join('');
}

const fmtMonth = (m) => parseISO(m + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function draw() {
  const r = result;
  const animate = animateNext && !reduceMotion;
  const drawIn = drawInFor(chart, animateNext);
  animateNext = false;
  chart?.destroy();
  $('chart').onmouseleave = null;
  if (view === 'income') {
    const months = r.months;
    $('legend').innerHTML = r.B.map((b) => `<span><i class="sw" style="background:${bucketColor(b.key)}"></i>${bucketLabel(b.key)}</span>`).join('');
    chart = new Chart($('chart'), {
      type: 'bar',
      data: {
        labels: months.map(([m]) => m),
        datasets: r.B.map((b, i) => ({ data: months.map(([, v]) => v[i]), backgroundColor: bucketColor(b.key), borderRadius: 2, maxBarThickness: 28, categoryPercentage: 0.75, stack: 's' })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        // bars grow up one after another the first time, then update instantly while you tweak inputs
        animation: animate ? { duration: 650, easing: 'easeOutQuart', delay: (c) => (c.type === 'data' && c.mode === 'default' ? c.dataIndex * 28 + c.datasetIndex * 40 : 0) } : false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 6, maxRotation: 0, font: { family: css('--font'), size: 11 }, callback: (_, i) => fmtMonth(months[i][0]) } },
          y: { stacked: true, display: false, beginAtZero: true },
        },
        onHover: (_e, els) => {
          if (!els.length) return headline();
          const [m, v] = months[els[0].index];
          const tot = Object.values(v).reduce((s, x) => s + x, 0);
          big(usd(tot));
          $('change').innerHTML = `<span class="pos">Paid to you in ${fmtMonth(m)}</span> <span class="when">· ${r.B.map((b, i) => v[i] > 0 ? `${bucketLabel(b.key).replace('Reinvest in same fund', 'reinvested')} ${usd(v[i])}` : '').filter(Boolean).join(' · ')}</span>`;
        },
      },
    });
    $('chart').onmouseleave = headline;
  } else {
    const rows = downsample(r.rows, 400);
    const showNet = !!r.margin;
    $('legend').innerHTML = `<span><i class="sw" style="background:${css('--up')}"></i>Value</span><span><i class="sw dash"></i>Money put in</span>${showNet ? `<span><i class="sw" style="background:${BUCKET_COLORS.margin}"></i>Value after margin</span>` : ''}`;
    const ds = [
      { label: 'Value', data: rows.map((x) => x.value), color: r.value >= r.invested ? css('--up') : css('--down') },
      { label: 'Put in', data: rows.map((x) => x.invested), color: css('--muted'), dashed: true },
    ];
    if (showNet) ds.push({ label: 'Net', data: rows.map((x) => x.net), color: BUCKET_COLORS.margin, width: 1.5, order: 1 });
    chart = lineChart($('chart'), {
      labels: rows.map((x) => x.d), datasets: ds,
      drawIn, pulse: 0,
      dateLabel: (i) => prettyDate(rows[i].d),
      onScrub: (i) => {
        if (i == null) return headline();
        const x = rows[i];
        big(usd(x.value));
        changeLine($('change'), x.value - x.invested, x.invested, `vs. ${usd0(x.invested)} put in · ${usd0(x.totalDiv)} paid out${showNet ? ` · owe ${usd0(x.debt)}` : ''}`);
      },
    });
  }
}

/* ---------- inputs ---------- */
function renderMix() {
  $('mix').innerHTML = TICKERS.map((t) => `<div class="mix-row"><b><span class="dot" style="background:${A[t].color}"></span>${t}</b>
    <input type="range" min="0" max="100" step="5" value="${state.mix[t] || 0}" data-t="${t}" aria-label="${t} share of each purchase" /><output>${state.mix[t] || 0}%</output></div>`).join('');
}
function applyPreset(i) {
  const mix = PRESETS[i].mix;
  state.mix = Object.fromEntries(TICKERS.map((t) => [t, mix[t] || 0]));
  $('presets').querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.i === i));
  renderMix();
}
function applyRoutePreset(i) {
  state.buckets = PAYOUT_PRESETS[i].buckets.map((b) => ({ key: bucketKey(b), pct: b.pct }))
    .filter((b) => kindOf(b.key) !== 'buy' || TARGETS.some((t) => t.ticker === targetOf(b.key)));
  renderBucketEditor();
  $('route-presets').querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.i === i));
}

function bindRouter() {
  $('route-presets').innerHTML = PAYOUT_PRESETS.map((p, i) => `<button data-i="${i}">${p.label}</button>`).join('');
  $('route-presets').onclick = (e) => { const b = e.target.closest('button'); if (b) { applyRoutePreset(+b.dataset.i); animateNext = true; render(); } };
  $('buckets').addEventListener('change', (e) => {
    const row = e.target.closest('.bucket'); if (!row) return;
    const b = state.buckets[+row.dataset.i];
    if (e.target.dataset.f === 'key') { b.key = e.target.value; delete b.kind; delete b.target; renderBucketEditor(); render(); }
  });
  $('buckets').addEventListener('input', (e) => {
    const row = e.target.closest('.bucket'); if (!row || e.target.dataset.f !== 'pct') return;
    state.buckets[+row.dataset.i].pct = Math.max(0, +e.target.value || 0);
    $('route-presets').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
    render();
  });
  $('buckets').addEventListener('click', (e) => {
    if (e.target.dataset.f !== 'rm') return;
    state.buckets.splice(+e.target.closest('.bucket').dataset.i, 1);
    renderBucketEditor(); render();
  });
  $('add-bucket').onclick = () => {
    const used = new Set(state.buckets.map(bucketKey));
    const next = bucketOptions().find(([v]) => !used.has(v))?.[0] || 'cash';
    state.buckets.push({ key: next, pct: 10 });
    renderBucketEditor(); render();
  };
  $('route').value = state.route;
  $('route').onchange = (e) => { state.route = e.target.value; render(); };
  $('compare').innerHTML = TARGETS.map((t) => `<option value="${t.ticker}">${t.ticker}</option>`).join('');
  $('compare').value = state.compare;
  $('compare').onchange = (e) => { state.compare = e.target.value; render(); };
  $('m-bal').value = state.margin.balance;
  $('m-apr').value = state.margin.apr;
  $('m-bal').oninput = (e) => { state.margin.balance = Math.max(0, +e.target.value || 0); render(); };
  $('m-apr').oninput = (e) => { state.margin.apr = Math.max(0, +e.target.value || 0); render(); };
  $('route-lbl').innerHTML = term('Split payouts', 'As they\'re paid: every payout is split the moment it arrives. Weekly / Monthly: payouts collect and get split on a schedule, like a paycheck.');
  $('compare-lbl').innerHTML = term('Compare to', 'For money that leaves the market (bills, margin, savings), what it would be worth if it had bought this instead. That difference is the opportunity cost.');
  rangeBar($('window'), WINDOWS.map(([k, l]) => [k, l]), win, (w) => { win = w; renderBuckets(result); });
  renderBucketEditor();
}

(async () => {
  try {
    data = await loadData();
    A = incomeAssets(data);
    TICKERS = Object.keys(A);
    TARGETS = buyTargets(data);
    for (const t of new Set([...TICKERS, ...TARGETS.map((x) => x.ticker), 'BTC'])) prices[t] = priceLookup(data.series[t].prices);
    for (const t of TICKERS) { events[t] = new Map(data.series[t].dividends); rates[t] = dailyRate(t); }
    state.end = TICKERS.map((t) => prices[t].last).sort()[0];
    state.start = TICKERS.map((t) => prices[t].first).sort().at(-1);
    restore();
    // grab the live BTC price first (max 1.2s) so the intro animation only plays once
    const live = await Promise.race([liveBTC(), new Promise((r) => setTimeout(() => r(null), 1200))]);
    if (live) prices.BTC.set(todayISO(), live);
    if (!TARGETS.some((t) => t.ticker === state.compare)) state.compare = TARGETS[0].ticker;

    $('presets').innerHTML = PRESETS.map((p, i) => `<button data-i="${i}">${p.label}</button>`).join('');
    $('presets').onclick = (e) => { const b = e.target.closest('button'); if (b) { applyPreset(+b.dataset.i); animateNext = true; render(); } };
    applyPreset(0);
    $('mix').oninput = (e) => {
      const t = e.target.dataset.t; if (!t) return;
      state.mix[t] = +e.target.value;
      e.target.nextElementSibling.textContent = state.mix[t] + '%';
      $('presets').querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      render();
    };
    const first = TICKERS.map((t) => prices[t].first).sort()[0];
    const clamp = (v) => (v < first ? first : v > state.end ? state.end : v);
    $('amount').value = state.amount; $('start').value = state.start; $('end').value = state.end;
    $('start').min = $('end').min = first; $('start').max = $('end').max = state.end;
    $('amount').oninput = (e) => { state.amount = +e.target.value; render(); };
    $('start').onchange = (e) => { if (e.target.value) { state.start = clamp(e.target.value); e.target.value = state.start; render(); } };
    $('end').onchange = (e) => { if (e.target.value) { state.end = clamp(e.target.value); e.target.value = state.end; render(); } };
    for (const id of ['freq', 'sched']) $(id).onchange = (e) => { state[id] = e.target.value; render(); };
    $('sched-lbl').innerHTML = term('Schedule', 'Actual: paid on the real historical dates (STRC twice a month, STRF/STRK/STRD quarterly, BTCI monthly). Daily (proposed): Strategy shareholders vote Oct 28, 2026 on paying every calendar day. This spreads each preferred\'s payouts across every day. Funds without a proposal keep their normal schedule.');
    rangeBar($('view'), [['income', 'Payouts'], ['value', 'Value']], view, (v) => { view = v; animateNext = true; draw(); });
    bindRouter();
    render();
    revealSections();


  } catch (err) {
    $('sentence').textContent = 'Could not load price data. Please refresh the page.';
    console.error(err);
  }
})();
onTheme(() => result && (holdings(result), draw()));
