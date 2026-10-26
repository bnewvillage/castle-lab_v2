import { planMarketRecalc } from './marketRecalc';
import { prettifyShelf } from './shelfRounding';
import { DERIVED, PRICE_COLUMNS, REAL_COLUMNS, suggestKSAPrice, suggestKWDPrice } from './markets';

const round2 = (v) => Math.round(v * 100) / 100;
const applyPlan = (items, plan) => items.map(it => ({ ...it, ...(plan.changes.find(c => c.item_code === it.item_code)?.set ?? {}) }));
const NONE = { change: 0, outOfStep: 0, baseOnly: 0, same: 0, overridden: 0, noUae: 0 };

describe('planMarketRecalc — KSA from UAE at the current factor', () => {
  const recalc = (items, opts) => planMarketRecalc(items, 'sar', opts);
  const ksa = (aed) => round2(suggestKSAPrice(aed));
  // A KSA price saved under ×1.03: UAE 510 shelf (485.71 ex-VAT) → KSA 580 shelf.
  const old103 = (aed) => round2(prettifyShelf(aed * 1.03 * 1.15) / 1.15);
  const item = (over = {}) => ({
    item_code: 'TEST-1', brand_code: 'TEST', msrp_aed: 485.71, real_msrp_aed: 485.71,
    msrp_sar: ksa(485.71), real_msrp_sar: ksa(485.71), msrp_qat: 495, real_msrp_qat: 495,
    ksa_overridden: false, ...over,
  });

  test('a KSA price that follows UAE is already right', () => {
    expect(recalc([item()]).tally).toEqual({ ...NONE, same: 1 });
  });

  test('a price at an old factor is out of step: listed, moved only on request — 580 → 570 SAR shelf', () => {
    const it = item({ msrp_sar: old103(485.71), real_msrp_sar: old103(485.71) });
    expect(round2(it.msrp_sar * 1.15)).toBe(580);
    const off = recalc([it]);
    expect(off.tally).toEqual({ ...NONE, outOfStep: 1 });
    expect(off.changes).toHaveLength(0);
    expect(off.outOfStep[0]).toMatchObject({ code: 'TEST-1', before: 580, after: 570, uae: 510 });
    const on = recalc([it], { includeOutOfStep: true });
    expect(on.changes[0].set).toEqual({ msrp_sar: ksa(485.71), real_msrp_sar: ksa(485.71) });
    expect(on.changes[0].lines).toEqual([{ market: 'sar', before: 580, after: 570, status: 'outOfStep' }]);
  });

  test('a missing KSA price is filled, and never touches UAE or Qatar', () => {
    const { changes, tally } = recalc([item({ msrp_sar: null, real_msrp_sar: null })]);
    expect(tally).toEqual({ ...NONE, change: 1 });
    expect(changes[0].set).toEqual({ msrp_sar: ksa(485.71), real_msrp_sar: ksa(485.71) });
  });

  test('records every price it read, for the compare-and-set on apply', () => {
    const it = item({ msrp_sar: null });
    expect(recalc([it]).changes[0].expect).toEqual({
      msrp_aed: it.msrp_aed, real_msrp_aed: it.real_msrp_aed, msrp_sar: null,
      real_msrp_sar: it.real_msrp_sar, msrp_qat: it.msrp_qat, real_msrp_qat: it.real_msrp_qat,
      msrp_kwd: null, real_msrp_kwd: null,
    });
  });

  test('hand-set KSA prices and items with no UAE price are left alone', () => {
    const { changes, tally } = recalc([item({ ksa_overridden: true, msrp_sar: null }), item({ msrp_aed: null })]);
    expect(changes).toHaveLength(0);
    expect(tally).toEqual({ ...NONE, overridden: 1, noUae: 1 });
  });

  test('real_msrp_sar follows real_msrp_aed (base price before additional markup)', () => {
    const it = item({ real_msrp_aed: 466.67, real_msrp_sar: null });   // 490 base, 510 selling
    const { changes, tally } = recalc([it]);
    expect(tally).toEqual({ ...NONE, baseOnly: 1 });
    expect(changes[0].set).toEqual({ real_msrp_sar: ksa(466.67) });
  });

  test('a second run finds nothing: every price is exactly what a save gives today', () => {
    const items = [];
    for (let v = 40; v < 12000; v += 37.3) {
      const aed = round2(prettifyShelf(v * 1.05) / 1.05);
      items.push(item({ item_code: `T${v}`, msrp_aed: aed, real_msrp_aed: aed, msrp_sar: old103(aed), real_msrp_sar: null }));
    }
    const first = recalc(items, { includeOutOfStep: true });
    expect(first.changes.length).toBeGreaterThan(0);
    const applied = applyPlan(items, first);
    expect(recalc(applied, { includeOutOfStep: true }).changes).toHaveLength(0);
    for (const it of applied) expect(it.msrp_sar).toBe(ksa(it.msrp_aed));
  });
});

describe('planMarketRecalc — fill and keep Kuwait from UAE', () => {
  const recalc = (items, opts) => planMarketRecalc(items, 'kwd', opts);
  const item = (over = {}) => ({
    item_code: 'TEST-1', brand_code: 'TEST', msrp_aed: round2(510 / 1.05), real_msrp_aed: round2(510 / 1.05),
    msrp_sar: 500, real_msrp_sar: 500, msrp_qat: 495, real_msrp_qat: 495,
    msrp_kwd: null, real_msrp_kwd: null, kwd_overridden: false, ...over,
  });

  test('an item with no Kuwait price is filled, at what a save gives', () => {
    const { changes, tally } = recalc([item()]);
    expect(tally).toEqual({ ...NONE, change: 1 });
    expect(changes[0].set).toEqual({ msrp_kwd: 41, real_msrp_kwd: 41 });
    expect(changes[0].lines[0]).toMatchObject({ market: 'kwd', before: null, after: 41 });
  });

  test('only Kuwait is written; every price is recorded for the compare-and-set', () => {
    const { changes } = recalc([item()]);
    expect(Object.keys(changes[0].set).sort()).toEqual(['msrp_kwd', 'real_msrp_kwd']);
    expect(Object.keys(changes[0].expect).sort()).toEqual([...PRICE_COLUMNS, ...REAL_COLUMNS].sort());
  });

  test('a second run finds nothing', () => {
    const items = [];
    for (let v = 20; v < 60000; v += 97.3) {
      const aed = round2(v / 1.05);
      items.push(item({ item_code: `T${v}`, msrp_aed: aed, real_msrp_aed: aed }));
    }
    const applied = applyPlan(items, recalc(items));
    expect(recalc(applied).changes).toHaveLength(0);
    for (const it of applied) expect(it.msrp_kwd).toBe(suggestKWDPrice(it.msrp_aed));
  });

  test('hand-set Kuwait prices: flagged ones are skipped, unflagged ones listed but not moved', () => {
    const flagged   = item({ kwd_overridden: true, msrp_kwd: 39.9 });
    const unflagged = item({ item_code: 'TEST-2', msrp_kwd: 39.9 });
    const { changes, outOfStep, tally } = recalc([flagged, unflagged]);
    expect(tally.overridden).toBe(1);
    expect(tally.outOfStep).toBe(1);
    expect(outOfStep[0]).toMatchObject({ code: 'TEST-2', before: 39.9, after: 41 });
    expect(changes.flatMap(c => Object.keys(c.set))).not.toContain('msrp_kwd');
  });
});

test('every derived market recalculates the same way — filled from UAE at its own rule', () => {
  const aed = round2(1199 / 1.05);
  for (const m of DERIVED) {
    const { changes } = planMarketRecalc([{ item_code: 'X', msrp_aed: aed, real_msrp_aed: aed }], m.key);
    const at = parseFloat(m.derive(aed).toFixed(m.dp));
    expect(changes[0].set).toEqual({ [m.price]: at, [m.real]: at });
  }
});
