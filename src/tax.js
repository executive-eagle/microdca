// Rough US federal tax estimates (plus optional flat state and city rates). Educational only.
// Simplifications: one marginal bracket, no 3.8% NIIT, no AMT, non-ROC payouts treated as ordinary income.
import { term } from './common.js';

export const BRACKETS = [10, 12, 22, 24, 32, 35, 37];
/** Long-term capital gains rate that roughly lines up with each ordinary bracket. */
export const ltcgFor = (b) => (b <= 12 ? 0 : b >= 37 ? 20 : 15);

const KEY = 'microdca-tax';
let settings = { bracket: 22, state: 0, city: 0 };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}

export const taxRates = () => {
  const state = settings.state || 0, city = settings.city || 0;
  const local = (state + city) / 100;
  // "at your 22% bracket + 4% state + 3.9% city"
  const label = `${settings.bracket}% bracket${state ? ` + ${state}% state` : ''}${city ? ` + ${city}% city` : ''}`;
  return { bracket: settings.bracket, ordinary: settings.bracket / 100 + local, longTerm: ltcgFor(settings.bracket) / 100 + local, state, city, label };
};

/** Renders the bracket + state inputs into `el`; calls onChange when either changes. */
export function taxControls(el, onChange) {
  el.innerHTML = `
    <div class="prow"><label for="tax-bracket">${term('Your tax bracket', 'Your federal income tax bracket (the rate on your last dollar of income). Single filers earning roughly $50k–$105k a year are usually in the 22% bracket. Check last year\'s return if you\'re not sure.', 'taxes')}</label>
      <select class="field ctl" id="tax-bracket">${BRACKETS.map((b) => `<option value="${b}" ${b === settings.bracket ? 'selected' : ''}>${b}%${b === 22 ? ' (common)' : ''}</option>`).join('')}</select></div>
    <div class="prow"><label for="tax-state">${term('State tax', 'Your state income tax rate, if any. Some states (like Texas and Florida) have none.', 'taxes')}</label>
      <div class="ctl pct-in"><input class="field" id="tax-state" type="number" inputmode="decimal" min="0" max="15" step="0.5" value="${settings.state || 0}" /></div></div>
    <div class="prow"><label for="tax-city">${term('City tax', 'Your city or local income tax rate, if it taxes investment income. Most cities don\'t. Some do, like New York City. Leave it at 0 if yours doesn\'t.', 'taxes')}</label>
      <div class="ctl pct-in"><input class="field" id="tax-city" type="number" inputmode="decimal" min="0" max="10" step="0.1" value="${settings.city || 0}" /></div></div>`;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} onChange(); };
  el.querySelector('#tax-bracket').onchange = (e) => { settings.bracket = +e.target.value; save(); };
  el.querySelector('#tax-state').oninput = (e) => { settings.state = Math.max(0, Math.min(15, +e.target.value || 0)); save(); };
  el.querySelector('#tax-city').oninput = (e) => { settings.city = Math.max(0, Math.min(10, +e.target.value || 0)); save(); };
}

export const US_NOTE = 'US federal estimate (plus your state and city rates) for US residents. Tax rules are different in other countries. This is an educational estimate, not tax advice: talk to a tax professional.';
