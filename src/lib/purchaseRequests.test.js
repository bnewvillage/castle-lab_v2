import { REQUEST_PO_HEADER } from './erpPoTemplate';
import {
  REQUEST_PO_FIELDS, prepareRequestLines, requestLineCheck, requestPoCurrency, requestPoCsv, supplierPartNo,
} from './purchaseOrder';

// RFC 4180: quoted cells may hold commas, quotes ("") and line breaks.
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Made-up identifiers in the ERP's shapes — no real orders, accounts or warehouses.
const LINE = {
  line_id: 'mri0001abc', request_id: 'MR-TEST-0001', company: 'Test Trading LLC',
  item_code: 'SWMT-SBL.06.593.10002/B', item_name: 'Crash Bar Black Yamaha MT-07 / Tracer, Tracer 7 / GT',
  description: 'Crash Bar Black Yamaha MT-07 / Tracer, Tracer 7 / GT', brand: 'SW Motech', item_group: 'SW Motech',
  qty: 1, ordered_qty: 0, outstanding_qty: 1, uom: 'Nos', stock_uom: 'Nos', conversion_factor: 1,
  schedule_date: '2026-10-31', warehouse: 'Reservation - TST',
  sales_order: 'SO-TEST-0001', sales_order_item: 'soi0001abc',
  expense_account: '6100 - Cost of Goods Sold - TST', cost_center: 'Main - TST', project: null, draft_pos: [],
};
const DB = {
  'SWMT-SBL.06.593.10002/B': { item_code: 'SWMT-SBL.06.593.10002/B', brand_code: 'SWMT', exw_cost: 235.95, cost_currency: 'EUR' },
  'SWMT-TRT.00.787.13000/B': { item_code: 'SWMT-TRT.00.787.13000/B', brand_code: 'SWMT', exw_cost: 42.6, cost_currency: 'EUR' },
  'GIVI-E22N':               { item_code: 'GIVI-E22N', brand_code: 'GIVI', exw_cost: 30, cost_currency: 'USD' },
  'SWMT-NOCOST':             { item_code: 'SWMT-NOCOST', brand_code: 'SWMT', exw_cost: null, cost_currency: 'EUR' },
};
const lines = (...over) => prepareRequestLines(over.map((o, i) => ({ ...LINE, line_id: `mri${i}`, ...o })), DB);
const select = (rows) => rows.map(r => ({ ...r, selected: true }));
const dataRows = (csv) => parseCsv(csv).slice(7);
const byField = (row) => Object.fromEntries(REQUEST_PO_FIELDS.map((f, i) => [f, row[i]]));

describe('the 83-column header', () => {
  test('7 records of 83 columns, CRLF between rows, the ERP\'s one embedded line break, no BOM', () => {
    const recs = parseCsv(REQUEST_PO_HEADER);
    expect(recs).toHaveLength(7);
    for (const r of recs) expect(r).toHaveLength(83);
    expect(REQUEST_PO_HEADER.charCodeAt(0)).not.toBe(0xfeff);
    expect(REQUEST_PO_HEADER.endsWith('------' + ','.repeat(82) + '\r\n')).toBe(true);
    expect(REQUEST_PO_HEADER.replace(/\r\n/g, '').split('\n')).toHaveLength(2);
    expect(recs[3][REQUEST_PO_FIELDS.indexOf('schedule_date')]).toBe(' dd-mm-yyyy');
  });

  test('field names come from row 3', () => {
    expect(REQUEST_PO_FIELDS).toHaveLength(83);
    for (const f of ['item_code', 'qty', 'rate', 'warehouse', 'material_request', 'material_request_item', 'sales_order', 'sales_order_item', 'schedule_date', 'expected_delivery_date'])
      expect(REQUEST_PO_FIELDS).toContain(f);
  });
});

describe('a request line becomes a PO line', () => {
  test('every value lands in its column, the link to the request included', () => {
    const csv = requestPoCsv(select(lines({})), '2026-11-17');
    expect(csv.startsWith(REQUEST_PO_HEADER)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    const rows = dataRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(83);
    const v = byField(rows[0]);
    expect(v).toMatchObject({
      fg_item_qty: '1', item_code: 'SWMT-SBL.06.593.10002/B', supplier_part_no: 'SBL.06.593.10002/B',
      item_name: 'Crash Bar Black Yamaha MT-07 / Tracer, Tracer 7 / GT', brand: 'SW Motech',
      schedule_date: '31-10-2026', expected_delivery_date: '17-11-2026', item_group: 'SW Motech',
      qty: '1', stock_uom: 'Nos', uom: 'Nos', conversion_factor: '1', stock_qty: '1',
      rate: '235.95', amount: '235.95', apply_tds: '1', warehouse: 'Reservation - TST',
      material_request: 'MR-TEST-0001', material_request_item: 'mri0',
      sales_order: 'SO-TEST-0001', sales_order_item: 'soi0001abc',
      expense_account: '6100 - Cost of Goods Sold - TST', cost_center: 'Main - TST', item_tax_rate: '{}',
    });
  });

  test('only those columns are filled; prices, totals and stock figures are left to the ERP', () => {
    const v = byField(dataRows(requestPoCsv(select(lines({})), '2026-11-17'))[0]);
    const filled = Object.entries(v).filter(([, x]) => x !== '').map(([f]) => f).sort();
    expect(filled).toEqual([
      'amount', 'apply_tds', 'brand', 'conversion_factor', 'cost_center', 'description', 'expected_delivery_date',
      'expense_account', 'fg_item_qty', 'item_code', 'item_group', 'item_name', 'item_tax_rate', 'material_request',
      'material_request_item', 'qty', 'rate', 'sales_order', 'sales_order_item', 'schedule_date', 'stock_qty',
      'stock_uom', 'supplier_part_no', 'uom', 'warehouse',
    ]);
  });

  test('a description with commas, quotes and line breaks stays one cell', () => {
    const csv = requestPoCsv(select(lines({ description: 'Bar, black\n"PRO" line' })), '2026-11-17');
    const rows = dataRows(csv);
    expect(rows).toHaveLength(1);
    expect(byField(rows[0]).description).toBe('Bar, black\n"PRO" line');
  });

  test('a box line: stock quantity and rate follow the conversion factor', () => {
    // EXW cost is per piece (235.95); a box of 6 is 1,415.70, two boxes 2,831.40.
    const v = byField(dataRows(requestPoCsv(select(lines({ uom: 'Box', conversion_factor: 6, qty: 2, outstanding_qty: 2 })), '2026-11-17'))[0]);
    expect([v.qty, v.uom, v.conversion_factor, v.stock_qty, v.rate, v.amount]).toEqual(['2', 'Box', '6', '12', '1415.7', '2831.40']);
  });

  test('a line\'s own expected delivery wins over the default', () => {
    const rows = select(lines({}, {}));
    rows[1].date = '2026-12-01';
    expect(dataRows(requestPoCsv(rows, '2026-11-17')).map(r => byField(r).expected_delivery_date)).toEqual(['17-11-2026', '01-12-2026']);
  });
});

describe('checks', () => {
  test('quantity starts at what is outstanding, nothing selected', () => {
    const [r] = lines({ qty: 5, ordered_qty: 2, outstanding_qty: 3 });
    expect([r.qty, r.selected]).toEqual([3, false]);
  });

  test('only selected lines without errors are written', () => {
    const rows = lines({}, { item_code: 'NOPE-1' }, { item_code: 'SWMT-NOCOST' }, { warehouse: '' }, { item_code: 'SWMT-TRT.00.787.13000/B' });
    rows.forEach((r, i) => { r.selected = i !== 4; });
    expect(rows.map(r => requestLineCheck(r, 'EUR').errors)).toEqual([
      [], ['not in the pricing master'], ['no EXW cost'], ['request has no warehouse'], [],
    ]);
    expect(dataRows(requestPoCsv(rows, '2026-11-17')).map(r => byField(r).item_code)).toEqual(['SWMT-SBL.06.593.10002/B']);
  });

  test('a quantity of 0 or less is an error; more than outstanding is a warning', () => {
    const [a, b] = lines({}, {});
    a.qty = 0; b.qty = 3;
    expect(requestLineCheck(a, 'EUR').errors).toEqual(['quantity must be above 0']);
    expect(requestLineCheck(b, 'EUR').warnings).toEqual(['more than the 1 outstanding']);
  });

  test('a line already on a draft PO is flagged but can still be ordered', () => {
    const rows = select(lines({ draft_pos: ['PUR-ORD-TEST-0009'] }));
    expect(requestLineCheck(rows[0], 'EUR').warnings).toEqual(['already on draft PUR-ORD-TEST-0009']);
    expect(dataRows(requestPoCsv(rows, '2026-11-17'))).toHaveLength(1);
  });

  test('the PO currency is the one most selected lines are in; others are flagged', () => {
    const rows = select(lines({}, { item_code: 'SWMT-TRT.00.787.13000/B' }, { item_code: 'GIVI-E22N' }));
    expect(requestPoCurrency(rows)).toBe('EUR');
    expect(requestLineCheck(rows[2], 'EUR').warnings).toEqual(['priced in USD, PO is EUR']);
  });

  test('supplier part number is the item code without its brand prefix', () => {
    expect(supplierPartNo('SWMT-SBL.06.593.10002/B', 'SWMT')).toBe('SBL.06.593.10002/B');
    expect(supplierPartNo('swmt-abc', 'SWMT')).toBe('abc');
    expect(supplierPartNo('OTHER-123', 'SWMT')).toBe('');
    expect(supplierPartNo('SWMT-123', null)).toBe('');
  });
});
