// ─────────────────────────────────────────────────────────────
// VENDOR VAT — filling an MSRP pair
// A vendor's MSRP comes with or without its local VAT. Typing the VAT % fills
// whichever side is empty, so neither has to be worked out by hand. The VAT is
// typed each time and never stored: it can't be inferred from currency or
// brand (one brand can buy from suppliers in different countries), and the
// stored pair already carries it.
// ─────────────────────────────────────────────────────────────
import { toNum, round } from './num';

// A VAT % as a rate: 19 → 0.19. Null when blank or not a sensible VAT.
export function vatRate(pct) {
  const v = toNum(pct);
  return v != null && v >= 0 && v < 100 ? v / 100 : null;
}

/**
 * Fills the empty side of an MSRP pair from the VAT %, to 2 decimals. A side
 * that was given is never changed: when both are given and they disagree with
 * the VAT %, that is flagged instead.
 * @returns {{ ex, inc, filled: 'ex' | 'inc' | null, mismatch: boolean }}
 */
export function fillVatPair(ex, inc, vatPct) {
  const e = toNum(ex), i = toNum(inc), v = vatRate(vatPct);
  if (v == null) return { ex: e, inc: i, filled: null, mismatch: false };
  if (e != null && i == null) return { ex: e, inc: round(e * (1 + v)), filled: 'inc', mismatch: false };
  if (i != null && e == null) return { ex: round(i / (1 + v)), inc: i, filled: 'ex', mismatch: false };
  return { ex: e, inc: i, filled: null, mismatch: e != null && Math.abs(round(e * (1 + v)) - i) > 0.01 };
}

// The VAT % a stored pair implies, to 2 decimals: 400 / 476 → 19.
export function vatFromPair(ex, inc) {
  const e = toNum(ex), i = toNum(inc);
  return e > 0 && i > 0 ? round((i / e - 1) * 100, 2) : null;
}
