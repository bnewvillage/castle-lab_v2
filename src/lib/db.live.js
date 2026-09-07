import { supabase } from './supabase';
import { toNum } from './num';
import { BRAND_DEFAULT_FIELDS, brandDefaultsFrom } from './pricing';
import { orExpression } from './search';

// ── INTERNAL HELPERS ──────────────────────────────────────────

const CHUNK = 500;    // max rows per upsert / .in() batch
const PAGE  = 10000;  // rows requested per paginated fetch (server may cap lower)

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Walks a Supabase query builder through all pages and concatenates results.
// buildQuery receives (from, to) and must return the full query.
// Advances by rows actually returned rather than by PAGE, so a server-side
// max_rows cap below PAGE silently reduces the stride instead of truncating
// the result. Costs one extra empty request at the end.
async function fetchAllPages(buildQuery) {
  let all  = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all = all.concat(data);
    from += data.length;
  }
  return all;
}

// stripItem no longer calls getUser — callers fetch the user once and pass it in.
function stripItem(item, user) {
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
    msrp_aed:                 toNum(item.msrp_aed),
    msrp_sar:                 toNum(item.msrp_sar),
    msrp_qat:                 toNum(item.msrp_qat),
    real_msrp_aed:            toNum(item.real_msrp_aed),
    real_msrp_sar:            toNum(item.real_msrp_sar),
    real_msrp_qat:            toNum(item.real_msrp_qat),
    uae_overridden:           item.uae_overridden ?? false,
    ksa_overridden:           item.ksa_overridden ?? false,
    qat_overridden:           item.qat_overridden ?? false,
    cost_source:              item.cost_source || null,
    updated_at:               new Date().toISOString(),
    updated_by:               user?.email || null,
  };
}

// ── EXCHANGE RATES ────────────────────────────────────────────
export async function fetchRates() {
  const { data, error } = await supabase.from('exchange_rates').select('currency, rate_to_aed');
  if (error) throw error;
  const rates = Object.fromEntries(data.map(r => [r.currency, parseFloat(r.rate_to_aed)]));
  rates['AED'] = 1; // base currency — always 1:1, never stored in DB
  return rates;
}

export async function updateRate(currency, rateToAED) {
  const { error } = await supabase.from('exchange_rates')
    .update({ rate_to_aed: rateToAED, updated_at: new Date().toISOString() })
    .eq('currency', currency);
  if (error) throw error;
}

// ── BRANDS ────────────────────────────────────────────────────
export async function fetchBrands() {
  const { data, error } = await supabase.from('brands')
    .select('brand_code, brand_name, brand_rules(markup_percentage, additional_markup_pct)')
    .order('brand_code');
  if (error) throw error;
  return data;
}

export async function addBrand(brandCode, brandName, markupPercentage = 10) {
  const { error: e1 } = await supabase.from('brands').insert({ brand_code: brandCode.toUpperCase(), brand_name: brandName });
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('brand_rules').insert({ brand_code: brandCode.toUpperCase(), markup_percentage: markupPercentage });
  if (e2) throw e2;
}

export async function fetchBrandRule(brandCode) {
  const { data, error } = await supabase.from('brand_rules').select('markup_percentage, additional_markup_pct').eq('brand_code', brandCode).single();
  if (error) return null;
  return data;
}

export async function fetchBrandDefaults(brandCode) {
  const { data, error } = await supabase.from('pricing_master')
    .select(BRAND_DEFAULT_FIELDS.join(','))
    .eq('brand_code', brandCode).order('created_at', { ascending: false }).limit(30);
  if (error) return null;
  return brandDefaultsFrom(data);
}

// ── PRICING MASTER ────────────────────────────────────────────
export async function searchItems(query) {
  if (!query?.trim()) return [];
  const { data, error } = await supabase.from('pricing_master')
    .select('*, brands(brand_name)')
    .or(orExpression(query))
    .order('item_code').limit(20);
  if (error) throw error;
  return data;
}

export async function fetchItem(itemCode) {
  const { data, error } = await supabase.from('pricing_master')
    .select('*, brands(brand_name)')
    .eq('item_code', itemCode.toUpperCase()).single();
  if (error) throw error;
  return data;
}

export async function saveItem(item) {
  const { data: { user } } = await supabase.auth.getUser();
  const stripped = stripItem(item, user);
  const { error } = await supabase.from('pricing_master')
    .upsert(stripped, { onConflict: 'item_code' });
  if (error) throw error;
}

export async function deleteItem(itemCode) {
  const { error } = await supabase.from('pricing_master').delete().eq('item_code', itemCode.toUpperCase());
  if (error) throw error;
}

// Chunks into batches of 500 and upserts sequentially.
// getUser is called once, not once per item.
export async function bulkSaveItems(items) {
  const { data: { user } } = await supabase.auth.getUser();
  const rawStripped = items.map(i => stripItem(i, user)).filter(i => i.item_code);
  // De-duplicate by item_code — last occurrence wins (mirrors Excel row order)
  const dedupMap = new Map();
  for (const item of rawStripped) dedupMap.set(item.item_code, item);
  const stripped = [...dedupMap.values()];
  for (const batch of chunkArray(stripped, CHUNK)) {
    const { error } = await supabase.from('pricing_master')
      .upsert(batch, { onConflict: 'item_code' });
    if (error) {
      console.error(error);
      throw error;
    }
  }
}

// Writes only the columns present in each update object, leaving every other
// column untouched. bulkSaveItems can't be used for partial updates — it upserts
// the full stripItem shape, so any column absent from the payload gets nulled.
export async function bulkUpdateItemFields(updates) {
  const { data: { user } } = await supabase.auth.getUser();
  const at = new Date().toISOString();
  const by = user?.email || null;
  for (const batch of chunkArray(updates, 25)) {
    await Promise.all(batch.map(async ({ item_code, ...fields }) => {
      if (!Object.keys(fields).length) return;
      const { error } = await supabase.from('pricing_master')
        .update({ ...fields, updated_at: at, updated_by: by })
        .eq('item_code', item_code.toUpperCase());
      if (error) throw error;
    }));
  }
}
// ── PRICE HISTORY ─────────────────────────────────────────────
export async function fetchHistory(itemCode, limit = 10) {
  const { data, error } = await supabase.from('price_history')
    .select('*').eq('item_code', itemCode.toUpperCase())
    .order('changed_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

// Chunks .in() to avoid URL/body size limits.
export async function checkExisting(itemCodes) {
  const codes = itemCodes.map(c => c.toUpperCase());
  const results = [];
  for (const batch of chunkArray(codes, CHUNK)) {
    const { data, error } = await supabase.from('pricing_master')
      .select('item_code').in('item_code', batch);
    if (error) throw error;
    results.push(...data.map(r => r.item_code));
  }
  return new Set(results);
}

// Fetches current DB rows for a list of item codes — used for the pre-import diff modal.
// Returns a map of UPPERCASE_CODE → full DB row.
export async function fetchItemsByCodes(itemCodes) {
  const codes = itemCodes.map(c => c.toUpperCase());
  const results = [];
  for (const batch of chunkArray(codes, CHUNK)) {
    const { data, error } = await supabase.from('pricing_master')
      .select('item_code, brand_code, item_name, barcode, exw_cost, cost_currency, shipping_rate, customs_duty_rate, msrp_primary_ex_vat, msrp_primary_inc_vat, msrp_primary_currency, msrp_secondary_ex_vat, msrp_secondary_inc_vat, msrp_secondary_currency, price_used, target_margin_pct, cost_source, price_source, msrp_aed, msrp_sar, msrp_qat, real_msrp_aed, real_msrp_sar, real_msrp_qat, uae_overridden, ksa_overridden, qat_overridden')
      .in('item_code', batch);
    if (error) throw error;
    results.push(...data);
  }
  return Object.fromEntries(results.map(r => [r.item_code, r]));
}

// ── ITEM LIST ─────────────────────────────────────────────────
export async function fetchItemList({
  brandCode, search, page = 0, pageSize = 100,
  sortCol = 'item_code', sortDir = 'asc',
} = {}) {
  let query = supabase
    .from('pricing_master')
    .select('item_code, item_name, barcode, brand_code, cost_currency, exw_cost, shipping_rate, customs_duty_rate, msrp_primary_ex_vat, msrp_primary_inc_vat, msrp_primary_currency, msrp_secondary_ex_vat, msrp_secondary_inc_vat, msrp_secondary_currency, price_used, msrp_aed, msrp_sar, msrp_qat, price_source, cost_source, target_margin_pct, created_at, updated_at, updated_by', { count: 'exact' })
    .order(sortCol, { ascending: sortDir === 'asc', nullsFirst: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  // Tiebreaker keeps paging stable when the sort column has duplicate values —
  // without it a row can appear on two pages or none.
  if (sortCol !== 'item_code') query = query.order('item_code', { ascending: true });

  if (brandCode) query = query.eq('brand_code', brandCode);
  if (search?.trim()) {
    query = query.or(orExpression(search));

  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data, count };
}

// ── BRAND MANAGEMENT ─────────────────────────────────────────
export async function fetchBrandsWithStats() {
  // Always fetch brand_rules directly so we get additional_markup_pct
  const { data: rules, error: rulesErr } = await supabase
    .from('brand_rules')
    .select('brand_code, markup_percentage, additional_markup_pct');
  if (rulesErr) throw rulesErr;
  const rulesMap = Object.fromEntries(rules.map(r => [r.brand_code, r]));

  const { data, error } = await supabase.rpc('get_brand_stats');
  if (error) {
    const { data: brands, error: e2 } = await supabase
      .from('brands')
      .select('brand_code, brand_name')
      .order('brand_code');
    if (e2) throw e2;
    return brands.map(b => ({
      brand_code:             b.brand_code,
      brand_name:             b.brand_name,
      markup_percentage:      rulesMap[b.brand_code]?.markup_percentage ?? 10,
      additional_markup_pct:  rulesMap[b.brand_code]?.additional_markup_pct ?? null,
      sku_count:              0,
      price_used_types:       [],
    }));
  }
  return data.map(r => ({
    brand_code:             r.brand_code,
    brand_name:             r.brand_name,
    markup_percentage:      rulesMap[r.brand_code]?.markup_percentage ?? r.markup_percentage ?? 10,
    additional_markup_pct:  rulesMap[r.brand_code]?.additional_markup_pct ?? null,
    sku_count:              r.sku_count,
    price_used_types:       r.price_used_types?.filter(Boolean) || [],
  }));
}

export async function updateBrandMarkup(brandCode, markupPercentage) {
  const { error } = await supabase
    .from('brand_rules')
    .update({ markup_percentage: markupPercentage, updated_at: new Date().toISOString() })
    .eq('brand_code', brandCode);
  if (error) throw error;
}

export async function updateBrandAdditionalMarkup(brandCode, pct) {
  const { error } = await supabase
    .from('brand_rules')
    .update({ additional_markup_pct: pct === '' || pct == null ? null : Number(pct) })
    .eq('brand_code', brandCode);
  if (error) throw error;
}

export async function insertBrand(brandCode, brandName, markupPercentage = 10) {
  const { error: e1 } = await supabase
    .from('brands')
    .insert({ brand_code: brandCode.toUpperCase(), brand_name: brandName });
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from('brand_rules')
    .insert({ brand_code: brandCode.toUpperCase(), markup_percentage: markupPercentage });
  if (e2) throw e2;
}

// ── MASS OVERRIDE SELECTION ───────────────────────────────────
// Same brand/search semantics as fetchItemList, but walks every page instead of
// one — an override has to see the whole matched set, not the visible slice.
export async function fetchItemsForOverride({ brandCode, search } = {}) {
  return fetchAllPages((from, to) => {
    let q = supabase
      .from('pricing_master')
      .select('item_code, item_name, brand_code, msrp_aed, msrp_sar, msrp_qat, uae_overridden, ksa_overridden, qat_overridden')
      .order('item_code')
      .range(from, to);
    if (brandCode) q = q.eq('brand_code', brandCode);
    if (search?.trim()) {
      q = q.or(orExpression(search));

    }
    return q;
  });
}
// ── COST CORRECTION ───────────────────────────────────────────
// Targeted UPDATEs rather than an upsert: an upsert would INSERT a near-empty
// row if an item_code no longer existed, so a stale correction list could
// create junk records instead of failing loudly.
export async function bulkUpdateExwCost(updates) {
  const { data: { user } } = await supabase.auth.getUser();
  const at = new Date().toISOString();
  const by = user?.email || null;
  for (const batch of chunkArray(updates, 25)) {
    await Promise.all(batch.map(async ({ item_code, exw_cost }) => {
      const { error } = await supabase.from('pricing_master')
        .update({ exw_cost, updated_at: at, updated_by: by })
        .eq('item_code', item_code.toUpperCase());
      if (error) throw error;
    }));
  }
}

// ── ERP ITEM CACHE ────────────────────────────────────────────

// item_code is stored upper-cased so it can be matched against pricing_master
// (also upper-cased) with a plain .in() lookup — no case-folding needed.
export async function syncErpItemsBatch(items, syncedAt) {
  const dedup = new Map();
  for (const r of items) {
    const code = r.item_code?.toUpperCase();
    if (!code) continue;
    dedup.set(code, {
      item_code: code,
      item_name: r.item_name ?? null,
      brand:     r.brand     ?? null,
      modified:  r.modified  ?? null,
      synced_at: syncedAt,
    });
  }
  if (!dedup.size) return;
  const { error } = await supabase.from('erp_items')
    .upsert([...dedup.values()], { onConflict: 'item_code' });
  if (error) throw error;
}

// Returns the subset of `codes` present in the ERP cache. Chunked .in() lookups
// hit the primary key index, so this stays cheap as long as `codes` is the
// already-narrowed candidate set rather than the whole catalogue.
export async function filterCodesInErpCache(codes) {
  const found = new Set();
  for (const batch of chunkArray(codes, CHUNK)) {
    const { data, error } = await supabase
      .from('erp_items').select('item_code').in('item_code', batch);
    if (error) throw error;
    data.forEach(r => found.add(r.item_code));
  }
  return found;
}

// Only safe after a FULL sync — an incremental sync doesn't touch unchanged
// rows, so their synced_at stays old and they'd be wrongly deleted.
export async function pruneStaleErpItems(syncedAtBefore) {
  const { error } = await supabase.from('erp_items').delete().lt('synced_at', syncedAtBefore);
  if (error) throw error;
}

export async function fetchErpItemCodes() {
  return fetchAllPages((from, to) =>
    supabase.from('erp_items').select('item_code').range(from, to)
  );
}

export async function countErpItems() {
  const { count, error } = await supabase
    .from('erp_items').select('item_code', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

// Single-row metadata table — avoids a COUNT(*) + sort over erp_items just to
// render "N items, last synced X".
export async function getErpCacheInfo() {
  const { data, error } = await supabase
    .from('erp_sync_meta')
    .select('last_synced_at, modified_cursor, item_count')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return {
    count:    data?.item_count      ?? 0,
    syncedAt: data?.last_synced_at  ?? null,
    cursor:   data?.modified_cursor ?? null,
  };
}

export async function updateErpSyncMeta({ syncedAt, cursor, count }) {
  const { error } = await supabase.from('erp_sync_meta').upsert({
    id: 1,
    last_synced_at:  syncedAt,
    modified_cursor: cursor,
    item_count:      count,
  }, { onConflict: 'id' });
  if (error) throw error;
}

// Mid-sync checkpoint. Items arrive ordered by `modified` ascending, so
// everything at or below the saved cursor is already persisted — an interrupted
// sync resumes from here instead of restarting.
export async function saveErpSyncCursor(cursor, syncedAt) {
  const { error } = await supabase.from('erp_sync_meta')
    .upsert({ id: 1, modified_cursor: cursor, last_synced_at: syncedAt }, { onConflict: 'id' });
  if (error) throw error;
}

// Fallback when the metadata row is missing or was never written: the newest
// `modified` already cached tells us where to resume.
export async function getErpMaxModified() {
  const { data, error } = await supabase
    .from('erp_items')
    .select('modified')
    .not('modified', 'is', null)
    .order('modified', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.modified ?? null;
}

// ── ERP EXPORT ───────────────────────────────────────────────
// Paginates through all rows — safe at 300k SKUs.
export async function fetchAllPricesForExport() {
  return fetchAllPages((from, to) =>
    supabase.from('pricing_master')
      .select('item_code, barcode, msrp_aed, msrp_sar, msrp_qat')
      .not('item_code', 'is', null)
      .order('item_code')
      .range(from, to)
  );
}

// brandCodes is optional — pass a non-empty array to pull only those brands.
export async function fetchAllItemsForErpAutomation(brandCodes) {
  const filtered = Array.isArray(brandCodes) && brandCodes.length > 0;
  return fetchAllPages((from, to) => {
    let q = supabase.from('pricing_master')
      .select('item_code, item_name, brand_code, barcode, msrp_aed, msrp_sar, msrp_qat')
      .not('item_code', 'is', null)
      .order('item_code')
      .range(from, to);
    if (filtered) q = q.in('brand_code', brandCodes);
    return q;
  });
}

// ── BRAND ITEMS ───────────────────────────────────────────────
// Paginates — safe for large brands.
export async function fetchBrandItems(brandCode) {
  const code = brandCode.toUpperCase();
  return fetchAllPages((from, to) =>
    supabase.from('pricing_master')
      .select('item_code, barcode, exw_cost, cost_currency, shipping_rate, customs_duty_rate, msrp_primary_ex_vat, msrp_primary_inc_vat, msrp_primary_currency, msrp_secondary_ex_vat, msrp_secondary_inc_vat, msrp_secondary_currency, price_used, msrp_aed, msrp_sar, msrp_qat, real_msrp_aed, real_msrp_sar, real_msrp_qat, uae_overridden, ksa_overridden, qat_overridden, cost_source, price_source')
      .eq('brand_code', code)
      .order('item_code')
      .range(from, to)
  );
}

// Single Postgres UPDATE via RPC — chunked at 500 to handle 300k SKUs safely.
export async function bulkUpdateMarkupPrices(updates, updatedBy, updatedAt) {
  const by  = updatedBy  ?? (await supabase.auth.getUser()).data?.user?.email ?? null;
  const at  = updatedAt  ?? new Date().toISOString();
  const chunks = chunkArray(updates, CHUNK);
  for (const chunk of chunks) {
    const { error } = await supabase.rpc('bulk_update_markup_prices', {
      updates:      chunk,
      p_updated_by: by,
      p_updated_at: at,
    });
    if (error) throw error;
  }
}

// ── PRICE HISTORY ─────────────────────────────────────────────

export async function insertPriceHistoryBatch({ batch_id, operation_type, description, applied_by, item_count, brand_count, metadata }) {
  const { error } = await supabase.from('price_history_batches').insert({
    batch_id, operation_type, description,
    applied_at:  new Date().toISOString(),
    applied_by,
    item_count,
    brand_count: brand_count ?? null,
    metadata:    metadata    ?? null,
  });
  if (error) throw error;
}

// Chunked at 500 — safe for 300k row batches.
export async function bulkInsertPriceHistory(rows) {
  const chunks = chunkArray(rows, CHUNK);
  for (const chunk of chunks) {
    const { error } = await supabase.rpc('bulk_insert_price_history', { rows: chunk });
    if (error) throw error;
  }
}

export async function fetchPriceHistoryBatches() {
  const { data, error } = await supabase
    .from('price_history_batches')
    .select('*')
    .order('applied_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchBatchItems(batchId, limit = 20, offset = 0) {
  const { data, error } = await supabase
    .from('price_history')
    .select('item_code, brand_code, old_msrp_aed, new_msrp_aed, old_msrp_sar, new_msrp_sar, old_msrp_qat, new_msrp_qat')
    .eq('batch_id', batchId)
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data;
}

export async function fetchAllBatchItems(batchId) {
  return fetchAllPages((from, to) =>
    supabase.from('price_history')
      .select('item_code, brand_code, old_msrp_aed, new_msrp_aed, old_msrp_sar, new_msrp_sar, old_msrp_qat, new_msrp_qat, changed_at, changed_by')
      .eq('batch_id', batchId)
      .order('item_code')
      .range(from, to)
  );
}

export async function rollbackBatch(batchId, userEmail) {
  const { error } = await supabase.rpc('rollback_batch', {
    p_batch_id:        batchId,
    p_rolled_back_by:  userEmail,
    p_rolled_back_at:  new Date().toISOString(),
  });
  if (error) throw error;
}

// ── PROJECT ITEMS ─────────────────────────────────────────────
export async function fetchProjectItems() {
  const { data, error } = await supabase
    .from('project_items')
    .select('*')
    .order('item_code');
  if (error) throw error;
  return data;
}

export async function saveProjectItem(item, { isNew = false } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email || null;
  const now   = new Date().toISOString();
  const code  = item.item_code?.toUpperCase();
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
    updated_by:        email,
  };

  if (isNew) {
    const { error } = await supabase
      .from('project_items')
      .insert({ ...row, created_by: email });
    if (error) {
      if (error.code === '23505') {
        const err = new Error('duplicate');
        err.isDuplicate = true;
        throw err;
      }
      throw error;
    }
  } else {
    const { error } = await supabase
      .from('project_items')
      .update(row)
      .eq('item_code', code);
    if (error) throw error;
  }
}

// Applies pre-computed field updates to many project items.
// Each entry must carry item_code plus only the columns being changed.
export async function bulkUpdateProjectItems(updates) {
  if (!updates?.length) return;
  const { data: { user } } = await supabase.auth.getUser();
  const stamp = { updated_at: new Date().toISOString(), updated_by: user?.email || null };
  for (const { item_code, ...fields } of updates) {
    const { error } = await supabase
      .from('project_items')
      .update({ ...fields, ...stamp })
      .eq('item_code', item_code.toUpperCase());
    if (error) throw error;
  }
}

export async function deleteProjectItem(itemCode) {
  const { error } = await supabase
    .from('project_items')
    .delete()
    .eq('item_code', itemCode.toUpperCase());
  if (error) throw error;
}
