import * as XLSX from 'xlsx-js-style';

// ─────────────────────────────────────────────────────────────
// XLSX EXPORT
// Identifier columns have to reach Excel as text. Barcodes are long numeric
// strings that Excel renders as scientific notation, and codes can carry
// leading zeros it would strip.
//
// A CSV can only *ask* for this with the ="…" formula trick, which Excel honours
// inconsistently — it depends on version, locale list-separator and Trust Center
// settings, and it leaves a formula in the cell rather than a value. An xlsx
// cell can be genuinely typed as text, so that is what these exports write.
// ─────────────────────────────────────────────────────────────

export const TEXT_COLUMNS = ['barcode', 'sku', 'item_code', 'name'];

function toSheet(rows, headers, textColumns) {
  const cols = headers ?? Object.keys(rows[0]);
  const textIdx = new Set(
    cols.map((h, i) => (textColumns.includes(h) ? i : -1)).filter(i => i >= 0),
  );

  const aoa = [cols, ...rows.map(r => cols.map(h => r[h] ?? ''))];
  const ws  = XLSX.utils.aoa_to_sheet(aoa);

  // Row 0 is the header, so data starts at 1.
  for (let r = 1; r < aoa.length; r++) {
    for (const c of textIdx) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      cell.t = 's';                                   // string cell, not numeric
      cell.v = cell.v == null ? '' : String(cell.v);
      cell.s = { ...(cell.s || {}), numFmt: '@' };     // and formatted as Text
    }
  }

  ws['!cols'] = cols.map(h => ({ wch: Math.min(Math.max(h.length + 4, 12), 42) }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}

export function downloadXLSX(rows, filename, {
  headers, sheet = 'Export', textColumns = TEXT_COLUMNS,
} = {}) {
  if (!rows?.length) return;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, toSheet(rows, headers, textColumns), sheet);
  XLSX.writeFile(wb, filename);
}