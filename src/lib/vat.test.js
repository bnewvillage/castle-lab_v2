import { fillVatPair, vatFromPair, vatRate } from './vat';
import { calcEXWMargin } from './pricing';

test('the VAT % fills whichever side is empty, to 2 decimals', () => {
  expect(fillVatPair(400, null, 19)).toEqual({ ex: 400, inc: 476, filled: 'inc', mismatch: false });
  expect(fillVatPair('', '476', '19')).toEqual({ ex: 400, inc: 476, filled: 'ex', mismatch: false });
  expect(fillVatPair(99.99, null, 22)).toMatchObject({ inc: 121.99 });
  expect(fillVatPair(150, null, 0)).toMatchObject({ inc: 150, filled: 'inc' });    // 0% VAT: the same price
});

test('a given side is never changed; two given prices that disagree with the VAT are flagged', () => {
  expect(fillVatPair(400, 476, 19)).toEqual({ ex: 400, inc: 476, filled: null, mismatch: false });
  expect(fillVatPair(400, 480, 19)).toEqual({ ex: 400, inc: 480, filled: null, mismatch: true });
  expect(fillVatPair(400, null, '')).toEqual({ ex: 400, inc: null, filled: null, mismatch: false });   // no VAT: nothing filled
  expect(vatRate(100)).toBeNull();
  expect(vatRate('abc')).toBeNull();
});

test('a stored pair gives back its VAT %', () => {
  expect(vatFromPair(400, 476)).toBe(19);
  expect(vatFromPair(100, 122)).toBe(22);
  expect(vatFromPair(null, 476)).toBeNull();
});

test('EXW margin compares the MSRP without VAT, even when the basis prices from the VAT-inclusive one', () => {
  const rates = { EUR: 4.4 };
  const item = { exw_cost: 100, cost_currency: 'EUR', msrp_primary_ex_vat: 200, msrp_primary_inc_vat: 240, msrp_primary_currency: 'EUR' };
  expect(calcEXWMargin({ ...item, price_used: 'primary_inc_vat' }, rates)).toBeCloseTo(50, 9);   // not 58.3
  expect(calcEXWMargin({ ...item, price_used: 'primary_ex_vat' }, rates)).toBeCloseTo(50, 9);
  // Priced from the VAT-inclusive MSRP with no price without VAT: no EXW margin, rather than a wrong one.
  expect(calcEXWMargin({ ...item, msrp_primary_ex_vat: null, price_used: 'primary_inc_vat' }, rates)).toBeNull();
});
