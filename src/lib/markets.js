// ─────────────────────────────────────────────────────────────
// MARKETS — the one definition of every market the app prices.
//
// UAE is priced from the item's source; every other market is DERIVED from the
// rounded UAE price ex-VAT. Each entry carries everything a screen, query,
// export or history table needs, so they all loop over this list rather than
// naming markets one by one. A new market is one entry here (plus its columns
// in the database).
//
//   key        column suffix: msrp_<key>, real_msrp_<key>, old/new_msrp_<key>
//   code       override flag and margin prefix: <code>_overridden, <code>_margin
//   short      the label on screens (UAE / KSA / QAT / KWT)
//   vat        the shelf price is stored ÷ this (1 = no VAT)
//   dp         decimals a stored price is kept to
//   step       the smallest shelf-price step, for showing a stored price as
//              the shelf price it came from
//   rate       exchange_rates currency for margins, and the fallback if absent
//              (none for UAE: its prices are AED already)
//   report     the ERP price-list report the Price Export reads
//   recalcOp   price-history type of its "recalculate from UAE" run, if it has one
//   derive     (UAE ex-VAT) → this market's stored price, rounded on its ladder
// ─────────────────────────────────────────────────────────────
import { round } from './num';
import { prettifyShelf, prettifyKwd } from './shelfRounding';

// KSA: the UAE price ex-VAT converted to SAR — no market premium. 1 AED is
// 1.0211 SAR (both pegged to the dollar, 3.6725 and 3.75), taken as 1.02.
// Changed from 1.03 on 2026-10-21.
export const KSA_FACTOR = 1.02;
// Qatar: UAE ex-VAT × 1.01. No VAT, so shelf and stored agree.
export const QAT_FACTOR = 1.01;
// Kuwait: the UAE price ex-VAT converted to KWD — no premium, no VAT. The dinar
// is pegged to a basket, not the dollar, so this is a FIXED factor (about
// 0.0835 at the market in Oct 2026; 0.084 is ~0.6% above it), reviewed by hand.
export const KWD_FACTOR = 0.084;

export const suggestKSAPrice = (aed) => (aed == null ? null : prettifyShelf(aed * KSA_FACTOR * 1.15) / 1.15);
export const suggestQATPrice = (aed) => (aed == null ? null : prettifyShelf(aed * QAT_FACTOR));
export const suggestKWDPrice = (aed) => (aed == null ? null : prettifyKwd(aed * KWD_FACTOR));

const market = (m) => ({
  ...m,
  price: `msrp_${m.key}`,
  real:  `real_msrp_${m.key}`,
  flag:  `${m.code}_overridden`,
  margin: `${m.code}_margin`,
});

export const MARKETS = [
  market({ key: 'aed', code: 'uae', short: 'UAE', label: 'UAE',    currency: 'AED', vat: 1.05, dp: 2, step: 0.05,
           rate: null,                                        report: 'PRICE-AED_ValidFromLatest' }),
  market({ key: 'sar', code: 'ksa', short: 'KSA', label: 'KSA',    currency: 'SAR', vat: 1.15, dp: 2, step: 0.05,
           rate: { currency: 'SAR', fallback: 0.98 },         report: 'PRICE-SAR_ValidFromLatest', recalcOp: 'ksa_recalc',
           derive: suggestKSAPrice, factor: KSA_FACTOR, rule: `UAE ex-VAT × ${KSA_FACTOR} (to SAR) × 1.15 VAT` }),
  market({ key: 'qat', code: 'qat', short: 'QAT', label: 'Qatar',  currency: 'QAR', vat: 1,    dp: 2, step: 0.05,
           rate: { currency: 'QAR', fallback: 1.01 },         report: 'PRICE-QAR_ValidFromLatest',
           derive: suggestQATPrice, factor: QAT_FACTOR, rule: `UAE ex-VAT × ${QAT_FACTOR} · no VAT` }),
  market({ key: 'kwd', code: 'kwd', short: 'KWT', label: 'Kuwait', currency: 'KWD', vat: 1,    dp: 3, step: 0.001,
           rate: { currency: 'KWD', fallback: 1 / KWD_FACTOR }, report: 'PRICE-KWD_ValidFromLatest', recalcOp: 'kwd_recalc',
           derive: suggestKWDPrice, factor: KWD_FACTOR, rule: `UAE ex-VAT × ${KWD_FACTOR} (to KWD) · Kuwait rounding · no VAT` }),
];

export const UAE     = MARKETS[0];
export const DERIVED = MARKETS.filter(m => m.derive);
export const MARKET  = Object.fromEntries(MARKETS.map(m => [m.key, m]));
// "UAE, KSA, Qatar and Kuwait", for copy.
export const MARKETS_IN_WORDS = `${MARKETS.slice(0, -1).map(m => m.label).join(', ')} and ${MARKETS[MARKETS.length - 1].label}`;

// Database columns, for queries that read or write prices.
export const PRICE_COLUMNS   = MARKETS.map(m => m.price);
export const REAL_COLUMNS    = MARKETS.map(m => m.real);
export const FLAG_COLUMNS    = MARKETS.map(m => m.flag);
export const HISTORY_COLUMNS = MARKETS.flatMap(m => [`old_${m.price}`, `new_${m.price}`]);

/** A derived market's stored price from a UAE price ex-VAT, at its decimals. */
export const deriveMarket = (m, aedExVat) => (aedExVat == null ? null : round(m.derive(aedExVat), m.dp));

/**
 * Every derived market's price from one UAE price ex-VAT, keyed by column
 * ('price' → msrp_sar…, 'real' → real_msrp_sar…). With `keep`, a market whose
 * override flag is set keeps the price `keep` already has.
 */
export function deriveMarkets(aedExVat, { column = 'price', keep = null } = {}) {
  return Object.fromEntries(DERIVED.map(m => [
    m[column],
    keep?.[m.flag] ? keep[m[column]] : deriveMarket(m, aedExVat),
  ]));
}

/** The Rollback label of a market's recalculation run (its recalcOp). */
export const recalcLabel = (m) => `${m.label} Recalculation`;

/** A stored price shown as the shelf price it came from. */
export const shelfOf = (m, stored) =>
  stored == null ? null : round(Math.round((Number(stored) * m.vat) / m.step) * m.step, m.dp);
