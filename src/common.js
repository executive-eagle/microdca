import './style.css';
import {
  Chart, LineController, BarController, LineElement, BarElement, PointElement, LinearScale, CategoryScale, Filler,
} from 'chart.js';

Chart.register(LineController, BarController, LineElement, BarElement, PointElement, LinearScale, CategoryScale, Filler);
export { Chart };

/* ---------- theme ---------- */
const THEME_KEY = 'microdca-theme';
const readTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } };
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  document.dispatchEvent(new CustomEvent('themechange'));
}
document.documentElement.dataset.theme = readTheme() || 'dark';
export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const onTheme = (fn) => document.addEventListener('themechange', fn);

/* ---------- Simple / Advanced mode (site-wide, remembered per browser) ---------- */
const MODE_KEY = 'microdca-mode';
const readMode = () => { try { return localStorage.getItem(MODE_KEY); } catch { return null; } };
export const getMode = () => document.documentElement.dataset.mode;
export const isSimple = () => getMode() !== 'advanced';
function setMode(m) {
  document.documentElement.dataset.mode = m;
  try { localStorage.setItem(MODE_KEY, m); } catch {}
  document.querySelectorAll('.mode-switch button').forEach((b) => b.classList.toggle('active', b.dataset.m === m));
  document.dispatchEvent(new CustomEvent('modechange', { detail: m }));
}
document.documentElement.dataset.mode = readMode() || 'simple';
export const onMode = (fn) => document.addEventListener('modechange', (e) => fn(e.detail));

/* ---------- layout ---------- */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  dca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/></svg>',
  income: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.5 6"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 21h14"/><path d="M3 7h18"/><path d="M6 7l-3 7a3 3 0 006 0z"/><path d="M18 7l-3 7a3 3 0 006 0z"/></svg>',
  learn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5c-.8 0-1.5-.7-1.5-1.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>',
};
export const X_URL = 'https://x.com/MicroDCA3';
export const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#F7931A"/><path d="M6.5 16.5l3.6-4.2 2.7 2.2 4.7-6" stroke="#000" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// [href, desktop label, icon, phone label]
const PAGES = [
  ['index.html', 'Home', 'home', 'Home'],
  ['bitcoin.html', 'Bitcoin', 'dca', 'Bitcoin'],
  ['income.html', 'Income', 'income', 'Income'],
  ['portfolio.html', 'Live $10K', 'live', '$10K'],
  ['compare.html', 'Sell vs. income', 'compare', 'Compare'],
  ['learn.html', 'Learn', 'learn', 'Learn'],
];

export function mountLayout(active, { modeSwitch = true } = {}) {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<div class="in">
    <a class="wordmark" href="index.html" aria-label="MicroDCA home">${MARK}MicroDCA</a>
    <nav>${PAGES.slice(1).map(([h, l]) => `<a href="${h}" class="${h === active ? 'active' : ''}">${l}</a>`).join('')}</nav>
    ${modeSwitch ? `<div class="mode-switch" role="group" aria-label="Simple or advanced view">
      <button data-m="simple" title="Just the essentials, in plain English">Simple</button><button data-m="advanced" title="Every setting and number">Advanced</button>
    </div>` : ''}
    <button class="icon-btn" id="theme-btn" aria-label="Switch light or dark mode"></button></div>`;
  document.body.prepend(header);
  const btn = header.querySelector('#theme-btn');
  const sync = () => { btn.innerHTML = document.documentElement.dataset.theme === 'dark' ? ICONS.sun : ICONS.moon; };
  sync();
  btn.onclick = () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); sync(); };
  header.querySelectorAll('.mode-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.m === getMode());
    b.onclick = () => setMode(b.dataset.m);
  });

  const tabbar = document.createElement('nav');
  tabbar.className = 'tabbar';
  tabbar.innerHTML = PAGES.map(([h, , i, short]) => `<a href="${h}" class="${h === active ? 'active' : ''}">${ICONS[i]}${short}</a>`).join('');
  document.body.append(tabbar);

  const footer = document.createElement('footer');
  footer.className = 'legal';
  footer.innerHTML = `
    <p><b>Educational simulation, not financial advice.</b> Past performance does not predict future results. Nothing on MicroDCA is a recommendation to buy or sell anything. <a href="learn.html">New to this? Start here.</a></p>
    <p><b>Strategy's preferred stock (STRC, STRF, STRK, STRD) is not collateralized by its bitcoin holdings, and dividends are not guaranteed.</b> STRD is non-cumulative: missed dividends are never owed. Strive's SATA preferred dividends are likewise not guaranteed and its variable rate can change.</p>
    <p><b>Covered-call ETFs like BTCI cap upside and can lose value (NAV) over time.</b> A high distribution rate is not the same as total return.</p>
    <p><b>The $10K portfolio is hypothetical. No real money is invested.</b> Simulations ignore taxes, fees and trading costs. Strategy has indicated recent dividends were characterized as return of capital for tax purposes; talk to a tax professional.</p>
    <p id="data-meta"></p>
    <p class="social"><a href="${X_URL}" target="_blank" rel="noopener">${X_ICON}<span>Follow @MicroDCA3 on X</span></a></p>`;
  document.body.append(footer);
  initTerms();
}

/* ---------- dotted-underline terms (with an optional "Learn more" link) ---------- */
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const term = (label, text, learn = '') =>
  `<span class="term" tabindex="0" data-tip="${esc(text)}"${learn ? ` data-learn="${learn}"` : ''}>${label}</span>`;
function initTerms() {
  let pop, pinned = false, hideTimer;
  const close = () => { pop?.remove(); pop = null; pinned = false; };
  const open = (el, pin) => {
    clearTimeout(hideTimer);
    if (pop && pop._for === el) { pinned ||= pin; return; }
    close();
    pinned = pin;
    pop = document.createElement('div');
    pop.className = 'pop';
    pop._for = el;
    pop.textContent = el.dataset.tip;
    if (el.dataset.learn) {
      const a = document.createElement('a');
      a.href = `learn.html#${el.dataset.learn}`;
      a.className = 'pop-learn';
      a.textContent = 'Learn more';
      pop.append(' ', a);
    }
    pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    pop.addEventListener('mouseleave', () => { if (!pinned) hideTimer = setTimeout(close, 150); });
    document.body.append(pop);
    const r = el.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px';
    pop.style.top = (r.bottom + h + 12 > innerHeight ? r.top - h - 8 : r.bottom + 8) + 'px';
  };
  const hover = () => matchMedia('(hover: hover)').matches;
  document.addEventListener('mouseover', (e) => { const t = e.target.closest?.('.term'); if (t && hover()) open(t, false); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('.term') && hover() && !pinned) hideTimer = setTimeout(close, 150); });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.pop')) return;
    const t = e.target.closest('.term');
    if (t) { e.preventDefault(); open(t, true); } else close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  addEventListener('scroll', close, { passive: true });
}

/**
 * On phones, move the side panel (inputs) up to sit right after `anchor`, instead of after every result.
 * Moves back on wider screens.
 */
export function panelAfter(anchor) {
  const side = document.querySelector('.side');
  if (!side || !anchor) return;
  const home = side.parentElement, mq = matchMedia('(max-width: 960px)');
  const place = () => {
    if (mq.matches && side.previousElementSibling !== anchor) { anchor.after(side); side.classList.add('moved'); }
    else if (!mq.matches && side.parentElement !== home) { home.append(side); side.classList.remove('moved'); }
  };
  place();
  mq.addEventListener('change', place);
}

/* ---------- beginner helpers ---------- */
const RISK_WORD = { lower: 'Lower risk', medium: 'Medium risk', higher: 'Higher risk', unknown: 'Not rated' };
/** Small colored risk chip; the note shows on hover/tap. */
export const riskTag = ({ level, note }) =>
  `<span class="risk r-${level}${note ? ' term' : ''}"${note ? ` data-tip="${esc(note)}" data-learn="risk" tabindex="0"` : ''}>${RISK_WORD[level] || RISK_WORD.unknown}</span>`;

/** Puts a monthly amount in everyday terms: "about a phone bill". */
export function everyday(monthly) {
  const scale = [
    [8, 'a cup of coffee'], [20, 'a streaming subscription'], [45, 'a gym membership'], [90, 'a phone bill'],
    [160, 'an internet and phone bill'], [350, 'a weekly grocery run, every week'], [650, 'a car payment'],
    [1300, 'a month of groceries for a family'], [2500, 'rent in a lot of towns'], [Infinity, 'a full month of rent almost anywhere'],
  ];
  if (monthly < 2) return 'a little pocket change';
  return scale.find(([max]) => monthly <= max)[1];
}

/* ---------- formatting ---------- */
export const usd = (v, dp = 2) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const usd0 = (v) => usd(v, 0);
export const pct = (v, dp = 2) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(dp) + '%';
export const btc = (v) => v.toFixed(8) + ' BTC';
export const num = (v, dp = 4) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const signClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
export const arrow = (v) => (v >= 0 ? '+' : '-');

/** Robinhood-style change line: "+$123.45 (+1.23%) All time" */
export function changeLine(el, delta, base, when) {
  const p = base ? (delta / base) * 100 : 0;
  el.innerHTML = `<span class="${signClass(delta) || 'pos'}">${arrow(delta)}${usd(Math.abs(delta))} (${pct(p)})</span> <span class="when">${when}</span>`;
}

/* ---------- dates ---------- */
export const toISO = (d) => d.toISOString().slice(0, 10);
export const parseISO = (s) => new Date(s + 'T00:00:00Z');
export const addDays = (iso, n) => { const d = parseISO(iso); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };
export function addMonths(iso, n) {
  const s = parseISO(iso), y = s.getUTCFullYear(), m = s.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(y, m, Math.min(s.getUTCDate(), last))));
}
export function* eachDay(from, to) { for (let d = from; d <= to; d = addDays(d, 1)) yield d; }
export const todayISO = () => toISO(new Date());
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
export const prettyDate = (iso) => parseISO(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export function scheduleDates(start, end, freq) {
  const out = [];
  if (freq === 'monthly') { for (let i = 0; ; i++) { const d = addMonths(start, i); if (d > end) break; out.push(d); } }
  else { const step = freq === 'weekly' ? 7 : 1; for (let d = start; d <= end; d = addDays(d, step)) out.push(d); }
  return out;
}
export const FREQ_WORD = { daily: 'every day', weekly: 'every week', monthly: 'every month' };

/* ---------- data ---------- */
let dataPromise;
export function loadData() {
  dataPromise ??= fetch('data/prices.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((data) => {
      const el = document.getElementById('data-meta');
      if (el) el.textContent = `Market data: daily closes via Yahoo Finance, updated ${new Date(data.updated).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}. Live bitcoin price via Coinbase (CoinGecko backup).`;
      return data;
    });
  return dataPromise;
}

/** Forward-filled price lookup: last close on or before a date. */
export function priceLookup(pairs) {
  const dates = pairs.map((p) => p[0]), vals = pairs.map((p) => p[1]);
  const fn = (iso) => {
    let lo = 0, hi = dates.length - 1, ans = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= iso) { ans = m; lo = m + 1; } else hi = m - 1; }
    return vals[ans];
  };
  fn.first = dates[0];
  fn.last = dates.at(-1);
  fn.set = (iso, v) => {
    if (iso < dates.at(-1)) return;
    if (iso === dates.at(-1)) vals[vals.length - 1] = v; else { dates.push(iso); vals.push(v); }
    fn.last = iso;
  };
  fn.between = (a, b) => pairs.filter(([d]) => d >= a && d <= b).map(([, v]) => v);
  return fn;
}

/** Live BTC/USD: Coinbase first, CoinGecko as backup (both free, no key). Cached 30s; null if both fail. */
let btcCache = { t: 0, v: null };
export async function liveBTC() {
  if (Date.now() - btcCache.t < 30_000 && btcCache.v) return btcCache.v;
  const sources = [
    ['https://api.coinbase.com/v2/prices/BTC-USD/spot', (j) => +j.data.amount],
    ['https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', (j) => j.bitcoin.usd],
  ];
  for (const [url, pick] of sources) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const v = pick(await r.json());
      if (v > 0) { btcCache = { t: Date.now(), v }; return v; }
    } catch {}
  }
  return null;
}

/**
 * Real-time stock/ETF quotes from the MicroDCA worker (Yahoo data, cached 15s at the edge).
 * Returns { quotes: { TICKER: { price, date, state, time } }, open } or null if unavailable.
 */
let quoteCache = { t: 0, v: null };
export async function liveQuotes(url) {
  if (!url) return null;
  if (Date.now() - quoteCache.t < 10_000 && quoteCache.v) return quoteCache.v;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const { quotes } = await r.json();
    const states = Object.values(quotes).map((q) => q.state);
    const v = { quotes, open: states.includes('live') ? 'live' : states.includes('pre') ? 'pre' : states.includes('post') ? 'post' : 'closed' };
    quoteCache = { t: Date.now(), v };
    return v;
  } catch { return null; }
}

/**
 * Intraday bars from the worker: range '1d' (5-minute, last 2 days) or '1mo' (hourly, last month).
 * Returns { TICKER: [[ms, close], ...] } or null. Cached in the page for a minute.
 */
const intradayCache = new Map();
export async function intraday(quotesUrl, range, symbols) {
  if (!quotesUrl) return null;
  const key = range + ':' + symbols.join(',');
  const c = intradayCache.get(key);
  if (c && Date.now() - c.t < 60_000) return c.v;
  try {
    const r = await fetch(quotesUrl.replace(/\/quotes$/, '/chart') + `?range=${range}&symbols=${symbols.join(',')}`);
    if (!r.ok) return null;
    const { series } = await r.json();
    const v = Object.fromEntries(Object.entries(series).map(([t, rows]) => [t, rows.map(([s, p]) => [s * 1000, p])]));
    intradayCache.set(key, { t: Date.now(), v });
    return v;
  } catch { return null; }
}

/** "3:45 PM" for today, "Mon 3:45 PM" within a week, "Oct 3, 3 PM" otherwise. */
export function prettyTime(ms, span = 'day') {
  const d = new Date(ms);
  if (span === 'day') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (span === 'week') return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' });
}

/** Puts each live quote into its price series as today's (forward-filled) close. */
export function applyQuotes(prices, live) {
  if (!live) return;
  for (const [t, q] of Object.entries(live.quotes)) if (prices[t] && q.price > 0) prices[t].set(q.date, q.price);
}

/* ---------- rolling digits ---------- */
export function roller(el) {
  el.classList.add('roll');
  let prev = '';
  return (text, instant = false) => {
    if (text === prev) return;
    // roll only small changes (live ticks); big jumps and scrubbing update instantly, like Robinhood
    if (!instant && text.length === prev.length) {
      let changed = 0;
      for (let i = 0; i < text.length; i++) if (text[i] !== prev[i]) changed++;
      if (changed > 3) instant = true;
    } else if (text.length !== prev.length) instant = true;
    el.classList.toggle('instant', instant);
    const reuse = text.length === prev.length && el.children.length === text.length;
    if (!reuse) {
      el.innerHTML = [...text].map((c) => /\d/.test(c)
        ? `<span class="d"><span>${'0123456789'.split('').map((n) => `<i>${n}</i>`).join('')}</span></span>`
        : `<span class="s">${c}</span>`).join('');
    }
    [...text].forEach((c, i) => {
      const node = el.children[i];
      if (/\d/.test(c)) {
        if (!node.classList.contains('d')) return;
        node.firstChild.style.transform = `translateY(-${+c * 1.2}em)`;
      } else if (node.textContent !== c) node.textContent = c;
    });
    if (!reuse) {
      // first paint: jump straight to the digits, no roll
      el.querySelectorAll('.d > span').forEach((s) => { s.style.transition = 'none'; });
      void el.offsetWidth;
      el.querySelectorAll('.d > span').forEach((s) => { s.style.transition = ''; });
    }
    prev = text;
  };
}

/* ---------- sparkline ---------- */
export function sparkline(values, color) {
  if (values.length < 2) values = [values[0] ?? 0, values[0] ?? 0];
  const w = 84, h = 30, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - lo) / span) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

export function downsample(rows, n = 400) {
  if (rows.length <= n) return rows;
  const step = Math.ceil(rows.length / n);
  const out = rows.filter((_, i) => i % step === 0);
  if (out.at(-1) !== rows.at(-1)) out.push(rows.at(-1));
  return out;
}

/* ---------- Robinhood-style chart ---------- */
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const a = chart.getActiveElements();
    if (!a.length) return;
    const x = a[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
    ctx.save(); ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
    if (chart.$dateLabel) {
      ctx.save(); ctx.fillStyle = css('--muted'); ctx.font = '500 12px ' + css('--font'); ctx.textAlign = 'center';
      ctx.fillText(chart.$dateLabel(a[0].index), Math.min(Math.max(x, 50), chart.width - 50), top - 2); ctx.restore();
    }
  },
};

/** Line chart with no axes/grid; dragging across it scrubs the headline number. */
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);

/** Clips the datasets to a growing width so the line "draws itself" left to right. */
const reveal = {
  id: 'reveal',
  beforeDatasetsDraw(chart) {
    const p = chart.$reveal ?? 1;
    if (p >= 1) return;
    const { left, right } = chart.chartArea;
    chart.ctx.save();
    chart.ctx.beginPath();
    chart.ctx.rect(0, 0, left + (right - left) * p, chart.height);
    chart.ctx.clip();
    chart.$clipped = true;
  },
  afterDatasetsDraw(chart) { if (chart.$clipped) { chart.ctx.restore(); chart.$clipped = false; } },
};

/** Pulsing "live" dot on the last point of one dataset (a DOM element so CSS can animate it). */
const liveDot = {
  id: 'liveDot',
  afterDraw(chart) {
    const wrap = chart.canvas.parentElement;
    let dot = wrap.querySelector('.pulse-dot');
    const i = chart.$pulse;
    if (i == null || (chart.$reveal ?? 1) < 1) { if (dot) dot.hidden = true; return; }
    const meta = chart.getDatasetMeta(i);
    const data = chart.data.datasets[i].data;
    let last = data.length - 1;
    while (last >= 0 && data[last] == null) last--;
    const pt = meta.data[last];
    if (!pt) { if (dot) dot.hidden = true; return; }
    if (!dot) { dot = document.createElement('span'); dot.className = 'pulse-dot'; wrap.append(dot); }
    dot.hidden = false;
    dot.style.left = pt.x + 'px';
    dot.style.top = pt.y + 'px';
    dot.style.setProperty('--c', chart.data.datasets[i].borderColor);
  },
};

/** Line chart with no axes/grid; dragging across it scrubs the headline number. */
export function lineChart(canvas, { labels, datasets, onScrub, dateLabel, yRange, drawIn = false, pulse = null }) {
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d) => ({
        label: d.label, data: d.data, borderColor: d.color, backgroundColor: 'transparent',
        fill: d.fill ?? false, borderWidth: d.width ?? (d.dashed ? 1 : 2), borderDash: d.dashed ? [2, 3] : [],
        pointRadius: 0, pointHoverRadius: d.dot === false || d.dashed ? 0 : 4.5,
        pointHoverBackgroundColor: d.color, pointHoverBorderColor: css('--bg'), pointHoverBorderWidth: 2,
        tension: 0, order: d.order ?? 0, spanGaps: false,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 18, bottom: 2, left: 2, right: 2 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, ...(yRange || {}) } },
      onHover: (_e, els) => onScrub?.(els.length ? els[0].index : null),
    },
    plugins: [reveal, crosshair, liveDot],
  });
  chart.$dateLabel = dateLabel;
  chart.$pulse = pulse;
  chart.draw(); // first paint happened inside the constructor, before these were set
  // drawIn: true starts the draw-in; a number (0–1) continues one a previous chart had in progress
  if (drawIn !== false && drawIn != null && !reduceMotion) {
    const from = drawIn === true ? 0 : +drawIn;
    chart.$reveal = from;
    const t0 = performance.now(), ms = 900 * (1 - from);
    const step = (t) => {
      if (!chart.canvas) return; // destroyed
      chart.$reveal = from + (1 - from) * easeOut(Math.min(1, (t - t0) / ms));
      chart.draw();
      if (chart.$reveal < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const reset = () => { if (!chart.canvas) return; chart.setActiveElements([]); chart.update('none'); onScrub?.(null); };
  canvas.onmouseleave = reset;
  canvas.ontouchend = reset;
  return chart;
}

/* ---------- scroll reveal + count-up ---------- */
function countUp(el) {
  const m = el.textContent.match(/^(.*?)(-?)([\d,]+(?:\.\d+)?)(.*)$/);
  if (!m) return;
  const [, pre, neg, numStr, post] = m;
  const target = parseFloat(numStr.replace(/,/g, ''));
  const dp = (numStr.split('.')[1] || '').length;
  const t0 = performance.now(), ms = 900;
  const step = (t) => {
    if (!el.isConnected) return;
    const k = easeOut(Math.min(1, (t - t0) / ms));
    el.textContent = pre + neg + (target * k).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) + post;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Sections fade/rise in as they scroll into view; their stats count up and rows stagger in. */
export function revealSections() {
  const blocks = document.querySelectorAll('main section.block, main .panel, main .earn');
  if (reduceMotion || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const b = e.target;
      io.unobserve(b);
      b.querySelectorAll('.stat, .li, .bucket, .vs-row').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)));
      b.classList.add('in');
      b.querySelectorAll('.stats .stat .v').forEach(countUp);
      setTimeout(() => b.classList.add('settled'), 1400);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  blocks.forEach((b) => { b.classList.add('reveal'); io.observe(b); });
}

/** What to pass as `drawIn` when replacing `old`: animate if asked, else continue an unfinished draw-in. */
export const drawInFor = (old, animate) => (animate ? true : old && old.canvas && (old.$reveal ?? 1) < 1 ? old.$reveal : false);

/** Range bar under the chart (text buttons with an underline on the active one). */
export function rangeBar(el, items, active, onChange) {
  el.querySelectorAll('[data-r]').forEach((b) => b.remove());
  const anchor = el.querySelector('.spacer');
  items.forEach(([key, label]) => {
    const b = document.createElement('button');
    b.dataset.r = key; b.textContent = label;
    if (key === active) b.classList.add('active');
    el.insertBefore(b, anchor);
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    el.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('active', x === b));
    onChange(b.dataset.r);
  });
}

/** Whole page tints to green when up / red when down, like Robinhood. */
export function setTrend(up) { document.documentElement.style.setProperty('--accent', up ? 'var(--up)' : 'var(--down)'); }

export function rgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const stat = (k, v, cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
