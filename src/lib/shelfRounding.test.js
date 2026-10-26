import { prettifyShelf, prettifyKwd } from './shelfRounding';
import { applyAdditionalMarkupUAE } from './pricing';
import { suggestKSAPrice, suggestQATPrice, suggestKWDPrice, KWD_FACTOR } from './markets';

const round2 = (v) => Math.round(v * 100) / 100;
const kwdFromUaeShelf = (shelf) => suggestKWDPrice(round2(shelf / 1.05));

describe('prettifyShelf — the rule', () => {
  test.each([
    [0, 0], [87, 90], [97, 99], [100, 99], [172, 175], [202, 199], [447, 450], [450, 450],
    [503, 499], [1196, 1199], [1203, 1199], [1214, 1215], [2905, 2899], [2994, 2995],
    [2995, 2995], [2996, 3000], [2999.99, 3000], [3000, 3000], [3045, 3000], [3049.99, 3000],
    [3050, 3050], [3120, 3100], [3180, 3150], [4995, 4950], [4999.99, 4950], [5000, 5000],
    [5099.99, 5000], [5100, 5100], [8740, 8700],
  ])('%p → %p', (target, shelf) => expect(prettifyShelf(target)).toBe(shelf));

  test('float noise never costs a step', () => {
    expect(prettifyShelf(3050 - 1e-11)).toBe(3050);
    expect(prettifyShelf(175 + 1e-11)).toBe(175);
    expect(prettifyShelf(2971.43 * 1.05)).toBe(3100);   // 3120.0015
  });

  test('invariants across the whole range', () => {
    let prev = -1;
    for (let i = 0; i <= 400000; i++) {
      const t = i * 0.05;
      const p = prettifyShelf(t);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-9);                 // never inverts
      prev = p;
      expect(p).not.toBe(2999);                                      // no charm/round pair at 3,000
      if (t >= 3000) expect(p).toBeLessThanOrEqual(t + 1e-6);         // prestige never rounds up
      if (t >= 5000) { expect(p % 100).toBe(0); expect(t - p).toBeLessThan(100); }
      else if (t >= 3000) { expect(p % 50).toBe(0); expect(t - p).toBeLessThan(50); }
      else if (p >= 100 && p !== 3000) expect([0, 5, 99].includes(p % 100) || p % 5 === 0).toBe(true);
    }
  });

  test('a second pass from a 2dp stored price never loses or gains a step', () => {
    // 5,000 base stored as 4,761.90; +10% = 5,499.9945 → 5,500, not 5,400.
    expect(round2(applyAdditionalMarkupUAE(round2(5000 / 1.05), 10) * 1.05)).toBe(5500);
    // 3,000 base stored as 2,857.14; +10% = 3,299.9967 → 3,300, not 3,250.
    expect(round2(applyAdditionalMarkupUAE(round2(3000 / 1.05), 10) * 1.05)).toBe(3300);
    // 1,150 base stored as 1,095.24 (rounded up); +10% = 1,265.0022 → 1,265, not 1,270.
    expect(round2(applyAdditionalMarkupUAE(round2(1150 / 1.05), 10) * 1.05)).toBe(1265);
    // Every base shelf price the rule can make, through common additional markups,
    // lands where the same markup on the exact shelf price would.
    const bases = new Set();
    for (let i = 2000; i <= 400000; i++) bases.add(prettifyShelf(i * 0.05));
    for (const base of bases) {
      if (base < 100) continue;
      for (const add of [2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 50]) {
        const exact = prettifyShelf(base * (1 + add / 100));
        expect(round2(applyAdditionalMarkupUAE(round2(base / 1.05), add) * 1.05)).toBe(exact);
      }
    }
  });

  // The rule only, fed one fixed UAE price.
  test('KSA and Qatar apply the same rule to their own target', () => {
    expect(round2(suggestKSAPrice(2971.43) * 1.15)).toBe(3450);   // 3,485.49 target
    expect(suggestQATPrice(2971.43)).toBe(3000);                   // 3,001.14 target
  });
});

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
