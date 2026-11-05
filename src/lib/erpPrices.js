// ─────────────────────────────────────────────────────────────
// THE PRICES ERP LISTS ARE MATCHED AGAINST
// One read for every ERP page: the catalogue's prices and, where the page fills
// prices, the project items' too (in the catalogue's row shape). The checks
// pages leave project items out: quotes aren't expected to exist in the ERP.
// ─────────────────────────────────────────────────────────────
import { fetchAllItemsForErpAutomation, fetchProjectItems } from './db';
import { PROJECT_BRAND } from './pricing';
import { projectAsItem } from './rows';

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
