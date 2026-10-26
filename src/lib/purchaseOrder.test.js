import { parsePoInput, parseQty, parseDate, erpDate, addDays, buildPoLines, mergeDuplicates, poCsv, PO_HEADER, fitErpText, tooLongForErp, ERP_TEXT_MAX, NAME_SHORTENED, prepareRequestLines, requestLineCheck, requestPoCsv, REQUEST_PO_FIELDS } from './purchaseOrder';

// Rows 1–7 of the template the ERP hands out (POBLAINE3.csv), CRLF-joined.
// Row 4's hint is " dd-mm-yyyy" with its leading space; the template copy also
// carried a stray 279.19 in Qty in Stock UOM, which the ERP never reads.
const TEMPLATE_HEADER = [
  'Bulk Edit Items,,,,,,,,,,,,,,',
  'Item Code,Quantity,Stock UOM,UOM,UOM Conversion Factor,Qty in Stock UOM,Item Name,,Rate,Rate (Company Currency),Amount,Amount (Company Currency),,,Expected Delivery Date',
  'item_code,qty,stock_uom,uom,conversion_factor,stock_qty,item_name,,rate,base_rate,amount,base_amount,,,expected_delivery_date',
  ',,,,,,,,,,,,,, dd-mm-yyyy',
  'The CSV format is case sensitive,,,,,,,,,,,,,,',
  'Do not edit headers which are preset in the template,,,,,,,,,,,,,,',
  '------,,,,,,,,,,,,,,',
].join('\r\n');

const DB = {
  'WRSA-BM051F': { item_code: 'WRSA-BM051F', brand_code: 'WRSA', exw_cost: 49.8, cost_currency: 'EUR',
    item_name: 'WRS RACE HIGH WINDSCREEN BMW S 1000 RR 2019-2022 / M 1000 RR 2020-2021' },
  'WRSA-BM102T': { item_code: 'WRSA-BM102T', brand_code: 'WRSA', exw_cost: 64.8, cost_currency: 'EUR',
    item_name: 'Plexi WRS Caponord 41cm for BMW F900GS 2023+, clear' },
  'WRSA-ZERO':   { item_code: 'WRSA-ZERO', brand_code: 'WRSA', exw_cost: 0, cost_currency: 'EUR', item_name: 'Sample' },
  'WRSA-NOCOST': { item_code: 'WRSA-NOCOST', brand_code: 'WRSA', exw_cost: null, cost_currency: 'EUR', item_name: 'No cost' },
  'GIVI-USD':    { item_code: 'GIVI-USD', brand_code: 'GIVI', exw_cost: 612.605, cost_currency: 'USD', item_name: 'Case' },
};

describe('the CSV matches the ERP template', () => {
  test('rows 1–7 byte for byte', () => {
    expect(PO_HEADER).toBe(TEMPLATE_HEADER);
    for (const row of PO_HEADER.split('\r\n')) expect(row.split(',')).toHaveLength(15);
  });

  test('a data line reproduces the template\'s line', () => {
    const { rows } = buildPoLines(parsePoInput('WRSA-BM051F', '28'), DB);
    const csv = poCsv(rows, '2026-11-17');
    expect(csv.startsWith(TEMPLATE_HEADER + '\r\n')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    // Template: …,WRSA,49.8,,"1,394.40",,,,17-11-2026 — the amount is written without
    // the spreadsheet's thousands separator; the ERP recalculates it from qty × rate.
    expect(csv.split('\r\n')[7]).toBe(
      'WRSA-BM051F,28,Nos,Nos,1,28,WRS RACE HIGH WINDSCREEN BMW S 1000 RR 2019-2022 / M 1000 RR 2020-2021,WRSA,49.8,,1394.40,,,,17-11-2026');
  });

  test('a name with a comma is quoted, as the template quotes it', () => {
    const { rows } = buildPoLines(parsePoInput('WRSA-BM102T', '14'), DB);
    expect(poCsv(rows, '2026-11-17').split('\r\n')[7]).toBe(
      'WRSA-BM102T,14,Nos,Nos,1,14,"Plexi WRS Caponord 41cm for BMW F900GS 2023+, clear",WRSA,64.8,,907.20,,,,17-11-2026');
  });

  test('every data line has 15 columns', () => {
    const { rows } = buildPoLines(parsePoInput('WRSA-BM051F\nWRSA-BM102T', '28\n14'), DB);
    const data = poCsv(rows, '2026-11-17').split('\r\n').slice(7, -1);
    for (const line of data) expect(line.replace(/"[^"]*"/g, 'X').split(',')).toHaveLength(15);
  });

  test('a 3-decimal cost is kept as the rate, not rounded', () => {
    const { rows } = buildPoLines(parsePoInput('GIVI-USD', '3'), DB);
    expect(poCsv(rows, '2026-11-17').split('\r\n')[7]).toContain(',GIVI,612.605,,1837.82,');
  });
});

describe('pasted lines', () => {
  test('codes and quantities join by line; blank code lines are dropped; trailing newline ignored', () => {
    const input = parsePoInput('WRSA-BM051F\n\nwrsa-bm102t\n', '28\n\n14\n');
    expect(input.map(l => [l.line, l.code, l.qtyRaw])).toEqual([[1, 'WRSA-BM051F', '28'], [3, 'wrsa-bm102t', '14']]);
  });

  test('codes match case-insensitively and come out in the database spelling', () => {
    const { rows } = buildPoLines(parsePoInput('wrsa-bm051f', '2'), DB);
    expect(rows[0].code).toBe('WRSA-BM051F');
    expect(rows[0].errors).toEqual([]);
  });

  test('quantities: whole positive numbers, spreadsheet separators allowed', () => {
    expect(parseQty('28')).toBe(28);
    expect(parseQty('1,200')).toBe(1200);
    expect(parseQty('0')).toBeNull();
    expect(parseQty('2.5')).toBeNull();
    expect(parseQty('abc')).toBeNull();
    expect(parseQty('')).toBeNull();
  });

  test('dates: day-first in every common form, ISO too; impossible dates rejected', () => {
    for (const s of ['17-11-2026', '17/11/2026', '17.11.2026', '17-11-26', '2026-11-17']) expect(parseDate(s)).toBe('2026-11-17');
    expect(parseDate('7-1-2027')).toBe('2027-01-07');
    expect(parseDate('31-02-2026')).toBeNull();
    expect(parseDate('next week')).toBeNull();
    expect(erpDate('2027-01-07')).toBe('07-01-2027');
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
  });
});

describe('problems are caught before the ERP sees them', () => {
  test('errors leave the line out of the CSV; warnings keep it', () => {
    const { rows, currency } = buildPoLines(
      parsePoInput('WRSA-BM051F\nNOPE-1\nWRSA-NOCOST\nWRSA-BM102T\nWRSA-ZERO\nGIVI-USD', '28\n5\n5\nx\n4\n3'), DB);
    expect(currency).toBe('EUR');
    expect(rows.map(r => r.errors)).toEqual([[], ['not found'], ['no EXW cost'], ['quantity "x"'], [], []]);
    expect(rows[4].warnings).toEqual(['zero cost']);
    expect(rows[5].warnings).toEqual(['priced in USD, PO is EUR']);
    const data = poCsv(rows, '2026-11-17').split('\r\n').slice(7, -1);
    expect(data.map(l => l.split(',')[0])).toEqual(['WRSA-BM051F', 'WRSA-ZERO', 'GIVI-USD']);
  });

  test('an unreadable pasted date is an error, not a silent default', () => {
    const { rows } = buildPoLines(parsePoInput('WRSA-BM051F', '28', '17th Nov'), DB);
    expect(rows[0].errors).toEqual(['date "17th Nov"']);
  });

  test('a line\'s own date wins over the default', () => {
    const { rows } = buildPoLines(parsePoInput('WRSA-BM051F\nWRSA-BM102T', '1\n1', '01-12-2026\n'), DB);
    const data = poCsv(rows, '2026-11-17').split('\r\n').slice(7, -1);
    expect(data.map(l => l.split(',').pop())).toEqual(['01-12-2026', '17-11-2026']);
  });

  test('duplicates are flagged, and merging sums them into the first line', () => {
    const { rows } = buildPoLines(parsePoInput('WRSA-BM051F\nWRSA-BM102T\nwrsa-bm051f', '10\n14\n4'), DB);
    expect(rows[0].warnings).toEqual(['duplicate code']);
    const merged = mergeDuplicates(rows);
    expect(merged.map(r => [r.code, r.qty, r.amount, r.warnings])).toEqual([
      ['WRSA-BM051F', 14, 697.2, []],
      ['WRSA-BM102T', 14, 907.2, []],
    ]);
  });
});

describe('the ERP\'s 140-character limit on Item Name', () => {
  // The name the ERP refused on row 60 of a real upload.
  const LONG = "Engine Case Cover Race Kit (2-piece) for Honda CRF1100L Africa Twin Adventure Sports '20-, CRF1100L Africa Twin '20- (NON-DCT) & CRF1100L Africa Twin DCT '24-)";
  const len = (s) => Array.from(s).length;

  test('a name over 140 characters is shortened at a word break, with "…"', () => {
    expect(len(LONG)).toBeGreaterThan(ERP_TEXT_MAX);
    const fit = fitErpText(LONG);
    expect(len(fit)).toBeLessThanOrEqual(ERP_TEXT_MAX);
    expect(fit.endsWith('…')).toBe(true);
    expect(LONG.startsWith(fit.slice(0, -1))).toBe(true);
    expect(LONG[fit.length - 1]).toMatch(/\s/);      // cut where a word ended
  });

  test('140 characters exactly is left alone; 141 is shortened', () => {
    const at = 'x'.repeat(140), over = 'x'.repeat(141);
    expect(fitErpText(at)).toBe(at);
    expect(tooLongForErp(at)).toBe(false);
    expect(len(fitErpText(over))).toBe(140);          // no word break: cut mid-word
  });

  test('characters are counted as the ERP counts them, not as UTF-16 units', () => {
    const emoji = '🏍'.repeat(140);                     // 140 characters, 280 UTF-16 units
    expect(emoji.length).toBe(280);
    expect(tooLongForErp(emoji)).toBe(false);
    expect(fitErpText(emoji)).toBe(emoji);
  });

  test('paste mode: the line is flagged and the file carries the shortened name', () => {
    const db = { 'TEST-1': { item_code: 'TEST-1', brand_code: 'TEST', exw_cost: 10, cost_currency: 'EUR', item_name: LONG } };
    const { rows } = buildPoLines(parsePoInput('TEST-1', '1'), db);
    expect(rows[0].warnings).toContain(NAME_SHORTENED);
    const line = poCsv(rows, '2026-11-17').split('\r\n')[7];
    expect(line).toContain(fitErpText(LONG));
    expect(line).not.toContain(LONG);
  });

  test('request mode: same, and the full name survives in the description', () => {
    const [r] = prepareRequestLines([{
      line_id: 'mri1', request_id: 'MR-1', company: 'Co', item_code: 'TEST-1', item_name: LONG, description: LONG,
      qty: 1, ordered_qty: 0, outstanding_qty: 1, uom: 'Nos', stock_uom: 'Nos', conversion_factor: 1,
      schedule_date: '2026-10-31', warehouse: 'WH - TST', draft_pos: [],
    }], { 'TEST-1': { item_code: 'TEST-1', brand_code: 'TEST', exw_cost: 10, cost_currency: 'EUR' } });
    r.selected = true;
    expect(requestLineCheck(r, 'EUR').warnings).toContain(NAME_SHORTENED);
    const csv = requestPoCsv([r], '2026-11-17');
    expect(csv).toContain(fitErpText(LONG));
    expect(csv).toContain(`"${LONG}"`);                // description column: unlimited text
    expect(REQUEST_PO_FIELDS).toContain('description');
  });
});
