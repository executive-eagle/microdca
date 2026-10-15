// Rough US federal tax estimates (plus an optional flat state rate). Educational only.
// Simplifications: one marginal bracket, no 3.8% NIIT, no AMT, non-ROC payouts treated as ordinary income.
import { term } from './common.js';

export const BRACKETS = [10, 12, 22, 24, 32, 35, 37];
/** Long-term capital gains rate that roughly lines up with each ordinary bracket. */
export const ltcgFor = (b) => (b <= 12 ? 0 : b >= 37 ? 20 : 15);

const KEY = 'microdca-tax';
let settings = { bracket: 22, state: 0 };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}

export const taxRates = () => {
  const st = (settings.state || 0) / 100;
  return { bracket: settings.bracket, ordinary: settings.bracket / 100 + st, longTerm: ltcgFor(settings.bracket) / 100 + st, state: settings.state || 0 };
};

/** Renders the bracket + state inputs into `el`; calls onChange when either changes. */
export function taxControls(el, onChange) {
  el.innerHTML = `
    <div class="prow"><label for="tax-bracket">${term('Your tax bracket', 'Your federal income tax bracket (the rate on your last dollar of income). Single filers earning roughly $50k–$105k a year are usually in the 22% bracket. Check last year\'s return if you\'re not sure.', 'taxes')}</label>
      <select class="field ctl" id="tax-bracket">${BRACKETS.map((b) => `<option value="${b}" ${b === settings.bracket ? 'selected' : ''}>${b}%${b === 22 ? ' (most common)' : ''}</option>`).join('')}</select></div>
    <div class="prow"><label for="tax-state">${term('State tax', 'Your state income tax rate, if any. Some states (like Texas and Florida) have none.', 'taxes')}</label>
      <div class="ctl pct-in"><input class="field" id="tax-state" type="number" inputmode="decimal" min="0" max="15" step="0.5" value="${settings.state || 0}" /></div></div>`;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} onChange(); };
  el.querySelector('#tax-bracket').onchange = (e) => { settings.bracket = +e.target.value; save(); };
  el.querySelector('#tax-state').oninput = (e) => { settings.state = Math.max(0, Math.min(15, +e.target.value || 0)); save(); };
}

export const US_NOTE = 'US federal estimate (plus your state rate) for US residents. Tax rules are different in other countries. This is an educational estimate, not tax advice: talk to a tax professional.';
