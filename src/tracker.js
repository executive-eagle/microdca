import {
  mountLayout, revealSections, loadData, priceLookup, liveBTC, liveQuotes, intraday, lineChart, rangeBar, roller, Chart, css, rgba,
  usd, usd0, num, term, prettyDate, todayISO, addDays, onTheme, reduceMotion, drawInFor,
} from './common.js';
import { incomeAssets, LIVE_QUOTES_URL } from './config.js';

mountLayout('tracker.html');
const $ = (id) => document.getElementById(id);
const big = roller($('big'));
const histBig = roller($('hist-big'));
const fmtBTC = (v, dp = 0) => `${num(v, dp)} BTC`;
const compactUsd = (v) => '$' + Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);

let A, T = [], data, btcDaily, liveBtc = null, quotes = null, bars = null;
let hist = {}, today = {}, histChart, dailyChart, histRange = 'ALL', animateHist = true;
let part = 0.45;

/* ================= estimates ================= */
/** Daily estimate for every past trading day: at-or-above-par volume × participation × price ÷ bitcoin price. */
function history(t) {
  const par = A[t].atm.par, out = [];
  const cutoff = todayISO();
  for (const row of data.series[t].prices) {
    const [d, close, vol = 0, high = close] = row;
    if (d >= cutoff) continue; // today is estimated live
    const share = close >= par ? 1 : high >= par ? 0.5 : 0;
    const raised = vol * share * close * part;
    out.push({ d, raised, btc: raised ? raised / btcDaily(d) : 0, open: share > 0, shares: vol * share });
  }
  return out;
}

/** US Eastern offset in minutes for a timestamp (handles daylight saving). */
function etOffsetMin(ms) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value || 'GMT-5';
  const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? +m[1] * 60 + Math.sign(+m[1]) * (+m[2] || 0) : -300;
}
const etDate = (ms) => new Date(ms + etOffsetMin(ms) * 60000).toISOString().slice(0, 10);
/** The trading session shown: the ET date of the latest STRC/SATA minute bar (or today). */
function sessionInfo() {
  const lastBar = Math.max(0, ...T.map((t) => bars?.[t]?.at(-1)?.[0] || 0));
  const date = lastBar ? etDate(lastBar) : etDate(Date.now());
  const off = etOffsetMin(Date.parse(date + 'T12:00:00Z'));
  const start = Date.parse(date + 'T04:00:00Z') - off * 60000; // 4:00 AM ET
  return { date, start, end: start + 16 * 3600000 }; // through 8:00 PM ET
}

/**
 * Today, minute by minute: volume in minutes that traded at or above par × participation × price ÷ bitcoin price that minute.
 * Plus a live tail from the quote's running volume since the last minute bar.
 */
function todayEstimate(t) {
  const par = A[t].atm.par, q = quotes?.quotes?.[t];
  const sess = sessionInfo();
  const list = (bars?.[t] || []).filter(([ms]) => ms >= sess.start && ms < sess.end);
  const btcBars = bars?.BTC || [];
  let j = 0;
  const btcAt = (ms) => { while (j + 1 < btcBars.length && btcBars[j + 1][0] <= ms) j++; return btcBars[j]?.[1] || liveBtc || btcDaily(sess.date); };
  const minutes = new Map();
  let vol = 0, elig = 0, raised = 0, btc = 0;
  for (const [ms, close, v] of list) {
    vol += v;
    if (close >= par && v > 0) {
      elig += v;
      const r = v * close * part, b = r / btcAt(ms);
      raised += r; btc += b;
      minutes.set(Math.floor((ms - sess.start) / 60000), b);
    }
  }
  // live tail: quote volume reported since the last minute bar
  if (q && q.date === sess.date && q.volume > vol && (q.state === 'live' || q.state === 'pre' || q.state === 'post')) {
    const extra = q.volume - vol;
    vol = q.volume;
    if (q.price >= par) {
      elig += extra;
      const r = extra * q.price * part, b = r / (liveBtc || btcAt(Date.now()));
      raised += r; btc += b;
      const slot = Math.floor((Date.now() - sess.start) / 60000);
      minutes.set(slot, (minutes.get(slot) || 0) + b);
    }
  }
  const price = q?.price ?? data.series[t].prices.at(-1)[1];
  return { price, vol, elig, raised, btc, minutes, state: q?.state || 'closed', atPar: price >= par };
}

/* ================= today's jar: coins pile up as the ATM buys ================= */
/**
 * Soundtrack: Creed's "Higher", via the official CreedVEVO video embedded from YouTube
 * (the audio isn't hosted here). YouTube requires the player to be visible, so it's a small card.
 */
const SONG = { id: 'J16lInLZRms', title: 'Creed — Higher' };
const music = {
  play() {
    const box = $('music');
    box.innerHTML = `<div class="music-top"><span class="eq"><i></i><i></i><i></i></span><span>Now playing <b>${SONG.title}</b></span><button class="music-x" aria-label="Stop the music">×</button></div>
      <iframe src="https://www.youtube-nocookie.com/embed/${SONG.id}?autoplay=1&playsinline=1&rel=0&modestbranding=1" title="${SONG.title} (official video)" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    box.hidden = false;
    box.querySelector('.music-x').onclick = () => document.getElementById('sound').click();
  },
  stop() { const box = $('music'); box.innerHTML = ''; box.hidden = true; },
};

const sound = (() => {
  const KEY = 'microdca-coin-sound';
  let on = false, ac = null, last = 0;
  try { on = localStorage.getItem(KEY) === '1'; } catch {}
  const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7"/><path d="M19 6a8.5 8.5 0 010 12"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6"/><path d="M22 9l-5 6"/></svg>';
  const btn = document.getElementById('sound');
  const sync = () => { btn.innerHTML = on ? ICON_ON : ICON_OFF; btn.setAttribute('aria-label', on ? 'Turn sound and music off' : 'Turn on sound and music (Creed, Higher)'); btn.title = on ? 'Sound off' : 'Sound on (plays Creed, Higher)'; btn.classList.toggle('on', on); };
  btn.onclick = () => {
    on = !on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
    if (on) { ac ??= new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); clink(); music.play(); } else music.stop();
    sync();
  };
  // sound starts off on every visit (browsers only allow audio after a tap anyway)
  on = false;
  sync();
  /** Shared helper: one oscillator with a pitch path and a quick volume envelope. */
  function tone(type, freqs, dur, gain = 0.08, at = 0) {
    const now = ac.currentTime + at, o = ac.createOscillator(), v = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freqs[0], now);
    freqs.slice(1).forEach((f, i) => o.frequency.exponentialRampToValueAtTime(f, now + (dur * (i + 1)) / (freqs.length - 1)));
    v.gain.setValueAtTime(0.0001, now); v.gain.exponentialRampToValueAtTime(gain, now + 0.012); v.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(v).connect(ac.destination); o.start(now); o.stop(now + dur + 0.02);
    return o;
  }
  // a rotating cast of dumb cartoon noises for every coin
  const SILLY = [
    () => { const o = tone('sine', [220, 880, 330, 660, 440], 0.32, 0.09); const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 28; lg.gain.value = 60; lfo.connect(lg).connect(o.frequency); lfo.start(); lfo.stop(ac.currentTime + 0.34); }, // boing
    () => { tone('square', [1500, 2400, 1900], 0.12, 0.035); }, // rubber duck squeak
    () => { tone('sawtooth', [420, 300, 260], 0.16, 0.05); tone('sawtooth', [630, 450], 0.12, 0.025); }, // quack
    () => { tone('sine', [180, 720], 0.09, 0.12); }, // bloop
    () => { tone('sawtooth', [233, 247, 233], 0.22, 0.05); tone('square', [466, 494], 0.2, 0.02); }, // kazoo honk
  ];
  /** Was a "clink"; now something much dumber. */
  function clink() {
    if (!on || !ac) return;
    const now = ac.currentTime;
    if (now - last < 0.09) return;
    last = now;
    SILLY[(Math.random() * SILLY.length) | 0]();
  }
  /** Slide whistle up (big buys). */
  function whistle() { if (!on || !ac) return; tone('sine', [520, 2200], 0.55, 0.07); }
  /** A ridiculous air horn (mega buys): three stacked detuned saws, honked twice. */
  function airhorn() {
    if (!on || !ac) return;
    for (const at of [0, 0.32]) for (const f of [466, 470, 587]) {
      const now = ac.currentTime + at, o = ac.createOscillator(), v = ac.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.92, now); o.frequency.exponentialRampToValueAtTime(f, now + 0.05);
      v.gain.setValueAtTime(0.0001, now); v.gain.exponentialRampToValueAtTime(0.035, now + 0.03); v.gain.setValueAtTime(0.035, now + 0.24); v.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      o.connect(v).connect(ac.destination); o.start(now); o.stop(now + 0.32);
    }
  }
  /** A short low "boom" for big buys: filtered noise with a fast decay. */
  function boom(size = 1) {
    if (!on || !ac) return;
    const now = ac.currentTime, len = 0.5 + 0.3 * size;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2.5);
    const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), v = ac.createGain();
    src.buffer = buf; lp.type = 'lowpass'; lp.frequency.setValueAtTime(900 * size, now); lp.frequency.exponentialRampToValueAtTime(60, now + len);
    v.gain.setValueAtTime(0.22 * Math.min(1.5, size), now); v.gain.exponentialRampToValueAtTime(0.0001, now + len);
    src.connect(lp).connect(v).connect(ac.destination); src.start(now);
  }
  /** Firework pop: a quick crackly burst. */
  function pop() {
    if (!on || !ac) return;
    const now = ac.currentTime;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 4) * (Math.random() < 0.1 ? 1 : 0.4);
    const src = ac.createBufferSource(), hp = ac.createBiquadFilter(), v = ac.createGain();
    src.buffer = buf; hp.type = 'highpass'; hp.frequency.value = 700; v.gain.value = 0.12;
    src.connect(hp).connect(v).connect(ac.destination); src.start(now);
  }
  return { clink, boom, pop, whistle, airhorn };
})();

const jar = (() => {
  const cv = $('jar'), ctx = cv.getContext('2d');
  const CW = 30, CH = 10, TH = 4; // coin width, face height, thickness
  const SATS_PER_COIN = 1_000_000; // each coin is 1,000,000 sats = 0.01 BTC
  let W = 0, H = 0, unit = SATS_PER_COIN / 1e8, cols = [], coins = [], falling = [], pops = [], raf = null;
  let sparks = [], rings = [], rockets = [], speedUntil = 0, speedPower = 1;
  /** Anime "focus" lines rushing toward the center. */
  function drawSpeedLines(now) {
    if (now > speedUntil) return false;
    const cx = W / 2, cy = H * 0.42, R = Math.hypot(W, H);
    ctx.save();
    const n = Math.round(70 * speedPower);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, inner = (0.18 + Math.random() * 0.25) * Math.min(W, H), w = 0.6 + Math.random() * 2.6 * speedPower;
      ctx.strokeStyle = Math.random() < 0.85 ? `rgba(255,255,255,${0.12 + Math.random() * 0.35})` : 'rgba(255,190,90,0.45)';
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner); ctx.stroke();
    }
    ctx.restore();
    return true;
  }
  const PALETTES = [['#F7931A', '#FFD27A', '#FFFFFF'], ['#00C805', '#B6FF9E', '#FFFFFF'], ['#5B8DEF', '#A9C4FF', '#FFFFFF'], ['#22C3D6', '#9DF3FF', '#FFFFFF'], ['#FF4FA3', '#FFC2E1', '#FFFFFF'], ['#FFD24A', '#FFF3B0', '#FF9F1C']];
  // points of a "₿" glyph, for the bitcoin-shaped burst
  const BTC_SHAPE = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.font = '800 60px DM Sans, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('₿', 32, 34);
    const d = g.getImageData(0, 0, 64, 64).data, pts = [];
    for (let y = 0; y < 64; y += 3) for (let x = 0; x < 64; x += 3) if (d[(y * 64 + x) * 4 + 3] > 128) pts.push([(x - 32) / 32, (y - 32) / 32]);
    return pts;
  })();
  /** Launch a firework rocket that bursts near the top of the jar. */
  function rocket(type, delay = 0) {
    if (reduceMotion) return;
    const types = ['peony', 'ring', 'willow', 'crackle'];
    rockets.push({ x: W * (0.12 + Math.random() * 0.76), y: H - 8, vy: -(7.5 + Math.random() * 2.5), apex: H * (0.12 + Math.random() * 0.28),
      type: type || types[(Math.random() * types.length) | 0], pal: PALETTES[(Math.random() * PALETTES.length) | 0], t0: performance.now() + delay });
    kick();
  }
  function burst(r) {
    const add = (vx, vy, extra = {}) => sparks.push({ x: r.x, y: r.y, vx, vy, life: 0, max: 55 + Math.random() * 25, r: 1.6 + Math.random() * 1.4, c: r.pal[(Math.random() * r.pal.length) | 0], drag: 0.97, g: 0.07, ...extra });
    if (r.type === 'btc') {
      const s = 2.3 + Math.random() * 0.5;
      for (const [px, py] of BTC_SHAPE) add(px * s * 2.2, py * s * 2.2, { c: Math.random() < 0.8 ? '#F7931A' : '#FFFFFF', max: 85, g: 0.025, drag: 0.94, r: 2 });
    } else if (r.type === 'ring') {
      const n = 46, s = 3.4 + Math.random();
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; add(Math.cos(a) * s, Math.sin(a) * s); }
    } else if (r.type === 'willow') {
      for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, sp = Math.random() * 3; add(Math.cos(a) * sp, Math.sin(a) * sp, { c: '#FFC34D', max: 110, g: 0.05, drag: 0.985, trail: true }); }
    } else if (r.type === 'crackle') {
      for (let i = 0; i < 60; i++) { const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3.5; add(Math.cos(a) * sp, Math.sin(a) * sp, { crackle: true, c: '#FFFFFF' }); }
    } else {
      for (let i = 0; i < 80; i++) { const a = Math.random() * Math.PI * 2, sp = Math.pow(Math.random(), 0.4) * 4.2; add(Math.cos(a) * sp, Math.sin(a) * sp); }
    }
    rings.push({ x: r.x, y: r.y, r: 4, max: 44, life: 0, c: r.pal[0] });
    sound.pop?.();
  }
  const SPARK_COLORS = ['#FFD27A', '#F7931A', '#FFB347', '#FFFFFF', '#FF7A00'];
  /** Burst of sparks (and coin confetti when power ≥ 2) with a shockwave ring. */
  function explode(x, y, power = 1) {
    if (reduceMotion) return;
    const n = Math.round(10 + power * 26);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (1.5 + Math.random() * 4.5) * (0.7 + power * 0.45);
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.2 * power, life: 0, max: 40 + Math.random() * 30 * power,
        r: 1.2 + Math.random() * 2.2, c: SPARK_COLORS[(Math.random() * SPARK_COLORS.length) | 0], coin: power >= 2 && Math.random() < 0.3, spin: Math.random() * 6 });
    }
    if (power >= 1.5) rings.push({ x, y, r: 6, max: 60 + power * 50, life: 0 });
    if (sparks.length > 1600) sparks.splice(0, sparks.length - 1600);
    kick();
  }
  function drawFx() {
    let alive = false;
    const now = performance.now();
    rockets = rockets.filter((r) => {
      if (now < r.t0) { alive = true; return true; }
      r.y += r.vy; r.vy *= 0.985;
      ctx.save(); ctx.fillStyle = '#FFE2A8'; ctx.shadowColor = '#F7931A'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(r.x, r.y, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      if (Math.random() < 0.8) sparks.push({ x: r.x + (Math.random() - 0.5) * 2, y: r.y + 4, vx: (Math.random() - 0.5) * 0.6, vy: 1 + Math.random(), life: 0, max: 16, r: 1.1, c: '#FFB347', drag: 0.9, g: 0.05 });
      if (r.y <= r.apex || r.vy > -1.2) { burst(r); alive = true; return false; }
      alive = true; return true;
    });
    rings = rings.filter((g) => {
      g.life++; g.r += (g.max - g.r) * 0.12;
      const a = Math.max(0, 1 - g.life / 32);
      if (a <= 0) return false;
      ctx.save(); ctx.strokeStyle = g.c ? rgba(g.c, a * 0.7) : `rgba(255,190,90,${a * 0.8})`; ctx.lineWidth = 3 * a + 0.5; ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      alive = true; return true;
    });
    sparks = sparks.filter((p) => {
      p.life++; p.x += p.vx; p.y += p.vy; p.vy += p.g ?? 0.16; p.vx *= p.drag ?? 0.985; if (p.drag) p.vy *= p.drag;
      if (p.y > H - 12) { p.y = H - 12; p.vy *= -0.35; p.vx *= 0.7; }
      const a = 1 - p.life / p.max;
      if (a <= 0) return false;
      ctx.save(); ctx.globalAlpha = a;
      if (p.coin) { ctx.translate(p.x, p.y); ctx.scale(Math.cos(p.life / 4 + p.spin), 1); ctx.fillStyle = '#F7931A'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#9A5605'; ctx.lineWidth = 1; ctx.stroke(); }
      else if (p.trail) { ctx.strokeStyle = p.c; ctx.lineWidth = 1.4; ctx.shadowColor = p.c; ctx.shadowBlur = 6; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 5, p.y - p.vy * 5); ctx.stroke(); }
      else if (p.crackle && p.life > p.max * 0.45 && Math.random() < 0.5) { /* strobe off */ }
      else { ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = p.crackle ? 10 : 6; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      alive = true; return true;
    });
    return alive;
  }
  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuild();
  }
  const ncols = () => Math.max(8, Math.floor((W - 24) / (CW * 0.5)));
  const colX = (i) => 12 + CW / 2 + i * ((W - 24 - CW) / (ncols() - 1));
  const capacity = () => Math.floor(ncols() * ((H * 0.42) / TH) * 0.5); // a mound, not a full box
  /** Where a coin dropped at column i comes to rest: it slides downhill like sand. */
  function settle(i) {
    for (let step = 0; step < 40; step++) {
      const h = cols[i], l = i > 0 ? cols[i - 1] : Infinity, r = i < cols.length - 1 ? cols[i + 1] : Infinity;
      if (l < h - 1 && l <= r) i--; else if (r < h - 1) i++; else break;
    }
    return i;
  }
  const inPile = () => coins.length + falling.filter((f) => !f.ghost && !f.over).length;
  const isFull = () => inPile() >= capacity();
  function place(t, animate, delay = 0) {
    if (!cols.length) cols = new Array(ncols()).fill(0);
    // jar full: the coin still rains in, lands on top of the heap and bursts
    if (isFull()) {
      if (!animate || reduceMotion) return;
      const top = H - 10 - Math.max(...cols) * TH - CH;
      falling.push({ t, x: W * (0.15 + Math.random() * 0.7), y: top + Math.random() * 6, y0: -12, t0: performance.now() + delay, ms: 480 + Math.random() * 200, over: true });
      kick(); return;
    }
    // drop near the middle, spreading out as the pile grows
    const spread = Math.min(0.95, 0.12 + (coins.length + falling.length) / 500);
    let i = Math.round((cols.length - 1) / 2 + (Math.random() - 0.5) * spread * (cols.length - 1));
    i = settle(Math.max(0, Math.min(cols.length - 1, i)));
    const y = H - 10 - cols[i] * TH - CH / 2;
    cols[i]++;
    const c = { t, x: colX(i) + (Math.random() - 0.5) * 4, y, col: i };
    if (animate && !reduceMotion) falling.push({ ...c, y0: -12, t0: performance.now() + delay, ms: 520 + Math.random() * 220 });
    else land(c);
    kick();
  }
  /** Coins don't stay forever: each column drains from the top a few seconds after landing. */
  const stacks = new Map(); let leaving = [];
  function land(c) {
    c.born = performance.now(); c.life = 3500 + Math.random() * 3500;
    coins.push(c);
    if (!stacks.has(c.col)) stacks.set(c.col, []);
    stacks.get(c.col).push(c);
  }
  function drain(now) {
    for (const [i, st] of stacks) {
      const top = st.at(-1);
      if (!top || now - top.born < top.life) continue;
      st.pop(); cols[i] = Math.max(0, cols[i] - 1);
      coins.splice(coins.indexOf(top), 1);
      leaving.push({ ...top, t0: now });
      if (st.length) st.at(-1).born = Math.min(st.at(-1).born, now - st.at(-1).life + 120 + Math.random() * 220); // the rest follow shortly
    }
    let alive = false;
    leaving = leaving.filter((c) => {
      const k = (now - c.t0) / 650;
      if (k >= 1) return false;
      coin(c.x + Math.sin(k * 9) * 3, c.y + k * k * 40, A[c.t].color, 1 - k);
      alive = true; return true;
    });
    return alive || coins.length > 0;
  }
  function coin(x, y, color, a = 1) {
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = '#9A5605';
    ctx.beginPath(); ctx.ellipse(x, y + TH, CW / 2, CH / 2, 0, 0, Math.PI); ctx.lineTo(x - CW / 2, y); ctx.ellipse(x, y, CW / 2, CH / 2, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(x - CW / 2, 0, x + CW / 2, 0);
    g.addColorStop(0, '#FFB955'); g.addColorStop(0.55, '#F7931A'); g.addColorStop(1, '#D5760A');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, CW / 2, CH / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();
  }
  function frame(now) {
    ctx.clearRect(0, 0, W, H);
    // the glow rises with the pile
    const top = cols.length ? Math.max(...cols) * TH : 0;
    if (top > 0) {
      const y = H - 10 - top - 14;
      const g = ctx.createLinearGradient(0, y, 0, H);
      g.addColorStop(0, 'rgba(247,147,26,0)'); g.addColorStop(1, 'rgba(247,147,26,0.16)');
      ctx.fillStyle = g; ctx.fillRect(0, y, W, H - y);
    }
    ctx.strokeStyle = 'rgba(247,147,26,0.25)'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(0, H - 9.5); ctx.lineTo(W, H - 9.5); ctx.stroke(); ctx.setLineDash([]);
    coins.sort((a, b) => a.y - b.y);
    for (const c of coins) coin(c.x, c.y, A[c.t].color);
    let busy = drain(now);
    if (drawSpeedLines(now)) busy = true;
    falling = falling.filter((f) => {
      if (now < f.t0) { busy = true; return true; }
      const k = Math.min(1, (now - f.t0) / f.ms), e = k * k;
      coin(f.x, f.y0 + (f.y - f.y0) * e, A[f.t].color);
      if (k >= 1) { if (!f.over) land({ t: f.t, x: f.x, y: f.y, col: f.col }); sound.clink(); explode(f.x, f.y, f.over ? 0.5 : 0.35); busy = true; return false; }
      busy = true; return true;
    });
    if (drawFx()) busy = true;
    pops = pops.filter((p) => {
      const k = (now - p.t0) / 1800;
      if (k < 0) { busy = true; return true; }
      if (k >= 1) return false;
      ctx.save(); ctx.globalAlpha = Math.min(1, (1 - k) * 1.6); ctx.fillStyle = A[p.t].color; ctx.font = '700 15px DM Sans, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y - k * 22); ctx.restore();
      busy = true; return true;
    });
    raf = busy ? requestAnimationFrame(frame) : null;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  let counts = {};
  function rebuild(animate = false) {
    cols = new Array(ncols()).fill(0); coins = []; falling = []; stacks.clear(); leaving = [];
    // only as many coins as the jar holds (a big day is tens of thousands), in proportion per fund
    const total = T.reduce((a, t) => a + (counts[t] || 0), 0), cap = capacity();
    const seq = [];
    for (const t of T) { const n = total > cap ? Math.round(((counts[t] || 0) / total) * cap) : counts[t] || 0; for (let i = 0; i < n; i++) seq.push(t); }
    seq.sort(() => Math.random() - 0.5);
    // coins don't stay, so on load just rain a short shower representing today (if there was any buying)
    const shower = animate ? seq.slice(-150) : [];
    shower.forEach((t, i) => place(t, true, i * Math.min(40, 2200 / shower.length)));
    footer(); kick();
  }
  const footer = () => {
    const n = T.reduce((a, t) => a + (counts[t] || 0), 0);
    $('jar-unit').innerHTML = `Each coin = 1,000,000 sats (0.01 BTC)${n ? ` · ${n.toLocaleString()} coins today` : ''}`;
  };
  addEventListener('resize', resize);
  return {
    init() { resize(); },
    /** Show `btcByFund` worth of coins (re-scaling the coin size if the pile would overflow). */
    set(btcByFund, { animate = false } = {}) {
      counts = Object.fromEntries(T.map((t) => [t, Math.floor((btcByFund[t] || 0) / unit)]));
      rebuild(animate);
    },
    setUnit(u) { unit = u; },
    /** New bitcoin bought by `t`: add coins (if a full coin's worth) and pop a "+x BTC" label. */
    add(t, btc, prevBtc) {
      const before = Math.floor(prevBtc / unit), after = Math.floor((prevBtc + btc) / unit), n = after - before;
      counts[t] = (counts[t] || 0) + n;
      // rain up to ~80 coins per update (the readout keeps the exact count)
      const shown = Math.min(n, 80);
      for (let i = 0; i < shown; i++) place(t, true, i * Math.min(70, 1500 / shown));
      footer();
      // the "+x BTC" pops rise from just above the pile, below the big number
      const pileTop = H - 10 - Math.max(0, ...cols) * TH;
      const x = W * (0.2 + Math.random() * 0.6);
      if (pops.length >= 3) pops.shift(); // at most three labels at once
      pops.push({ t, x, y: Math.max(H * 0.64, pileTop - 18) + (Math.random() - 0.5) * 24, text: `+${num(btc, btc < 1 ? 3 : 2)} BTC ${t}`, t0: performance.now() + 200 });
      kick();
    },
    get unit() { return unit; },
    explode,
    rocket,
    speed(ms = 500, power = 1) { if (reduceMotion) return; speedUntil = Math.max(speedUntil, performance.now() + ms); speedPower = power; kick(); },
    /** Where the top of the pile is, and how wide the jar is (for placing effects). */
    get pileTop() { return H - 10 - Math.max(0, ...(cols.length ? cols : [0])) * TH; },
    get size() { return { W, H }; },
  };
})();

/* ================= coin stack (canvas) ================= */
const stack = (() => {
  const cv = $('stack'), ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, unit = 1, piles = {}, falling = [], floats = [], raf = null, labels = {};
  const COIN_W = 50, COIN_H = 15, STEP = 7.5;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kick();
  }
  const perCol = () => Math.max(6, Math.min(11, Math.floor((H - 90) / STEP)));
  function slot(t, i) {
    const idx = T.indexOf(t), cx = W * (T.length === 1 ? 0.5 : idx === 0 ? 0.3 : 0.7);
    const col = Math.floor(i / perCol()), row = i % perCol();
    // columns fan out left and right of the center, each a little shorter, so the pile looks like a heap
    const off = col === 0 ? 0 : (col % 2 ? 1 : -1) * Math.ceil(col / 2) * (COIN_W * 0.62);
    return { x: cx + off, y: H - 58 - row * STEP + (col ? 3 : 0) };
  }
  function coin(x, y, color, alpha = 1, scale = 1) {
    const w = COIN_W * scale, h = COIN_H * scale, th = 5 * scale;
    ctx.save(); ctx.globalAlpha = alpha;
    // rim
    ctx.fillStyle = '#A65F08';
    ctx.beginPath(); ctx.ellipse(x, y + th, w / 2, h / 2, 0, 0, Math.PI); ctx.lineTo(x - w / 2, y); ctx.ellipse(x, y, w / 2, h / 2, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    // face
    const g = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y);
    g.addColorStop(0, '#FFB347'); g.addColorStop(0.5, '#F7931A'); g.addColorStop(1, '#D97A0A');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.2 * scale; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.font = `700 ${9 * scale}px DM Sans, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('₿', x, y + 0.5);
    ctx.restore();
  }
  function frame(now) {
    ctx.clearRect(0, 0, W, H);
    for (const t of T) {
      const { x } = slot(t, 0);
      const n = piles[t] || 0, cols = Math.max(1, Math.ceil(n / perCol()));
      // soft shadow under the pile
      const sg = ctx.createRadialGradient(x, H - 50, 2, x, H - 50, 30 + cols * 18);
      sg.addColorStop(0, rgba(A[t].color, 0.28)); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(x, H - 50, 30 + cols * 18, 10, 0, 0, Math.PI * 2); ctx.fill();
      // label: ticker + running total
      ctx.textAlign = 'center';
      ctx.fillStyle = css('--fg'); ctx.font = '600 13px DM Sans, sans-serif';
      ctx.fillText(t, x, H - 24);
      ctx.fillStyle = css('--muted'); ctx.font = '500 12px DM Sans, sans-serif';
      const L = labels[t]; // exact total once the pile is complete, running count while it builds
      ctx.fillText(`${num(L && n >= L.count ? L.exact : n * unit, 0)} BTC`, x, H - 8);
      ctx.fillStyle = A[t].color; ctx.beginPath(); ctx.arc(x - 24, H - 28, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // draw bottom rows first so coins sit on top of each other
    const all = [];
    for (const t of T) for (let i = 0; i < (piles[t] || 0); i++) all.push({ t, ...slot(t, i), i });
    all.sort((a, b) => b.y - a.y).forEach((s) => coin(s.x, s.y, A[s.t].color));
    let busy = false;
    falling = falling.filter((f) => {
      if (now < f.t0) { busy = true; return true; } // not its turn yet
      const k = Math.min(1, (now - f.t0) / f.ms);
      const e = k < 1 ? k * k : 1;
      const y = f.y0 + (f.y1 - f.y0) * e;
      coin(f.x, y, A[f.t].color, f.ghost ? 1 - k * 0.6 : 1, f.ghost ? 0.7 : 1);
      if (k >= 1) { if (!f.ghost) piles[f.t] = (piles[f.t] || 0) + 1; busy = true; return false; } // one more frame to redraw labels
      busy = true; return true;
    });
    floats = floats.filter((f) => {
      const k = (now - f.t0) / 1600;
      if (k >= 1) return false;
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = css('--up'); ctx.font = '600 12px DM Sans, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y - k * 26); ctx.restore();
      busy = true; return true;
    });
    raf = busy ? requestAnimationFrame(frame) : null;
    cv.dataset.piles = JSON.stringify({ piles, unit, labels }); // handy for checking the totals in devtools
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener('resize', resize);
  return {
    init() { resize(); },
    setUnit(u) { unit = u; },
    setLabels(l) { labels = l; },
    get unit() { return unit; },
    reset() { piles = {}; falling = []; kick(); },
    fill(counts) { piles = { ...counts }; falling = []; kick(); },
    /** A coin drops onto `t`'s pile (counts toward the pile). */
    drop(t, delay = 0) {
      const i = (piles[t] || 0) + falling.filter((f) => f.t === t && !f.ghost).length;
      const s = slot(t, i);
      falling.push({ t, x: s.x, y0: -20, y1: s.y, t0: performance.now() + delay, ms: 650 });
      kick();
    },
    /** Live sale: a small coin falls in with a "+0.42 BTC" label (doesn't change pile size). */
    sparkle(t, text) {
      const s = slot(t, piles[t] || 0);
      falling.push({ t, x: s.x, y0: -20, y1: s.y - 8, t0: performance.now(), ms: 700, ghost: true });
      floats.push({ x: s.x, y: s.y - 30, text, t0: performance.now() + 500 });
      kick();
    },
  };
})();


/* ================= the party: bulls dance, bears fall over ================= */
// Anime-style characters. Optional parts are toggled by state classes in CSS:
// bull: .eyes-anime .mouth-happy (default) | .eyes-closed .tear .mouth-sad (sleepy)
// bear: .eyes-anime .mouth-cat (default) | .hat .eyes-happy .mouth-open (party) | .eyes-swirl .sweat .mouth-sad (knocked)
const BULL = `<svg viewBox="-4 -16 88 100" class="bull-svg">
  <g class="legs"><rect x="27" y="62" width="8" height="14" rx="3" fill="#B8650A"/><rect x="45" y="62" width="8" height="14" rx="3" fill="#B8650A"/></g>
  <ellipse cx="40" cy="58" rx="20" ry="13" fill="#F7931A"/><text x="40" y="63" text-anchor="middle" font-size="13" font-weight="800" fill="#7A3E00" font-family="DM Sans,sans-serif">₿</text>
  <path d="M20 20C8 18 3 9 7 2c2 7 8 10 15 11z" fill="#FFF1D6"/><path d="M60 20c12-2 17-11 13-18-2 7-8 10-15 11z" fill="#FFF1D6"/>
  <path class="hair" d="M17 18 L13 -4 L25 8 L28 -14 L36 5 L41 -16 L46 5 L54 -13 L56 8 L68 -4 L63 18 Z" fill="#FFD24A" stroke="#D99A00" stroke-width="1.5" stroke-linejoin="round"/>
  <ellipse cx="40" cy="30" rx="20" ry="18" fill="#F7931A"/>
  <ellipse cx="20" cy="25" rx="6" ry="4" fill="#E07E0C" transform="rotate(-25 20 25)"/><ellipse cx="60" cy="25" rx="6" ry="4" fill="#E07E0C" transform="rotate(25 60 25)"/>
  <g class="headband"><rect x="20" y="13" width="40" height="6" rx="2" fill="#E53935"/><rect x="35" y="13.5" width="10" height="5" rx="1" fill="#C9CED3"/><text x="40" y="18" text-anchor="middle" font-size="5.5" font-weight="800" fill="#333" font-family="DM Sans,sans-serif">₿</text>
    <path d="M60 15 q8 2 12 -3 M60 17 q9 5 14 2" stroke="#E53935" stroke-width="2.6" fill="none" stroke-linecap="round"/></g>
  <g class="eyes-anime">
    <path d="M24 21 L35 24" stroke="#5A2A00" stroke-width="2.2" stroke-linecap="round"/><path d="M56 21 L45 24" stroke="#5A2A00" stroke-width="2.2" stroke-linecap="round"/>
    <ellipse cx="31" cy="30" rx="5.2" ry="6.6" fill="#fff"/><ellipse cx="49" cy="30" rx="5.2" ry="6.6" fill="#fff"/>
    <ellipse cx="31.5" cy="31" rx="4.1" ry="5.4" fill="#2D6BFF"/><ellipse cx="48.5" cy="31" rx="4.1" ry="5.4" fill="#2D6BFF"/>
    <ellipse cx="31.5" cy="32" rx="2.2" ry="3" fill="#0B1E5B"/><ellipse cx="48.5" cy="32" rx="2.2" ry="3" fill="#0B1E5B"/>
    <circle cx="33" cy="28.5" r="1.7" fill="#fff"/><circle cx="50" cy="28.5" r="1.7" fill="#fff"/><circle cx="30" cy="34" r="0.9" fill="#fff"/><circle cx="47" cy="34" r="0.9" fill="#fff"/></g>
  <g class="eyes-closed" stroke="#5A2A00" stroke-width="2" fill="none" stroke-linecap="round"><path d="M26 30q5 4 10 0"/><path d="M44 30q5 4 10 0"/><path d="M25 24l9 2M55 24l-9 2"/></g>
  <g class="tear"><path d="M28 33 q-1 10 0 26 l3 0 q1 -16 0 -26 z" fill="#7EC8FF" opacity="0.9"/><path d="M52 33 q1 10 0 26 l-3 0 q-1 -16 0 -26 z" fill="#7EC8FF" opacity="0.9"/></g>
  <g class="blush" fill="#FF6B8B" opacity="0.55"><ellipse cx="23" cy="38" rx="4" ry="2.2"/><ellipse cx="57" cy="38" rx="4" ry="2.2"/></g>
  <ellipse cx="40" cy="41" rx="10" ry="6.5" fill="#FFD3A0"/><ellipse cx="36.5" cy="40" rx="1.6" ry="2.1" fill="#7A3E00"/><ellipse cx="43.5" cy="40" rx="1.6" ry="2.1" fill="#7A3E00"/>
  <circle cx="40" cy="46" r="3.6" fill="none" stroke="#FFD24A" stroke-width="2"/>
  <path class="mouth-happy" d="M33 45 q7 9 14 0 z" fill="#8A1C1C"/>
  <path class="mouth-sad" d="M34 47 q2 -2 4 0 q2 2 4 0 q2 -2 4 0" stroke="#7A3E00" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;
const BEAR = `<svg viewBox="0 -14 80 94" class="bear-svg">
  <rect x="27" y="62" width="9" height="14" rx="4" fill="#5E3B20"/><rect x="44" y="62" width="9" height="14" rx="4" fill="#5E3B20"/>
  <ellipse cx="40" cy="57" rx="19" ry="14" fill="#7A4E2D"/><ellipse cx="40" cy="60" rx="11" ry="8" fill="#A7764C"/>
  <circle cx="24" cy="14" r="7.5" fill="#7A4E2D"/><circle cx="56" cy="14" r="7.5" fill="#7A4E2D"/><circle cx="24" cy="14" r="4" fill="#E9A3A3"/><circle cx="56" cy="14" r="4" fill="#E9A3A3"/>
  <circle cx="40" cy="30" r="19" fill="#7A4E2D"/><ellipse cx="40" cy="38" rx="9" ry="6.5" fill="#C79A6B"/><ellipse cx="40" cy="35" rx="3.4" ry="2.4" fill="#222"/>
  <g class="hat"><path d="M33 13L41 -10L49 13z" fill="#FF4FA3"/><path d="M36 6l10 2M38 0l7 1.5" stroke="#FFD24A" stroke-width="2"/><circle cx="41" cy="-11" r="3.2" fill="#FFD24A"/></g>
  <g class="eyes-anime"><ellipse cx="31" cy="27" rx="4.6" ry="5.6" fill="#111"/><ellipse cx="49" cy="27" rx="4.6" ry="5.6" fill="#111"/>
    <circle cx="32.6" cy="25" r="1.9" fill="#fff"/><circle cx="50.6" cy="25" r="1.9" fill="#fff"/><circle cx="29.8" cy="29.5" r="1" fill="#fff"/><circle cx="47.8" cy="29.5" r="1" fill="#fff"/></g>
  <g class="eyes-happy" stroke="#111" stroke-width="2.2" fill="none" stroke-linecap="round"><path d="M27 28q4 -6 8 0"/><path d="M45 28q4 -6 8 0"/></g>
  <g class="eyes-swirl" stroke="#111" stroke-width="1.4" fill="none" stroke-linecap="round"><path d="M31 27 m-0.5 0 a0.5 0.5 0 1 1 1 0 a1.5 1.5 0 1 1 -3 0 a2.5 2.5 0 1 1 5 0 a3.5 3.5 0 1 1 -7 0"/><path d="M49 27 m-0.5 0 a0.5 0.5 0 1 1 1 0 a1.5 1.5 0 1 1 -3 0 a2.5 2.5 0 1 1 5 0 a3.5 3.5 0 1 1 -7 0"/></g>
  <path class="sweat" d="M60 18 q4 6 0 9 q-4 -3 0 -9z" fill="#7EC8FF"/>
  <g class="blush" fill="#FF6B8B" opacity="0.6"><ellipse cx="24" cy="36" rx="4" ry="2.2"/><ellipse cx="56" cy="36" rx="4" ry="2.2"/></g>
  <path class="mouth-cat" d="M35.5 40 q2.2 3 4.5 0 q2.3 3 4.5 0" stroke="#3B2412" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path class="mouth-open" d="M34 39 q6 8 12 0z" fill="#8A1C1C"/>
  <path class="mouth-sad" d="M36 43q4 -3 8 0" stroke="#3B2412" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;

const fx = (() => {
  const layer = $('fx'), jarEl = document.querySelector('.jar');
  let sleepy = null, bearTimer = null;
  const live = () => layer.querySelectorAll('.critter:not(.sleepy)').length;
  function spawn(cls, svg, ms, style = {}) {
    if (reduceMotion || live() >= 5) return null;
    const el = document.createElement('div');
    el.className = `critter ${cls}`;
    el.innerHTML = svg;
    Object.assign(el.style, style);
    layer.append(el);
    setTimeout(() => el.remove(), ms);
    return el;
  }
  return {
    /** A bull in sunglasses hops in and dances. */
    bull(delay = 0) {
      setTimeout(() => {
        const left = 6 + Math.random() * 78;
        const el = spawn('bull', BULL, 3400, { left: `${left}%`, '--flip': Math.random() < 0.5 ? -1 : 1 });
        if (el && document.getElementById('today-big').classList.contains('aura')) el.classList.add('ssj');
      }, delay);
    },
    /** A bear wanders in from a side, wobbles, and falls over seeing stars. */
    bear(delay = 0) {
      setTimeout(() => {
        const fromLeft = Math.random() < 0.5;
        const el = spawn(`bear ${fromLeft ? 'from-left' : 'from-right'}`, BEAR + '<span class="stars">✦ ✧ ✦</span>', 4200, { left: fromLeft ? '14%' : '70%' });
        if (el) setTimeout(() => el.classList.add('knocked'), 1500);
      }, delay);
    },
    /** Manga sound effect text that slams onto the screen. */
    sfx(text, { x = 20 + Math.random() * 60, y = 18 + Math.random() * 40, size = 1, rot = (Math.random() - 0.5) * 24, color = '#FFE14D', ms = 1300 } = {}) {
      if (reduceMotion) return;
      const el = document.createElement('div');
      el.className = 'sfx';
      el.textContent = text;
      Object.assign(el.style, { left: `${x}%`, top: `${y}%`, '--rot': `${rot}deg`, '--size': size, '--c': color });
      layer.append(el);
      setTimeout(() => el.remove(), ms);
    },
    /** Anime attack cut-in: a slanted banner slashes across with the bull's face. */
    cutin(title, sub) {
      if (reduceMotion || layer.querySelector('.cutin')) return;
      const el = document.createElement('div');
      el.className = 'cutin';
      el.innerHTML = `<div class="cutin-band"><div class="cutin-face">${BULL}</div><div class="cutin-text"><b>${title}</b><span>${sub}</span></div></div>`;
      layer.append(el);
      setTimeout(() => el.remove(), 2100);
    },
    /** Impact frames: a couple of high-contrast inverted flashes. */
    impact() {
      if (reduceMotion) return;
      jarEl.classList.remove('impact'); void jarEl.offsetWidth; jarEl.classList.add('impact');
      setTimeout(() => jarEl.classList.remove('impact'), 420);
    },
    /** Golden power-up aura on the big number (and any dancing bulls). */
    powerUp(ms = 2600) {
      if (reduceMotion) return;
      const big = document.getElementById('today-big');
      big.classList.add('aura');
      layer.querySelectorAll('.critter.bull').forEach((b) => b.classList.add('ssj'));
      clearTimeout(big._aura); big._aura = setTimeout(() => big.classList.remove('aura'), ms);
    },
    /** Whole-jar flash and shake for a mega buy. */
    mega() {
      if (reduceMotion) return;
      jarEl.classList.remove('shake', 'flash'); void jarEl.offsetWidth; jarEl.classList.add('shake', 'flash');
      setTimeout(() => jarEl.classList.remove('shake', 'flash'), 700);
    },
    /**
     * While the ATM is paused the roles flip: the bull sleeps (sad) in the corner and
     * bears in party hats keep dancing in.
     */
    paused(on) {
      if (on && !sleepy && !reduceMotion) {
        sleepy = document.createElement('div');
        sleepy.className = 'critter sleepy';
        sleepy.innerHTML = BULL + '<span class="zzz"><i>z</i><i>z</i><i>z</i></span>';
        layer.append(sleepy);
        const dance = () => { if (!sleepy) return; this.happyBear(); bearTimer = setTimeout(dance, 4500 + Math.random() * 3500); };
        bearTimer = setTimeout(dance, 900);
      } else if (!on && sleepy) { sleepy.remove(); sleepy = null; clearTimeout(bearTimer); }
    },
    /** A bear in a party hat dances (the ATM is paused, so bears are winning). */
    happyBear(delay = 0) {
      setTimeout(() => {
        const left = 8 + Math.random() * 64;
        spawn('bear happy', BEAR, 3400, { left: `${left}%`, '--flip': Math.random() < 0.5 ? -1 : 1 });
        if (Math.random() < 0.7) this.sfx('ゴゴゴゴ', { x: Math.min(80, left + 6), y: 52 + Math.random() * 10, size: 0.7, rot: -8, color: '#C9A0FF', ms: 2200 });
      }, delay);
    },
  };
})();

let over9000Shown = false;
/** Classic: when today's coin count passes 9,000. */
function checkOver9000(coinsToday) {
  if (over9000Shown || coinsToday <= 9000) return;
  over9000Shown = true;
  fx.impact(); jar.speed(1500, 1.8); fx.powerUp(3200);
  fx.cutin("IT'S OVER 9,000!!", `${coinsToday.toLocaleString()} coins of 1M sats today`);
  fx.sfx('ドドドドドド', { x: 50, y: 64, size: 1, rot: 0, color: '#FF4FA3', ms: 2000 });
  sound.boom(1.8); sound.airhorn();
}

/** How big a party a buy gets: sparks always, bulls often, explosions + falling bears for big ones. */
function celebrate(t, btc) {
  const { W } = jar.size, y = jar.pileTop - 6;
  const x = W * (0.25 + Math.random() * 0.5);
  if (btc >= 25) {
    // the finale, anime edition
    fx.impact(); jar.speed(1400, 1.6); fx.powerUp(); sound.airhorn();
    fx.cutin('BULL MODE: ACTIVATED!!', '超強気 · super bullish');
    fx.sfx('バァーン!!', { x: 50, y: 30, size: 1.6, rot: -8, ms: 1600 });
    setTimeout(() => fx.sfx('ドドドド', { x: 22, y: 60, size: 0.9, rot: 10, color: '#FF9F1C' }), 500);
    jar.explode(W / 2, y, 3.2); setTimeout(() => jar.explode(W * 0.3, y - 20, 2), 160); setTimeout(() => jar.explode(W * 0.7, y - 30, 2), 320);
    fx.mega(); sound.boom(1.6);
    jar.rocket('btc', 0);
    for (let i = 1; i < 9; i++) jar.rocket(null, i * 140 + Math.random() * 120);
    setTimeout(() => { fx.mega(); sound.boom(1.2); jar.rocket('btc', 0); jar.rocket('willow', 120); jar.rocket('ring', 240); }, 1500);
    fx.bull(0); fx.bull(250); fx.bull(500); fx.bull(750); fx.bear(200); fx.bear(900);
  } else if (btc >= 5) {
    jar.explode(x, y, 2); sound.boom(1); sound.whistle();
    jar.speed(450, 1);
    fx.sfx(Math.random() < 0.5 ? 'ドン!' : 'ズドン!', { size: 1.1 });
    for (let i = 0; i < 3; i++) jar.rocket(null, i * 180);
    fx.bull(0);
    if (Math.random() < 0.6) fx.bear(150);
  } else {
    jar.explode(x, y, 1);
    if (Math.random() < 0.45) jar.rocket();
    if (Math.random() < 0.35) fx.bull(0);
    if (Math.random() < 0.25) fx.sfx(Math.random() < 0.5 ? 'キラッ' : 'ドド', { size: 0.6, color: Math.random() < 0.5 ? '#FFE14D' : '#9DF3FF', ms: 1000 });
  }
}

/* ================= today: readout + per-minute chart ================= */
const todayBig = roller($('today-big'));
let preview = null; // when running, the readout shows preview numbers instead of real ones

function renderTodayReadout() {
  if (preview) return;
  const sum = T.reduce((a, t) => a + today[t].btc, 0);
  const raised = T.reduce((a, t) => a + today[t].raised, 0);
  todayBig(`+${num(sum, sum >= 100 ? 2 : 4)} BTC`);
  $('today-sub').textContent = 'Estimated bitcoin bought today';
  $('today-split').innerHTML = T.map((t) => `<span><i class="dot" style="background:${A[t].color}"></i>${t} ${num(today[t].btc, today[t].btc >= 100 ? 1 : 3)}</span>`).join('') + `<span class="muted">≈ ${compactUsd(raised * 1)} raised</span>`;
  const sess = sessionInfo();
  $('jar-date').textContent = prettyDate(sess.date);
  const live = T.some((t) => today[t].state === 'live' || today[t].state === 'pre' || today[t].state === 'post');
  const open = T.some((t) => today[t].atPar && live);
  $('jar-badge').textContent = open ? 'ATM open' : live ? 'Below par' : 'Market closed';
  $('jar-badge').classList.toggle('closed', !open);
  $('preview').hidden = open;
  fx.paused(!open && !preview);
}

let pmChart;
/** Shades the part of the trading day that hasn't happened yet. */
const restOfDay = {
  id: 'restOfDay',
  beforeDatasetsDraw(chart) {
    const nowSlot = chart.$nowSlot;
    if (nowSlot == null || nowSlot >= chart.data.labels.length) return;
    const x0 = chart.scales.x.getPixelForValue(Math.max(0, nowSlot)), { top, bottom, right } = chart.chartArea;
    chart.ctx.save(); chart.ctx.fillStyle = rgba(css('--fg'), 0.04); chart.ctx.fillRect(x0, top, right - x0, bottom - top); chart.ctx.restore();
  },
};
function drawPerMinute() {
  const sess = sessionInfo();
  const N = 960, labels = Array.from({ length: N }, (_, i) => sess.start + i * 60000);
  const fmt = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const per = Object.fromEntries(T.map((t) => [t, labels.map((_, i) => today[t].minutes.get(i) || 0)]));
  const btcBars = bars?.BTC || [];
  let j = 0;
  const btcLine = labels.map((ms) => { if (ms > Date.now()) return null; while (j + 1 < btcBars.length && btcBars[j + 1][0] <= ms) j++; return btcBars[j] && btcBars[j][0] <= ms + 60000 ? btcBars[j][1] : null; });
  const nowSlot = Math.floor((Date.now() - sess.start) / 60000);
  const any = T.some((t) => today[t].btc > 0);
  $('pm-note').textContent = any
    ? 'Each bar is one minute of estimated buying. Taller bar, more bitcoin. The line is bitcoin\'s price (right side). The shaded area is the rest of today\'s trading hours.'
    : `Neither has traded at or above $100 ${sess.date === etDate(Date.now()) ? 'yet today' : `on ${prettyDate(sess.date)}`}, so there's nothing to estimate${sess.date === etDate(Date.now()) ? ' so far' : ''}. Bars appear here the moment one does. The line is bitcoin's price.`;
  $('pm-legend').innerHTML = T.map((t) => `<span><i class="sw" style="background:${A[t].color}"></i>${t} bitcoin bought</span>`).join('') + `<span><i class="sw dash" style="border-color:${css('--fg-2')}"></i>Bitcoin price</span>`;
  const maxBar = Math.max(0.0001, ...labels.map((_, i) => T.reduce((a, t) => a + per[t][i], 0)));
  pmChart?.destroy();
  pmChart = new Chart($('perminute'), {
    data: {
      labels,
      datasets: [
        ...T.map((t) => ({ type: 'bar', label: t, data: per[t], backgroundColor: A[t].color, stack: 's', yAxisID: 'y', barPercentage: 1, categoryPercentage: 1, order: 2 })),
        { type: 'line', label: 'BTC', data: btcLine, borderColor: css('--fg-2'), borderWidth: 1.25, pointRadius: 0, tension: 0, yAxisID: 'y2', order: 1, spanGaps: true },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: css('--muted'), autoSkip: false, maxRotation: 0, font: { family: css('--font'), size: 11 }, callback: (_, i) => (i % 120 === 0 ? fmt(labels[i]).replace(':00', '') : '') } },
        y: { stacked: true, beginAtZero: true, suggestedMax: maxBar * 1.15, position: 'left', grid: { color: css('--grid') }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 4, font: { family: css('--font'), size: 11 }, callback: (v) => `${num(v, v < 1 ? 2 : 0)} ₿` } },
        y2: { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 4, font: { family: css('--font'), size: 11 }, callback: (v) => compactUsd(v) } },
      },
      onHover: (_e, els) => {
        if (!els.length) { $('pm-tl').innerHTML = '&nbsp;'; return; }
        const i = els[0].index;
        $('pm-tl').innerHTML = `<b>${fmt(labels[i])} ET</b> · ${T.map((t) => `${t} ${num(per[t][i], 3)} BTC`).join(' · ')}${btcLine[i] ? ` · bitcoin ${usd0(btcLine[i])}` : ''}`;
      },
    },
    plugins: [restOfDay],
  });
  pmChart.$nowSlot = nowSlot;
  pmChart.update('none');
  $('perminute').onmouseleave = () => { $('pm-tl').innerHTML = '&nbsp;'; };
}

/* ================= rendering ================= */
const totals = () => {
  const out = { btc: 0, raised: 0, by: {} };
  for (const t of T) {
    const h = hist[t].reduce((a, r) => ({ btc: a.btc + r.btc, raised: a.raised + r.raised, days: a.days + (r.open ? 1 : 0) }), { btc: 0, raised: 0, days: 0 });
    h.btc += today[t].btc; h.raised += today[t].raised; h.days += today[t].elig > 0 ? 1 : 0;
    out.by[t] = h; out.btc += h.btc; out.raised += h.raised;
  }
  return out;
};

function renderHead() {
  const tot = totals();
  const px = liveBtc || btcDaily(todayISO());
  big(fmtBTC(tot.btc));
  const todayBtc = T.reduce((a, t) => a + today[t].btc, 0);
  $('change').innerHTML = `<span class="o">≈ ${compactUsd(tot.raised)} raised</span> <span class="when">· worth ${compactUsd(tot.btc * px)} today · ${todayBtc > 0 ? `<span class="pos">+${fmtBTC(todayBtc, 2)} today</span>` : 'no ATM sales today'}</span>`;
  $('tiles').innerHTML = T.map((t) => {
    const x = today[t], par = A[t].atm.par, diff = x.price - par;
    const live = x.state === 'live' || x.state === 'pre' || x.state === 'post';
    const status = x.atPar && live ? '<span class="atm on">ATM open</span>' : x.atPar ? '<span class="atm">At par · market closed</span>' : `<span class="atm off">ATM paused · ${usd(-diff)} below par</span>`;
    return `<div class="tile"><div class="tile-top"><span class="dot" style="background:${A[t].color}"></span><b>${t}</b><span class="muted">${A[t].atm.issuer}</span></div>
      <div class="tile-price">${usd(x.price)}</div>${status}
      <div class="tile-sub">Today <b>${x.btc > 0 ? '+' + fmtBTC(x.btc, 2) : '0 BTC'}</b> · Since launch <b>${fmtBTC(tot.by[t].btc)}</b></div></div>`;
  }).join('');
  const anyLive = T.some((t) => today[t].state === 'live');
  $('badge').textContent = anyLive ? 'Live' : 'Market closed';
  $('badge').classList.toggle('closed', !anyLive);
}

function renderToday() {
  const tot = totals();
  const cell = (t, f) => f(today[t], A[t], tot.by[t]);
  const row = (k, f, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><th scope="row">${k}</th>${T.map((t) => `<td>${cell(t, f)}</td>`).join('')}</tr>`;
  $('today').innerHTML = `
    <thead><tr><th></th>${T.map((t) => `<th><span class="dot" style="background:${A[t].color}"></span>${t}<div class="cs muted">${A[t].atm.issuer}</div></th>`).join('')}</tr></thead>
    <tbody>
      ${row('Price', (x) => usd(x.price))}
      ${row(term('vs. par', 'How far the price is from the $100 par value. The company can only sell new shares at or above par.'), (x, a) => { const d = x.price - a.atm.par; return `<span class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : '−'}${usd(Math.abs(d))}</span>`; })}
      ${row(term('Yield', 'Yearly dividend ÷ current price.', 'dividends'), (x, a) => `${((a.annual / x.price) * 100).toFixed(2)}%`)}
      ${row('Volume today', (x) => `${num(x.vol, 0)} sh`)}
      ${row(term('At or above par', 'Shares that traded at $100 or more today. These are the only ones the company could have sold.'), (x) => (x.vol ? `${num(x.elig, 0)} sh <div class="cs muted">${Math.round((x.elig / x.vol) * 100)}% of volume</div>` : '—'))}
      ${row('Est. sold by company', (x) => (x.raised ? compactUsd(x.raised) : '$0'))}
      ${row('Est. bitcoin today', (x) => (x.btc ? `<span class="pos">+${fmtBTC(x.btc, 2)}</span>` : '0 BTC'))}
      ${row('Days ATM open', (x, a, h) => `${h.days}`)}
      ${row('Est. raised since launch', (x, a, h) => compactUsd(h.raised))}
      ${row('Est. bitcoin since launch', (x, a, h) => fmtBTC(h.btc), 'total')}
    </tbody>`;
}

/** Cumulative estimated BTC per fund on one shared timeline. */
function cumulative() {
  const start = T.map((t) => hist[t][0]?.d).filter(Boolean).sort()[0];
  const maps = Object.fromEntries(T.map((t) => [t, new Map(hist[t].map((r) => [r.d, r.btc]))]));
  const rows = [];
  const run = Object.fromEntries(T.map((t) => [t, 0]));
  for (let d = start; d <= todayISO(); d = addDays(d, 1)) {
    for (const t of T) run[t] += maps[t].get(d) || 0;
    if (d === todayISO()) for (const t of T) run[t] += today[t].btc;
    rows.push({ d, ...run, total: T.reduce((a, t) => a + run[t], 0) });
  }
  return rows;
}

function drawHistory() {
  let rows = cumulative();
  const days = { '3M': 91, '6M': 182, '1Y': 365 }[histRange];
  if (days) rows = rows.filter((r) => r.d >= addDays(todayISO(), -days));
  const [t1, t2] = T;
  const base = rows[0];
  const head = (r) => {
    histBig(fmtBTC(r.total), true);
    const added = r.total - base.total;
    $('hist-change').innerHTML = `${T.map((t) => `<span class="dot" style="background:${A[t].color}"></span> ${t} ${fmtBTC(r[t])}`).join('&nbsp;&nbsp;')} <span class="when">· ${prettyDate(r.d)}${histRange !== 'ALL' ? ` · +${fmtBTC(added)} in this period` : ''}</span>`;
  };
  head(rows.at(-1));
  $('hist-legend').innerHTML = T.map((t) => `<span><i class="sw" style="background:${A[t].color}"></i>${A[t].plain_name || t} (${t})</span>`).join('');
  const drawIn = drawInFor(histChart, animateHist); animateHist = false;
  histChart?.destroy();
  // stacked look: the lower fund fills to the axis, the total fills down to it
  histChart = lineChart($('hist'), {
    labels: rows.map((r) => r.d),
    datasets: [
      { label: t2, data: rows.map((r) => r[t2] || 0), color: A[t2]?.color || css('--muted'), width: 1.5, order: 2, fill: { target: 'origin', above: rgba(A[t2]?.color || '#888888', 0.35) } },
      { label: 'Total', data: rows.map((r) => r.total), color: A[t1].color, order: 1, fill: { target: 0, above: rgba(A[t1].color, 0.3) } },
    ],
    drawIn, pulse: 1,
    yRange: { min: 0 },
    dateLabel: (i) => prettyDate(rows[i].d),
    onScrub: (i) => head(i == null ? rows.at(-1) : rows[i]),
  });
}

function drawDaily() {
  const days = [...new Set(T.flatMap((t) => hist[t].filter((r) => r.btc > 0).map((r) => r.d)))].sort();
  if (T.some((t) => today[t].btc > 0)) days.push(todayISO());
  const val = (t, d) => (d === todayISO() ? today[t].btc : hist[t].find((r) => r.d === d)?.btc || 0);
  dailyChart?.destroy();
  dailyChart = new Chart($('daily'), {
    type: 'bar',
    data: { labels: days, datasets: T.map((t) => ({ label: t, data: days.map((d) => val(t, d)), backgroundColor: A[t].color, borderRadius: 2, maxBarThickness: 14, stack: 's' })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: reduceMotion ? false : { duration: 700, delay: (c) => (c.type === 'data' && c.mode === 'default' ? c.dataIndex * 6 : 0) },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: css('--muted'), maxTicksLimit: 6, maxRotation: 0, font: { family: css('--font'), size: 11 }, callback: (_, i) => prettyDate(days[i]).replace(/ \d+,/, '') } },
        y: { stacked: true, display: false, beginAtZero: true },
      },
      onHover: (_e, els) => {
        if (!els.length) { $('daily-tl').innerHTML = dailyDefault(days.length); return; }
        const d = days[els[0].index];
        $('daily-tl').innerHTML = `<b>${prettyDate(d)}</b> · ${T.map((t) => `${t} ${fmtBTC(val(t, d), 1)}`).join(' · ')}`;
      },
    },
  });
  $('daily').onmouseleave = () => { $('daily-tl').innerHTML = dailyDefault(days.length); };
  $('daily-tl').innerHTML = dailyDefault(days.length);
}
/* ================= expandable table: every day the ATM stacked bitcoin ================= */
let daysOpen = false;
const DAYS_SHOWN = 8;
function renderDaysTable() {
  const byDay = new Map();
  for (const t of T) for (const r of hist[t]) if (r.btc > 0) {
    const row = byDay.get(r.d) || { d: r.d, raised: 0, total: 0 };
    row[t] = r.btc; row.raised += r.raised; row.total += r.btc;
    byDay.set(r.d, row);
  }
  if (T.some((t) => today[t].btc > 0)) {
    const d = sessionInfo().date, row = { d, raised: 0, total: 0, today: true };
    for (const t of T) { row[t] = today[t].btc; row.raised += today[t].raised; row.total += today[t].btc; }
    byDay.set(d, row);
  }
  const rows = [...byDay.values()].sort((a, b) => b.d.localeCompare(a.d)); // newest first
  const shown = daysOpen ? rows : rows.slice(0, DAYS_SHOWN);
  const b = (v) => (v ? num(v, v >= 100 ? 0 : 1) : '<span class="muted">—</span>');
  $('days').innerHTML = `
    <thead><tr><th>Day</th>${T.map((t) => `<th><span class="dot" style="background:${A[t].color}"></span>${t}</th>`).join('')}<th>Total</th><th class="opt">Raised</th><th class="opt">Bitcoin price</th></tr></thead>
    <tbody>${shown.map((r) => `<tr><th scope="row">${prettyDate(r.d)}${r.today ? ' <span class="o">today</span>' : ''}</th>${T.map((t) => `<td>${b(r[t])}</td>`).join('')}<td><b>${num(r.total, r.total >= 100 ? 0 : 1)} BTC</b></td><td class="opt">${compactUsd(r.raised)}</td><td class="opt">${usd0(r.today ? liveBtc || btcDaily(r.d) : btcDaily(r.d))}</td></tr>`).join('')}</tbody>
    ${daysOpen && rows.length ? `<tfoot><tr><th scope="row">All ${rows.length} days</th>${T.map((t) => `<td>${num(rows.reduce((a, r) => a + (r[t] || 0), 0), 0)}</td>`).join('')}<td><b>${num(rows.reduce((a, r) => a + r.total, 0), 0)} BTC</b></td><td class="opt">${compactUsd(rows.reduce((a, r) => a + r.raised, 0))}</td><td class="opt"></td></tr></tfoot>` : ''}`;
  const btn = $('days-more');
  btn.hidden = rows.length <= DAYS_SHOWN;
  btn.textContent = daysOpen ? 'Show fewer' : `Show all ${rows.length} days`;
  btn.setAttribute('aria-expanded', daysOpen);
}

const dailyDefault = (n) => `${n} trading days with the ATM open. Hover a bar for the details.`;

/* ================= coins ================= */
function niceUnit(total) {
  const raw = total / 60, p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((u) => u >= raw) || p * 10;
}
/** Replays every past ATM day as coins dropping onto each fund's pile, with the total counting up. */
function replay() {
  const tot = totals();
  const unit = niceUnit(tot.btc);
  stack.setUnit(unit); stack.reset();
  $('stack-unit').textContent = `Each coin ≈ ${num(unit, 0)} BTC`;
  const events = [];
  for (const t of T) {
    let run = 0, dropped = 0;
    const list = [...hist[t], { d: todayISO(), btc: today[t].btc }];
    for (const r of list) { run += r.btc; while (Math.floor(run / unit) > dropped) { dropped++; events.push({ t, d: r.d }); } }
  }
  events.sort((a, b) => a.d.localeCompare(b.d));
  stack.setLabels(Object.fromEntries(T.map((t) => [t, { count: events.filter((e) => e.t === t).length, exact: tot.by[t].btc }])));
  if (reduceMotion) { const c = {}; for (const e of events) c[e.t] = (c[e.t] || 0) + 1; stack.fill(c); return; }
  const span = 3200, gap = events.length ? span / events.length : 0;
  events.forEach((e, i) => stack.drop(e.t, i * gap));
}

/* ================= live loop ================= */
let lastToday = {};
function recompute(fromPoll = false) {
  for (const t of T) today[t] = todayEstimate(t);
  renderHead();
  renderToday();
  renderTodayReadout();
  if (fromPoll && !preview) {
    // new at-par volume → coins fall into today's jar (and sparkle on the since-launch heap)
    for (const t of T) {
      const prev = lastToday[t]?.btc ?? today[t].btc, d = today[t].btc - prev;
      if (d > 0.0005) { jar.add(t, d, prev); celebrate(t, d); stack.sparkle(t, `+${num(d, 2)} BTC`); }
    }
    checkOver9000(Math.floor(T.reduce((a, t) => a + today[t].btc, 0) * 100));
    drawPerMinute();
    renderDaysTable();
  }
  lastToday = Object.fromEntries(T.map((t) => [t, { ...today[t] }]));
}

(async () => {
  try {
    data = await loadData();
    A = incomeAssets(data);
    T = Object.keys(A).filter((t) => A[t].atm);
    btcDaily = priceLookup(data.series.BTC.prices);
    const [p, q, b] = await Promise.all([liveBTC(), liveQuotes(LIVE_QUOTES_URL), intraday(LIVE_QUOTES_URL, 'today', [...T, 'BTC'])]);
    liveBtc = p; quotes = q; bars = b;
    for (const t of T) hist[t] = history(t);
    stack.init();
    jar.init();
    recompute();
    // a typical ATM day sets the coin size, so a normal day fills the jar nicely
        jar.set(Object.fromEntries(T.map((t) => [t, today[t].btc])), { animate: true });
    drawPerMinute();
    $('preview').onclick = runPreview;
    drawHistory();
    drawDaily();
    renderDaysTable();
    $('days-more').onclick = () => {
      daysOpen = !daysOpen;
      renderDaysTable();
      if (!daysOpen) $('days').scrollIntoView({ block: 'nearest' });
    };
    replay();
    $('replay').onclick = replay;
    $('filings').innerHTML = T.map((t) => `<a class="o" href="${A[t].atm.filings_url}" target="_blank" rel="noopener">${A[t].atm.filings_label}</a>`).join(' and ');
    $('total-lbl').innerHTML = term('Estimated bitcoin bought since launch', 'Our estimate of the bitcoin bought with money raised by selling these preferreds at the market. The real totals are in the companies\' SEC filings.');
    rangeBar($('hist-range'), [['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['ALL', 'All']], histRange, (r) => { histRange = r; animateHist = true; drawHistory(); });
    $('part').oninput = (e) => {
      const v = Math.max(1, Math.min(100, +e.target.value || 45));
      part = v / 100; $('part-word').textContent = v + '%';
      for (const t of T) hist[t] = history(t);
      recompute(); drawHistory(); drawDaily(); renderDaysTable(); replay();
    };
    revealSections();
    // poll: every 15s while the market is open, every minute otherwise; paused in background tabs
    let timer;
    const poll = async () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const [p2, q2, b2] = await Promise.all([liveBTC(), liveQuotes(LIVE_QUOTES_URL), intraday(LIVE_QUOTES_URL, 'today', [...T, 'BTC'])]);
      if (p2) liveBtc = p2; if (q2) quotes = q2; if (b2) bars = b2;
      recompute(true);
      timer = setTimeout(poll, quotes?.open && quotes.open !== 'closed' ? 15_000 : 60_000);
    };
    timer = setTimeout(poll, 15_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  } catch (err) {
    $('change').textContent = 'Could not load data. Please refresh the page.';
    console.error(err);
  }
})();
onTheme(() => { if (data) { drawHistory(); drawDaily(); drawPerMinute(); stack.fill({}); replay(); } });

/* ================= preview: what an open ATM looks like ================= */
function runPreview() {
  if (preview) return;
  const fake = Object.fromEntries(T.map((t) => [t, 0]));
  preview = { t0: performance.now(), n: 0 };
  over9000Shown = false;
  $('preview').disabled = true;
  fx.paused(false);
  $('today-sub').innerHTML = '<b class="o">Preview</b> · made-up numbers, not real data';
  jar.set(fake);
  const step = () => {
    const el = performance.now() - preview.t0;
    if (el > 16000) {
      preview = null; $('preview').disabled = false;
      over9000Shown = T.reduce((a, t) => a + today[t].btc, 0) * 100 > 9000; // don't re-fire for real data
      jar.set(Object.fromEntries(T.map((t) => [t, today[t].btc])));
      renderTodayReadout();
      return;
    }
    const t = Math.random() < 0.7 ? T[0] : T[1] || T[0];
    preview.n++;
    // every so often, a big buy or a mega buy
    const d = preview.n % 9 === 0 ? 30 + Math.random() * 15 : preview.n % 4 === 0 ? 6 + Math.random() * 4 : 0.3 + Math.random() * 2.7;
    jar.add(t, d, fake[t]); celebrate(t, d); fake[t] += d;
    checkOver9000(Math.floor(Object.values(fake).reduce((a, b) => a + b, 0) * 100));
    const sum = Object.values(fake).reduce((a, b) => a + b, 0);
    todayBig(`+${num(sum, sum >= 100 ? 2 : 4)} BTC`);
    $('today-split').innerHTML = T.map((x) => `<span><i class="dot" style="background:${A[x].color}"></i>${x} ${num(fake[x], 1)}</span>`).join('');
    setTimeout(step, 260 + Math.random() * 420);
  };
  step();
}
