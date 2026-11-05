// ─────────────────────────────────────────────────────────────
// PRICE BASES — what an item's UAE price is worked out from (CONTEXT.md).
// Stored in pricing_master.price_used; the database's check constraint lists
// the same values. Screens, imports and the price builders all read this list
// rather than naming bases one by one.
//
//   value          the stored price_used
//   label, short   how screens name it, in full and compact (Brands)
//   source         'msrp'  a vendor MSRP after the brand markup
//                  'exw'   the EXW cost at a target margin
//                  'landed' the landed cost at a target margin
//   msrp, currency for an MSRP basis, the fields holding the price and currency
//   paste          offered where only primary MSRPs are entered (paste import,
//                  Bulk Update)
//   defaultMargin  for a cost basis, the target margin a blank stands for
//   inputs         the fields whose change reprices an item on this basis
//   describe       how the UAE price is made, for the form
//   marginRule     what the target margin applies to, for the form
// ─────────────────────────────────────────────────────────────
import { toNum } from './num';

const msrp = (value, label, short, field, currency, paste) => ({
  value, label, short, source: 'msrp', msrp: field, currency, paste,
  inputs: [field, currency], describe: 'brand markup applied',
});

const COST_INPUTS = ['exw_cost', 'cost_currency', 'target_margin_pct'];

export const PRICE_BASES = [
  msrp('primary_ex_vat',    'Primary w/o VAT',   'Pri ex VAT',  'msrp_primary_ex_vat',    'msrp_primary_currency',   true),
  msrp('primary_inc_vat',   'Primary w/ VAT',    'Pri inc VAT', 'msrp_primary_inc_vat',   'msrp_primary_currency',   true),
  msrp('secondary_ex_vat',  'Secondary w/o VAT', 'Sec ex VAT',  'msrp_secondary_ex_vat',  'msrp_secondary_currency', false),
  msrp('secondary_inc_vat', 'Secondary w/ VAT',  'Sec inc VAT', 'msrp_secondary_inc_vat', 'msrp_secondary_currency', false),
  { value: 'cost_based', label: 'Cost + margin', short: 'Cost based', source: 'exw', paste: true,
    defaultMargin: 45, inputs: COST_INPUTS,
    describe: 'derived from cost at target margin',
    marginRule: 'Price = EXW cost in AED ÷ (1 − margin) · shipping & customs excluded' },
  { value: 'landed_cost_based', label: 'Landed cost + margin', short: 'Landed cost', source: 'landed', paste: true,
    defaultMargin: 40, inputs: [...COST_INPUTS, 'shipping_rate', 'customs_duty_rate'],
    describe: 'derived from landed cost at target margin',
    marginRule: 'Price = landed cost in AED (EXW + shipping, + customs) ÷ (1 − margin) · reprices when shipping or customs change' },
];

export const PRICE_BASIS        = Object.fromEntries(PRICE_BASES.map(b => [b.value, b]));
export const PRICE_BASIS_VALUES = PRICE_BASES.map(b => b.value);
export const PASTE_BASIS_VALUES = PRICE_BASES.filter(b => b.paste).map(b => b.value);

/** Priced from a cost at a target margin rather than a vendor MSRP. */
export const isCostPriced = (value) => { const s = PRICE_BASIS[value]?.source; return s === 'exw' || s === 'landed'; };

/** The field a basis needs filled before it can be chosen. */
export const basisNeeds = (b) => b.msrp ?? 'exw_cost';

/** The target margin a cost-priced row is priced at: its own, or its basis default. */
export const targetMargin = (item) => toNum(item.target_margin_pct) ?? PRICE_BASIS[item.price_used]?.defaultMargin ?? null;

/**
 * The MSRP a row is priced from, as { value, currency }; nulls for a cost basis.
 * Form state, an Excel row and a database record share the field names, and
 * toNum takes strings and numbers alike, so every caller uses this one.
 */
export function basisPrice(item) {
  const b = PRICE_BASIS[item.price_used];
  if (!b?.msrp) return { value: null, currency: null };
  return { value: toNum(item[b.msrp]), currency: item[b.currency] || null };
}
