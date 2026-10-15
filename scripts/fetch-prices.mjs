// Fetches daily closes + dividend events from Yahoo Finance's public chart endpoint (no API key)
// and writes public/data/prices.json. If a ticker fails, the previously committed series is kept,
// so the repo copy always acts as the bundled fallback dataset.
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../public/data/prices.json', import.meta.url);
// Every asset listed in assets.json gets fetched — add a fund there, not here.
const cfg = JSON.parse(await readFile(new URL('../assets.json', import.meta.url), 'utf8'));
const TICKERS = Object.fromEntries(
  [cfg.bitcoin, ...cfg.income, ...(cfg.growth || [])].map((a) => [a.ticker, { yahoo: a.yahoo || a.ticker, from: a.history_from || '2024-01-01' }]),
);

const isoDate = (sec, offset) => new Date((sec + offset) * 1000).toISOString().slice(0, 10);
const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

async function fetchTicker({ yahoo, from }) {
  const p1 = Math.floor(new Date(from).getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?period1=${p1}&period2=${p2}&interval=1d&events=div`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MicroDCA price bot)' } });
  if (!res.ok) throw new Error(`${yahoo}: HTTP ${res.status}`);
  const r = (await res.json()).chart.result[0];
  const offset = r.meta.gmtoffset || 0;
  const closes = r.indicators.quote[0].close;
  const dp = yahoo === 'BTC-USD' ? 2 : 4;
  const byDate = new Map();
  r.timestamp.forEach((t, i) => {
    if (closes[i] != null) byDate.set(isoDate(t, offset), round(closes[i], dp));
  });
  const prices = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const dividends = Object.values(r.events?.dividends || {})
    .map((d) => [isoDate(d.date, offset), round(d.amount, 4)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (prices.length < 5) throw new Error(`${yahoo}: too few rows`);
  return { prices, dividends };
}

let previous = { series: {} };
try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

const series = {};
let failures = 0;
for (const [key, cfg] of Object.entries(TICKERS)) {
  try {
    series[key] = await fetchTicker(cfg);
    const last = series[key].prices.at(-1);
    console.log(`${key}: ${series[key].prices.length} closes, last ${last[0]} ${last[1]}, ${series[key].dividends.length} dividends`);
  } catch (err) {
    failures++;
    console.warn(`WARN ${err.message} — keeping previous data`);
    if (previous.series[key]) series[key] = previous.series[key];
  }
}

if (failures === Object.keys(TICKERS).length) {
  console.warn('All fetches failed; leaving prices.json untouched.');
} else {
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), source: 'Yahoo Finance daily closes', series }));
  console.log('Wrote public/data/prices.json');
}
