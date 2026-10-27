// ─────────────────────────────────────────────────────────────
// DEMO ERP REPORTS
// Stands in for the live ERPNext proxy when running in demo mode.
// Produces synthetic "current ERP price list" rows from the demo
// catalogue so the ERP export + markup screens fully function
// without any credentials or network access.
// ─────────────────────────────────────────────────────────────
import { store } from './demoData';
import { MARKETS, UAE } from '../lib/markets';
import { projectAsItem } from '../lib/rows';

// A few codes that exist in ERP but not in the demo catalogue,
// so the "no price / no match" stats are non-zero and realistic.
const UNMATCHED = ['LEGACY-4471', 'DISC-0098', 'ARCH-2210'];

export function demoErpReport(reportName) {
  // Kuwait's price list isn't set up in the (demo) ERP yet: answer the way the
  // proxy does for a report the ERP doesn't have.
  if (/KWD/.test(reportName)) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('Report not found in the ERP')), 200));
  }
  // The market whose price list this is.
  const m = MARKETS.find(mk => mk.report === reportName) ?? UAE;
  const { currency, price: field } = m;
  const price_list = `${m.short} Retail`;

  // The ERP's lists carry the project items too.
  const rows = [...store.pricingMaster, ...store.projectItems.map(projectAsItem)].map(it => ({
    name: `${it.item_code}-${price_list.replace(/\s/g, '')}`,
    item_code: it.item_code,
    price_list,
    currency,
    // Existing ERP rate — intentionally a little stale vs the master.
    price_list_rate: it[field] != null ? +(it[field] / 1.04).toFixed(2) : 0,
  }));

  UNMATCHED.forEach((code, i) => rows.push({
    name: `${code}-${price_list.replace(/\s/g, '')}`,
    item_code: code,
    price_list,
    currency,
    price_list_rate: 100 + i * 25,
  }));

  // Simulate the proxy round-trip.
  return new Promise(resolve => setTimeout(() => resolve(rows), 260));
}

// Open purchase-request lines in the shape the erp-proxy 'purchase_requests'
// action returns. Two companies; a partly ordered line; one already on a
// draft PO; one item the catalogue doesn't have; a box-of-6 UOM.
export function demoPurchaseRequests() {
  const COMPANIES = [
    { name: 'Demo Trading UAE LLC', abbr: 'DTU', wh: 'Reservation - DTU' },
    { name: 'Demo Trading KSA',     abbr: 'DTK', wh: 'Reservation - DTK' },
  ];
  const brands = Object.fromEntries(store.brands.map(b => [b.brand_code, b.brand_name]));
  const pick = store.pricingMaster.filter((_, i) => i % 3 === 0).slice(0, 16);
  const lines = pick.map((it, i) => {
    const co = COMPANIES[i % 4 === 3 ? 1 : 0];
    const req = `MR-DEMO-${String(100 + Math.floor(i / 3)).padStart(5, '0')}`;
    const qty = 1 + (i % 4);
    const ordered = i === 2 ? 1 : 0;
    return {
      line_id: `mri-demo-${i}`, request_id: req, idx: (i % 3) + 1, company: co.name,
      request_status: ordered ? 'Partially Ordered' : 'Pending', transaction_date: '2026-10-14',
      owner: i % 2 ? 'sales.demo@castillo.lab' : 'ops.demo@castillo.lab',
      item_code: it.item_code, item_name: it.item_name, description: it.item_name,
      brand: brands[it.brand_code] ?? it.brand_code, item_group: brands[it.brand_code] ?? it.brand_code,
      qty, ordered_qty: ordered, outstanding_qty: qty - ordered,
      uom: 'Nos', stock_uom: 'Nos', conversion_factor: 1,
      schedule_date: `2026-${i < 8 ? '10-31' : '11-15'}`, warehouse: co.wh,
      sales_order: i % 2 ? `SO-DEMO-${String(400 + i).padStart(5, '0')}` : null,
      sales_order_item: i % 2 ? `soi-demo-${i}` : null,
      expense_account: `5100 - Cost of Goods Sold - ${co.abbr}`, cost_center: `Main - ${co.abbr}`, project: null,
      draft_pos: i === 5 ? ['PUR-ORD-DEMO-00031'] : [],
    };
  });
  lines.push({
    ...lines[0], line_id: 'mri-demo-x', idx: 4, item_code: 'LEGACY-4471', item_name: 'Discontinued bracket',
    description: 'Discontinued bracket', qty: 2, outstanding_qty: 2,
  });
  lines.push({
    ...lines[1], line_id: 'mri-demo-box', idx: 5, uom: 'Box', conversion_factor: 6, qty: 2, outstanding_qty: 2,
  });
  return new Promise(resolve => setTimeout(() => resolve(lines), 400));
}
