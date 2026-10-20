// ─────────────────────────────────────────────────────────────
// PURCHASE ORDER — pasted lines → the ERP's "Bulk Edit Items" CSV
//
// The ERP imports a Purchase Order's item table from the CSV it hands out as a
// template. Its importer reads field names from row 3 and data from row 8, so
// rows 1–7 must match the template exactly — every comma and the dashes on
// row 7. Columns without a field name (8, 13, 14) are ignored on import;
// column 8 carries the brand code, as in the template, for the reader.
//
// Rate is the item's EXW cost in its cost currency: a PO is raised in the
// supplier's currency, which the ERP sets on the PO itself, not per line.
// ─────────────────────────────────────────────────────────────
import { toNum } from './num';

export const DEFAULT_UOM = 'Nos';

// Rows 1–7, byte for byte as the template has them (15 columns each).
const HEADER_ROWS = [
  'Bulk Edit Items,,,,,,,,,,,,,,',
  'Item Code,Quantity,Stock UOM,UOM,UOM Conversion Factor,Qty in Stock UOM,Item Name,,Rate,Rate (Company Currency),Amount,Amount (Company Currency),,,Expected Delivery Date',
  'item_code,qty,stock_uom,uom,conversion_factor,stock_qty,item_name,,rate,base_rate,amount,base_amount,,,expected_delivery_date',
  ',,,,,,,,,,,,,, dd-mm-yyyy',
  'The CSV format is case sensitive,,,,,,,,,,,,,,',
  'Do not edit headers which are preset in the template,,,,,,,,,,,,,,',
  '------,,,,,,,,,,,,,,',
];
export const PO_HEADER = HEADER_ROWS.join('\r\n');

// ── Parsing pasted columns ───────────────────────────────────

// Split on newlines only: the columns join by line number, and item codes can
// contain commas. A trailing newline from a spreadsheet copy is not a line.
const lines = (raw) => {
  const out = String(raw ?? '').replace(/\r/g, '').split('\n').map(s => s.trim());
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
};

// "1,200" from a spreadsheet is twelve hundred. Whole positive numbers only.
export function parseQty(raw) {
  const n = toNum(raw);
  return n != null && n > 0 && Number.isInteger(n) ? n : null;
}

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/**
 * A pasted date to ISO yyyy-mm-dd, or null. Day-first, as the ERP and the UAE
 * write it: 17-11-2026, 17/11/2026, 17.11.2026, 17-11-26. ISO 2026-11-17 too.
 */
export function parseDate(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return isoOf(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}

export const erpDate = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * The pasted columns, joined by line. Lines with no item code are dropped.
 * @returns [{ line, code, qtyRaw, dateRaw }]
 */
export function parsePoInput(codesRaw, qtysRaw, datesRaw = '') {
  const codes = lines(codesRaw), qtys = lines(qtysRaw), dates = lines(datesRaw);
  const out = [];
  codes.forEach((code, i) => {
    if (code) out.push({ line: i + 1, code, qtyRaw: qtys[i] ?? '', dateRaw: dates[i] ?? '' });
  });
  return out;
}

// ── Building PO lines from the database ──────────────────────

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * One PO line per pasted line, matched to pricing_master case-insensitively.
 *
 *   errors    not found · no EXW cost · quantity missing or not a whole number
 *             · pasted date not readable — the line is left out of the CSV
 *   warnings  zero cost · a currency other than the PO's · a duplicate code
 *
 * The PO's currency is the one most lines are in.
 *
 * @param itemsByCode  { [ITEM_CODE]: pricing_master row } (fetchItemsByCodes)
 */
export function buildPoLines(input, itemsByCode) {
  const seen = {};
  for (const { code } of input) seen[code.toUpperCase()] = (seen[code.toUpperCase()] ?? 0) + 1;

  const rows = input.map(({ line, code, qtyRaw, dateRaw }) => {
    const item = itemsByCode[code.toUpperCase()] ?? null;
    const qty  = parseQty(qtyRaw);
    const rate = item ? toNum(item.exw_cost) : null;
    const date = dateRaw ? parseDate(dateRaw) : null;
    const errors = [];
    if (!item) errors.push('not found');
    else if (rate == null) errors.push('no EXW cost');
    if (qty == null) errors.push(qtyRaw ? `quantity "${qtyRaw}"` : 'no quantity');
    if (dateRaw && !date) errors.push(`date "${dateRaw}"`);
    return {
      line,
      code:      item?.item_code ?? code.toUpperCase(),
      name:      item?.item_name ?? '',
      brand:     item?.brand_code ?? '',
      currency:  item?.cost_currency ?? '',
      qty, rate,
      amount:    qty != null && rate != null ? round2(qty * rate) : null,
      date,                                  // a per-line override; empty uses the default
      errors,
      warnings:  [],
      duplicate: seen[code.toUpperCase()] > 1,
    };
  });

  const counts = {};
  for (const r of rows) if (!r.errors.length && r.currency) counts[r.currency] = (counts[r.currency] ?? 0) + 1;
  const currency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  for (const r of rows) {
    if (r.errors.length) continue;
    if (r.rate === 0) r.warnings.push('zero cost');
    if (r.currency && currency && r.currency !== currency) r.warnings.push(`priced in ${r.currency}, PO is ${currency}`);
    if (r.duplicate) r.warnings.push('duplicate code');
  }
  return { rows, currency };
}

// Duplicate codes become one line: quantities summed, the first line's date kept.
export function mergeDuplicates(rows) {
  const out = [], at = {};
  for (const r of rows) {
    const k = r.code.toUpperCase();
    if (r.errors.length || at[k] == null) {
      if (!r.errors.length) at[k] = out.length;
      out.push({ ...r, duplicate: false, warnings: r.warnings.filter(w => w !== 'duplicate code') });
      continue;
    }
    const m = out[at[k]];
    m.qty += r.qty;
    m.amount = round2(m.qty * m.rate);
  }
  return out;
}

// ── The CSV ──────────────────────────────────────────────────

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The rate as stored — some EXW costs carry 3 decimals — without float noise
// (49.8, not 49.800000001) or thousands separators.
const rateCell = (v) => (v == null ? '' : String(parseFloat(v.toFixed(6))));

/**
 * The CSV text for the PO's lines, CRLF line endings, as the template. Lines
 * with errors are left out; a line's own date wins over the default.
 */
export function poCsv(rows, defaultDate) {
  const body = rows
    .filter(r => !r.errors.length)
    .map(r => [
      r.code, r.qty, DEFAULT_UOM, DEFAULT_UOM, 1, r.qty, r.name, r.brand,
      rateCell(r.rate), '', r.amount == null ? '' : r.amount.toFixed(2), '', '', '',
      erpDate(r.date || defaultDate),
    ].map(cell).join(','));
  return [PO_HEADER, ...body].join('\r\n') + '\r\n';
}
