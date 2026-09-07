// ─────────────────────────────────────────────────────────────
// PRICING CALCULATIONS
// One place to audit all math. No DB calls here — pure functions.
// ─────────────────────────────────────────────────────────────

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
  if (!exw_cost || !cost_currency || !rates?.[cost_currency]) return null;
  const afterShipping = exw_cost * (1 + (shipping_rate || 0) / 100);
  const inAED = afterShipping * rates[cost_currency];
  return inAED * (1 + (customs_duty_rate ?? 5.5) / 100);
}

// ── PRICE USED RESOLVER ───────────────────────────────────────

/**
 * Resolve the selected MSRP value and its currency from an item
 */
export function resolvePriceUsed(item) {
  const map = {
    primary_ex_vat:    { value: item.msrp_primary_ex_vat,    currency: item.msrp_primary_currency },
    primary_inc_vat:   { value: item.msrp_primary_inc_vat,   currency: item.msrp_primary_currency },
    secondary_ex_vat:  { value: item.msrp_secondary_ex_vat,  currency: item.msrp_secondary_currency },
    secondary_inc_vat: { value: item.msrp_secondary_inc_vat, currency: item.msrp_secondary_currency },
  };
  return map[item.price_used] || { value: null, currency: null };
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
  if (!item.exw_cost || !item.cost_currency || !rates?.[item.cost_currency]) return null;
  const { value, currency } = resolvePriceUsed(item);
  if (!value || !currency || !rates?.[currency]) return null;
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
  if (!sellingPriceAED || !costAED || sellingPriceAED <= 0) return null;
  return ((sellingPriceAED - costAED) / sellingPriceAED) * 100;
}

/**
 * Calculate all three country retail margins + EXW margin
 *
 * UAE margin  = (msrp_aed - landed_cost_aed) / msrp_aed × 100
 * KSA margin  = (msrp_sar × sar_rate - landed_cost_aed) / (msrp_sar × sar_rate) × 100
 * QAT margin  = (msrp_qat × qar_rate - landed_cost_aed) / (msrp_qat × qar_rate) × 100
 * EXW margin  = (price_used_aed - exw_cost_aed) / price_used_aed × 100
 */
export function calcAllMargins(item, rates) {
  const landed = calcLandedCost(item, rates);
  if (landed === null) return null;

  const ksaAED = item.msrp_sar ? item.msrp_sar * (rates['SAR'] || 0.98) : null;
  const qatAED = item.msrp_qat ? item.msrp_qat * (rates['QAR'] || 1.01) : null;

  return {
    landed_cost_aed: landed,
    uae_margin:      calcMargin(item.msrp_aed, landed),
    ksa_margin:      calcMargin(ksaAED, landed),
    qat_margin:      calcMargin(qatAED, landed),
    exw_margin:      calcEXWMargin(item, rates),
  };
}

// ── MOD REMOVAL ───────────────────────────────────────────────

export function removeMOD(ceiled) {
  const modMark = ceiled < 100 ? 0 : ceiled < 1000 ? 5 : ceiled < 5000 ? 10 : 20;
  const modDiv  = ceiled < 100 ? 1 : 100;
  const mod     = ceiled % modDiv;
  const removed = ceiled - (mod > modMark ? 0 : mod);
  return String(removed).slice(-2) === '00' ? removed - 0.05 : removed;
}

// ── SUGGESTED PRICES ─────────────────────────────────────────

export function suggestUAEPrice(priceUsedValue, priceCurrency, markupPercentage, rates) {
  if (!priceUsedValue || !priceCurrency || !rates?.[priceCurrency]) return null;
  const inAED    = priceUsedValue * rates[priceCurrency];
  const markedUp = inAED * (1 + markupPercentage / 100);
  const vatted   = markedUp * 1.05;
  const ceiled   = Math.ceil(vatted / 5) * 5;
  const modded   = removeMOD(ceiled);
  return modded / 1.05;
}

export function suggestKSAPrice(msrp_aed) {
  if (!msrp_aed) return null;
  const raw    = msrp_aed * 1.03 * 1.15;
  const ceiled = Math.ceil(raw / 5) * 5;
  const modded = String(ceiled).slice(-2) === '00' ? ceiled - 0.05 : ceiled;
  return modded / 1.15;
}

export function suggestQATPrice(msrp_aed) {
  if (!msrp_aed) return null;
  const raw    = msrp_aed * 1.01;
  const ceiled = Math.ceil(raw / 5) * 5;
  return String(ceiled).slice(-2) === '00' ? ceiled - 0.05 : ceiled;
}

// Apply additional markup to an already-prettified AED ex-VAT base, then re-prettify.
// base (ex-VAT) → ×(1+add%) → ×1.05 VAT → ceil/5 → removeMOD → ÷1.05
export function applyAdditionalMarkupUAE(realMsrpAed, additionalPct) {
  if (!realMsrpAed || !additionalPct) return realMsrpAed;
  const vatted = realMsrpAed * (1 + additionalPct / 100) * 1.05;
  const ceiled = Math.ceil(vatted / 5) * 5;
  return removeMOD(ceiled) / 1.05;
}

// Compute all 6 MSRP fields from a source price — two prettification passes.
// Pass 1: source → base markup → prettify → real_msrp_*
// Pass 2: real_msrp_aed → additional markup → prettify → msrp_*
// If additionalMarkupPct is null/0, msrp_* === real_msrp_*
export function calcMSRPs(priceValue, priceCurrency, baseMarkupPct, additionalMarkupPct, rates) {
  const pf2 = v => v != null ? parseFloat(v.toFixed(2)) : null;
  const rawReal = suggestUAEPrice(priceValue, priceCurrency, baseMarkupPct, rates);
  if (rawReal == null) return null;
  const real_msrp_aed = pf2(rawReal);
  const real_msrp_sar = pf2(suggestKSAPrice(real_msrp_aed));
  const real_msrp_qat = pf2(suggestQATPrice(real_msrp_aed));
  const msrp_aed = additionalMarkupPct
    ? pf2(applyAdditionalMarkupUAE(real_msrp_aed, additionalMarkupPct))
    : real_msrp_aed;
  const msrp_sar = pf2(suggestKSAPrice(msrp_aed));
  const msrp_qat = pf2(suggestQATPrice(msrp_aed));
  return { real_msrp_aed, real_msrp_sar, real_msrp_qat, msrp_aed, msrp_sar, msrp_qat };
}

// ── COST-BASED PRICING ────────────────────────────────────────

export const DEFAULT_COST_MARGIN_PCT = 25;

/**
 * Compute all 6 MSRP fields from EXW cost by enforcing a target gross margin.
 * Pure EXW basis — no shipping, no customs (unlike calcProjectPrice).
 *
 * cost_aed     = exw_cost × FX rate
 * real_msrp    = cost_aed / (1 - margin%)  → ×1.05 VAT → ceil/5 → removeMOD → ÷1.05
 * msrp_*       = real_msrp after optional additional-markup second pass (same as calcMSRPs)
 * KSA/QAT derived from the final AED via the standard formulas.
 */
export function calcCostBasedMSRPs(exwCost, costCurrency, targetMarginPct, rates, additionalMarkupPct = null) {
  if (!exwCost || !costCurrency || !rates?.[costCurrency]) return null;
  const margin = (targetMarginPct ?? DEFAULT_COST_MARGIN_PCT) / 100;
  if (!(margin > 0 && margin < 1)) return null;
  const pf2           = v => v != null ? parseFloat(v.toFixed(2)) : null;
  const costAED       = exwCost * rates[costCurrency];
  const raw           = costAED / (1 - margin);
  const vatted        = raw * 1.05;
  const ceiled        = Math.ceil(vatted / 5) * 5;
  const real_msrp_aed = pf2(removeMOD(ceiled) / 1.05);
  const real_msrp_sar = pf2(suggestKSAPrice(real_msrp_aed));
  const real_msrp_qat = pf2(suggestQATPrice(real_msrp_aed));
  const msrp_aed = additionalMarkupPct
    ? pf2(applyAdditionalMarkupUAE(real_msrp_aed, additionalMarkupPct))
    : real_msrp_aed;
  const msrp_sar = pf2(suggestKSAPrice(msrp_aed));
  const msrp_qat = pf2(suggestQATPrice(msrp_aed));
  return { real_msrp_aed, real_msrp_sar, real_msrp_qat, msrp_aed, msrp_sar, msrp_qat };
}

// ── EMPLOYEE PRICE ────────────────────────────────────────────

export function calcEmployeePrice(item, rates) {
  const landed = calcLandedCost(item, rates);
  if (!landed) return null;
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
  if (!cost || !cost_currency || !rates?.[cost_currency]) return null;
  const margin            = (target_margin_pct ?? DEFAULT_PROJECT_MARGIN_PCT) / 100;
  if (!(margin > 0 && margin < 1)) return null;
  const rate              = rates[cost_currency];
  const ship              = (shipping_rate  ?? 0)   / 100;
  const duty              = (customs_duty_rate ?? 5.5) / 100;
  const costExCustomsSrc  = cost * (1 + ship);
  const landedSrc         = costExCustomsSrc * (1 + duty);
  const landedAED         = landedSrc * rate;
  const raw               = landedAED / (1 - margin);   // gross margin target on landed cost
  const vatted            = raw * 1.05;
  const ceiled            = Math.ceil(vatted / 5) * 5;
  const incVat            = removeMOD(ceiled);
  const exVat             = parseFloat((incVat / 1.05).toFixed(2));
  return {
    msrp_aed_inc_vat:      parseFloat(incVat.toFixed(2)),
    msrp_aed_ex_vat:       exVat,
    msrp_sar:              suggestKSAPrice(exVat) != null ? parseFloat(suggestKSAPrice(exVat).toFixed(2)) : null,
    msrp_qat:              suggestQATPrice(exVat) != null ? parseFloat(suggestQATPrice(exVat).toFixed(2)) : null,
    landed_cost_aed:       parseFloat(landedAED.toFixed(2)),
    target_margin_pct:     parseFloat((margin * 100).toFixed(2)),
    cost_ex_customs_src:   parseFloat(costExCustomsSrc.toFixed(2)),
    landed_cost_src:       parseFloat(landedSrc.toFixed(2)),
  };
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
