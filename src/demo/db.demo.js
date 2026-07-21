// ─────────────────────────────────────────────────────────────
// DEMO DATA LAYER
// Drop-in replacement for db.js that runs entirely against the
// in-memory `store` (demoData.js). Same function names, same
// return shapes — the UI can't tell the difference. All mutations
// persist for the session and reset on page reload.
// ─────────────────────────────────────────────────────────────
import { store } from './demoData';
import { DEMO_USER } from './demoConfig';

// Small artificial latency so loading states actually render.
const wait = (ms = 130) => new Promise(r => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
};

const brandName = (code) => store.brands.find(b => b.brand_code === code)?.brand_name ?? null;
const withBrand = (item) => ({ ...item, brands: { brand_name: brandName(item.brand_code) } });

// Mirrors the real db.js stripItem so saved rows match the schema.
function stripItem(item) {
  return {
    item_code:               item.item_code?.toUpperCase(),
    item_name:               item.item_name,
    brand_code:              item.brand_code,
    barcode:                 item.barcode || null,
    cost_currency:           item.cost_currency,
    exw_cost:                toNum(item.exw_cost),
    shipping_rate:           toNum(item.shipping_rate) ?? 0,
    customs_duty_rate:       toNum(item.customs_duty_rate) ?? 5.5,
    msrp_primary_ex_vat:     toNum(item.msrp_primary_ex_vat),
    msrp_primary_inc_vat:    toNum(item.msrp_primary_inc_vat),
    msrp_primary_currency:   item.msrp_primary_currency || null,
    msrp_secondary_ex_vat:   toNum(item.msrp_secondary_ex_vat),
    msrp_secondary_inc_vat:  toNum(item.msrp_secondary_inc_vat),
    msrp_secondary_currency: item.msrp_secondary_currency || null,
    price_used:              item.price_used || null,
    target_margin_pct:       toNum(item.target_margin_pct),
    price_source:            item.price_source || null,
    msrp_aed:                toNum(item.msrp_aed),
    msrp_sar:                toNum(item.msrp_sar),
    msrp_qat:                toNum(item.msrp_qat),
    real_msrp_aed:           toNum(item.real_msrp_aed),
    real_msrp_sar:           toNum(item.real_msrp_sar),
    real_msrp_qat:           toNum(item.real_msrp_qat),
    uae_overridden:          item.uae_overridden ?? false,
    ksa_overridden:          item.ksa_overridden ?? false,
    qat_overridden:          item.qat_overridden ?? false,
    cost_source:             item.cost_source || null,
    created_at:              item.created_at ?? new Date().toISOString(),
    updated_at:              new Date().toISOString(),
    updated_by:              DEMO_USER.email,
  };
}

function upsertItem(row) {
  const idx = store.pricingMaster.findIndex(i => i.item_code === row.item_code);
  if (idx >= 0) store.pricingMaster[idx] = { ...store.pricingMaster[idx], ...row };
  else store.pricingMaster.push(row);
}

// ── EXCHANGE RATES ────────────────────────────────────────────
export async function fetchRates() {
  await wait(80);
  return { ...store.rates, AED: 1 };
}

export async function updateRate(currency, rateToAED) {
  await wait();
  store.rates[currency] = rateToAED;
}

// ── BRANDS ────────────────────────────────────────────────────
export async function fetchBrands() {
  await wait(90);
  return store.brands
    .map(b => ({
      ...b,
      brand_rules: (() => {
        const r = store.brandRules.find(x => x.brand_code === b.brand_code);
        return r ? [{ markup_percentage: r.markup_percentage, additional_markup_pct: r.additional_markup_pct }] : [];
      })(),
    }))
    .sort((a, b) => a.brand_code.localeCompare(b.brand_code));
}

export async function addBrand(brandCode, brandName, markupPercentage = 10) {
  return insertBrand(brandCode, brandName, markupPercentage);
}

export async function fetchBrandRule(brandCode) {
  await wait(60);
  const r = store.brandRules.find(x => x.brand_code === brandCode);
  return r ? { markup_percentage: r.markup_percentage, additional_markup_pct: r.additional_markup_pct } : null;
}

export async function insertBrand(brandCode, brandName, markupPercentage = 10) {
  await wait();
  const code = brandCode.toUpperCase();
  if (store.brands.some(b => b.brand_code === code)) {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    throw err;
  }
  store.brands.push({ brand_code: code, brand_name: brandName });
  store.brandRules.push({ brand_code: code, markup_percentage: markupPercentage, additional_markup_pct: null });
}

export async function updateBrandMarkup(brandCode, markupPercentage) {
  await wait();
  const r = store.brandRules.find(x => x.brand_code === brandCode);
  if (r) r.markup_percentage = markupPercentage;
}

export async function updateBrandAdditionalMarkup(brandCode, pct) {
  await wait();
  const r = store.brandRules.find(x => x.brand_code === brandCode);
  if (r) r.additional_markup_pct = pct === '' || pct == null ? null : Number(pct);
}

export async function fetchBrandsWithStats() {
  await wait(120);
  return store.brands
    .map(b => {
      const rule = store.brandRules.find(x => x.brand_code === b.brand_code);
      const items = store.pricingMaster.filter(i => i.brand_code === b.brand_code);
      const priceUsed = [...new Set(items.map(i => i.price_used).filter(Boolean))];
      return {
        brand_code:            b.brand_code,
        brand_name:            b.brand_name,
        markup_percentage:     rule?.markup_percentage ?? 10,
        additional_markup_pct: rule?.additional_markup_pct ?? null,
        sku_count:             items.length,
        price_used_types:      priceUsed,
      };
    })
    .sort((a, b) => a.brand_code.localeCompare(b.brand_code));
}

// ── PRICING MASTER ────────────────────────────────────────────
export async function searchItems(query) {
  await wait(90);
  if (!query?.trim()) return [];
  const q = query.trim().toLowerCase();
  return store.pricingMaster
    .filter(i => i.item_code.toLowerCase().includes(q) || (i.item_name || '').toLowerCase().includes(q))
    .slice(0, 20)
    .map(withBrand);
}

export async function fetchItem(itemCode) {
  await wait(80);
  const item = store.pricingMaster.find(i => i.item_code === itemCode.toUpperCase());
  if (!item) throw new Error('Item not found');
  return withBrand(clone(item));
}

export async function saveItem(item) {
  await wait();
  upsertItem(stripItem(item));
}

export async function deleteItem(itemCode) {
  await wait();
  store.pricingMaster = store.pricingMaster.filter(i => i.item_code !== itemCode.toUpperCase());
}

export async function bulkSaveItems(items) {
  await wait(220);
  const dedup = new Map();
  for (const it of items) {
    const row = stripItem(it);
    if (row.item_code) dedup.set(row.item_code, row);
  }
  for (const row of dedup.values()) upsertItem(row);
}

export async function checkExisting(itemCodes) {
  await wait(90);
  const codes = new Set(itemCodes.map(c => c.toUpperCase()));
  return new Set(store.pricingMaster.filter(i => codes.has(i.item_code)).map(i => i.item_code));
}

export async function fetchItemsByCodes(itemCodes) {
  await wait(90);
  const codes = new Set(itemCodes.map(c => c.toUpperCase()));
  const rows = store.pricingMaster.filter(i => codes.has(i.item_code));
  return Object.fromEntries(rows.map(r => [r.item_code, clone(r)]));
}

export async function fetchItemList({ brandCode, search, page = 0, pageSize = 100 } = {}) {
  await wait(140);
  let rows = [...store.pricingMaster];
  if (brandCode) rows = rows.filter(i => i.brand_code === brandCode);
  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    rows = rows.filter(i => i.item_code.toLowerCase().includes(q) || (i.item_name || '').toLowerCase().includes(q));
  }
  rows.sort((a, b) => a.item_code.localeCompare(b.item_code));
  const count = rows.length;
  const paged = rows.slice(page * pageSize, (page + 1) * pageSize).map(clone);
  return { data: paged, count };
}

// ── PRICE HISTORY ─────────────────────────────────────────────
export async function fetchHistory(itemCode, limit = 10) {
  await wait(90);
  return store.priceHistory
    .filter(h => h.item_code === itemCode.toUpperCase())
    .sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at))
    .slice(0, limit)
    .map(clone);
}

// ── ERP EXPORT ────────────────────────────────────────────────
export async function fetchAllPricesForExport() {
  await wait(180);
  return store.pricingMaster
    .filter(i => i.item_code)
    .sort((a, b) => a.item_code.localeCompare(b.item_code))
    .map(i => ({ item_code: i.item_code, barcode: i.barcode, msrp_aed: i.msrp_aed, msrp_sar: i.msrp_sar, msrp_qat: i.msrp_qat }));
}

export async function fetchBrandItems(brandCode) {
  await wait(120);
  return store.pricingMaster
    .filter(i => i.brand_code === brandCode.toUpperCase())
    .sort((a, b) => a.item_code.localeCompare(b.item_code))
    .map(clone);
}

export async function bulkUpdateMarkupPrices(updates, updatedBy, updatedAt) {
  await wait(200);
  const by = updatedBy ?? DEMO_USER.email;
  const at = updatedAt ?? new Date().toISOString();
  for (const u of updates) {
    const item = store.pricingMaster.find(i => i.item_code === u.item_code);
    if (!item) continue;
    if (u.msrp_aed != null) item.msrp_aed = u.msrp_aed;
    if (u.msrp_sar != null) item.msrp_sar = u.msrp_sar;
    if (u.msrp_qat != null) item.msrp_qat = u.msrp_qat;
    if (u.real_msrp_aed != null) item.real_msrp_aed = u.real_msrp_aed;
    if (u.real_msrp_sar != null) item.real_msrp_sar = u.real_msrp_sar;
    if (u.real_msrp_qat != null) item.real_msrp_qat = u.real_msrp_qat;
    item.updated_by = by;
    item.updated_at = at;
  }
}

// ── PRICE HISTORY BATCHES ─────────────────────────────────────
export async function insertPriceHistoryBatch({ batch_id, operation_type, description, applied_by, item_count, brand_count, metadata }) {
  await wait();
  store.batches.unshift({
    batch_id,
    operation_type,
    description,
    applied_at: new Date().toISOString(),
    applied_by,
    item_count,
    brand_count: brand_count ?? null,
    metadata: metadata ?? null,
  });
  // Keep at most 3 snapshots per operation type (mirrors the real auto-prune).
  const seen = {};
  store.batches = store.batches.filter(b => {
    seen[b.operation_type] = (seen[b.operation_type] || 0) + 1;
    const keep = seen[b.operation_type] <= 3;
    if (!keep) store.priceHistory = store.priceHistory.filter(h => h.batch_id !== b.batch_id);
    return keep;
  });
}

export async function bulkInsertPriceHistory(rows) {
  await wait(160);
  let id = store.priceHistory.reduce((m, h) => Math.max(m, h.id || 0), 0);
  for (const r of rows) store.priceHistory.push({ id: ++id, ...r });
}

export async function fetchPriceHistoryBatches() {
  await wait(120);
  return [...store.batches]
    .sort((a, b) => new Date(b.applied_at) - new Date(a.applied_at))
    .map(clone);
}

export async function fetchBatchItems(batchId, limit = 20, offset = 0) {
  await wait(90);
  return store.priceHistory
    .filter(h => h.batch_id === batchId)
    .slice(offset, offset + limit)
    .map(h => ({
      item_code: h.item_code, brand_code: h.brand_code,
      old_msrp_aed: h.old_msrp_aed, new_msrp_aed: h.new_msrp_aed,
      old_msrp_sar: h.old_msrp_sar, new_msrp_sar: h.new_msrp_sar,
      old_msrp_qat: h.old_msrp_qat, new_msrp_qat: h.new_msrp_qat,
    }));
}

export async function fetchAllBatchItems(batchId) {
  await wait(140);
  return store.priceHistory
    .filter(h => h.batch_id === batchId)
    .sort((a, b) => a.item_code.localeCompare(b.item_code))
    .map(h => ({
      item_code: h.item_code, brand_code: h.brand_code,
      old_msrp_aed: h.old_msrp_aed, new_msrp_aed: h.new_msrp_aed,
      old_msrp_sar: h.old_msrp_sar, new_msrp_sar: h.new_msrp_sar,
      old_msrp_qat: h.old_msrp_qat, new_msrp_qat: h.new_msrp_qat,
      changed_at: h.changed_at, changed_by: h.changed_by,
    }));
}

export async function rollbackBatch(batchId, userEmail) {
  await wait(220);
  // Revert affected items to their pre-batch values, then drop the snapshot.
  const rows = store.priceHistory.filter(h => h.batch_id === batchId);
  for (const h of rows) {
    const item = store.pricingMaster.find(i => i.item_code === h.item_code);
    if (!item) continue;
    if (h.old_msrp_aed != null) item.msrp_aed = h.old_msrp_aed;
    if (h.old_msrp_sar != null) item.msrp_sar = h.old_msrp_sar;
    if (h.old_msrp_qat != null) item.msrp_qat = h.old_msrp_qat;
    item.updated_by = userEmail;
    item.updated_at = new Date().toISOString();
  }
  store.priceHistory = store.priceHistory.filter(h => h.batch_id !== batchId);
  store.batches = store.batches.filter(b => b.batch_id !== batchId);
}

// ── PROJECT ITEMS ─────────────────────────────────────────────
export async function fetchProjectItems() {
  await wait(110);
  return [...store.projectItems]
    .sort((a, b) => a.item_code.localeCompare(b.item_code))
    .map(clone);
}

export async function saveProjectItem(item, { isNew = false } = {}) {
  await wait();
  const now = new Date().toISOString();
  const code = item.item_code?.toUpperCase();
  const row = {
    item_code:         code,
    project_item_name: item.project_item_name || null,
    cost:              toNum(item.cost),
    cost_currency:     item.cost_currency,
    shipping_rate:     toNum(item.shipping_rate) ?? 0,
    customs_duty_rate: toNum(item.customs_duty_rate) ?? 5.5,
    msrp_aed_inc_vat:  toNum(item.msrp_aed_inc_vat),
    msrp_aed_ex_vat:   toNum(item.msrp_aed_ex_vat),
    msrp_sar:          toNum(item.msrp_sar),
    msrp_qat:          toNum(item.msrp_qat),
    uae_overridden:    item.uae_overridden ?? false,
    ksa_overridden:    item.ksa_overridden ?? false,
    qat_overridden:    item.qat_overridden ?? false,
    updated_at:        now,
    updated_by:        DEMO_USER.email,
  };
  const idx = store.projectItems.findIndex(p => p.item_code === code);
  if (isNew) {
    if (idx >= 0) {
      const err = new Error('duplicate');
      err.isDuplicate = true;
      throw err;
    }
    store.projectItems.push({ ...row, created_by: DEMO_USER.email });
  } else if (idx >= 0) {
    store.projectItems[idx] = { ...store.projectItems[idx], ...row };
  }
}

export async function deleteProjectItem(itemCode) {
  await wait();
  store.projectItems = store.projectItems.filter(p => p.item_code !== itemCode.toUpperCase());
}
