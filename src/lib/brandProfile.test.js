import { brandProfile } from './brandProfile';

const rates = { AED: 1, EUR: 4 };
// An MSRP-priced row whose EXW margin is exactly `margin` %: price 100 EUR, cost (100 − margin).
const row = (code, margin, over = {}) => ({
  item_code: code, price_used: 'primary_ex_vat', msrp_primary_ex_vat: 100, msrp_primary_currency: 'EUR',
  exw_cost: 100 - margin, cost_currency: 'EUR', ...over,
});

test('price bases and currencies: each distinct value with its count and share, most used first', () => {
  const p = brandProfile([row('A', 40), row('B', 40), row('C', 30, { price_used: 'cost_based', cost_currency: 'AED' }), row('D', 30)], rates);
  expect(p.count).toBe(4);
  expect(p.bases).toEqual([
    { value: 'primary_ex_vat', label: 'Primary w/o VAT', count: 3, pct: 75 },
    { value: 'cost_based', label: 'Cost + margin', count: 1, pct: 25 },
  ]);
  expect(p.costCurrencies.map(c => [c.label, c.count])).toEqual([['EUR', 3], ['AED', 1]]);
  expect(p.msrpCurrencies).toEqual([{ value: 'EUR', label: 'EUR', count: 3, pct: 100 }]);   // of the MSRP-priced three
});

test('EXW margins: median, mean, mode, and the SKUs sharing the min and max, as shares of the brand', () => {
  const p = brandProfile([row('A', 20), row('B', 20), row('C', 35), row('D', 50), row('E', 50), row('F', 50), row('G', 0, { exw_cost: 0 })], rates);
  expect(p.exw.n).toBe(6);
  expect(p.exw.missing).toBe(1);                         // cost 0 is "no cost data"
  expect(p.exw.median).toBeCloseTo(42.5, 9);             // 35 and 50
  expect(p.exw.mean).toBeCloseTo((20 + 20 + 35 + 50 * 3) / 6, 9);
  expect(p.exw.mode).toMatchObject({ value: 50, count: 3 });
  expect(p.exw.min).toEqual({ value: 20, sku: 'A', count: 2, pct: (2 / 7) * 100 });
  expect(p.exw.max).toMatchObject({ value: 50, sku: 'D', count: 3 });
});

test('no mode when no margin repeats; nothing to show for an empty brand', () => {
  expect(brandProfile([row('A', 10), row('B', 20)], rates).exw.mode).toBeNull();
  expect(brandProfile([], rates)).toMatchObject({ count: 0, bases: [], exw: { n: 0 } });
});

test('landed margin covers cost-priced SKUs too: UAE price vs landed cost', () => {
  const cost = row('C', 0, { price_used: 'landed_cost_based', exw_cost: 50, cost_currency: 'AED', shipping_rate: 0, customs_duty_rate: 0, msrp_aed: 100 });
  const p = brandProfile([cost, row('A', 40, { msrp_aed: 0 })], rates);
  expect(p.exw.n).toBe(1);                                   // only A has a vendor price
  expect(p.landed).toMatchObject({ n: 1, missing: 1, median: 50 });   // C: 100 AED vs 50 landed; A has no UAE price
  expect(p.landed.min).toMatchObject({ value: 50, sku: 'C', count: 1 });
});

test('a margin with no SKUs says why, counted by reason', () => {
  const landed = (code) => row(code, 0, { price_used: 'landed_cost_based', msrp_primary_ex_vat: null, exw_cost: 320, cost_currency: 'EUR', msrp_aed: 1833.33 });
  const p = brandProfile([landed('A'), landed('B')], rates);
  expect(p.exw).toMatchObject({ n: 0, missing: 2, gaps: [{ reason: 'priced from cost, so no vendor MSRP', count: 2 }] });
  expect(p.landed.n).toBe(2);
  const mixed = brandProfile([landed('A'), row('B', 30, { exw_cost: 0 }), row('C', 30, { msrp_primary_ex_vat: null })], rates);
  expect(mixed.exw.gaps).toEqual([
    { reason: 'priced from cost, so no vendor MSRP', count: 1 },
    { reason: 'no EXW cost', count: 1 },
    { reason: 'no vendor MSRP without VAT', count: 1 },
  ]);
});
