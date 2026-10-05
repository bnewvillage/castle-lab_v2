import { prettifyShelf, suggestKSAPrice, suggestQATPrice, calcMSRPs, applyAdditionalMarkupUAE } from './pricing';
import { reroundStored, planRounding, legacyUaeShelf, legacyMarketShelf, MARKETS } from './rounding';

const round2 = (v) => Math.round(v * 100) / 100;

// Sweep with an awkward step so targets don't land exactly on 5/50/100 marks.
function* targets(from = 50, to = 20000, step = 0.37) {
  for (let t = from + 0.013; t < to; t += step) yield t;
}

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

  // The rule only, fed one fixed UAE price. Not what any item ends up at: once
  // UAE re-rounds, KSA and Qatar derive from the new UAE price (see the
  // SCHB-4156218360 test under planRounding).
  test('KSA and Qatar apply the same rule to their own target', () => {
    expect(round2(suggestKSAPrice(2971.43) * 1.15)).toBe(3500);   // 3,519.66 target
    expect(suggestQATPrice(2971.43)).toBe(3000);                   // 3,001.14 target
  });
});

describe('reroundStored — inferring the target from an old price', () => {
  // Store an old shelf price the way the app did (ex-VAT, 2dp), re-round it,
  // and compare with the new rule applied to the original target.
  const check = (market, oldShelf) => {
    const { vat } = MARKETS[market];
    let exact = 0, approxRight = 0, approxHigh = 0;
    for (const t of targets()) {
      const stored = round2(oldShelf(t) / vat);
      const r = reroundStored(stored, market, { savedAfterCutoff: false });
      expect(r.status).not.toBe('manual');
      const got  = r.value ?? round2(stored);
      const want = round2(prettifyShelf(t) / vat);
      if (r.status === 'approx') {
        const step = prettifyShelf(t) >= 5000 ? 100 : 50;
        if (got === want) approxRight++;
        else { expect(got).toBe(round2((prettifyShelf(t) + step) / vat)); approxHigh++; }
      } else {
        expect(got).toBe(want);
        exact++;
      }
    }
    return { exact, approxRight, approxHigh };
  };

  test('UAE: exact except snapped hundreds at 3,000+, which are never more than one step high', () => {
    const r = check('aed', legacyUaeShelf);
    expect(r.approxRight).toBeGreaterThan(r.approxHigh);   // the hundred is the likelier side
  });
  test('KSA: always exact', () => expect(check('sar', legacyMarketShelf).approxHigh).toBe(0));
  test('Qatar: always exact', () => expect(check('qat', legacyMarketShelf).approxHigh).toBe(0));

  test('idempotent: a price already on the new rule never moves', () => {
    for (const t of targets()) for (const market of ['aed', 'sar', 'qat']) {
      const { vat } = MARKETS[market];
      const stored = round2(prettifyShelf(t) / vat);
      const r = reroundStored(stored, market, { savedAfterCutoff: true });
      expect(['same', 'ambiguous']).toContain(r.status);
    }
  });

  test('a price ending in 50 in the 3,000s is only re-rounded if saved before the cutoff', () => {
    const stored = round2(3150 / 1.05);
    expect(reroundStored(stored, 'aed', { savedAfterCutoff: false }).after).toBe(3100);
    expect(reroundStored(stored, 'aed', { savedAfterCutoff: true }).status).toBe('ambiguous');
  });

  test('hand-entered prices are left alone', () => {
    expect(reroundStored(3012.37, 'qat').status).toBe('manual');
    expect(reroundStored(round2(1000 / 1.05), 'aed').status).toBe('manual');
  });
});

describe('planRounding — the whole pass', () => {
  const rates = { EUR: 4.03, USD: 3.6725, AED: 1, SAR: 0.979333, QAR: 1.008929 };
  const rules = { KLIM: { markup: 10, additional: null }, BRND: { markup: 15, additional: 5 }, LOCL: { markup: 0, additional: null } };

  // Price an item exactly the way the old code did.
  function legacyItem(code, brand, value, currency, extra = {}) {
    const { markup, additional } = rules[brand];
    const real = round2(legacyUaeShelf(value * rates[currency] * (1 + markup / 100) * 1.05) / 1.05);
    const msrp = additional ? round2(legacyUaeShelf(real * (1 + additional / 100) * 1.05) / 1.05) : real;
    const k = (a) => round2(legacyMarketShelf(a * 1.03 * 1.15) / 1.15);
    const q = (a) => round2(legacyMarketShelf(a * 1.01));
    return {
      item_code: code, brand_code: brand, price_used: 'primary_ex_vat',
      msrp_primary_ex_vat: value, msrp_primary_currency: currency,
      msrp_aed: msrp, msrp_sar: k(msrp), msrp_qat: q(msrp),
      real_msrp_aed: real, real_msrp_sar: k(real), real_msrp_qat: q(real),
      uae_overridden: false, ksa_overridden: false, qat_overridden: false,
      updated_at: '2026-01-01T00:00:00Z', ...extra,
    };
  }

  test('unchanged rates and markups: every price lands exactly where a fresh save would', () => {
    const items = [];
    for (let v = 40; v < 3000; v += 13.7) {
      items.push(legacyItem(`K${v}`, 'KLIM', v, 'EUR'));
      items.push(legacyItem(`B${v}`, 'BRND', v, 'USD'));
    }
    const { changes, tally } = planRounding(items, { rates, rules, cutoff: '2026-06-01T00:00:00Z' });
    expect(tally.aed.approx + tally.aed.ambiguous + tally.aed.manual + tally.aed.change).toBe(0);

    const byCode = Object.fromEntries(changes.map(c => [c.item_code, c]));
    for (const it of items) {
      const { markup, additional } = rules[it.brand_code];
      const fresh = calcMSRPs(it.msrp_primary_ex_vat, it.msrp_primary_currency, markup, additional, rates);
      const set = byCode[it.item_code]?.set ?? {};
      expect(set.msrp_aed ?? it.msrp_aed).toBe(fresh.msrp_aed);
      expect(set.real_msrp_aed ?? it.real_msrp_aed).toBe(fresh.real_msrp_aed);
      expect(set.msrp_sar ?? it.msrp_sar).toBe(fresh.msrp_sar);
      expect(set.msrp_qat ?? it.msrp_qat).toBe(fresh.msrp_qat);
      expect(set.real_msrp_sar ?? it.real_msrp_sar).toBe(fresh.real_msrp_sar);
    }
  });

  test('AED item on a round number keeps 3,150 rather than dropping to 3,100', () => {
    const it = legacyItem('LOCAL-1', 'LOCL', 3000, 'AED');    // 3,000 × 1.05 = 3,150 exactly
    expect(round2(it.msrp_aed * 1.05)).toBe(3150);
    const { changes } = planRounding([it], { rates, rules });
    const set = changes[0]?.set ?? {};
    expect(set.msrp_aed).toBeUndefined();                       // 3,150 is already right — not 3,100
    expect(set.real_msrp_aed).toBeUndefined();
    expect(set.msrp_sar).toBe(round2(suggestKSAPrice(3000)));   // 3,553.5 target → 3,550 shelf
    expect(set.msrp_qat).toBe(suggestQATPrice(3000));           // 3,030 target → 3,000
  });

  test('SCHB-4156218360 ends at UAE 3,100 / KSA 3,450 / Qatar 2,985', () => {
    // Stored prices as live on 30 Sept 2026 (old rule: shelf 3,120 / 3,520 / 3,005).
    const live = {
      item_code: 'SCHB-4156218360', brand_code: 'SCHB',
      msrp_aed: 2971.43, msrp_sar: 3060.87, msrp_qat: 3005,
      real_msrp_aed: 2971.43, real_msrp_sar: 3060.87, real_msrp_qat: 3005,
      uae_overridden: false, ksa_overridden: false, qat_overridden: false,
      updated_at: '2026-09-30T00:00:00Z',
    };
    const { changes } = planRounding([live], { rates: {}, rules: {} });
    const { set } = changes[0];
    expect(round2(set.msrp_aed * 1.05)).toBe(3100);
    expect(set.msrp_aed).toBe(2952.38);
    // KSA derives from the re-rounded UAE price: 2,952.38 × 1.03 × 1.15 =
    // 3,497.09, floored to 3,450 — not 3,500, which the old UAE price gives.
    expect(round2(set.msrp_sar * 1.15)).toBe(3450);
    expect(set.msrp_sar).toBe(3000);
    // 2,952.38 × 1.01 = 2,981.90, under 3,000 so up to the 5.
    expect(set.msrp_qat).toBe(2985);
    expect(set.real_msrp_aed).toBe(2952.38);
    expect(set.real_msrp_sar).toBe(3000);
    expect(set.real_msrp_qat).toBe(2985);
  });

  test('drifted exchange rate: prices are re-rounded, never repriced', () => {
    const items = [];
    for (let v = 40; v < 3000; v += 13.7) items.push(legacyItem(`K${v}`, 'KLIM', v, 'EUR'));
    const drifted = { ...rates, EUR: 4.31 };                    // a 7% move
    const { changes, tally } = planRounding(items, { rates: drifted, rules });
    expect(tally.aed.exact).toBe(0);                            // the old pipeline no longer reproduces them
    const byCode = Object.fromEntries(changes.map(c => [c.item_code, c]));
    for (const it of items) {
      const set = byCode[it.item_code]?.set ?? {};
      const aedNew = set.msrp_aed ?? it.msrp_aed;
      // UAE moves only within its rounding grid — never by the 7% a
      // recalculation at the drifted rate would have.
      const grid = it.msrp_aed * 1.05 >= 5000 ? 100 : 50;
      expect(Math.abs(aedNew - it.msrp_aed) * 1.05).toBeLessThanOrEqual(grid + 0.01);
      // KSA and Qatar follow the new UAE price, exactly as a save would derive them.
      expect(set.msrp_sar ?? it.msrp_sar).toBe(round2(suggestKSAPrice(aedNew)));
      expect(set.msrp_qat ?? it.msrp_qat).toBe(round2(suggestQATPrice(aedNew)));
    }
  });

  test('overridden prices are never touched; KSA and Qatar still follow a manual UAE price', () => {
    const it = legacyItem('OVR-1', 'KLIM', 700, 'EUR', { uae_overridden: true, qat_overridden: true });
    it.msrp_aed = 2999.95 / 1.05;                                // a hand-set UAE price
    it.msrp_sar = round2(legacyMarketShelf(it.msrp_aed * 1.03 * 1.15) / 1.15);
    const { changes, tally } = planRounding([it], { rates, rules });
    expect(tally.aed.overridden).toBe(1);
    expect(tally.qat.overridden).toBe(1);
    const set = changes[0]?.set ?? {};
    expect(set.msrp_aed).toBeUndefined();
    expect(set.msrp_qat).toBeUndefined();
    expect(set.msrp_sar).toBe(round2(suggestKSAPrice(it.msrp_aed)));
  });

  test('records exactly what it read, for the compare-and-set on apply', () => {
    const it = legacyItem('EXP-1', 'KLIM', 961, 'EUR');
    const { changes } = planRounding([it], { rates, rules });
    expect(changes[0].expect).toEqual({
      msrp_aed: it.msrp_aed, real_msrp_aed: it.real_msrp_aed,
      msrp_sar: it.msrp_sar, real_msrp_sar: it.real_msrp_sar,
      msrp_qat: it.msrp_qat, real_msrp_qat: it.real_msrp_qat,
    });
  });

  test('running the plan twice changes nothing the second time', () => {
    const items = [];
    for (let v = 40; v < 3000; v += 29.3) items.push(legacyItem(`K${v}`, 'KLIM', v, 'EUR'));
    const first = planRounding(items, { rates, rules });
    const applied = items.map(it => ({ ...it, ...(first.changes.find(c => c.item_code === it.item_code)?.set ?? {}), updated_at: '2026-12-01T00:00:00Z' }));
    const second = planRounding(applied, { rates, rules, cutoff: '2026-06-01T00:00:00Z' });
    expect(second.changes).toHaveLength(0);
  });
});

test('additional markup pass uses the new rule', () => {
  expect(round2(applyAdditionalMarkupUAE(2000, 5) * 1.05)).toBe(prettifyShelf(2000 * 1.05 * 1.05));
});
