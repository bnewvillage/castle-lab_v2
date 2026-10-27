// ─────────────────────────────────────────────────────────────
// ROW SHAPES
// What a pricing_master or project_items save writes, shared by the live and
// demo data layers so both store exactly the same row. Every market's columns
// come from markets.js. The caller adds its own updated_at / updated_by.
// ─────────────────────────────────────────────────────────────
import { toNum } from './num';
import { MARKETS, UAE, DERIVED, PRICE_COLUMNS, REAL_COLUMNS, FLAG_COLUMNS, HISTORY_COLUMNS } from './markets';

// Project items live in their own table under this code prefix: PRJT-….
export const PROJECT_BRAND = 'PRJT';

const numbers = (item, columns) => Object.fromEntries(columns.map(c => [c, toNum(item[c])]));
const flags   = (item) => Object.fromEntries(FLAG_COLUMNS.map(c => [c, !!item[c]]));

export function itemRow(item) {
  return {
    item_code:                item.item_code?.toUpperCase(),
    item_name:                item.item_name,
    brand_code:               item.brand_code,
    barcode:                  item.barcode || null,
    cost_currency:            item.cost_currency,
    exw_cost:                 toNum(item.exw_cost),
    shipping_rate:            toNum(item.shipping_rate) ?? 0,
    customs_duty_rate:        toNum(item.customs_duty_rate) ?? 5.5,
    msrp_primary_ex_vat:      toNum(item.msrp_primary_ex_vat),
    msrp_primary_inc_vat:     toNum(item.msrp_primary_inc_vat),
    msrp_primary_currency:    item.msrp_primary_currency || null,
    msrp_secondary_ex_vat:    toNum(item.msrp_secondary_ex_vat),
    msrp_secondary_inc_vat:   toNum(item.msrp_secondary_inc_vat),
    msrp_secondary_currency:  item.msrp_secondary_currency || null,
    price_used:               item.price_used || null,
    target_margin_pct:        toNum(item.target_margin_pct),
    price_source:             item.price_source || null,
    ...numbers(item, [...PRICE_COLUMNS, ...REAL_COLUMNS]),
    ...flags(item),
    cost_source:              item.cost_source || null,
  };
}

// Project items carry UAE as inc- and ex-VAT prices, and no base prices.
export function projectItemRow(item) {
  return {
    item_code:         item.item_code?.toUpperCase(),
    project_item_name: item.project_item_name || null,
    cost:              toNum(item.cost),
    cost_currency:     item.cost_currency,
    shipping_rate:     toNum(item.shipping_rate) ?? 0,
    customs_duty_rate: toNum(item.customs_duty_rate) ?? 5.5,
    target_margin_pct: toNum(item.target_margin_pct) ?? 25,
    msrp_aed_inc_vat:  toNum(item.msrp_aed_inc_vat),
    msrp_aed_ex_vat:   toNum(item.msrp_aed_ex_vat),
    ...numbers(item, DERIVED.map(m => m.price)),
    ...flags(item),
  };
}

// A project item in the shape of a catalogue price row (brand, barcode,
// msrp_<market>), so it can be matched against an ERP price list. Its UAE
// price is the ex-VAT one, as msrp_aed is.
export const projectAsItem = (p) => ({
  item_code:  p.item_code,
  item_name:  p.project_item_name,
  brand_code: PROJECT_BRAND,
  barcode:    null,
  ...Object.fromEntries(MARKETS.map(m => [m.price, toNum(m === UAE ? p.msrp_aed_ex_vat : p[m.price])])),
});

// Column lists for queries.
export const PRICES_SELECT      = PRICE_COLUMNS.join(', ');
export const FLAGS_SELECT       = FLAG_COLUMNS.join(', ');
export const ALL_PRICES_SELECT  = [...PRICE_COLUMNS, ...REAL_COLUMNS, ...FLAG_COLUMNS].join(', ');
export const HISTORY_SELECT     = HISTORY_COLUMNS.join(', ');

