// ─────────────────────────────────────────────────────────────
// DEMO ERP REPORTS
// Stands in for the live ERPNext proxy when running in demo mode.
// Produces synthetic "current ERP price list" rows from the demo
// catalogue so the ERP export + markup screens fully function
// without any credentials or network access.
// ─────────────────────────────────────────────────────────────
import { store } from './demoData';

// Report name → { currency, price_list } used in the ERP.
function meta(reportName = '') {
  if (reportName.includes('SAR')) return { currency: 'SAR', price_list: 'KSA Retail' };
  if (reportName.includes('QAR')) return { currency: 'QAR', price_list: 'QAT Retail' };
  return { currency: 'AED', price_list: 'UAE Retail' };
}

// A few codes that exist in ERP but not in the demo catalogue,
// so the "no price / no match" stats are non-zero and realistic.
const UNMATCHED = ['LEGACY-4471', 'DISC-0098', 'ARCH-2210'];

export function demoErpReport(reportName) {
  const { currency, price_list } = meta(reportName);
  const field = currency === 'SAR' ? 'msrp_sar' : currency === 'QAR' ? 'msrp_qat' : 'msrp_aed';

  const rows = store.pricingMaster.map(it => ({
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
