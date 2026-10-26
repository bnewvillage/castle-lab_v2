import { calcMSRPs, calcCostBasedMSRPs, msrpsFromBaseShelf, applyAdditionalMarkupUAE, pricesAtAdditionalMarkup, calcAllMargins } from './pricing';
import { prettifyShelf } from './shelfRounding';
import { suggestKSAPrice, suggestKWDPrice } from './markets';

const round2 = (v) => Math.round(v * 100) / 100;

test('additional markup pass uses the new rule', () => {
  expect(round2(applyAdditionalMarkupUAE(2000, 5) * 1.05)).toBe(prettifyShelf(2000 * 1.05 * 1.05));
});

describe('additional markup — UAE rounds once', () => {
  const rates = { EUR: 4.4, AED: 1 };
  const shelf = (v, vat) => round2(Math.round(v * vat / 0.05) * 0.05);

  test('the additional markup goes on the unrounded base', () => {
    const p = calcMSRPs(7236.2, 'AED', 0, 5, rates);
    expect(shelf(p.real_msrp_aed, 1.05)).toBe(7500);     // base, for reference
    expect(shelf(p.msrp_aed, 1.05)).toBe(7900);          // 7,977.91 → 7,900 — not 7,500 × 1.05 → 7,800
    expect(shelf(p.msrp_sar, 1.15)).toBe(8800);   // 7,523.81 × 1.02 × 1.15 = 8,825.43
    expect(p.msrp_qat).toBe(7500);
    // No additional markup: one price, as before.
    const n = calcMSRPs(7236.2, 'AED', 0, null, rates);
    expect(n.msrp_aed).toBe(n.real_msrp_aed);
  });

  test('cost-based items work the same way', () => {
    const p = calcCostBasedMSRPs(5427.15, 'AED', 25, rates, 5);   // 7,598.01 base target
    expect(shelf(p.real_msrp_aed, 1.05)).toBe(7500);
    expect(shelf(p.msrp_aed, 1.05)).toBe(7900);
  });
});

describe('pricesAtAdditionalMarkup — Global Markup', () => {
  const rates = { AED: 1, EUR: 4.4 };
  const base = (value) => ({
    price_used: 'primary_ex_vat', msrp_primary_ex_vat: value, msrp_primary_currency: 'AED',
    real_msrp_aed: round2(prettifyShelf(value * 1.05) / 1.05),
  });

  test('uses the unrounded base when the source still proves it', () => {
    const p = pricesAtAdditionalMarkup(base(7236.2), 5, { markup: 0, rates });
    expect(p.fromSource).toBe(true);
    expect(round2(p.msrp_aed * 1.05)).toBe(7900);
    expect(p.msrp_sar).toBe(round2(suggestKSAPrice(p.msrp_aed)));
  });

  test('falls back to the stored base when rates or markup have moved — never reprices', () => {
    const it = base(7236.2);
    const p = pricesAtAdditionalMarkup(it, 5, { markup: 0, rates: { AED: 1.2 } });
    expect(p.fromSource).toBe(false);
    expect(p.msrp_aed).toBe(round2(applyAdditionalMarkupUAE(it.real_msrp_aed, 5)));
  });

  test('0% reverts to the base', () => {
    const it = base(7236.2);
    expect(pricesAtAdditionalMarkup(it, 0, { markup: 0, rates }).msrp_aed).toBe(it.real_msrp_aed);
    expect(pricesAtAdditionalMarkup(it, 0, { markup: 0, rates: { AED: 1.2 } }).msrp_aed).toBe(it.real_msrp_aed);
  });

  test('cost-based items are recognised from their cost and margin', () => {
    const it = { price_used: 'cost_based', exw_cost: 5427.15, cost_currency: 'AED', target_margin_pct: 25,
      real_msrp_aed: round2(7500 / 1.05) };
    const p = pricesAtAdditionalMarkup(it, 5, { markup: 10, rates });
    expect(p.fromSource).toBe(true);
    expect(round2(p.msrp_aed * 1.05)).toBe(7900);
  });
});

describe('Kuwait in the shared price builders', () => {
  test('every source price carries a Kuwait price, from the rounded UAE price', () => {
    const p = calcMSRPs(100, 'EUR', 10, null, { EUR: 4.4 });   // UAE 510 shelf
    expect(p.msrp_kwd).toBe(41);
    expect(p.real_msrp_kwd).toBe(41);
    expect(p.msrp_kwd).toBe(suggestKWDPrice(p.msrp_aed));
  });

  test('additional markup: Kuwait follows the selling price, base follows the base', () => {
    const p = msrpsFromBaseShelf(508.2, 5);                    // UAE 535 selling, 510 base
    expect(p.msrp_kwd).toBe(suggestKWDPrice(p.msrp_aed));
    expect(p.real_msrp_kwd).toBe(suggestKWDPrice(p.real_msrp_aed));
  });

  test('Global Markup prices carry Kuwait too', () => {
    const it = { price_used: 'primary_ex_vat', msrp_primary_ex_vat: 100, msrp_primary_currency: 'EUR', real_msrp_aed: round2(510 / 1.05) };
    const p = pricesAtAdditionalMarkup(it, 5, { markup: 10, rates: { EUR: 4.4 } });
    expect(p.msrp_kwd).toBe(suggestKWDPrice(p.msrp_aed));
  });

  test('Kuwait margin converts KWD back to AED at the stored rate', () => {
    const item = { exw_cost: 10, cost_currency: 'AED', shipping_rate: 0, customs_duty_rate: 0, msrp_aed: 20, msrp_kwd: 2 };
    const m = calcAllMargins(item, { AED: 1, KWD: 12 });       // 2 KD = 24 AED; cost 10 → 58.3%
    expect(m.kwd_margin).toBeCloseTo((24 - 10) / 24 * 100, 6);
  });
});
