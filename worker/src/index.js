// MicroDCA live quotes: fetches real-time prices from Yahoo Finance for the tickers the site lists,
// caches them for 15s at Cloudflare's edge, and serves them with CORS so the static site can read them.
// GET /quotes → { t, quotes: { STRC: { price, prevClose, time, date, state }, ... } }
// GET /chart?range=1d|1mo&symbols=BTC,STRC → { t, range, series: { BTC: [[unixSec, close], ...] } }
//   1d = last 2 days of 5-minute bars (cached 60s), 1mo = last month of hourly bars (cached 15 min)
// GET /history?symbol=MSTY → { symbol, name, type, prices: [[date, close]], dividends: [[date, amount]] }
//   any ticker a visitor adds on the site; daily closes since 2010, cached 6 hours

const QUOTE_TTL = 15; // seconds
const TICKER_TTL = 600;
const CHART = { '1d': { range: '2d', interval: '5m', ttl: 60 }, '1mo': { range: '1mo', interval: '1h', ttl: 900 } };
const FALLBACK_TICKERS = { BTC: 'BTC-USD', STRC: 'STRC', STRF: 'STRF', STRK: 'STRK', STRD: 'STRD', BTCI: 'BTCI', IBIT: 'IBIT', MSTR: 'MSTR' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname === '/chart') return chart(url, env, ctx, cors);
    if (url.pathname === '/history') return history(url, ctx, cors);
    if (url.pathname !== '/quotes') return json({ ok: true, endpoints: ['/quotes', '/chart'] }, cors, 60);

    const cache = caches.default;
    const key = new Request(`${url.origin}/quotes`, { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) return withCors(hit, cors);

    const all = await loadTickers(env, ctx);
    // bitcoin is priced live in the browser; quotes cover the stocks/ETFs
    const tickers = Object.fromEntries(Object.entries(all).filter(([t]) => t !== 'BTC'));
    const entries = await Promise.all(Object.entries(tickers).map(async ([t, y]) => [t, await quote(y).catch(() => null)]));
    const quotes = Object.fromEntries(entries.filter(([, q]) => q));
    const res = json({ t: new Date().toISOString(), quotes }, {}, QUOTE_TTL);
    if (Object.keys(quotes).length) ctx.waitUntil(cache.put(key, res.clone()));
    return withCors(res, cors);
  },
};

async function loadTickers(env, ctx) {
  const cache = caches.default;
  const key = new Request('https://microdca.internal/tickers');
  const hit = await cache.match(key);
  if (hit) return hit.json();
  try {
    const r = await fetch(env.TICKERS_URL, { cf: { cacheTtl: TICKER_TTL } });
    if (!r.ok) throw new Error(r.status);
    const list = await r.json();
    // only plain ticker symbols, capped well under the free plan's 50 subrequests per call
    const clean = Object.fromEntries(Object.entries(list).filter(([, y]) => /^[A-Z0-9.^=-]{1,12}$/.test(y)).slice(0, 40));
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(clean), { headers: { 'Cache-Control': `max-age=${TICKER_TTL}` } })));
    return clean;
  } catch {
    return FALLBACK_TICKERS;
  }
}

async function chart(url, env, ctx, cors) {
  const r = url.searchParams.get('range') || '1d';
  const cfg = CHART[r];
  if (!cfg) return json({ error: 'range must be 1d or 1mo' }, cors, 60);
  const all = await loadTickers(env, ctx);
  const want = (url.searchParams.get('symbols') || Object.keys(all).join(',')).split(',').map((s) => s.trim().toUpperCase()).filter((t) => all[t]).sort();
  const cache = caches.default;
  const key = new Request(`${url.origin}/chart?range=${r}&symbols=${want.join(',')}`);
  const hit = await cache.match(key);
  if (hit) return withCors(hit, cors);
  const entries = await Promise.all(want.map(async (t) => {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(all[t])}?range=${cfg.range}&interval=${cfg.interval}`, { headers: { 'User-Agent': 'Mozilla/5.0 (MicroDCA charts)' } });
      if (!res.ok) return [t, null];
      const d = (await res.json()).chart.result[0];
      const c = d.indicators.quote[0].close;
      const dp = t === 'BTC' ? 2 : 4;
      return [t, (d.timestamp || []).map((ts, i) => (c[i] == null ? null : [ts, +c[i].toFixed(dp)])).filter(Boolean)];
    } catch { return [t, null]; }
  }));
  const series = Object.fromEntries(entries.filter(([, v]) => v && v.length));
  const res = json({ t: new Date().toISOString(), range: r, series }, {}, cfg.ttl);
  if (Object.keys(series).length) ctx.waitUntil(cache.put(key, res.clone()));
  return withCors(res, cors);
}

const HISTORY_TTL = 6 * 3600;
async function history(url, ctx, cors) {
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.\-^=]{0,11}$/.test(symbol)) return json({ error: 'Enter a ticker like MSTY or SCHD.' }, cors, 60);
  const cache = caches.default;
  const key = new Request(`${url.origin}/history?symbol=${symbol}`);
  const hit = await cache.match(key);
  if (hit) return withCors(hit, cors);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=1262304000&period2=${p2}&interval=1d&events=div`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (MicroDCA history)' },
  });
  if (r.status === 404) return json({ error: `Couldn't find ${symbol}.` }, cors, 300);
  if (!r.ok) return json({ error: 'Price source is busy, try again in a minute.' }, cors, 30);
  const d = (await r.json()).chart?.result?.[0];
  if (!d?.timestamp?.length) return json({ error: `No price history for ${symbol}.` }, cors, 300);
  const off = d.meta.gmtoffset || 0;
  const iso = (sec) => new Date((sec + off) * 1000).toISOString().slice(0, 10);
  const closes = d.indicators.quote[0].close;
  const byDate = new Map();
  d.timestamp.forEach((t, i) => { if (closes[i] != null) byDate.set(iso(t), +closes[i].toFixed(4)); });
  const body = {
    symbol,
    name: d.meta.longName || d.meta.shortName || symbol,
    type: d.meta.instrumentType || null,
    currency: d.meta.currency || 'USD',
    prices: [...byDate].sort((a, b) => a[0].localeCompare(b[0])),
    dividends: Object.values(d.events?.dividends || {}).map((x) => [iso(x.date), +x.amount.toFixed(4)]).sort((a, b) => a[0].localeCompare(b[0])),
  };
  const res = json(body, {}, HISTORY_TTL);
  ctx.waitUntil(cache.put(key, res.clone()));
  return withCors(res, cors);
}

async function quote(symbol) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (MicroDCA live quotes)' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const m = (await r.json()).chart.result[0].meta;
  const now = Date.now() / 1000;
  const p = m.currentTradingPeriod || {};
  const inP = (x) => x && now >= x.start && now < x.end;
  const state = inP(p.regular) ? 'live' : inP(p.pre) ? 'pre' : inP(p.post) ? 'post' : 'closed';
  const off = m.gmtoffset || 0;
  return {
    price: m.regularMarketPrice,
    prevClose: m.chartPreviousClose ?? m.previousClose ?? null,
    time: new Date(m.regularMarketTime * 1000).toISOString(),
    date: new Date((m.regularMarketTime + off) * 1000).toISOString().slice(0, 10),
    state,
  };
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  };
}
function json(body, headers, ttl) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}`, ...headers } });
}
function withCors(res, cors) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
  return r;
}
