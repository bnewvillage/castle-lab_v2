// ─────────────────────────────────────────────────────────────
// THE PRICES ERP LISTS ARE MATCHED AGAINST
// One read for every ERP page: the catalogue's prices and, where the page fills
// prices, the project items' too (in the catalogue's row shape). The checks
// pages leave project items out: quotes aren't expected to exist in the ERP.
// ─────────────────────────────────────────────────────────────
import { fetchAllItemsForErpAutomation, fetchProjectItems } from './db';
import { PROJECT_BRAND, companyBaseCosts } from './pricing';
import { projectAsItem } from './rows';
import { PRICE_COLUMNS, BASE_COST_COLUMNS } from './markets';

/**
 * @param brands    narrows the read (empty = everything); PROJECT_BRAND in it
 *                  stands for the project items
 * @param projects  whether project items are part of this page's prices at all
 * @returns {{ rows, projects }}  the rows, and how many of them are project items
 */
export async function fetchPriceRows({ brands = [], projects = true } = {}) {
  const scoped    = brands.length > 0;
  const catalogue = brands.filter(b => b !== PROJECT_BRAND);
  const wantProjects = projects && (!scoped || brands.includes(PROJECT_BRAND));
  const [items, projectRows] = await Promise.all([
    !scoped ? fetchAllItemsForErpAutomation() : catalogue.length ? fetchAllItemsForErpAutomation(catalogue) : [],
    wantProjects ? fetchProjectItems() : [],
  ]);
  return { rows: [...items, ...projectRows.map(projectAsItem)], projects: projectRows.length };
}

// The brand filter of a page that includes project items: they are one more brand.
export const withProjectBrand = (brands) => brands.some(b => b.brand_code === PROJECT_BRAND)
  ? brands : [...brands, { brand_code: PROJECT_BRAND, brand_name: 'Project items' }];

/**
 * Fills the ERP's in-stock-without-price rows from the pricing master: each
 * row matched on its item code, or failing that its barcode, gets the
 * barcode, every market's price and every company base cost. A catalogue
 * item's base costs are the stored ones; a project item has none stored, so
 * its are worked out from its cost at the given rates.
 * @param rows       the report's rows, untouched apart from the added columns
 * @param itemKey    the report column holding the item code
 * @param priceRows  fetchPriceRows().rows
 * @returns {{ rows, headers, matched }}  headers: the report's own columns
 *          first, then the added ones, so the sheet reads like the ERP view
 */
export function fillStockRows(rows, itemKey, priceRows, rates) {
  const byCode    = new Map(priceRows.map(r => [r.item_code?.toUpperCase(), r]));
  const byBarcode = new Map(priceRows.filter(r => r.barcode).map(r => [String(r.barcode).toUpperCase(), r]));

  const filled = rows.map(r => {
    const key  = String(r[itemKey] ?? '').toUpperCase();
    const code = byCode.get(key);
    const db   = code ?? byBarcode.get(key) ?? null;
    const costs = db?.brand_code === PROJECT_BRAND ? companyBaseCosts(db, rates) : db;
    return {
      ...r,
      barcode: db?.barcode ?? '',
      ...Object.fromEntries(PRICE_COLUMNS.map(c => [c, db?.[c] ?? ''])),
      ...Object.fromEntries(BASE_COST_COLUMNS.map(c => [c, costs?.[c] ?? ''])),
      match_type: code ? 'item_code' : db ? 'barcode' : 'no_match',
      _missing: !db,
    };
  });

  const added    = ['barcode', ...PRICE_COLUMNS, ...BASE_COST_COLUMNS, 'match_type'];
  const original = rows.length ? Object.keys(rows[0]).filter(k => !added.includes(k)) : [];
  return { rows: filled, headers: [...original, ...added], matched: filled.filter(r => !r._missing).length };
}
