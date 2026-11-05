import { companyBaseCosts } from './pricing';

const rates = { AED: 1, EUR: 4.4, SAR: 0.98, QAR: 1.01, KWD: 11.904762 };

test('company base cost: EXW cost to AED at its rate, then into each market currency, 2 decimals', () => {
  expect(companyBaseCosts({ exw_cost: 100, cost_currency: 'EUR' }, rates)).toEqual({
    base_cost_aed: 440, base_cost_sar: 448.98, base_cost_qat: 435.64, base_cost_kwd: 36.96,
  });
});

test('no EXW cost (blank or 0), or no rate for its currency: no base cost', () => {
  const none = { base_cost_aed: null, base_cost_sar: null, base_cost_qat: null, base_cost_kwd: null };
  expect(companyBaseCosts({ exw_cost: null, cost_currency: 'EUR' }, rates)).toEqual(none);
  expect(companyBaseCosts({ exw_cost: 0, cost_currency: 'EUR' }, rates)).toEqual(none);
  expect(companyBaseCosts({ exw_cost: 10, cost_currency: 'XYZ' }, rates)).toEqual(none);
});
