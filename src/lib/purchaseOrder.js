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
//
// A second source, at the end of this file: open purchase requests pulled
// from the ERP, written in the ERP's full PO item format so each line keeps
// its link back to the request.
// ─────────────────────────────────────────────────────────────
import { toNum, round } from './num';
import { REQUEST_PO_HEADER } from './erpPoTemplate';

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

// ── The ERP's text limit ─────────────────────────────────────
// The ERP's short text fields (Item Name among them) hold 140 characters, and
// the PO upload is refused — not truncated — when a value is longer. Counted
// in characters as the ERP counts them (Unicode code points, not UTF-16 units).
export const ERP_TEXT_MAX = 140;
const charCount = (s) => Array.from(s).length;
export const tooLongForErp = (s) => s != null && charCount(String(s)) > ERP_TEXT_MAX;

// Shortened to fit: cut at the last word break that leaves room for "…",
// or mid-word when the first 139 characters hold no break worth using.
export function fitErpText(s) {
  if (!tooLongForErp(s)) return s ?? '';
  const chars = Array.from(String(s)).slice(0, ERP_TEXT_MAX - 1);
  let cut = chars.length;
  for (let i = chars.length; i > ERP_TEXT_MAX * 0.6; i--) {
    if (/\s/.test(chars[i])) { cut = i; break; }
  }
  return chars.slice(0, cut).join('').replace(/[\s,;:/(–-]+$/, '') + '…';
}

export const NAME_SHORTENED = `name shortened to ${ERP_TEXT_MAX} characters for the ERP`;

// ── Building PO lines from the database ──────────────────────

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
      amount:    qty != null && rate != null ? round(qty * rate) : null,
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
    if (tooLongForErp(r.name)) r.warnings.push(NAME_SHORTENED);
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
    m.amount = round(m.qty * m.rate);
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
const rateCell = (v) => (v == null ? '' : String(round(v, 6)));

/**
 * The CSV text for the PO's lines, CRLF line endings, as the template. Lines
 * with errors are left out; a line's own date wins over the default.
 */
export function poCsv(rows, defaultDate) {
  const body = rows
    .filter(r => !r.errors.length)
    .map(r => [
      r.code, r.qty, DEFAULT_UOM, DEFAULT_UOM, 1, r.qty, fitErpText(r.name), r.brand,
      rateCell(r.rate), '', r.amount == null ? '' : r.amount.toFixed(2), '', '', '',
      erpDate(r.date || defaultDate),
    ].map(cell).join(','));
  return [PO_HEADER, ...body].join('\r\n') + '\r\n';
}

// ─────────────────────────────────────────────────────────────
// FROM PURCHASE REQUESTS
//
// Open purchase-request lines (ERP Material Requests of type Purchase, with
// quantity not yet ordered) become PO lines in the ERP's full 83-column
// item format. Each line carries material_request + material_request_item,
// which is what makes the ERP count the request as ordered when the PO is
// submitted — exactly as if the requests had been pulled into the PO there.
//
// The ERP's upload sets every column it is given, blanks included, over the
// row's defaults. So check fields the ERP itself exports as set (apply_tds,
// fg_item_qty, item_tax_rate) are written with the ERP's own values, and the
// price and total columns are left for the ERP to compute on save.
// ─────────────────────────────────────────────────────────────

export const REQUEST_PO_FIELDS = REQUEST_PO_HEADER.split('\r\n')[2].split(',');

const num = (v) => (v == null ? '' : String(round(v, 6)));

// Castle-lab item codes are BRAND-SKU, and the SKU is the supplier's part
// number (SWMT-SBL.06.593.10002/B → SBL.06.593.10002/B), which the ERP's own
// pull fills from Item Supplier where it has one.
export const supplierPartNo = (itemCode, brandCode) =>
  brandCode && itemCode?.toUpperCase().startsWith(`${brandCode.toUpperCase()}-`)
    ? itemCode.slice(brandCode.length + 1) : '';

/**
 * Request lines from the ERP, joined to the pricing master. Quantity starts
 * at what is still outstanding; nothing starts selected.
 *
 * @param erpLines     from the erp-proxy 'purchase_requests' action
 * @param itemsByCode  { [ITEM_CODE]: pricing_master row } (fetchItemsByCodes)
 */
export function prepareRequestLines(erpLines, itemsByCode) {
  return erpLines.map(l => {
    const item = itemsByCode[String(l.item_code).toUpperCase()] ?? null;
    const unit = item ? toNum(item.exw_cost) : null;          // per piece (stock UOM)
    const cf   = toNum(l.conversion_factor) || 1;
    return {
      ...l,
      item,
      // A PO line's rate is per ITS unit: a box of 6 costs 6 pieces.
      rate:      unit == null ? null : round(unit * cf, 6),
      unit_rate: unit,
      currency: item?.cost_currency ?? '',
      qty:      l.outstanding_qty,
      date:     null,          // expected delivery override; empty uses the default
      selected: false,
    };
  });
}

/**
 * What stops a line going on the PO (errors) and what to look at (warnings).
 * @param currency  the PO's currency — the one most selected lines are in
 */
export function requestLineCheck(r, currency) {
  const errors = [], warnings = [];
  if (!r.item) errors.push('not in the pricing master');
  else if (r.rate == null) errors.push('no EXW cost');
  const qty = toNum(r.qty);
  if (qty == null || qty <= 0) errors.push('quantity must be above 0');
  if (!r.warehouse) errors.push('request has no warehouse');
  if (r.item && r.rate === 0) warnings.push('zero cost');
  if (qty != null && qty > r.outstanding_qty + 1e-9) warnings.push(`more than the ${num(r.outstanding_qty)} outstanding`);
  if (r.draft_pos?.length) warnings.push(`already on draft ${r.draft_pos.join(', ')}`);
  if (tooLongForErp(r.item_name)) warnings.push(NAME_SHORTENED);
  if (r.item && currency && r.currency && r.currency !== currency) warnings.push(`priced in ${r.currency}, PO is ${currency}`);
  return { errors, warnings };
}

// The currency most of the selected, valid lines are priced in.
export function requestPoCurrency(rows) {
  const counts = {};
  for (const r of rows) {
    if (!r.selected || !r.item || r.rate == null || !r.currency) continue;
    counts[r.currency] = (counts[r.currency] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/**
 * The 83-column CSV for the selected lines that have no errors, CRLF line
 * endings, the ERP's header byte for byte.
 */
export function requestPoCsv(rows, defaultDate) {
  const currency = requestPoCurrency(rows);
  const body = rows
    .filter(r => r.selected && !requestLineCheck(r, currency).errors.length)
    .map(r => {
      const qty = toNum(r.qty);
      const cf  = toNum(r.conversion_factor) || 1;
      const v = {
        fg_item_qty:            1,
        item_code:              r.item_code,
        supplier_part_no:       supplierPartNo(r.item_code, r.item?.brand_code),
        item_name:              fitErpText(r.item_name),
        brand:                  r.brand,
        schedule_date:          erpDate(r.schedule_date),
        expected_delivery_date: erpDate(r.date || defaultDate),
        item_group:             r.item_group,
        description:            r.description,
        qty:                    num(qty),
        stock_uom:              r.stock_uom,
        uom:                    r.uom,
        conversion_factor:      num(cf),
        stock_qty:              num(qty * cf),
        rate:                   rateCell(r.rate),
        amount:                 round(qty * r.rate).toFixed(2),
        apply_tds:              1,
        warehouse:              r.warehouse,
        material_request:       r.request_id,
        material_request_item:  r.line_id,
        sales_order:            r.sales_order,
        sales_order_item:       r.sales_order_item,
        expense_account:        r.expense_account,
        cost_center:            r.cost_center,
        project:                r.project,
        item_tax_rate:          '{}',
      };
      return REQUEST_PO_FIELDS.map(f => cell(v[f] ?? '')).join(',');
    });
  return REQUEST_PO_HEADER + body.map(line => line + '\r\n').join('');
}
