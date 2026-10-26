import { prettifyKwd, suggestKWDPrice, KWD_FACTOR, msrpsFromBaseShelf, calcMSRPs, calcAllMargins, pricesAtAdditionalMarkup } from './pricing';

const r2 = (v) => Math.round(v * 100) / 100;
const kwdFromUaeShelf = (shelf) => suggestKWDPrice(r2(shelf / 1.05));

describe('Kuwait: UAE ex-VAT × 0.084, Kuwait ladder, no VAT', () => {
  test('the factor', () => expect(KWD_FACTOR).toBe(0.084));

  // The figures from the proposal you approved.
  test.each([
    [49, 4], [99, 8], [105, 8.5], [150, 12], [199, 16], [299, 24], [450, 36], [510, 41],
    [999, 79.9], [1199, 96], [1499, 119.9], [2499, 199.9], [2995, 239.9], [3000, 239.9],
    [3100, 248], [3500, 280], [4950, 395], [5000, 400], [5400, 430], [7900, 630], [9900, 790],
    [15000, 1200], [25000, 2000],
  ])('UAE %p AED shelf → %p KD', (uae, kd) => expect(kwdFromUaeShelf(uae)).toBe(kd));

  test.each([
    [0.37, 0.4], [0.951, 1], [1.73, 1.8],
    [4.96, 4.9],                    // rounds up to 5.000, a multiple of 5 → 4.900
    [5.2, 4.9],                     // 5.250 is within 0.250 above 5 → snaps → 4.900
    [5.3, 5.5], [12.37, 12.5], [20.2, 19.9], [19.95, 19.9], [24, 24], [99.95, 99.9],
    [137.2, 137.5], [150.6, 149.9], [161.2, 161.5], [249.95, 250], [250, 250],
    [318.4, 315], [499.99, 495], [500, 500], [538, 530],
  ])('ladder: %p KD target → %p', (t, kd) => expect(prettifyKwd(t)).toBe(kd));

  test('2dp storage noise never costs a step', () => {
    expect(prettifyKwd(399.9996)).toBe(400);          // 4,761.90 × 0.084
    expect(prettifyKwd(279.99972)).toBe(280);         // 3,333.33 × 0.084
    expect(prettifyKwd(2.00004)).toBe(2);             // 23.81 × 0.084 — not up to 2.100
    expect(kwdFromUaeShelf(5000)).toBe(400);
  });

  test('invariants across the whole range', () => {
    let prev = -1;
    for (let i = 1; i <= 120000; i++) {
      const t = i * 0.01;                               // 0.01 – 1,200 KD
      const k = prettifyKwd(t);
      expect(k).toBeGreaterThanOrEqual(prev - 1e-9);     // never inverts price order
      prev = k;
      expect(k).not.toBe(249.9);                         // the 250 mark is never charmed
      expect(Math.abs(k * 100 - Math.round(k * 100))).toBeLessThan(1e-6);   // fits the ERP's 2 decimals
      if (t >= 250) expect(k).toBeLessThanOrEqual(t + 0.001);                // prestige never rounds up
      if (t >= 500) { expect(k % 10).toBeCloseTo(0, 6); expect(t - k).toBeLessThan(10 + 1e-6); }
      else if (t >= 250) { expect(k % 5).toBeCloseTo(0, 6); expect(t - k).toBeLessThan(5 + 1e-6); }
      else expect(['.000', '.050', '.100', '.150', '.200', '.250', '.300', '.350', '.400', '.450', '.500',
                   '.550', '.600', '.650', '.700', '.750', '.800', '.850', '.900', '.950'])
             .toContain((k % 1).toFixed(3).slice(1));
    }
  });

  test('5–250 KD only ever ends in .000 .250 .500 .750 .900', () => {
    for (let i = 500; i < 25000; i++) {
      const k = prettifyKwd(i * 0.01);
      if (k >= 5 && k < 250) expect(['.000', '.250', '.500', '.750', '.900']).toContain((k % 1).toFixed(3).slice(1));
    }
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
    const it = { price_used: 'primary_ex_vat', msrp_primary_ex_vat: 100, msrp_primary_currency: 'EUR', real_msrp_aed: r2(510 / 1.05) };
    const p = pricesAtAdditionalMarkup(it, 5, { markup: 10, rates: { EUR: 4.4 } });
    expect(p.msrp_kwd).toBe(suggestKWDPrice(p.msrp_aed));
  });

  test('Kuwait margin converts KWD back to AED at the stored rate', () => {
    const item = { exw_cost: 10, cost_currency: 'AED', shipping_rate: 0, customs_duty_rate: 0, msrp_aed: 20, msrp_kwd: 2 };
    const m = calcAllMargins(item, { AED: 1, KWD: 12 });       // 2 KD = 24 AED; cost 10 → 58.3%
    expect(m.kwd_margin).toBeCloseTo((24 - 10) / 24 * 100, 6);
  });
});

describe('planKwdRecalc — fill and keep Kuwait from UAE', () => {
  const { planKwdRecalc } = require('./rounding');
  const item = (over = {}) => ({
    item_code: 'TEST-1', brand_code: 'TEST', msrp_aed: r2(510 / 1.05), real_msrp_aed: r2(510 / 1.05),
    msrp_sar: 500, real_msrp_sar: 500, msrp_qat: 495, real_msrp_qat: 495,
    msrp_kwd: null, real_msrp_kwd: null, kwd_overridden: false, ...over,
  });

  test('an item with no Kuwait price is filled, at what a save gives', () => {
    const { changes, tally } = planKwdRecalc([item()]);
    expect(tally).toEqual({ change: 1, outOfStep: 0, baseOnly: 0, same: 0, overridden: 0, noUae: 0 });
    expect(changes[0].set).toEqual({ msrp_kwd: 41, real_msrp_kwd: 41 });
    expect(changes[0].lines[0]).toMatchObject({ market: 'kwd', before: null, after: 41 });
  });

  test('only Kuwait is written; all eight prices are recorded for the compare-and-set', () => {
    const { changes } = planKwdRecalc([item()]);
    expect(Object.keys(changes[0].set).sort()).toEqual(['msrp_kwd', 'real_msrp_kwd']);
    expect(Object.keys(changes[0].expect)).toHaveLength(8);
  });

  test('a second run finds nothing', () => {
    const items = [];
    for (let v = 20; v < 60000; v += 97.3) {
      const aed = r2(v / 1.05);
      items.push(item({ item_code: `T${v}`, msrp_aed: aed, real_msrp_aed: aed }));
    }
    const first = planKwdRecalc(items);
    const applied = items.map(it => ({ ...it, ...(first.changes.find(c => c.item_code === it.item_code)?.set ?? {}) }));
    expect(planKwdRecalc(applied).changes).toHaveLength(0);
    for (const it of applied) expect(it.msrp_kwd).toBe(suggestKWDPrice(it.msrp_aed));
  });

  test('hand-set Kuwait prices: flagged ones are skipped, unflagged ones listed but not moved', () => {
    const flagged   = item({ kwd_overridden: true, msrp_kwd: 39.9 });
    const unflagged = item({ item_code: 'TEST-2', msrp_kwd: 39.9 });
    const { changes, outOfStep, tally } = planKwdRecalc([flagged, unflagged]);
    expect(tally.overridden).toBe(1);
    expect(tally.outOfStep).toBe(1);
    expect(outOfStep[0]).toMatchObject({ code: 'TEST-2', before: 39.9, after: 41 });
    expect(changes.flatMap(c => Object.keys(c.set))).not.toContain('msrp_kwd');
  });
});
