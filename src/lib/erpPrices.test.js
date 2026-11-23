import { fillStockRows } from './erpPrices';
import { projectAsItem } from './rows';

const rates = { AED: 1, EUR: 4, SAR: 0.98, QAR: 1.01, KWD: 11.9 };
const catalogue = {
  item_code: 'ALPN-1', brand_code: 'ALPN', barcode: '590123', msrp_aed: 500, msrp_sar: 600, msrp_qat: 505, msrp_kwd: 42,
  base_cost_aed: 400, base_cost_sar: 408.16, base_cost_qat: 396.04, base_cost_kwd: 33.61,
};
const project = projectAsItem({ item_code: 'PRJT-1', project_item_name: 'Kit', cost: 100, cost_currency: 'EUR', msrp_aed_ex_vat: 790 });

test('a stock row gets its prices and the stored base costs, matched on code or barcode', () => {
  const report = [{ item: 'alpn-1', qty: 3 }, { item: '590123', qty: 1 }, { item: 'NOPE-9', qty: 2 }];
  const out = fillStockRows(report, 'item', [catalogue, project], rates);
  expect(out.matched).toBe(2);
  expect(out.headers).toEqual(['item', 'qty', 'barcode', 'msrp_aed', 'msrp_sar', 'msrp_qat', 'msrp_kwd',
    'base_cost_aed', 'base_cost_sar', 'base_cost_qat', 'base_cost_kwd', 'match_type']);
  expect(out.rows[0]).toMatchObject({ qty: 3, msrp_aed: 500, base_cost_aed: 400, base_cost_kwd: 33.61, match_type: 'item_code' });
  expect(out.rows[1]).toMatchObject({ match_type: 'barcode', base_cost_sar: 408.16 });
  expect(out.rows[2]).toMatchObject({ msrp_aed: '', base_cost_aed: '', match_type: 'no_match' });
});

test("a project item's base costs are worked out from its cost, as it has none stored", () => {
  const out = fillStockRows([{ item: 'PRJT-1' }], 'item', [catalogue, project], rates);
  expect(out.rows[0]).toMatchObject({ msrp_aed: 790, base_cost_aed: 400, base_cost_qat: 396.04, base_cost_kwd: 33.61 });
});

test('a catalogue item without a cost leaves its base costs blank', () => {
  const out = fillStockRows([{ item: 'ALPN-2' }], 'item', [{ item_code: 'ALPN-2', brand_code: 'ALPN', msrp_aed: 10 }], rates);
  expect(out.rows[0]).toMatchObject({ msrp_aed: 10, base_cost_aed: '', base_cost_sar: '' });
});
