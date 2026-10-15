// Reads /assets.json (the single place to add or change funds) and normalizes it for the pages.
import raw from '../assets.json';

const ttm = (divs, asOf) => {
  const from = new Date(new Date(asOf).getTime() - 365 * 864e5).toISOString().slice(0, 10);
  return divs.filter(([d]) => d > from && d <= asOf).reduce((s, [, v]) => s + v, 0);
};

export const BITCOIN = raw.bitcoin;
export const LIVE_QUOTES_URL = raw.live_quotes_url || null;
export const PORTFOLIO = {
  startValue: raw.portfolio.start_value,
  inception: raw.portfolio.inception,
  priceDate: raw.portfolio.price_date,
  allocation: raw.portfolio.allocation,
  startPrices: raw.portfolio.start_prices,
};
export const PRESETS = raw.income_presets;
export const PAYOUT_PRESETS = raw.payout_presets || [{ label: 'Reinvest all', buckets: [{ kind: 'same', pct: 100 }] }];
export const GROWTH = raw.growth || [];

/* ---------- tickers a visitor adds on the site (kept in their browser) ---------- */
let CUSTOM = [];
const CUSTOM_COLORS = ['#F472B6', '#A3E635', '#FB923C', '#60A5FA', '#FACC15', '#34D399', '#C084FC', '#F87171'];
export const customColor = (i) => CUSTOM_COLORS[i % CUSTOM_COLORS.length];
export const setCustom = (list) => { CUSTOM = list; };
const everything = () => [raw.bitcoin, ...GROWTH, ...raw.income, ...CUSTOM];

/** Guess a payout schedule from how many payouts happened in the past year. */
export function inferSchedule(divs, asOf) {
  const from = new Date(new Date(asOf).getTime() - 365 * 864e5).toISOString().slice(0, 10);
  const n = divs.filter(([d]) => d > from).length;
  return n >= 150 ? 'daily' : n >= 40 ? 'weekly' : n >= 20 ? 'semimonthly' : n >= 10 ? 'monthly' : n >= 3 ? 'quarterly' : n >= 1 ? 'yearly' : 'none';
}

/** Everything payouts can be routed into: bitcoin, growth assets, and income funds. */
export const buyTargets = (data) => [raw.bitcoin, ...GROWTH, ...raw.income, ...CUSTOM]
  .filter((a) => data.series[a.ticker])
  .map((a) => ({ ticker: a.ticker, name: a.name, color: a.color }));

/** Income assets, with annual dividend resolved ("ttm" uses the downloaded payout history). */
export function incomeAssets(data) {
  return Object.fromEntries([...raw.income, ...CUSTOM].filter((a) => data.series[a.ticker]).map((a) => {
    const divs = data.series[a.ticker].dividends;
    const last = data.series[a.ticker].prices.at(-1)[0];
    const annual = a.annual_dividend === 'ttm' ? ttm(divs, last) : Number(a.annual_dividend);
    return [a.ticker, {
      ...a,
      annual,
      payDay: a.pay_day ?? 15,
      quarterMonths: a.quarter_months ?? [3, 6, 9, 12],
      dailyFrom: a.daily_proposed_from ?? null,
    }];
  }));
}

export const colorOf = (t) => everything().find((a) => a.ticker === t)?.color || '#888';
export const nameOf = (t) => everything().find((a) => a.ticker === t)?.name || t;
export const isCustom = (t) => CUSTOM.some((a) => a.ticker === t);

/** Beginner-friendly name, e.g. "Strategy Stretch" for STRC. */
export const plainName = (t) => { const a = everything().find((x) => x.ticker === t); return a?.plain_name || a?.name || t; };
/** { level: 'lower'|'medium'|'higher'|'unknown', note } — risk relative to the other funds on the site. */
export function riskOf(t) {
  const a = everything().find((x) => x.ticker === t);
  if (!a) return { level: 'unknown', note: '' };
  if (a.ticker === raw.bitcoin.ticker) return { level: 'higher', note: 'Bitcoin\'s price can swing a lot, sometimes 20% or more in a month.' };
  if (CUSTOM.includes(a)) return { level: 'unknown', note: 'You added this one, so MicroDCA hasn\'t rated it.' };
  return { level: a.risk || 'unknown', note: a.risk_note || '' };
}
export const STYLES = raw.simple_styles || [];

/** Is `iso` a scheduled payout date for this asset under its normal schedule? */
export function isPayDay(asset, iso) {
  const day = +iso.slice(8), month = +iso.slice(5, 7);
  const next = new Date(Date.parse(iso + 'T00:00:00Z') + 864e5).toISOString();
  const lastOfMonth = next.slice(8, 10) === '01';
  switch (asset.schedule) {
    case 'daily': return true;
    case 'semimonthly': return day === 15 || lastOfMonth;
    case 'monthly': return day === asset.payDay;
    case 'quarterly': return day === asset.payDay && asset.quarterMonths.includes(month);
    default: return false;
  }
}
