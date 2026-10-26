// ─────────────────────────────────────────────────────────────
// PRICING CALCULATIONS
// Source price / cost → UAE price, and every other market from it. Pure.
// The rounding ladders live in shelfRounding.js, the markets in markets.js.
// ─────────────────────────────────────────────────────────────
import { toNum, round } from './num';
import { prettifyShelf } from './shelfRounding';
import { MARKETS, deriveMarkets } from './markets';

// Compound two markups multiplicatively: base% + additional% applied on top
// e.g. compoundMarkup(10, 5) = ((1.10 × 1.05) - 1) × 100 = 15.5%
export function compoundMarkup(base, additional) {
  if (!additional) return base;
  return ((1 + base / 100) * (1 + additional / 100) - 1) * 100;
}

// ── LANDED COST ───────────────────────────────────────────────

/**
 * Fully landed cost in AED
 * exw_cost (vendor currency) × (1 + shipping_rate%) × FX rate × (1 + customs_duty_rate%)
 */
export function calcLandedCost({ exw_cost, shipping_rate, customs_duty_rate, cost_currency }, rates) {
  if (exw_cost == null || exw_cost === '' || !cost_currency || !rates?.[cost_currency]) return null;
  const afterShipping = exw_cost * (1 + (shipping_rate || 0) / 100);
  const inAED = afterShipping * rates[cost_currency];
  return inAED * (1 + (customs_duty_rate ?? 5.5) / 100);
}

// ── PRICE USED RESOLVER ───────────────────────────────────────

/**
 * The MSRP a row is priced from, as { value, currency }.
 *
 * The single implementation for every caller — form state, an Excel row and a
 * database record all use the same field names, and toNum accepts strings and
 * numbers alike, so no caller needs its own copy of this map. `cost_based`
 * rows price from cost rather than a vendor MSRP and resolve to nulls.
 */
export function resolvePriceUsed(item) {
  const map = {
    primary_ex_vat:    [item.msrp_primary_ex_vat,    item.msrp_primary_currency],
    primary_inc_vat:   [item.msrp_primary_inc_vat,   item.msrp_primary_currency],
    secondary_ex_vat:  [item.msrp_secondary_ex_vat,  item.msrp_secondary_currency],
    secondary_inc_vat: [item.msrp_secondary_inc_vat, item.msrp_secondary_currency],
  };
  const [value, currency] = map[item.price_used] ?? [];
  return { value: toNum(value), currency: currency || null };
}

// ── EXW MARGIN ────────────────────────────────────────────────

/**
 * EXW margin — raw vendor price vs raw cost, both converted to AED
 * No markup, no shipping, no customs applied
 *
 * price_used_aed = price_used_value × price_currency_rate
 * cost_aed       = exw_cost × cost_currency_rate
 * exw_margin     = (price_used_aed - cost_aed) / price_used_aed × 100
 */
export function calcEXWMargin(item, rates) {
  if (item.exw_cost == null || !item.cost_currency || !rates?.[item.cost_currency]) return null;
  const { value, currency } = resolvePriceUsed(item);
  if (value == null || !currency || !rates?.[currency]) return null;
  const priceAED = value * rates[currency];
  const costAED  = item.exw_cost * rates[item.cost_currency];
  if (!priceAED || priceAED <= 0) return null;
  return ((priceAED - costAED) / priceAED) * 100;
}

// ── MARGIN ────────────────────────────────────────────────────

/**
 * Generic margin % — both values must be in AED
 * (selling_price_aed - cost_aed) / selling_price_aed × 100
 */
export function calcMargin(sellingPriceAED, costAED) {
  if (sellingPriceAED == null || costAED == null || sellingPriceAED <= 0) return null;
  return ((sellingPriceAED - costAED) / sellingPriceAED) * 100;
}

/**
 * Every market's retail margin on landed cost, plus the EXW margin, keyed
 * <code>_margin (uae_margin, ksa_margin, …). Each market price is converted to
 * AED at its stored rate (UAE is AED already). EXW margin = vendor price vs raw cost, in AED.
 */
export function calcAllMargins(item, rates) {
  const landed = calcLandedCost(item, rates);
  if (landed === null) return null;
  const margins = Object.fromEntries(MARKETS.map(m => {
    const price = toNum(item[m.price]);
    const inAED = !price ? null : m.rate ? price * (rates?.[m.rate.currency] || m.rate.fallback) : price;
    return [m.margin, calcMargin(inAED, landed)];
  }));
  return { landed_cost_aed: landed, ...margins, exw_margin: calcEXWMargin(item, rates) };
}

// ── SUGGESTED PRICES ─────────────────────────────────────────

export const DEFAULT_COST_MARGIN_PCT = 25;

// The unrounded UAE shelf target (VAT-inclusive) for a vendor price after the
// brand markup. Every UAE price is rounded from a target like this, exactly once.
export function baseShelfFromPrice(priceUsedValue, priceCurrency, markupPercentage, rates) {
  if (priceUsedValue == null || !priceCurrency || !rates?.[priceCurrency]) return null;
  const inAED    = priceUsedValue * rates[priceCurrency];
  const markedUp = inAED * (1 + markupPercentage / 100);
  return markedUp * 1.05;
}

// The unrounded UAE shelf target for an EXW cost at a target gross margin.
// Pure EXW basis — no shipping, no customs (unlike calcProjectPrice).
export function baseShelfFromCost(exwCost, costCurrency, targetMarginPct, rates) {
  if (exwCost == null || !costCurrency || !rates?.[costCurrency]) return null;
  const margin = (targetMarginPct ?? DEFAULT_COST_MARGIN_PCT) / 100;
  if (!(margin > 0 && margin < 1)) return null;
  const costAED = exwCost * rates[costCurrency];
  return costAED / (1 - margin) * 1.05;
}

// The unrounded base target a pricing_master row's source implies.
export function itemBaseShelf(item, { markup, rates }) {
  if (item.price_used === 'cost_based') {
    return baseShelfFromCost(toNum(item.exw_cost), item.cost_currency, toNum(item.target_margin_pct), rates);
  }
  const { value, currency } = resolvePriceUsed(item);
  return baseShelfFromPrice(value, currency, markup ?? 10, rates);
}

export function suggestUAEPrice(priceUsedValue, priceCurrency, markupPercentage, rates) {
  const target = baseShelfFromPrice(priceUsedValue, priceCurrency, markupPercentage, rates);
  return target == null ? null : prettifyShelf(target) / 1.05;
}

/**
 * Every market's prices from an unrounded base shelf target.
 *
 *   real_msrp_*  base markup only
 *   msrp_*       with the brand's additional markup — the selling prices
 *
 * Both UAE prices round once, from the unrounded target. The additional markup
 * applies to that target, never to the already-rounded base: rounding down twice
 * would stack, e.g. a 7,598 base + 5% → 7,500 × 1.05 = 7,875 → 7,800 instead of
 * 7,978 → 7,900. Every other market derives from the rounded UAE price.
 */
export function msrpsFromBaseShelf(baseShelf, additionalPct) {
  if (baseShelf == null) return null;
  const real_msrp_aed = round(prettifyShelf(baseShelf) / 1.05, 2);
  const msrp_aed = additionalPct
    ? round(prettifyShelf(baseShelf * (1 + additionalPct / 100)) / 1.05, 2)
    : real_msrp_aed;
  return {
    real_msrp_aed, ...deriveMarkets(real_msrp_aed, { column: 'real' }),
    msrp_aed,      ...deriveMarkets(msrp_aed),
  };
}

// Every price from a vendor price. If additionalMarkupPct is null/0, msrp_* === real_msrp_*.
export function calcMSRPs(priceValue, priceCurrency, baseMarkupPct, additionalMarkupPct, rates) {
  return msrpsFromBaseShelf(baseShelfFromPrice(priceValue, priceCurrency, baseMarkupPct, rates), additionalMarkupPct);
}

// Every price from EXW cost by enforcing a target gross margin.
export function calcCostBasedMSRPs(exwCost, costCurrency, targetMarginPct, rates, additionalMarkupPct = null) {
  return msrpsFromBaseShelf(baseShelfFromCost(exwCost, costCurrency, targetMarginPct, rates), additionalMarkupPct);
}

// An additional markup on a stored, already-rounded base. Only for when the
// unrounded target is unknown — see pricesAtAdditionalMarkup.
export function applyAdditionalMarkupUAE(realMsrpAed, additionalPct) {
  if (!realMsrpAed || !additionalPct) return realMsrpAed;
  return prettifyShelf(realMsrpAed * (1 + additionalPct / 100) * 1.05) / 1.05;
}

/**
 * Selling prices for a stored item at a new additional markup, without
 * repricing it.
 *
 * The markup belongs on the unrounded base target, which is not stored. It is
 * recovered from the item's source when the source, at today's rates and brand
 * markup, still rounds to exactly the stored base — proof nothing has moved.
 * Otherwise the stored base is the anchor and the markup goes on top of it:
 * recomputing from source would apply today's exchange rate as a side effect
 * of a markup change.
 *
 * @returns {{ msrp_aed, msrp_sar, …, fromSource } | null}
 */
export function pricesAtAdditionalMarkup(item, additionalPct, { markup, rates }) {
  const storedBase = toNum(item.real_msrp_aed ?? item.msrp_aed);
  if (!storedBase) return null;
  const target = itemBaseShelf(item, { markup, rates });
  const fromSource = target != null && round(prettifyShelf(target) / 1.05, 2) === round(storedBase, 2);
  const msrp_aed = fromSource
    ? msrpsFromBaseShelf(target, additionalPct).msrp_aed
    : round(applyAdditionalMarkupUAE(storedBase, additionalPct), 2);
  return { msrp_aed, ...deriveMarkets(msrp_aed), fromSource };
}

// ── EMPLOYEE PRICE ────────────────────────────────────────────

export function calcEmployeePrice(item, rates) {
  const landed = calcLandedCost(item, rates);
  if (landed == null) return null;
  return Math.floor(landed * 1.15 * 1.05);
}

// ── FORMAT HELPERS ────────────────────────────────────────────

export function formatMargin(margin) {
  if (margin === null || margin === undefined) return { value: null, label: '—', status: 'null' };
  const rounded = Math.round(margin * 10) / 10;
  const status  = rounded >= 30 ? 'good' : rounded >= 20 ? 'warn' : 'bad';
  return { value: rounded, label: `${rounded.toFixed(1)}%`, status };
}

export const MARGIN_COLORS = {
  good: '#3ecf8e',
  warn: '#f5a623',
  bad:  '#f26464',
  null: '#444444',
};

// ── PROJECT ITEM PRICING ──────────────────────────────────────
export const DEFAULT_PROJECT_MARGIN_PCT = 25;

/**
 * Cost-driven pricing for project items.
 * landed = cost × rate × (1 + ship%) × (1 + duty%)
 * Targets target_margin_pct (default 25%) on landed cost, adds 5% UAE VAT,
 * then prettifies. Unlike calcCostBasedMSRPs this prices off the LANDED cost,
 * so shipping and customs are included in the margin base.
 * Returns { msrp_aed_inc_vat, msrp_aed_ex_vat, landed_cost_aed } or null.
 */
export function calcProjectPrice({ cost, cost_currency, shipping_rate, customs_duty_rate, target_margin_pct }, rates) {
  if (cost == null || cost === '' || !cost_currency || !rates?.[cost_currency]) return null;
  const margin            = (target_margin_pct ?? DEFAULT_PROJECT_MARGIN_PCT) / 100;
  if (!(margin > 0 && margin < 1)) return null;
  const rate              = rates[cost_currency];
  const ship              = (shipping_rate  ?? 0)   / 100;
  const duty              = (customs_duty_rate ?? 5.5) / 100;
  const costExCustomsSrc  = cost * (1 + ship);
  const landedSrc         = costExCustomsSrc * (1 + duty);
  const landedAED         = landedSrc * rate;
  const raw               = landedAED / (1 - margin);   // gross margin target on landed cost
  const incVat            = prettifyShelf(raw * 1.05);
  const exVat             = round(incVat / 1.05, 2);
  return {
    msrp_aed_inc_vat:      round(incVat, 2),
    msrp_aed_ex_vat:       exVat,
    ...deriveMarkets(exVat),
    landed_cost_aed:       round(landedAED, 2),
    target_margin_pct:     round(margin * 100, 2),
    cost_ex_customs_src:   round(costExCustomsSrc, 2),
    landed_cost_src:       round(landedSrc, 2),
  };
}

// ── BRAND DEFAULTS ────────────────────────────────────────────
// The settings a brand's recent items most commonly use, for pre-filling a new
// SKU. Pure so both data layers can share it — the caller supplies the rows.
export const BRAND_DEFAULT_FIELDS = ['cost_currency','shipping_rate','customs_duty_rate','cost_source','msrp_primary_currency','price_used','price_source'];

export function brandDefaultsFrom(rows) {
  if (!rows?.length) return null;
  const modeOf = (key) => {
    const vals = rows.map(r => r[key]).filter(v => v !== null && v !== undefined && v !== '');
    if (!vals.length) return null;
    const freq = new Map();
    for (const v of vals) freq.set(String(v), (freq.get(String(v)) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  return Object.fromEntries(BRAND_DEFAULT_FIELDS.map(k => [k, modeOf(k)]));
}

// ── VALIDATION ────────────────────────────────────────────────

export function validateItem(item) {
  const errors = [];
  if (!item.item_code?.trim())       errors.push('Item code is required');
  if (!item.item_name?.trim())       errors.push('Item name is required');
  if (!item.brand_code)              errors.push('Brand is required');
  if (!item.cost_currency)           errors.push('Cost currency is required');
  if (item.price_used !== 'cost_based' && !item.msrp_primary_currency) errors.push('Primary MSRP currency is required');
  if (!item.price_used)              errors.push('Price used must be selected');
  if (!item.price_source)            errors.push('Price source is required');
  if (!item.cost_source)             errors.push('Cost source is required');
  return errors;
}
