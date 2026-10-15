import { mountLayout, riskTag, loadData, prettyDate } from './common.js';
import { BITCOIN, GROWTH, plainName, riskOf } from './config.js';
import raw from '../assets.json';

mountLayout('learn.html', { modeSwitch: false });

// risk table straight from assets.json, so it always matches the rest of the site
const rows = [BITCOIN.ticker, ...raw.income.map((a) => a.ticker)];
document.getElementById('risk-table').innerHTML = rows.map((t) => {
  const r = riskOf(t);
  return `<tr><td>${plainName(t)} <span class="muted" style="font-weight:400">${t}</span></td><td>${riskTag({ level: r.level, note: '' })}</td><td class="muted">${r.note}</td></tr>`;
}).join('') + GROWTH.map((g) => `<tr><td>${plainName(g.ticker)} <span class="muted" style="font-weight:400">${g.ticker}</span></td><td>${riskTag({ level: 'higher', note: '' })}</td><td class="muted">${g.about}</td></tr>`).join('');

// spring 2026 crash: peak before June → June low, and where each is now (computed from the site's own price data)
loadData().then((data) => {
  const list = ['BTC', 'STRC', 'SATA', 'STRF', 'STRK', 'STRD', 'BTCI'].filter((t) => data.series[t]);
  const rows = list.map((t) => {
    const p = data.series[t].prices.filter(([d]) => d >= '2026-04-01' && d <= '2026-08-15');
    const before = p.filter(([d]) => d < '2026-06-01');
    const [pd, peak] = before.reduce((a, b) => (b[1] > a[1] ? b : a));
    const [ld, low] = p.filter(([d]) => d >= pd).reduce((a, b) => (b[1] < a[1] ? b : a));
    const now = data.series[t].prices.at(-1)[1];
    const f = (x) => (Math.abs(x) < 0.5 ? '0%' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(0)}%`);
    return `<tr><td>${plainName(t)} <span class="muted" style="font-weight:400">${t}</span></td><td class="neg">${f((low / peak - 1) * 100)}</td><td class="muted">low on ${prettyDate(ld)} · ${f((now / peak - 1) * 100)} vs. peak today</td></tr>`;
  });
  document.getElementById('crash-table').innerHTML = '<tr><td class="muted">Investment</td><td class="muted">Drop</td><td class="muted">Where it is now</td></tr>' + rows.join('');
  document.getElementById('crash-note').textContent = 'Drop from each one\'s spring 2026 high to its June 2026 low, using real closing prices.';
}).catch(() => {});
