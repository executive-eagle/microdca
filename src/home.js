import { mountLayout, revealSections, loadData, priceLookup, liveBTC, liveQuotes, applyQuotes, intraday, scheduleDates, addDays, todayISO, usd0, signClass, pct } from './common.js';
import { incomeAssets, STYLES, LIVE_QUOTES_URL } from './config.js';

mountLayout('index.html', { modeSwitch: false });
const $ = (id) => document.getElementById(id);

(async () => {
  try {
    const data = await loadData();
    const btc = priceLookup(data.series.BTC.prices);
    const [now, quotes, bars] = await Promise.all([liveBTC(), liveQuotes(LIVE_QUOTES_URL), intraday(LIVE_QUOTES_URL, '1d', ['BTC'])]);
    if (now) btc.set(todayISO(), now);

    // live bitcoin price + 24h change
    const price = now || btc(btc.last);
    const dayAgo = bars?.BTC?.find(([t]) => t >= Date.now() - 864e5)?.[1];
    const ch = dayAgo ? (price / dayAgo - 1) * 100 : null;
    $('btc-now').innerHTML = `<span class="muted">Bitcoin right now</span> <b>${usd0(price)}</b>${ch == null ? '' : ` <span class="${signClass(ch)}">${pct(ch)} today</span>`}`;

    // $25 a week for the past 3 years
    const end = btc.last, start = addDays(end, -Math.round(365.25 * 3));
    let put = 0, coins = 0;
    for (const d of scheduleDates(start, end, 'weekly')) { put += 25; coins += 25 / btc(d); }
    const worth = coins * price;
    $('teaser-btc').innerHTML = `<b>$25 a week</b> for the past 3 years: you'd have put in <b>${usd0(put)}</b>, and it would be worth <b>${usd0(worth)}</b> today.`;

    // what $1,000 in each simple style pays per month right now
    const A = incomeAssets(data);
    const prices = Object.fromEntries(Object.keys(A).map((t) => [t, priceLookup(data.series[t].prices)]));
    applyQuotes(prices, quotes);
    const yieldOf = (mix) => {
      const total = Object.values(mix).reduce((a, b) => a + b, 0);
      return Object.entries(mix).reduce((y, [t, w]) => (A[t] ? y + (w / total) * (A[t].annual / prices[t](prices[t].last)) : y), 0);
    };
    const ys = STYLES.map((st) => ({ label: st.label, monthly: (1000 * yieldOf(st.mix)) / 12 }));
    if (ys.length) {
      const lo = ys.reduce((a, b) => (b.monthly < a.monthly ? b : a)), hi = ys.reduce((a, b) => (b.monthly > a.monthly ? b : a));
      $('teaser-income').innerHTML = `Every <b>$1,000</b> invested pays about <b>${usd0(lo.monthly)} a month</b> in the ${lo.label.toLowerCase()} mix, up to <b>${usd0(hi.monthly)} a month</b> in the ${hi.label.toLowerCase()} mix, at today's rates.`;
    }
  } catch (err) {
    console.error(err);
  }
  revealSections();
})();
