// ─────────────────────────────────────────────────────────────
// BULK IMPORT PIPELINE
// Template generation and the row validate/calculate pass. No JSX and no
// component state — the import screens render whatever this produces, so the
// rules live in one auditable place.
// ─────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx-js-style';
import { fetchBrands, fetchRates } from './db';
import { toNum } from './num';
import { calcMSRPs, calcCostBasedMSRPs, DEFAULT_COST_MARGIN_PCT, resolvePriceUsed } from './pricing';
import { CURRENCIES } from '../apps/pricing/styles';

export const PRICE_USED_OPTIONS = ['primary_ex_vat','primary_inc_vat','secondary_ex_vat','secondary_inc_vat','cost_based'];
export const SOURCES            = ['Portal','File','Website','Invoice','Estimate'];
export const LARGE_THRESHOLD    = 5000;  // above this, paginate review and show progress
export const REVIEW_PAGE_SIZE   = 100;   // rows per page in review / dup tables
// Fields that are merged from existing DB data when blank in import (merge mode)
export const MERGE_FIELDS = ['item_name','barcode','cost_currency','exw_cost','shipping_rate',
  'customs_duty_rate','msrp_primary_currency','msrp_primary_ex_vat','msrp_primary_inc_vat',
  'msrp_secondary_currency','msrp_secondary_ex_vat','msrp_secondary_inc_vat',
  'price_used','target_margin_pct','cost_source','price_source'];
// Paste import writes primaries only, so cost_based has no secondary fallback here.
export const PASTE_PRICE_USED   = ['primary_ex_vat','primary_inc_vat','cost_based'];

// ── TEMPLATE GENERATOR ────────────────────────────────────────
export async function generateTemplate() {
  const [brands, rates] = await Promise.all([fetchBrands(), fetchRates()]);
  const wb = XLSX.utils.book_new();

  const importHeaders = [
    'sku','item_name','brand_code','cost_currency','exw_cost',
    'shipping_rate','customs_duty_rate','msrp_primary_currency',
    'msrp_primary_ex_vat','msrp_primary_inc_vat','msrp_secondary_currency',
    'msrp_secondary_ex_vat','msrp_secondary_inc_vat','price_used',
    'target_margin_pct','cost_source','price_source','barcode',
  ];
  const required = new Set(['sku','brand_code','cost_currency','msrp_primary_currency','price_used']);
  const descriptions = {
    sku:'SKU without brand prefix — item_code will be constructed as BRAND-SKU',item_name:'Full item description',
    brand_code:'Must exist in Brands tab — see Reference sheet',
    cost_currency:'Currency of EXW cost — see Reference sheet',
    exw_cost:'Ex-works cost in cost_currency — leave blank or 0 if none was supplied',
    shipping_rate:'Shipping % applied to EXW cost (default: 0)',
    customs_duty_rate:'Customs duty % (default: 5.5)',
    msrp_primary_currency:'Currency of primary MSRP',
    msrp_primary_ex_vat:'Primary MSRP excluding VAT',
    msrp_primary_inc_vat:'Primary MSRP including VAT',
    msrp_secondary_currency:'Currency of secondary MSRP (optional)',
    msrp_secondary_ex_vat:'Secondary MSRP ex VAT (optional)',
    msrp_secondary_inc_vat:'Secondary MSRP inc VAT (optional)',
    price_used:'Which MSRP drives pricing, or cost_based to derive the price from EXW cost — see Reference sheet',
    target_margin_pct:'Target gross margin % when price_used is cost_based (default: 25) — shipping/customs not included',
    cost_source:'Where cost data came from — see Reference sheet',
    price_source:'Where price data came from — see Reference sheet',
    barcode:'Product barcode (optional) — stored as text',
  };

  const importData = [
    importHeaders.map(h => required.has(h) ? `${h} *` : h),
    importHeaders.map(h => descriptions[h] || ''),
  ];
  const importWs = XLSX.utils.aoa_to_sheet(importData);
  importWs['!cols'] = importHeaders.map(h => ({ wch: Math.max(h.length+4, 16) }));
  importWs['!freeze'] = { xSplit:0, ySplit:2 };

  // Pre-format barcode column as Text so Excel doesn't auto-convert long numeric barcodes
  const barcodeCol = importHeaders.indexOf('barcode');
  if (barcodeCol >= 0) {
    for (let r = 2; r <= 101; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: barcodeCol });
      importWs[addr] = { t: 's', v: '', s: { numFmt: '@' } };
    }
    const range = XLSX.utils.decode_range(importWs['!ref']);
    range.e.r = Math.max(range.e.r, 101);
    importWs['!ref'] = XLSX.utils.encode_range(range);
  }

  XLSX.utils.book_append_sheet(wb, importWs, 'Import');

  const maxLen = Math.max(brands.length, PRICE_USED_OPTIONS.length, CURRENCIES.length, SOURCES.length);
  const refData = [
    ['brand_code','brand_name','','price_used options','','currencies','','sources'],
    ...Array.from({length:maxLen},(_,i) => [
      brands[i]?.brand_code||'', brands[i]?.brand_name||'', '',
      PRICE_USED_OPTIONS[i]||'', '', CURRENCIES[i]||'', '', SOURCES[i]||'',
    ]),
  ];
  const refWs = XLSX.utils.aoa_to_sheet(refData);
  refWs['!cols'] = [{wch:14},{wch:24},{wch:4},{wch:22},{wch:4},{wch:12},{wch:4},{wch:12}];
  XLSX.utils.book_append_sheet(wb, refWs, 'Reference');

  XLSX.writeFile(wb, `pricing_import_template_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── ROW PROCESSOR ─────────────────────────────────────────────
export function validateAndCalc(row, brandMap, markupCache, additionalMarkupCache, rates) {
  const errors = [];
  const warnings = [];
  const brandCode = row.brand_code?.toUpperCase();

  if (!row.item_code?.trim())   errors.push('item_code is required');
  if (!row.item_name?.trim())   warnings.push('item_name is missing');
  if (!brandCode)               errors.push('brand_code is required');
  else if (!brandMap[brandCode]) errors.push(`Brand "${brandCode}" not found — create it in Brands tab first`);
  if (!row.cost_currency)       errors.push('cost_currency is required');
  // Cost is optional — vendors don't always send one — but must parse when present.
  if (String(row.exw_cost ?? '').trim() !== '' && toNum(row.exw_cost) == null) errors.push('exw_cost must be a number');
  const isCostBased = row.price_used === 'cost_based';
  if (!row.msrp_primary_currency && !isCostBased) errors.push('msrp_primary_currency is required');
  if (!row.price_used || !PRICE_USED_OPTIONS.includes(row.price_used)) {
    errors.push(`price_used must be one of: ${PRICE_USED_OPTIONS.join(', ')}`);
  }
  if (row.cost_source && !SOURCES.includes(row.cost_source)) {
    errors.push(`cost_source must be one of: ${SOURCES.join(', ')}`);
  }
  if (row.price_source && !SOURCES.includes(row.price_source)) {
    errors.push(`price_source must be one of: ${SOURCES.join(', ')}`);
  }

  const { value: priceVal, currency: priceCurrency } = resolvePriceUsed(row);
  if (!isCostBased && errors.length === 0 && priceVal == null) {
    errors.push(`No MSRP value found for price_used "${row.price_used}"`);
  }
  const targetMargin = toNum(row.target_margin_pct);
  if (isCostBased && String(row.target_margin_pct ?? '').trim() !== '' && !(targetMargin > 0 && targetMargin < 100)) {
    errors.push('target_margin_pct must be a number between 0 and 100');
  }

  // Compute all 6 MSRP fields — two-pass prettification via calcMSRPs
  let msrp_aed = null, msrp_sar = null, msrp_qat = null;
  let real_msrp_aed = null, real_msrp_sar = null, real_msrp_qat = null;
  if (errors.length === 0) {
    const msrps = isCostBased
      ? calcCostBasedMSRPs(toNum(row.exw_cost), row.cost_currency, targetMargin ?? DEFAULT_COST_MARGIN_PCT, rates, additionalMarkupCache[brandCode] ?? null)
      : calcMSRPs(priceVal, priceCurrency, markupCache[brandCode] ?? 10, additionalMarkupCache[brandCode] ?? null, rates);
    if (msrps) ({ msrp_aed, msrp_sar, msrp_qat, real_msrp_aed, real_msrp_sar, real_msrp_qat } = msrps);
  }

  return {
    ...row, brand_code: brandCode,
    _errors: errors, _warnings: warnings, _status: errors.length > 0 ? 'error' : 'ready',
    msrp_aed, msrp_sar, msrp_qat,
    real_msrp_aed, real_msrp_sar, real_msrp_qat,
  };
}

export async function processRows(rawRows, brands, rates, onProgress) {
  const brandMap = Object.fromEntries(brands.map(b => [b.brand_code, b]));
  const markupCache = {};
  const additionalMarkupCache = {};
  for (const b of brands) {
    markupCache[b.brand_code]           = b.brand_rules?.markup_percentage ?? 10;
    additionalMarkupCache[b.brand_code] = b.brand_rules?.additional_markup_pct ?? null;
  }
  const PROC_CHUNK = 500;
  const processed  = [];
  for (let start = 0; start < rawRows.length; start += PROC_CHUNK) {
    const end = Math.min(start + PROC_CHUNK, rawRows.length);
    for (let j = start; j < end; j++) {
      processed.push({ ...validateAndCalc(rawRows[j], brandMap, markupCache, additionalMarkupCache, rates), _rowNum: j + 3 });
    }
    onProgress?.(end, rawRows.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  // Flag rows whose item_code appears more than once in the file
  const codeCount = {};
  for (const r of processed) {
    const code = r.item_code?.trim().toUpperCase();
    if (code) codeCount[code] = (codeCount[code] || 0) + 1;
  }
  for (const r of processed) {
    const code = r.item_code?.trim().toUpperCase();
    r._dupInFile = !!(code && codeCount[code] > 1);
  }

  return { processed, brandMap, markupCache, additionalMarkupCache };
}
