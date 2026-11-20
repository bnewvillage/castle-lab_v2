// ─────────────────────────────────────────────────────────────
// CURRENCIES — every currency the app can cost or price in is a row in
// exchange_rates (the item currency columns are foreign keys to it). Screens
// offer that list rather than a fixed one, so adding a currency on the
// Currencies page is all it takes to use it.
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { fetchRates } from './db';
import { toNum } from './num';

/** The currencies a rates map covers, A to Z. */
export const currencyCodes = (rates) => Object.keys(rates).sort();

// One shared list for every mounted screen, loaded once and reloaded when the
// Currencies page changes the table.
let current = [];
let loading = null;
const listeners = new Set();

export function reloadCurrencies() {
  loading = fetchRates()
    .then(rates => { current = currencyCodes(rates); listeners.forEach(set => set(current)); })
    .catch(() => { loading = null; });   // the next screen to mount tries again
  return loading;
}

/** Every currency in exchange_rates, A to Z; empty until the first load. */
export function useCurrencies() {
  const [list, setList] = useState(current);
  useEffect(() => {
    listeners.add(setList);
    if (!loading) reloadCurrencies();
    return () => { listeners.delete(setList); };
  }, []);
  return list;
}

/** Why a new currency can't be added, or null when it can. */
export function newCurrencyProblem(code, rate, existing) {
  if (!/^[A-Z]{3}$/.test(code)) return 'A currency code is three letters, like SGD.';
  if (existing.includes(code))  return `${code} is already in the list.`;
  return rateProblem(rate);
}

/** Why a rate to AED can't be saved, or null when it can. */
export function rateProblem(rate) {
  const r = toNum(rate);
  return r != null && r > 0 ? null : 'The rate is how many AED one unit buys, and must be above 0.';
}

/** A rate's change as a percentage of the old one: 2.80 → 2.83 is about +1.1. */
export const rateChangePct = (from, to) => {
  const a = toNum(from), b = toNum(to);
  return a > 0 && b > 0 ? ((b - a) / a) * 100 : null;
};
