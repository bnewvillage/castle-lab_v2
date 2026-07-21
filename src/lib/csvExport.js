import { supabase, supabaseUrl, supabaseAnonKey } from './supabase';
import { DEMO } from '../demo/demoConfig';

export function downloadCSV(rows, filename) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const escape = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(','), ...rows.map(row => headers.map(h => escape(row[h])).join(','))];
  // '\ufeff' = UTF-8 BOM — required for Excel on Windows to auto-detect UTF-8 encoding
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
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

// Uses PostgREST's Accept: text/csv to stream a full-table export from the server.
// Requires Supabase project's max_rows to be set high enough (or removed) for large tables.
export async function downloadPostgRESTCSV({ table, filters = {}, filename }) {
  // Demo mode: build the full export client-side from the in-memory store.
  if (DEMO) {
    const { store } = await import('../demo/demoData');
    let rows = [...store.pricingMaster];
    if (filters.brandCode) rows = rows.filter(r => r.brand_code === filters.brandCode);
    if (filters.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      rows = rows.filter(r => r.item_code.toLowerCase().includes(q) || (r.item_name || '').toLowerCase().includes(q));
    }
    rows.sort((a, b) => a.item_code.localeCompare(b.item_code));
    downloadCSV(rows, filename);
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const params = new URLSearchParams();
  params.set('order', 'item_code');
  if (filters.brandCode) params.set('brand_code', `eq.${filters.brandCode}`);
  if (filters.search?.trim()) {
    // PostgREST uses * (not %) as the ilike wildcard in URL params
    // Escape ) and , so they don't break the or() clause syntax
    const q = filters.search.trim().replace(/[(),]/g, '\\$&');
    params.set('or', `(item_code.ilike.*${q.toUpperCase()}*,item_name.ilike.*${q}*)`);
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${params}`, {
    headers: {
      'apikey':        supabaseAnonKey,
      'Authorization': `Bearer ${session?.access_token ?? supabaseAnonKey}`,
      'Accept':        'text/csv',
      'Prefer':        'count=none',
    },
  });
  if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
  // Prepend UTF-8 BOM so Excel on Windows auto-detects encoding (server doesn't add one)
  const csvText = await response.text();
  const blob = new Blob(['\ufeff' + csvText], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
