import { supabase } from './supabase';

// ── INTERNAL HELPERS ──────────────────────────────────────────

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
};

const CHUNK = 500;   // max rows per upsert / .in() batch
const PAGE  = 1000;  // rows per paginated fetch

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Walks a Supabase query builder through all pages and concatenates results.
// buildQuery receives (from, to) and must return the full query.
async function fetchAllPages(buildQuery) {
  let all  = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
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

// ── PRICING MASTER ────────────────────────────────────────────
export async function searchItems(query) {
  if (!query?.trim()) return [];
  const q = query.trim();
  const { data, error } = await supabase.from('pricing_master')
    .select('*, brands(brand_name)')
    .or(`item_code.ilike.%${q.toUpperCase()}%,item_name.ilike.%${q}%`)
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
      .select('item_code, exw_cost, cost_currency, shipping_rate, customs_duty_rate, msrp_primary_ex_vat, msrp_primary_inc_vat, msrp_primary_currency, msrp_secondary_ex_vat, msrp_secondary_inc_vat, msrp_secondary_currency, price_used, msrp_aed, msrp_sar, msrp_qat')
      .in('item_code', batch);
    if (error) throw error;
    results.push(...data);
  }
  return Object.fromEntries(results.map(r => [r.item_code, r]));
}

// ── ITEM LIST ─────────────────────────────────────────────────
export async function fetchItemList({ brandCode, search, page = 0, pageSize = 100 } = {}) {
  let query = supabase
    .from('pricing_master')
    .select('item_code, item_name, barcode, brand_code, cost_currency, exw_cost, shipping_rate, customs_duty_rate, msrp_primary_ex_vat, msrp_primary_inc_vat, msrp_primary_currency, msrp_secondary_ex_vat, msrp_secondary_inc_vat, msrp_secondary_currency, price_used, msrp_aed, msrp_sar, msrp_qat, price_source, cost_source, target_margin_pct, updated_at, updated_by', { count: 'exact' })
    .order('item_code')
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (brandCode) query = query.eq('brand_code', brandCode);
  if (search?.trim()) {
    const q = search.trim();
    query = query.or(`item_code.ilike.%${q.toUpperCase()}%,item_name.ilike.%${q}%`);
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

export async function deleteProjectItem(itemCode) {
  const { error } = await supabase
    .from('project_items')
    .delete()
    .eq('item_code', itemCode.toUpperCase());
  if (error) throw error;
}
