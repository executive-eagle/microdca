import { mountLayout, riskTag } from './common.js';
import { BITCOIN, GROWTH, plainName, riskOf } from './config.js';
import raw from '../assets.json';

mountLayout('learn.html', { modeSwitch: false });

// risk table straight from assets.json, so it always matches the rest of the site
const rows = [BITCOIN.ticker, ...raw.income.map((a) => a.ticker)];
document.getElementById('risk-table').innerHTML = rows.map((t) => {
  const r = riskOf(t);
  return `<tr><td>${plainName(t)} <span class="muted" style="font-weight:400">${t}</span></td><td>${riskTag({ level: r.level, note: '' })}</td><td class="muted">${r.note}</td></tr>`;
}).join('') + GROWTH.map((g) => `<tr><td>${plainName(g.ticker)} <span class="muted" style="font-weight:400">${g.ticker}</span></td><td>${riskTag({ level: 'higher', note: '' })}</td><td class="muted">${g.about}</td></tr>`).join('');
