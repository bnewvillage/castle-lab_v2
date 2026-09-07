import { supabase, supabaseUrl, supabaseAnonKey } from './supabase';
import { DEMO } from '../demo/demoConfig';
import { orExpression, matchesSearch } from './search';
import { downloadXLSX } from './xlsxExport';

// Barcode values are long numeric strings — wrap in Excel text formula so they
// aren't auto-converted to numbers or scientific notation when opened in Excel.
const barcodeCell = (v) => {
  const s = String(v ?? '');
  return s ? `="${s}"` : '';
};

const escapeCell = (h, v) => {
  if (h === 'barcode') return barcodeCell(v);
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
};

export function downloadCSV(rows, filename) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escapeCell(h, row[h])).join(',')),
  ];
  // '﻿' = UTF-8 BOM — required for Excel on Windows to auto-detect UTF-8 encoding
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

// Strips the synthetic _margins object and promotes margin percentages to flat columns.
export function flattenItem(item) {
  if (!item._margins) return item;
  const { _margins, ...rest } = item;
  return {
    ...rest,
    uae_margin_pct:  _margins.uae_margin  != null ? +_margins.uae_margin.toFixed(2)  : null,
    ksa_margin_pct:  _margins.ksa_margin  != null ? +_margins.ksa_margin.toFixed(2)  : null,
    qat_margin_pct:  _margins.qat_margin  != null ? +_margins.qat_margin.toFixed(2)  : null,
    exw_margin_pct:  _margins.exw_margin  != null ? +_margins.exw_margin.toFixed(2)  : null,
    landed_cost_aed: _margins.landed_cost_aed ?? null,
  };
}

// Full-table export. Pulls JSON pages straight from PostgREST and writes an xlsx
// so identifier columns can be typed as text — the previous CSV path could only
// request that via an ="…" formula, which Excel applied inconsistently.
// Paginated with Range headers because PostgREST caps any single response at the
// project's max_rows (1000 by default) — without this it silently truncates.
const PAGE = 1000;

export async function downloadFullTableXLSX({ table, filters = {}, filename }) {
  // Demo mode: build the export from the in-memory store.
  if (DEMO) {
    const { store } = await import('../demo/demoData');
    let rows = [...store.pricingMaster];
    if (filters.brandCode) rows = rows.filter(r => r.brand_code === filters.brandCode);
    if (filters.search?.trim()) rows = rows.filter(r => matchesSearch(r, filters.search));
    rows.sort((a, b) => a.item_code.localeCompare(b.item_code));
    downloadXLSX(rows, filename);
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const params = new URLSearchParams();
  params.set('order', 'item_code');
  if (filters.brandCode) params.set('brand_code', `eq.${filters.brandCode}`);
  if (filters.search?.trim()) {
    // PostgREST uses * (not %) as the ilike wildcard in raw URL params
    params.set('or', `(${orExpression(filters.search, '*')})`);
  }

  const url = `${supabaseUrl}/rest/v1/${table}?${params}`;
  const all = [];
  let offset = 0;

  while (true) {
    const response = await fetch(url, {
      headers: {
        'apikey':        supabaseAnonKey,
        'Authorization': `Bearer ${session?.access_token ?? supabaseAnonKey}`,
        'Accept':        'application/json',
        'Range-Unit':    'items',
        'Range':         `${offset}-${offset + PAGE - 1}`,
        'Prefer':        'count=none',
      },
    });
    // 416 = offset past the end of the result set; nothing left to fetch.
    if (response.status === 416) break;
    if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);

    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    // Advance by rows actually returned — a max_rows below PAGE shrinks the
    // stride rather than ending the loop early.
    offset += batch.length;
  }

  downloadXLSX(all, filename);
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
