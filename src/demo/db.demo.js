// ─────────────────────────────────────────────────────────────
// DEMO DATA LAYER
// Drop-in replacement for db.js that runs entirely against the
// in-memory `store` (demoData.js). Same function names, same
// return shapes — the UI can't tell the difference. All mutations
// persist for the session and reset on page reload.
// ─────────────────────────────────────────────────────────────
import { store } from './demoData';
import { toNum } from '../lib/num';
import { brandDefaultsFrom } from '../lib/pricing';
import { DEMO_USER } from './demoConfig';
import { matchesSearch } from '../lib/search';

// Small artificial latency so loading states actually render.
const wait = (ms = 130) => new Promise(r => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

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

export async function fetchBrandDefaults(brandCode) {
  await wait(60);
  return brandDefaultsFrom(store.pricingMaster.filter(i => i.brand_code === brandCode).slice(0, 30));
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
  return store.pricingMaster
    .filter(i => matchesSearch(i, query))
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

export async function fetchItemsForOverride({ brandCode, search } = {}) {
  await wait(150);
  let rows = [...store.pricingMaster];
  if (brandCode) rows = rows.filter(i => i.brand_code === brandCode);
  if (search?.trim()) rows = rows.filter(i => matchesSearch(i, search));

  return rows.sort((a, b) => a.item_code.localeCompare(b.item_code)).map(clone);
}
export async function bulkUpdateItemFields(updates) {
  await wait(180);
  for (const { item_code, ...fields } of updates) {
    const row = store.pricingMaster.find(i => i.item_code === item_code.toUpperCase());
    if (row) Object.assign(row, fields, { updated_at: new Date().toISOString() });
  }
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

export async function fetchItemList({
  brandCode, search, page = 0, pageSize = 100,
  sortCol = 'item_code', sortDir = 'asc',
} = {}) {
  await wait(140);
  let rows = [...store.pricingMaster];
  if (brandCode) rows = rows.filter(i => i.brand_code === brandCode);
  if (search?.trim()) rows = rows.filter(i => matchesSearch(i, search));

  const dir = sortDir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[sortCol], bv = b[sortCol];
    // Nulls last regardless of direction, matching nullsFirst:false in the live layer
    if (av == null && bv == null) return a.item_code.localeCompare(b.item_code);
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return cmp !== 0 ? dir * cmp : a.item_code.localeCompare(b.item_code);
  });
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
    target_margin_pct: toNum(item.target_margin_pct) ?? 25,
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

export async function bulkUpdateProjectItems(updates) {
  await wait(160);
  for (const { item_code, ...fields } of updates || []) {
    const idx = store.projectItems.findIndex(p => p.item_code === item_code.toUpperCase());
    if (idx < 0) continue;
    store.projectItems[idx] = {
      ...store.projectItems[idx], ...fields,
      updated_at: new Date().toISOString(), updated_by: DEMO_USER.email,
    };
  }
}

export async function deleteProjectItem(itemCode) {
  await wait();
  store.projectItems = store.projectItems.filter(p => p.item_code !== itemCode.toUpperCase());
}

// ── ERP CACHE ─────────────────────────────────────────────────
// Only the item-coverage path is modelled here. The sync and report calls
// still need a live ERPNext behind the proxy, so they stay unimplemented and
// the screen's mount effects swallow their absence.
//
// The synthetic cache is every demo item except a deterministic slice, so
// coverage reports a realistic non-zero "not in ERP" figure.
const erpMissingCodes = () =>
  new Set(store.pricingMaster.filter((_, i) => i % 29 === 0).map(i => i.item_code));

export async function getErpCacheInfo() {
  await wait(60);
  const missing = erpMissingCodes();
  return {
    count:    store.pricingMaster.length - missing.size,
    syncedAt: new Date(Date.now() - 36e5).toISOString(),
    cursor:   null,
  };
}

export async function countErpItems() {
  await wait(40);
  return store.pricingMaster.length - erpMissingCodes().size;
}

export async function fetchErpCoverage(brandCodes) {
  await wait(120);
  const scoped = Array.isArray(brandCodes) && brandCodes.length > 0;
  const missing = erpMissingCodes();
  const inScope = store.pricingMaster.filter(i => !scoped || brandCodes.includes(i.brand_code));
  const notInErp = inScope.filter(i => missing.has(i.item_code)).map(i => ({
    item_code: i.item_code, item_name: i.item_name, brand_code: i.brand_code,
    barcode: i.barcode ?? null,
    msrp_aed: i.msrp_aed ?? null, msrp_sar: i.msrp_sar ?? null, msrp_qat: i.msrp_qat ?? null,
  }));
  return {
    erpTotal: store.pricingMaster.length - missing.size,
    dbTotal:  inScope.length,
    notInErp,
  };
}

// ── BULK CODE OPERATIONS ──────────────────────────────────────
export async function bulkDeleteItems(itemCodes) {
  await wait(160);
  const codes = new Set((itemCodes || []).map(c => String(c).trim().toUpperCase()).filter(Boolean));
  const before = store.pricingMaster.length;
  store.pricingMaster = store.pricingMaster.filter(i => !codes.has(i.item_code.toUpperCase()));
  return before - store.pricingMaster.length;
}

export async function renameItemCodes(pairs) {
  await wait(200);
  const clean = (pairs || [])
    .map(p => ({ old: String(p.old ?? '').trim().toUpperCase(), new: String(p.new ?? '').trim().toUpperCase() }))
    .filter(p => p.old && p.new && p.old !== p.new);
  const byOld = new Map(clean.map(p => [p.old, p.new]));
  const renaming = new Set(byOld.keys());
  const taken = clean.filter(p =>
    store.pricingMaster.some(i => i.item_code.toUpperCase() === p.new && !renaming.has(i.item_code.toUpperCase())));
  if (taken.length) throw new Error(`target item code already in use: ${taken.map(p => p.new).join(', ')}`);
  const brands = new Set(store.brands.map(b => b.brand_code));

  let renamed = 0, historyRows = 0;
  for (const item of store.pricingMaster) {
    const next = byOld.get(item.item_code.toUpperCase());
    if (!next) continue;
    const prefix = next.split('-')[0];
    item.item_code  = next;
    if (brands.has(prefix)) item.brand_code = prefix;
    item.updated_at = new Date().toISOString();
    item.updated_by = DEMO_USER.email;
    renamed++;
  }
  for (const h of store.priceHistory) {
    const next = byOld.get((h.item_code || '').toUpperCase());
    if (next) { h.item_code = next; historyRows++; }
  }
  return { renamed, historyRows };
}
