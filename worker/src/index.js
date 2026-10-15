// MicroDCA live quotes: fetches real-time prices from Yahoo Finance for the tickers the site lists,
// caches them for 15s at Cloudflare's edge, and serves them with CORS so the static site can read them.
// GET /quotes → { t, quotes: { STRC: { price, prevClose, time, date, state }, ... } }

const QUOTE_TTL = 15; // seconds
const TICKER_TTL = 600;
const FALLBACK_TICKERS = { STRC: 'STRC', STRF: 'STRF', STRK: 'STRK', STRD: 'STRD', BTCI: 'BTCI', IBIT: 'IBIT', MSTR: 'MSTR' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname !== '/quotes') return json({ ok: true, endpoints: ['/quotes'] }, cors, 60);

    const cache = caches.default;
    const key = new Request(`${url.origin}/quotes`, { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) return withCors(hit, cors);

    const tickers = await loadTickers(env, ctx);
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
    // only plain ticker symbols, BTC excluded (the site prices bitcoin itself)
    const clean = Object.fromEntries(Object.entries(list).filter(([t, y]) => t !== 'BTC' && /^[A-Z0-9.^=-]{1,12}$/.test(y)).slice(0, 40));
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(clean), { headers: { 'Cache-Control': `max-age=${TICKER_TTL}` } })));
    return clean;
  } catch {
    return FALLBACK_TICKERS;
  }
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
