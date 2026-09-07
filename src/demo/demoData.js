// ─────────────────────────────────────────────────────────────
// DEMO DATASET
// A fully synthetic, self-contained pricing catalogue used when
// the app runs in demo mode. No real brands, SKUs, costs or people.
// Prices are computed with the real pricing engine (pricing.js) so
// every margin, fill-rate and markup preview in the UI is coherent.
//
// The exported `store` is mutable — edits, imports, markup commits
// and rollbacks mutate it in place so the demo behaves like a real
// backend for the length of a session. A page reload reseeds.
// ─────────────────────────────────────────────────────────────
import { calcMSRPs, calcCostBasedMSRPs, calcProjectPrice } from '../lib/pricing';

// ── Exchange rates (to AED) ───────────────────────────────────
export const RATES = {
  EUR: 3.95,
  USD: 3.67,
  GBP: 4.65,
  AUD: 2.42,
  JPY: 0.025,
  SAR: 0.98,
  QAR: 1.01,
};

// ── Fake team (updated_by / changed_by) ───────────────────────
const TEAM = [
  'demo@castillo.lab',
  'ava.pricing@castillo.lab',
  'liam.ops@castillo.lab',
  'noor.catalog@castillo.lab',
];

// ── Brands ────────────────────────────────────────────────────
// markup_percentage = brand base markup, additional_markup_pct = optional 2nd pass
const BRAND_DEFS = [
  { brand_code: 'KLIM',  brand_name: 'KLIM Motorsports',      markup: 12, additional: null, count: 8 },
  { brand_code: 'ALPS',  brand_name: 'Alpine Star Gear',      markup: 10, additional: null, count: 9 },
  { brand_code: 'SHOEI', brand_name: 'Shoei Helmets',         markup: 15, additional: null, count: 7 },
  { brand_code: 'REVIT', brand_name: "Revit Apparel",         markup: 10, additional: 5,    count: 8 },
  { brand_code: 'SIDI',  brand_name: 'Sidi Riding Boots',     markup: 18, additional: null, count: 6 },
  { brand_code: 'GIVI',  brand_name: 'Givi Luggage Systems',  markup: 10, additional: null, count: 7 },
  { brand_code: 'OXFD',  brand_name: 'Oxford Products',       markup: 8,  additional: null, count: 9 },
  { brand_code: 'SENA',  brand_name: 'Sena Communications',   markup: 14, additional: 3,    count: 6 },
];

const CURRENCIES = ['EUR', 'USD', 'GBP', 'AUD', 'JPY'];
const SOURCES    = ['Portal', 'File', 'Website', 'Invoice', 'Estimate'];

// Product-name fragments to make item names read plausibly.
const NAME_HEAD = ['Adventure', 'Touring', 'Sport', 'Track', 'Urban', 'Enduro', 'Classic', 'Pro', 'Carbon', 'Alpine'];
const NAME_TAIL = ['Jacket', 'Glove', 'Helmet', 'Boot', 'Pant', 'Base Layer', 'Top Case', 'Tank Bag', 'Headset', 'Vest'];
const SIZES      = ['XS', 'S', 'M', 'L', 'XL', 'XXL', ''];

// Deterministic pseudo-random so a reload always reseeds the same catalogue.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const pf2 = (v) => (v != null ? parseFloat(Number(v).toFixed(2)) : null);
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9 + (n % 8), (n * 7) % 60, 0, 0);
  return d.toISOString();
}

// ── Build one brand's items ───────────────────────────────────
function buildBrandItems(def, rng) {
  const items = [];
  for (let i = 0; i < def.count; i++) {
    const seq = 1000 + i;
    const item_code = `${def.brand_code}-${seq}`;
    const size = pick(rng, SIZES);
    const item_name = `${def.brand_name.split(' ')[0]} ${pick(rng, NAME_HEAD)} ${pick(rng, NAME_TAIL)}${size ? ' ' + size : ''}`;
    const barcode = String(628000000000 + def.brand_code.length * 1e6 + seq * 137 + i).slice(0, 13);

    const cost_currency = pick(rng, CURRENCIES);
    // EXW cost scaled per currency so JPY items aren't tiny.
    const base = cost_currency === 'JPY' ? 4000 + Math.floor(rng() * 26000)
               : 18 + Math.floor(rng() * 240);
    const exw_cost = pf2(base);
    const shipping_rate = pick(rng, [0, 3, 5, 7.5]);
    const customs_duty_rate = pick(rng, [5, 5.5]);

    // Roughly 1 in 6 items is priced from cost + target margin.
    const costBased = rng() < 0.16;

    const updated_at = daysAgo(2 + Math.floor(rng() * 220));
    const updated_by = pick(rng, TEAM);

    let row = {
      item_code,
      item_name,
      brand_code: def.brand_code,
      barcode,
      cost_currency,
      exw_cost,
      shipping_rate,
      customs_duty_rate,
      msrp_primary_ex_vat: null,
      msrp_primary_inc_vat: null,
      msrp_primary_currency: null,
      msrp_secondary_ex_vat: null,
      msrp_secondary_inc_vat: null,
      msrp_secondary_currency: null,
      price_used: null,
      target_margin_pct: null,
      price_source: pick(rng, SOURCES),
      cost_source: pick(rng, SOURCES),
      msrp_aed: null, msrp_sar: null, msrp_qat: null,
      real_msrp_aed: null, real_msrp_sar: null, real_msrp_qat: null,
      uae_overridden: false, ksa_overridden: false, qat_overridden: false,
      created_at: updated_at,
      updated_at,
      updated_by,
    };

    if (costBased) {
      const target_margin_pct = pick(rng, [22, 25, 28, 30]);
      const msrps = calcCostBasedMSRPs(exw_cost, cost_currency, target_margin_pct, RATES);
      row = {
        ...row,
        price_used: 'cost_based',
        target_margin_pct,
        ...(msrps || {}),
      };
    } else {
      // Vendor MSRP in the cost currency — comfortably above cost.
      const msrp_primary_currency = cost_currency;
      const msrp_primary_ex_vat = pf2(exw_cost * (1.9 + rng() * 0.9));
      const msrp_primary_inc_vat = pf2(msrp_primary_ex_vat * 1.2);
      const hasSecondary = rng() < 0.35;
      const msrps = calcMSRPs(msrp_primary_ex_vat, msrp_primary_currency, def.markup, def.additional, RATES);
      row = {
        ...row,
        msrp_primary_currency,
        msrp_primary_ex_vat,
        msrp_primary_inc_vat,
        msrp_secondary_currency: hasSecondary ? msrp_primary_currency : null,
        msrp_secondary_ex_vat: hasSecondary ? pf2(msrp_primary_ex_vat * 1.08) : null,
        msrp_secondary_inc_vat: hasSecondary ? pf2(msrp_primary_ex_vat * 1.08 * 1.2) : null,
        price_used: 'primary_ex_vat',
        ...(msrps || {}),
      };
    }

    // A few manual overrides to exercise the override-aware code paths.
    if (rng() < 0.08 && row.msrp_aed) {
      row.uae_overridden = true;
      row.msrp_aed = pf2(row.msrp_aed * 1.03);
    }

    items.push(row);
  }
  return items;
}

// ── Assemble the full seed ────────────────────────────────────
function seed() {
  const brands = [];
  const brandRules = [];
  const pricingMaster = [];

  BRAND_DEFS.forEach((def, bi) => {
    brands.push({ brand_code: def.brand_code, brand_name: def.brand_name });
    brandRules.push({
      brand_code: def.brand_code,
      markup_percentage: def.markup,
      additional_markup_pct: def.additional,
    });
    const rng = makeRng(0x9e37 + bi * 7919);
    pricingMaster.push(...buildBrandItems(def, rng));
  });

  // ── Project items (cost-driven quotation pricing) ──
  const projRng = makeRng(0x51ed);
  const PROJ = [
    ['PRJ-ATLAS-01', 'Atlas Fleet Comms Kit',      'USD', 145],
    ['PRJ-ATLAS-02', 'Atlas Rider Safety Bundle',  'EUR', 260],
    ['PRJ-NOVA-01',  'Nova Track Day Package',      'EUR', 410],
    ['PRJ-NOVA-02',  'Nova Pit Crew Apparel Set',   'GBP', 88],
    ['PRJ-ORBIT-01', 'Orbit Adventure Luggage Set', 'EUR', 320],
    ['PRJ-ORBIT-02', 'Orbit Winter Layering Kit',   'USD', 175],
  ];
  const projectItems = PROJ.map(([item_code, project_item_name, cost_currency, cost]) => {
    const shipping_rate = pick(projRng, [0, 5, 7.5]);
    const customs_duty_rate = pick(projRng, [5, 5.5]);
    const target_margin_pct = pick(projRng, [20, 25, 25, 30, 35]);
    const priced = calcProjectPrice({ cost, cost_currency, shipping_rate, customs_duty_rate, target_margin_pct }, RATES) || {};
    const when = daysAgo(3 + Math.floor(projRng() * 90));
    const who = pick(projRng, TEAM);
    return {
      item_code,
      project_item_name,
      cost,
      cost_currency,
      shipping_rate,
      customs_duty_rate,
      target_margin_pct,
      msrp_aed_inc_vat: priced.msrp_aed_inc_vat ?? null,
      msrp_aed_ex_vat: priced.msrp_aed_ex_vat ?? null,
      msrp_sar: priced.msrp_sar ?? null,
      msrp_qat: priced.msrp_qat ?? null,
      uae_overridden: false, ksa_overridden: false, qat_overridden: false,
      created_by: who,
      updated_at: when,
      updated_by: who,
    };
  });

  // ── Price-history batches + detail rows ──
  const batches = [];
  const priceHistory = [];
  let hid = 1;

  const pushBatch = ({ operation_type, description, applied_by, daysBack, sampleBrand, factor, metadata }) => {
    const batch_id = `demo-batch-${batches.length + 1}`;
    const applied_at = daysAgo(daysBack);
    const sample = pricingMaster.filter(it => !sampleBrand || it.brand_code === sampleBrand);
    const rows = sample.slice(0, 24).map(it => {
      const oldAed = it.msrp_aed;
      const oldSar = it.msrp_sar;
      const oldQat = it.msrp_qat;
      return {
        id: hid++,
        batch_id,
        item_code: it.item_code,
        brand_code: it.brand_code,
        operation_type,
        changed_at: applied_at,
        changed_by: applied_by,
        old_msrp_aed: oldAed != null ? pf2(oldAed / factor) : null,
        new_msrp_aed: oldAed,
        old_msrp_sar: oldSar != null ? pf2(oldSar / factor) : null,
        new_msrp_sar: oldSar,
        old_msrp_qat: oldQat != null ? pf2(oldQat / factor) : null,
        new_msrp_qat: oldQat,
        old_exw_cost: it.exw_cost != null ? pf2(it.exw_cost / factor) : null,
        new_exw_cost: it.exw_cost,
        old_shipping_rate: it.shipping_rate,
        new_shipping_rate: it.shipping_rate,
        old_customs_duty_rate: it.customs_duty_rate,
        new_customs_duty_rate: it.customs_duty_rate,
      };
    });
    priceHistory.push(...rows);
    batches.push({
      batch_id,
      operation_type,
      description,
      applied_at,
      applied_by,
      item_count: rows.length,
      brand_count: sampleBrand ? 1 : new Set(rows.map(r => r.brand_code)).size,
      metadata: metadata ?? null,
    });
  };

  pushBatch({ operation_type: 'global_markup', description: 'Global markup — 8 brands, 60 items', applied_by: 'ava.pricing@castillo.lab', daysBack: 5,  factor: 1.05, metadata: { addMap: { REVIT: '5', SENA: '3' } } });
  pushBatch({ operation_type: 'global_markup', description: 'Global markup — Q2 refresh, 4 brands', applied_by: 'demo@castillo.lab',       daysBack: 34, factor: 1.03 });
  pushBatch({ operation_type: 'bulk_import',   description: 'Bulk import — SHOEI SS26 catalogue',   applied_by: 'noor.catalog@castillo.lab', daysBack: 12, sampleBrand: 'SHOEI', factor: 1.0 });
  pushBatch({ operation_type: 'single_edit',   description: 'Single edit — KLIM cost correction',   applied_by: 'liam.ops@castillo.lab',    daysBack: 2,  sampleBrand: 'KLIM',  factor: 1.08 });

  return {
    rates: { ...RATES },
    brands,
    brandRules,
    pricingMaster,
    projectItems,
    batches,
    priceHistory,
  };
}

// The single mutable in-memory store for the session.
export const store = seed();
