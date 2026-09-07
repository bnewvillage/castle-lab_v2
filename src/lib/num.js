// ─────────────────────────────────────────────────────────────
// NUMBERS IN, NUMBERS OUT
// One parser and one formatter for every user-, Excel- and DB-supplied
// number in the app.
//
// The rule, everywhere: blank and non-numeric are null; 0 is a real value.
// Before this module each screen carried its own `pf` (NaN when blank) or
// `toNum` (null when blank), so callers had to remember which flavour they
// were holding — which is exactly how zero costs and not-for-sale prices
// ended up being silently discarded.
// ─────────────────────────────────────────────────────────────

// Excel formats 1185 as "1,185.00", so separators are stripped before parsing.
export function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// "Did the user actually put a number here?" — true for 0, false for ''.
export const hasNum = (v) => toNum(v) !== null;

// Rounds to `dp` decimals, preserving null. Prices are stored to 2dp.
export const round = (v, dp = 2) => {
  const n = toNum(v);
  return n === null ? null : parseFloat(n.toFixed(dp));
};

/**
 * Currency display. Renders an em dash for a genuinely absent value and
 * "AED 0" for a real zero — the distinction the truthy checks used to lose.
 *
 * `decimals` omitted  → locale default ("AED 1,234.5")
 * `decimals` given    → fixed ("AED 1,234.50")
 */
export function money(v, currency, decimals) {
  const n = toNum(v);
  if (n === null) return '—';
  const body = decimals == null
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency ? `${currency} ${body}` : body;
}
