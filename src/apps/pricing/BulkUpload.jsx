import React, { useState, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx-js-style';
import { fetchBrands, fetchRates, bulkSaveItems, checkExisting, fetchItemsByCodes } from '../../lib/db';
import { calcMSRPs, calcCostBasedMSRPs, DEFAULT_COST_MARGIN_PCT } from '../../lib/pricing';
import { t, inp, sel, btnW, btnG, btnSm, lbl, groupBox, groupHead, CURRENCIES } from './styles';
import { useAuth } from '../../lib/AuthContext';
import BrandSelect from './BrandSelect';
import BulkUpdatePaste from './BulkUpdatePaste';
import MassOverride from './MassOverride';

const PRICE_USED_OPTIONS = ['primary_ex_vat','primary_inc_vat','secondary_ex_vat','secondary_inc_vat','cost_based'];
const SOURCES            = ['Portal','File','Website','Invoice','Estimate'];
const LARGE_THRESHOLD    = 5000;  // above this, paginate review and show progress
const REVIEW_PAGE_SIZE   = 100;   // rows per page in review / dup tables
// Fields that are merged from existing DB data when blank in import (merge mode)
const MERGE_FIELDS = ['item_name','barcode','cost_currency','exw_cost','shipping_rate',
  'customs_duty_rate','msrp_primary_currency','msrp_primary_ex_vat','msrp_primary_inc_vat',
  'msrp_secondary_currency','msrp_secondary_ex_vat','msrp_secondary_inc_vat',
  'price_used','target_margin_pct','cost_source','price_source'];
// Paste import writes primaries only, so cost_based has no secondary fallback here.
const PASTE_PRICE_USED   = ['primary_ex_vat','primary_inc_vat','cost_based'];

// Strip thousands-separator commas before parsing (Excel formats 1185 as "1,185.00")
const toNum = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? null : n; };

// ── TEMPLATE GENERATOR ────────────────────────────────────────
async function generateTemplate() {
  const [brands, rates] = await Promise.all([fetchBrands(), fetchRates()]);
  const wb = XLSX.utils.book_new();

  const importHeaders = [
    'sku','item_name','brand_code','cost_currency','exw_cost',
    'shipping_rate','customs_duty_rate','msrp_primary_currency',
    'msrp_primary_ex_vat','msrp_primary_inc_vat','msrp_secondary_currency',
    'msrp_secondary_ex_vat','msrp_secondary_inc_vat','price_used',
    'target_margin_pct','cost_source','price_source','barcode',
  ];
  const required = new Set(['sku','brand_code','cost_currency','exw_cost','msrp_primary_currency','price_used']);
  const descriptions = {
    sku:'SKU without brand prefix — item_code will be constructed as BRAND-SKU',item_name:'Full item description',
    brand_code:'Must exist in Brands tab — see Reference sheet',
    cost_currency:'Currency of EXW cost — see Reference sheet',
    exw_cost:'Ex-works cost in cost_currency',
    shipping_rate:'Shipping % applied to EXW cost (default: 0)',
    customs_duty_rate:'Customs duty % (default: 5.5)',
    msrp_primary_currency:'Currency of primary MSRP',
    msrp_primary_ex_vat:'Primary MSRP excluding VAT',
    msrp_primary_inc_vat:'Primary MSRP including VAT',
    msrp_secondary_currency:'Currency of secondary MSRP (optional)',
    msrp_secondary_ex_vat:'Secondary MSRP ex VAT (optional)',
    msrp_secondary_inc_vat:'Secondary MSRP inc VAT (optional)',
    price_used:'Which MSRP drives pricing, or cost_based to derive the price from EXW cost — see Reference sheet',
    target_margin_pct:'Target gross margin % when price_used is cost_based (default: 25) — shipping/customs not included',
    cost_source:'Where cost data came from — see Reference sheet',
    price_source:'Where price data came from — see Reference sheet',
    barcode:'Product barcode (optional) — stored as text',
  };

  const importData = [
    importHeaders.map(h => required.has(h) ? `${h} *` : h),
    importHeaders.map(h => descriptions[h] || ''),
  ];
  const importWs = XLSX.utils.aoa_to_sheet(importData);
  importWs['!cols'] = importHeaders.map(h => ({ wch: Math.max(h.length+4, 16) }));
  importWs['!freeze'] = { xSplit:0, ySplit:2 };

  // Pre-format barcode column as Text so Excel doesn't auto-convert long numeric barcodes
  const barcodeCol = importHeaders.indexOf('barcode');
  if (barcodeCol >= 0) {
    for (let r = 2; r <= 101; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: barcodeCol });
      importWs[addr] = { t: 's', v: '', s: { numFmt: '@' } };
    }
    const range = XLSX.utils.decode_range(importWs['!ref']);
    range.e.r = Math.max(range.e.r, 101);
    importWs['!ref'] = XLSX.utils.encode_range(range);
  }

  XLSX.utils.book_append_sheet(wb, importWs, 'Import');

  const maxLen = Math.max(brands.length, PRICE_USED_OPTIONS.length, CURRENCIES.length, SOURCES.length);
  const refData = [
    ['brand_code','brand_name','','price_used options','','currencies','','sources'],
    ...Array.from({length:maxLen},(_,i) => [
      brands[i]?.brand_code||'', brands[i]?.brand_name||'', '',
      PRICE_USED_OPTIONS[i]||'', '', CURRENCIES[i]||'', '', SOURCES[i]||'',
    ]),
  ];
  const refWs = XLSX.utils.aoa_to_sheet(refData);
  refWs['!cols'] = [{wch:14},{wch:24},{wch:4},{wch:22},{wch:4},{wch:12},{wch:4},{wch:12}];
  XLSX.utils.book_append_sheet(wb, refWs, 'Reference');

  XLSX.writeFile(wb, `pricing_import_template_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── ROW PROCESSOR ─────────────────────────────────────────────
function validateAndCalc(row, brandMap, markupCache, additionalMarkupCache, rates) {
  const errors = [];
  const warnings = [];
  const brandCode = row.brand_code?.toUpperCase();

  if (!row.item_code?.trim())   errors.push('item_code is required');
  if (!row.item_name?.trim())   warnings.push('item_name is missing');
  if (!brandCode)               errors.push('brand_code is required');
  else if (!brandMap[brandCode]) errors.push(`Brand "${brandCode}" not found — create it in Brands tab first`);
  if (!row.cost_currency)       errors.push('cost_currency is required');
  if (!row.exw_cost || toNum(row.exw_cost) == null) errors.push('exw_cost must be a number');
  const isCostBased = row.price_used === 'cost_based';
  if (!row.msrp_primary_currency && !isCostBased) errors.push('msrp_primary_currency is required');
  if (!row.price_used || !PRICE_USED_OPTIONS.includes(row.price_used)) {
    errors.push(`price_used must be one of: ${PRICE_USED_OPTIONS.join(', ')}`);
  }
  if (row.cost_source && !SOURCES.includes(row.cost_source)) {
    errors.push(`cost_source must be one of: ${SOURCES.join(', ')}`);
  }
  if (row.price_source && !SOURCES.includes(row.price_source)) {
    errors.push(`price_source must be one of: ${SOURCES.join(', ')}`);
  }

  const priceUsedMap = {
    primary_ex_vat:    { value: toNum(row.msrp_primary_ex_vat),    currency: row.msrp_primary_currency },
    primary_inc_vat:   { value: toNum(row.msrp_primary_inc_vat),   currency: row.msrp_primary_currency },
    secondary_ex_vat:  { value: toNum(row.msrp_secondary_ex_vat),  currency: row.msrp_secondary_currency },
    secondary_inc_vat: { value: toNum(row.msrp_secondary_inc_vat), currency: row.msrp_secondary_currency },
  };
  const { value: priceVal, currency: priceCurrency } = priceUsedMap[row.price_used] || {};
  if (!isCostBased && errors.length === 0 && (!priceVal || isNaN(priceVal))) {
    errors.push(`No MSRP value found for price_used "${row.price_used}"`);
  }
  const targetMargin = toNum(row.target_margin_pct);
  if (isCostBased && String(row.target_margin_pct ?? '').trim() !== '' && !(targetMargin > 0 && targetMargin < 100)) {
    errors.push('target_margin_pct must be a number between 0 and 100');
  }

  // Compute all 6 MSRP fields — two-pass prettification via calcMSRPs
  let msrp_aed = null, msrp_sar = null, msrp_qat = null;
  let real_msrp_aed = null, real_msrp_sar = null, real_msrp_qat = null;
  if (errors.length === 0) {
    const msrps = isCostBased
      ? calcCostBasedMSRPs(toNum(row.exw_cost), row.cost_currency, targetMargin ?? DEFAULT_COST_MARGIN_PCT, rates, additionalMarkupCache[brandCode] ?? null)
      : calcMSRPs(priceVal, priceCurrency, markupCache[brandCode] ?? 10, additionalMarkupCache[brandCode] ?? null, rates);
    if (msrps) ({ msrp_aed, msrp_sar, msrp_qat, real_msrp_aed, real_msrp_sar, real_msrp_qat } = msrps);
  }

  return {
    ...row, brand_code: brandCode,
    _errors: errors, _warnings: warnings, _status: errors.length > 0 ? 'error' : 'ready',
    msrp_aed, msrp_sar, msrp_qat,
    real_msrp_aed, real_msrp_sar, real_msrp_qat,
  };
}

async function processRows(rawRows, brands, rates, onProgress) {
  const brandMap = Object.fromEntries(brands.map(b => [b.brand_code, b]));
  const markupCache = {};
  const additionalMarkupCache = {};
  for (const b of brands) {
    markupCache[b.brand_code]           = b.brand_rules?.markup_percentage ?? 10;
    additionalMarkupCache[b.brand_code] = b.brand_rules?.additional_markup_pct ?? null;
  }
  const PROC_CHUNK = 500;
  const processed  = [];
  for (let start = 0; start < rawRows.length; start += PROC_CHUNK) {
    const end = Math.min(start + PROC_CHUNK, rawRows.length);
    for (let j = start; j < end; j++) {
      processed.push({ ...validateAndCalc(rawRows[j], brandMap, markupCache, additionalMarkupCache, rates), _rowNum: j + 3 });
    }
    onProgress?.(end, rawRows.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  // Flag rows whose item_code appears more than once in the file
  const codeCount = {};
  for (const r of processed) {
    const code = r.item_code?.trim().toUpperCase();
    if (code) codeCount[code] = (codeCount[code] || 0) + 1;
  }
  for (const r of processed) {
    const code = r.item_code?.trim().toUpperCase();
    r._dupInFile = !!(code && codeCount[code] > 1);
  }

  return { processed, brandMap, markupCache, additionalMarkupCache };
}

// ── PASTE IMPORT PANEL ────────────────────────────────────────
const PASTE_COLS = [
  { k:'sku',                  label:'SKU *',          ph:'ABC123' },
  { k:'item_name',            label:'Item name',      ph:'Description' },
  { k:'exw_cost',             label:'EXW cost *',     ph:'120.50' },
  { k:'msrp_primary_ex_vat',  label:'MSRP ex VAT',    ph:'400' },
  { k:'msrp_primary_inc_vat', label:'MSRP inc VAT',   ph:'480' },
  { k:'barcode',              label:'Barcode',        ph:'5901234123457' },
];

const pasteBox = {
  width:'100%', minHeight:300, resize:'vertical',
  background:t.bg2, border:`1px solid ${t.b2}`, borderRadius:8,
  padding:'10px 12px', fontSize:12.5, lineHeight:1.7,
  color:t.t1, fontFamily:'var(--font-mono)',
  outline:'none', boxSizing:'border-box', whiteSpace:'pre',
};

function PastePanel({ paste, setPasteField, opts, setOpt, brands, processing, isViewer, onProcess }) {
  const skuCount = paste.sku.split('\n').filter(s => s.trim()).length;
  const isCostBased = opts.price_used === 'cost_based';
  const ready = skuCount > 0 && opts.brand_code && !processing && !isViewer;

  const Field = ({ label, hint, children }) => (
    <div style={{ flex:'1 1 150px', minWidth:140 }}>
      <label style={lbl}>{label}</label>
      {children}
      {hint && <div style={{ fontSize:10, color:t.t4, marginTop:4, fontFamily:'var(--font-mono)' }}>{hint}</div>}
    </div>
  );

  return (
    <>
      {/* Options applied to every pasted row */}
      <div style={{ ...groupBox(false), marginBottom:16 }}>
        <div style={{ ...groupHead, marginBottom:14 }}>
          Applied to every row
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
          <Field label="Brand *">
            <BrandSelect brands={brands} value={opts.brand_code}
              onChange={v => setOpt('brand_code', v)} hasError={!opts.brand_code} />
          </Field>
          <Field label="MSRP source *" hint={isCostBased ? 'derived from cost' : undefined}>
            <select value={opts.price_used} onChange={e=>setOpt('price_used', e.target.value)}
              style={sel(true,false)}>
              {PASTE_PRICE_USED.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Cost currency *">
            <select value={opts.cost_currency} onChange={e=>setOpt('cost_currency', e.target.value)} style={sel(true,false)}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="MSRP currency" hint={isCostBased ? 'unused' : undefined}>
            <select value={opts.msrp_primary_currency} onChange={e=>setOpt('msrp_primary_currency', e.target.value)}
              style={{ ...sel(true,false), opacity: isCostBased ? 0.5 : 1 }} disabled={isCostBased}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Cost source">
            <select value={opts.cost_source} onChange={e=>setOpt('cost_source', e.target.value)} style={sel(!!opts.cost_source,false)}>
              <option value="">—</option>
              {SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Price source">
            <select value={opts.price_source} onChange={e=>setOpt('price_source', e.target.value)} style={sel(!!opts.price_source,false)}>
              <option value="">—</option>
              {SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Shipping %" hint="default 0">
            <input value={opts.shipping_rate} onChange={e=>setOpt('shipping_rate', e.target.value)}
              placeholder="0" style={inp(!!opts.shipping_rate,false)} />
          </Field>
          <Field label="Customs %" hint="default 5.5">
            <input value={opts.customs_duty_rate} onChange={e=>setOpt('customs_duty_rate', e.target.value)}
              placeholder="5.5" style={inp(!!opts.customs_duty_rate,false)} />
          </Field>
          {isCostBased && (
            <Field label="Target margin %" hint="default 25">
              <input value={opts.target_margin_pct} onChange={e=>setOpt('target_margin_pct', e.target.value)}
                placeholder="25" style={inp(!!opts.target_margin_pct,false)} />
            </Field>
          )}
        </div>
      </div>

      {/* Pasted columns */}
      <div style={{ ...groupBox(false), marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap', marginBottom:14 }}>
          <div>
            <div style={{ ...groupHead, marginBottom:4 }}>Paste columns</div>
            <div style={{ fontSize:12, color:t.t4 }}>
              One row per line. Columns join by line number — leave a line blank to skip that field, not the row.
            </div>
          </div>
          <button
            onClick={onProcess}
            disabled={!ready}
            style={{ ...btnW, opacity: ready?1:0.4, cursor: ready?'pointer':'not-allowed', whiteSpace:'nowrap' }}
          >{processing ? 'Processing...' : `Process ${skuCount} row${skuCount===1?'':'s'} →`}</button>
        </div>

        <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'flex-start' }}>
          {PASTE_COLS.map(({ k, label, ph }) => {
            const n = paste[k].split('\n').filter(s => s.trim()).length;
            const mismatch = k !== 'sku' && n > 0 && n !== skuCount;
            return (
              <div key={k} style={{ flex:'1 1 150px', minWidth:140 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:6 }}>
                  <label style={{ ...lbl, marginBottom:6 }}>{label}</label>
                  {n > 0 && (
                    <span style={{ fontSize:10, marginBottom:6, fontFamily:'var(--font-mono)', color: mismatch ? t.amber : t.t4 }}>{n}</span>
                  )}
                </div>
                <textarea
                  value={paste[k]}
                  onChange={e => setPasteField(k, e.target.value)}
                  placeholder={ph}
                  spellCheck={false}
                  style={{ ...pasteBox, borderColor: mismatch ? 'rgba(245,166,35,0.4)' : t.b2 }}
                />
              </div>
            );
          })}
        </div>

        {!opts.brand_code && skuCount > 0 && (
          <div style={{ marginTop:12, fontSize:12, color:t.amber }}>Pick a brand — item codes are built as BRAND-SKU.</div>
        )}
      </div>
    </>
  );
}

// ── INLINE EDITABLE CELL ──────────────────────────────────────
function EditCell({ value, options, isText, onChange, hasError }) {
  const [changed, setChanged] = useState(false);

  const handleChange = (v) => {
    setChanged(true);
    onChange(v);
  };

  const style = {
    background: hasError ? 'rgba(242,100,100,0.08)' : t.bg3,
    border: `1px solid ${hasError ? 'rgba(242,100,100,0.4)' : changed ? t.b3 : t.b2}`,
    borderRadius: 6, padding: '5px 8px', fontSize: 12,
    color: t.t1, fontFamily: 'var(--font-sans)', outline: 'none',
    width: '100%', minWidth: 120,
  };

  if (options) return (
    <select style={{ ...style, cursor: 'pointer' }} value={value||''} onChange={e=>handleChange(e.target.value)}>
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <input style={style} value={value||''} onChange={e=>handleChange(e.target.value)}/>
  );
}

// ── APPLY TO ALL POPOVER ──────────────────────────────────────
function ApplyAll({ onApplyErrors, onApplyAll, onDismiss }) {
  return (
    <div style={{
      position:'absolute', top:'100%', right:0, zIndex:100, marginTop:4,
      background:t.bg2, border:`1px solid ${t.b3}`, borderRadius:8,
      boxShadow:'0 4px 16px rgba(0,0,0,0.5)', overflow:'hidden', minWidth:160,
    }}>
      {[
        { label:'Apply to error rows', action: onApplyErrors },
        { label:'Apply to all rows',   action: onApplyAll   },
      ].map(({ label, action }) => (
        <button key={label} onClick={() => { action(); onDismiss(); }}
          style={{ display:'block', width:'100%', padding:'9px 14px', background:'none', border:'none', cursor:'pointer', fontSize:12, color:t.t2, fontFamily:'var(--font-sans)', textAlign:'left', transition:'background 0.1s' }}
          onMouseEnter={e=>e.currentTarget.style.background=t.bg3}
          onMouseLeave={e=>e.currentTarget.style.background='none'}
        >{label}</button>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    ready: { bg:'rgba(62,207,142,0.1)', border:'rgba(62,207,142,0.3)', color:t.green },
    error: { bg:'rgba(242,100,100,0.1)', border:'rgba(242,100,100,0.3)', color:t.red },
  };
  const st = colors[status]||colors.error;
  return <span style={{ fontSize:11, padding:'3px 10px', borderRadius:100, fontFamily:'var(--font-mono)', background:st.bg, border:`1px solid ${st.border}`, color:st.color }}>{status}</span>;
}

// ── DIFF MODAL ────────────────────────────────────────────────
// Shows before/after for every duplicate item being updated, plus aggregate margin stats.
function DiffModal({ items, existingItems, rates, onClose }) {
  const fmtSrc  = (val, cur) => (val != null && cur) ? `${cur} ${Number(val).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 })}` : '—';
  const fmtMgn  = v => v != null ? `${v.toFixed(1)}%` : '—';
  const fmtDelta = (d, pts) => {
    if (d == null) return '—';
    const s = d > 0 ? '+' : '';
    return pts ? `${s}${d.toFixed(1)} pts` : `${s}${d.toFixed(1)}%`;
  };
  const dColor  = d => d == null ? t.t4 : d > 0.05 ? t.green : d < -0.05 ? t.red : t.t4;

  const getPriceSrc = (item) => {
    const m = {
      primary_ex_vat:    { value: toNum(item.msrp_primary_ex_vat),    currency: item.msrp_primary_currency },
      primary_inc_vat:   { value: toNum(item.msrp_primary_inc_vat),   currency: item.msrp_primary_currency },
      secondary_ex_vat:  { value: toNum(item.msrp_secondary_ex_vat),  currency: item.msrp_secondary_currency },
      secondary_inc_vat: { value: toNum(item.msrp_secondary_inc_vat), currency: item.msrp_secondary_currency },
    };
    return m[item.price_used] || { value: null, currency: null };
  };

  const getMargin = (item) => {
    const { value: pv, currency: pc } = getPriceSrc(item);
    if (!pv || !pc) return null;
    const pr = rates[pc];
    const cr = rates[item.cost_currency];
    if (!pr || !cr || item.exw_cost == null) return null;
    const pAed = pv * pr;
    const cAed = toNum(item.exw_cost) * cr;
    if (!pAed || pAed <= 0) return null;
    return ((pAed - cAed) / pAed) * 100;
  };

  const diffRows = items.map(fileRow => {
    const code  = fileRow.item_code?.toUpperCase();
    const dbRow = existingItems[code];
    if (!dbRow) return null;

    const exwB     = { value: toNum(dbRow.exw_cost),  currency: dbRow.cost_currency };
    const exwA     = { value: toNum(fileRow.exw_cost), currency: fileRow.cost_currency };
    const exwAedB  = exwB.value != null && rates[exwB.currency]  ? exwB.value  * rates[exwB.currency]  : null;
    const exwAedA  = exwA.value != null && rates[exwA.currency]  ? exwA.value  * rates[exwA.currency]  : null;
    const exwDelta = exwAedB && exwAedA ? ((exwAedA - exwAedB) / Math.abs(exwAedB)) * 100 : null;

    const priceB    = getPriceSrc(dbRow);
    const priceA    = getPriceSrc(fileRow);
    const prAedB    = priceB.value && rates[priceB.currency] ? priceB.value * rates[priceB.currency] : null;
    const prAedA    = priceA.value && rates[priceA.currency] ? priceA.value * rates[priceA.currency] : null;
    const priceDelta = prAedB && prAedA ? ((prAedA - prAedB) / Math.abs(prAedB)) * 100 : null;

    const mgB      = getMargin(dbRow);
    const mgA      = getMargin(fileRow);
    const mgDelta  = mgB != null && mgA != null ? mgA - mgB : null;

    const msrpB    = toNum(dbRow.msrp_aed);
    const msrpA    = toNum(fileRow.msrp_aed);
    const msrpDelta = msrpB && msrpA ? ((msrpA - msrpB) / Math.abs(msrpB)) * 100 : null;

    return { code, exwB, exwA, exwDelta, priceB, priceA, priceDelta, mgB, mgA, mgDelta, msrpB, msrpA, msrpDelta };
  }).filter(Boolean);

  const statsOf = (vals) => {
    const v = vals.filter(x => x != null);
    if (!v.length) return null;
    const sorted = [...v].sort((a,b) => a-b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
    const freq = {}; let maxF = 0, modeVal = null;
    for (const n of v) { const k = +n.toFixed(1); freq[k] = (freq[k]||0)+1; if (freq[k] > maxF) { maxF = freq[k]; modeVal = k; } }
    return { min: sorted[0], max: sorted[sorted.length-1], avg: v.reduce((a,b)=>a+b,0)/v.length, median, mode: maxF > 1 ? modeVal : null };
  };
  const mgsBefore = statsOf(diffRows.map(r => r.mgB));
  const mgsAfter  = statsOf(diffRows.map(r => r.mgA));

  const thSt = { padding:'10px 14px', textAlign:'left', fontSize:11, color:t.t2, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:600, whiteSpace:'nowrap' };
  const tdSt = { padding:'10px 14px', fontSize:12, fontFamily:'var(--font-mono)', whiteSpace:'nowrap', verticalAlign:'top' };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={onClose}
    >
      <div style={{ background:t.bg2, border:`1px solid ${t.b2}`, borderRadius:16, width:'92vw', maxWidth:1080, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding:'20px 24px', borderBottom:`1px solid ${t.b1}`, display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:t.t1 }}>Change preview — {items.length} item{items.length!==1?'s':''} will be updated</div>
            <div style={{ fontSize:12, color:t.t4, marginTop:3 }}>These items already exist in the database. Review changes before confirming.</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:t.t4, padding:'4px 8px', borderRadius:6, lineHeight:1 }}>×</button>
        </div>

        {/* Aggregate margin stats */}
        {(mgsBefore || mgsAfter) && (
          <div style={{ padding:'16px 24px', borderBottom:`1px solid ${t.b1}`, background:t.bg3, flexShrink:0 }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:600, marginBottom:12 }}>EXW margin impact — updating items only</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:12 }}>
              {[
                { label:'Average', b: mgsBefore?.avg,    a: mgsAfter?.avg    },
                { label:'Median',  b: mgsBefore?.median, a: mgsAfter?.median },
                { label:'Mode',    b: mgsBefore?.mode,   a: mgsAfter?.mode   },
                { label:'Minimum', b: mgsBefore?.min,    a: mgsAfter?.min    },
                { label:'Maximum', b: mgsBefore?.max,    a: mgsAfter?.max    },
              ].map(({ label, b, a }) => {
                const d = b != null && a != null ? a - b : null;
                return (
                  <div key={label} style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:10, padding:'12px 16px' }}>
                    <div style={{ fontSize:10, color:t.t4, marginBottom:8 }}>{label}</div>
                    <div style={{ display:'flex', gap:16, alignItems:'center' }}>
                      <div>
                        <div style={{ fontSize:10, color:t.t4 }}>Before</div>
                        <div style={{ fontSize:14, fontFamily:'var(--font-mono)', color:t.t3 }}>{fmtMgn(b)}</div>
                      </div>
                      <div style={{ color:t.t4 }}>→</div>
                      <div>
                        <div style={{ fontSize:10, color:t.t4 }}>After</div>
                        <div style={{ fontSize:14, fontFamily:'var(--font-mono)', color: a!=null&&b!=null ? (a>b?t.green:a<b?t.red:t.t2) : t.t2 }}>{fmtMgn(a)}</div>
                      </div>
                      {d != null && <div style={{ marginLeft:'auto', fontSize:12, fontFamily:'var(--font-mono)', fontWeight:600, color:dColor(d) }}>{fmtDelta(d, true)}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Diff table */}
        <div style={{ flex:1, overflowY:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead style={{ position:'sticky', top:0, background:t.bg3, zIndex:1 }}>
              <tr style={{ borderBottom:`1px solid ${t.b2}` }}>
                {['Item code','EXW cost','Δ EXW','Price used','Δ Price','EXW margin','Δ Margin','MSRP AED','Δ MSRP'].map(h => (
                  <th key={h} style={thSt}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diffRows.map((row, i) => (
                <tr key={i} style={{ borderBottom:`1px solid ${t.b1}`, background:i%2===0?'transparent':'rgba(255,255,255,0.01)' }}>
                  <td style={{ ...tdSt, color:t.blue, fontWeight:500 }}>{row.code}</td>
                  <td style={tdSt}>
                    <div style={{ color:t.t4, fontSize:11 }}>{fmtSrc(row.exwB.value, row.exwB.currency)}</div>
                    <div style={{ color:t.t2 }}>{fmtSrc(row.exwA.value, row.exwA.currency)}</div>
                  </td>
                  <td style={{ ...tdSt, color:dColor(row.exwDelta) }}>{fmtDelta(row.exwDelta)}</td>
                  <td style={tdSt}>
                    <div style={{ color:t.t4, fontSize:11 }}>{fmtSrc(row.priceB.value, row.priceB.currency)}</div>
                    <div style={{ color:t.t2 }}>{fmtSrc(row.priceA.value, row.priceA.currency)}</div>
                  </td>
                  <td style={{ ...tdSt, color:dColor(row.priceDelta) }}>{fmtDelta(row.priceDelta)}</td>
                  <td style={tdSt}>
                    <div style={{ color:t.t4, fontSize:11 }}>{fmtMgn(row.mgB)}</div>
                    <div style={{ color: row.mgA!=null&&row.mgB!=null ? (row.mgA>row.mgB?t.green:row.mgA<row.mgB?t.red:t.t2) : t.t2 }}>{fmtMgn(row.mgA)}</div>
                  </td>
                  <td style={{ ...tdSt, color:dColor(row.mgDelta) }}>{fmtDelta(row.mgDelta, true)}</td>
                  <td style={tdSt}>
                    <div style={{ color:t.t4, fontSize:11 }}>{row.msrpB!=null?`AED ${Number(row.msrpB).toLocaleString()}`:'—'}</div>
                    <div style={{ color:t.t2 }}>{row.msrpA!=null?`AED ${Number(row.msrpA).toLocaleString()}`:'—'}</div>
                  </td>
                  <td style={{ ...tdSt, color:dColor(row.msrpDelta) }}>{fmtDelta(row.msrpDelta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding:'16px 24px', borderTop:`1px solid ${t.b1}`, display:'flex', justifyContent:'flex-end', flexShrink:0 }}>
          <button style={{ ...btnG, padding:'9px 20px' }} onClick={onClose}>Close preview</button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────
export default function BulkUpload({ onToast }) {
  const { isViewer } = useAuth();
  const [stage,      setStage]      = useState('drop'); // drop | summary | review | done
  const [rows,       setRows]       = useState([]);
  const [brandMap,           setBrandMap]           = useState({});
  const [markupCache,        setMarkupCache]         = useState({});
  const [additionalMarkupCache, setAdditionalMarkupCache] = useState({});
  const [rates,              setRates]               = useState({});
  const [importedCount,      setImportedCount]       = useState(0);
  const [importing,          setImporting]           = useState(false);
  const [processing,         setProcessing]          = useState(false);
  const [error,      setError]      = useState(null);
  const [dlLoading,  setDlLoading]  = useState(false);
  const [existingCodes, setExistingCodes] = useState(new Set());
  const [dupMode,  setDupMode]   = useState('keep_new'); // 'keep_old' | 'keep_new'
  const [dupOverrides, setDupOverrides] = useState({}); // item_code -> 'keep_old'|'keep_new'
  const [existingItems,   setExistingItems]   = useState({}); // UPPER_CODE -> DB row
  const [showDiffModal,   setShowDiffModal]   = useState(false);
  const [lastImport,      setLastImport]      = useState(null); // { imported, existingBefore }
  const [expandErr,       setExpandErr]       = useState(null);
  const [applyAll,        setApplyAll]        = useState(null);
  const [showErrorsOnly,  setShowErrorsOnly]  = useState(false);
  const [errorItems,      setErrorItems]      = useState([]);
  const [expandImportErr, setExpandImportErr] = useState(false);
  const [reviewPage,      setReviewPage]      = useState(0);
  const [dupPage,         setDupPage]         = useState(0);
  const [mergeEmpty,      setMergeEmpty]      = useState(false);

  // ── Paste import ─────────────────────────────────────────────
  const [inputMode, setInputMode] = useState('file'); // 'file' | 'paste'
  const [pasteMode, setPasteMode] = useState('full'); // 'full' = create/replace | 'update' = patch existing
  const [paste, setPaste] = useState({
    sku: '', item_name: '', barcode: '', exw_cost: '',
    msrp_primary_ex_vat: '', msrp_primary_inc_vat: '',
  });
  const [pasteOpts, setPasteOpts] = useState({
    brand_code: '', cost_currency: 'EUR', msrp_primary_currency: 'EUR',
    price_used: 'primary_ex_vat', cost_source: '', price_source: '',
    shipping_rate: '', customs_duty_rate: '', target_margin_pct: '',
  });
  const setPasteField = (k, v) => setPaste(p => ({ ...p, [k]: v }));
  const setOpt        = (k, v) => setPasteOpts(p => ({ ...p, [k]: v }));

  // Brand list is normally loaded as a side effect of parsing a file; paste mode
  // needs it up front for the brand picker.
  useEffect(() => {
    if (inputMode !== 'paste' || Object.keys(brandMap).length) return;
    fetchBrands()
      .then(bs => setBrandMap(Object.fromEntries(bs.map(b => [b.brand_code, b]))))
      .catch(e => setError('Failed to load brands: ' + e.message));
  }, [inputMode, brandMap]);

  const brands = Object.values(brandMap);
  const readyRows = rows.filter(r => r._status === 'ready');
  const errorRows = rows.filter(r => r._status === 'error');

  // Re-validate a single row after inline edit
  const revalidateRow = useCallback((rowIdx, updatedRow) => {
    const validated = validateAndCalc(updatedRow, brandMap, markupCache, additionalMarkupCache, rates);
    setRows(prev => prev.map((r,i) => i===rowIdx ? { ...validated, _rowNum: r._rowNum } : r));
  }, [brandMap, markupCache, additionalMarkupCache, rates]);

  const updateField = (rowIdx, field, value) => {
    setRows(prev => {
      const updated = { ...prev[rowIdx], [field]: value };
      const validated = validateAndCalc(updated, brandMap, markupCache, additionalMarkupCache, rates);
      return prev.map((r,i) => i===rowIdx ? { ...validated, _rowNum: r._rowNum } : r);
    });
  };

  const applyToRows = (field, value, errorsOnly) => {
    setRows(prev => prev.map(r => {
      if (errorsOnly && r._status !== 'error') return r;
      const updated = { ...r, [field]: value };
      const validated = validateAndCalc(updated, brandMap, markupCache, additionalMarkupCache, rates);
      return { ...validated, _rowNum: r._rowNum };
    }));
  };

  const handleDownloadTemplate = async () => {
    setDlLoading(true);
    try { await generateTemplate(); }
    catch(e) { setError('Failed to generate template: '+e.message); }
    finally { setDlLoading(false); }
  };

  const handleFile = async (file) => {
    if (!file) { setError('No file received.'); return; }
    setProcessing(true); setError(null);
    try {
      setError(`Step 1: Reading file "${file.name}" (${(file.size/1024).toFixed(1)} KB)...`);
      // Read file into buffer immediately before any async calls
      const buf = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('FileReader failed: ' + e.target.error));
        reader.readAsArrayBuffer(file);
      });
      setError('Step 2: Parsing XLSX...');

      setError('Step 3: Fetching brands and rates from DB...');
      const [brandsArr, ratesData] = await Promise.all([fetchBrands(), fetchRates()]);
      setRates(ratesData);
      const bMap = Object.fromEntries(brandsArr.map(b => [b.brand_code, b]));
      setBrandMap(bMap);

      const mCache = {};
      const addCache = {};
      for (const b of brandsArr) {
        // markup and additional_markup_pct already joined in fetchBrands — no extra query needed
        mCache[b.brand_code]   = b.brand_rules?.markup_percentage ?? 10;
        addCache[b.brand_code] = b.brand_rules?.additional_markup_pct ?? null;
      }
      setMarkupCache(mCache);
      setAdditionalMarkupCache(addCache);
      setError('Step 4: Parsing workbook...');
      const wb  = XLSX.read(buf, { type:'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      // Normalize keys — strip " *" suffix from template headers
      const raw = XLSX.utils.sheet_to_json(ws, { defval:'', raw:false })
        .map(r => Object.fromEntries(Object.entries(r).map(([k,v]) => [k.replace(/ \*$/, '').trim(), String(v??'').trim()])));

      // Skip blank rows and the description row (row 2 has no valid sku)
      // Construct item_code as BRANDCODE-SKU; filter out rows with no valid SKU
      const data = raw.filter(r => {
        const sku = (r['sku'] || '').trim();
        return sku.length > 0 && sku.length <= 50 && !sku.includes(' ');
      }).map(r => {
        const brand = (r['brand_code'] || '').toUpperCase().trim();
        const sku   = (r['sku'] || '').trim();
        return { ...r, item_code: brand ? `${brand}-${sku}` : sku };
      });

      setError(`Step 5: Found ${data.length} data rows. Processing...`);
      if (!data.length) { setError('No data rows found. Make sure data starts from row 3.'); setProcessing(false); return; }

      setError('Step 6: Validating rows...');
      const { processed } = await processRows(data, brandsArr, ratesData, (done, total) => {
        if (total > LARGE_THRESHOLD) setError(`Step 6: Validating rows (${done.toLocaleString()} / ${total.toLocaleString()})...`);
      });
      console.log('Success: processed', processed.length, 'rows, moving to summary');
      setError(null);
      setRows(processed);
      setStage('summary');
    } catch(e) { 
      console.error('handleFile error:', e);
      setError('Failed at: ' + e.message + (e.stack ? ' | ' + e.stack.split('\n')[1] : ''));
    }
    finally { setProcessing(false); }
  };

  // Builds rows from the pasted columns and feeds them into the same
  // validate → summary → review → import pipeline the .xlsx path uses.
  const handlePasteProcess = async () => {
    setProcessing(true); setError(null);
    try {
      // Split on newlines only — line index is the join key across columns, so
      // dropping blanks would shift every value below onto the wrong SKU.
      const col = (k) => paste[k].split('\n').map(s => s.trim());
      const skus = col('sku');
      const names = col('item_name'), bars = col('barcode'), costs = col('exw_cost');
      const exv = col('msrp_primary_ex_vat'), inv = col('msrp_primary_inc_vat');

      const brand = pasteOpts.brand_code.toUpperCase().trim();
      const data = [];
      skus.forEach((sku, i) => {
        if (!sku) return; // blank line in the SKU column = no row
        data.push({
          sku,
          item_code:               brand ? `${brand}-${sku}` : sku,
          item_name:               names[i] ?? '',
          barcode:                 bars[i]  ?? '',
          brand_code:              brand,
          cost_currency:           pasteOpts.cost_currency,
          exw_cost:                costs[i] ?? '',
          msrp_primary_currency:   pasteOpts.msrp_primary_currency,
          msrp_primary_ex_vat:     exv[i] ?? '',
          msrp_primary_inc_vat:    inv[i] ?? '',
          price_used:              pasteOpts.price_used,
          cost_source:             pasteOpts.cost_source,
          price_source:            pasteOpts.price_source,
          shipping_rate:           pasteOpts.shipping_rate,
          customs_duty_rate:       pasteOpts.customs_duty_rate,
          target_margin_pct:       pasteOpts.target_margin_pct,
        });
      });

      if (!data.length) { setError('No SKUs pasted.'); setProcessing(false); return; }

      const [brandsArr, ratesData] = await Promise.all([fetchBrands(), fetchRates()]);
      setRates(ratesData);
      setBrandMap(Object.fromEntries(brandsArr.map(b => [b.brand_code, b])));
      const mCache = {}, addCache = {};
      for (const b of brandsArr) {
        mCache[b.brand_code]   = b.brand_rules?.markup_percentage ?? 10;
        addCache[b.brand_code] = b.brand_rules?.additional_markup_pct ?? null;
      }
      setMarkupCache(mCache);
      setAdditionalMarkupCache(addCache);

      const { processed } = await processRows(data, brandsArr, ratesData);
      // processRows numbers rows for the .xlsx layout (data starts at row 3);
      // pasted lines are 1-indexed.
      setRows(processed.map((r, i) => ({ ...r, _rowNum: i + 1 })));
      setError(null);
      setStage('summary');
    } catch (e) {
      setError('Failed to process pasted data: ' + (e.message || e));
    } finally { setProcessing(false); }
  };

  const handleConfirm = async () => {
    setImporting(true);
    setErrorItems([]);
    setExpandImportErr(false);
    let toImport = [];
    try {
      const getMode = (itemCode) => dupOverrides[itemCode] ?? dupMode;
      toImport = stage === 'summary2'
        ? readyRows.filter(r => !existingCodes.has(r.item_code.toUpperCase()) || getMode(r.item_code) === 'keep_new')
        : readyRows;
      if (!toImport.length) {
        setImporting(false);
        setError('Nothing to import — all duplicates are set to "Keep existing data". Switch duplicates to "Update" to overwrite them.');
        return;
      }

      // Merge mode: fill empty import fields from existing DB data, then revalidate
      if (mergeEmpty && stage === 'summary2') {
        toImport = toImport.map(row => {
          const code     = row.item_code?.toUpperCase();
          const existing = existingItems[code];
          if (!existing) return row;
          let changed = false;
          const merged = { ...row };
          for (const field of MERGE_FIELDS) {
            const iv = row[field];
            const ev = existing[field];
            const isBlank = iv === null || iv === undefined || iv === '';
            const hasVal  = ev !== null && ev !== undefined && ev !== '';
            if (isBlank && hasVal) { merged[field] = ev; changed = true; }
          }
          if (!changed) return row;
          const revalidated = validateAndCalc(merged, brandMap, markupCache, additionalMarkupCache, rates);
          return { ...revalidated, _rowNum: row._rowNum };
        });
      }

      // Pre-check constraint fields before hitting the DB — catches values that slipped past review validation
      const preCheckFails = toImport.flatMap(r => {
        const fails = [];
        if (r.cost_source && !SOURCES.includes(r.cost_source))   fails.push({ item_code: r.item_code, _rowNum: r._rowNum, field: 'cost_source',  value: r.cost_source });
        if (r.price_source && !SOURCES.includes(r.price_source)) fails.push({ item_code: r.item_code, _rowNum: r._rowNum, field: 'price_source', value: r.price_source });
        if (!PRICE_USED_OPTIONS.includes(r.price_used))          fails.push({ item_code: r.item_code, _rowNum: r._rowNum, field: 'price_used',   value: r.price_used });
        return fails;
      });
      if (preCheckFails.length) {
        setErrorItems(preCheckFails);
        setError(`${preCheckFails.length} row${preCheckFails.length>1?'s':''} have invalid field values that would be rejected by the database.`);
        setImporting(false);
        return;
      }

      console.log('Importing', toImport.length, 'items');
      // Snapshot DB state for items being updated — used in post-import summary
      const updatingCodes = new Set(
        toImport.map(r => r.item_code?.toUpperCase()).filter(c => existingItems[c])
      );
      const existingBefore = Object.fromEntries(
        Object.entries(existingItems).filter(([k]) => updatingCodes.has(k))
      );
      await bulkSaveItems(toImport);
      setLastImport({ imported: toImport, existingBefore });
      setImportedCount(toImport.length);
      setStage('done');
      onToast?.(`Import complete — ${toImport.length} item${toImport.length !== 1 ? 's' : ''} saved`);
    } catch(e) {
      console.error('Import error:', e);
      const msg = e.message || e.error_description || JSON.stringify(e);
      const raw = [e.details, e.hint, e.code].filter(Boolean).join(' | ');

      // On DB failure, scan toImport for anything suspicious to surface it
      const suspectItems = toImport.flatMap(r => {
        const suspects = [];
        if (r.cost_source && !SOURCES.includes(r.cost_source))   suspects.push({ item_code: r.item_code, _rowNum: r._rowNum, field: 'cost_source',  value: r.cost_source });
        if (r.price_source && !SOURCES.includes(r.price_source)) suspects.push({ item_code: r.item_code, _rowNum: r._rowNum, field: 'price_source', value: r.price_source });
        if (!PRICE_USED_OPTIONS.includes(r.price_used))          suspects.push({ item_code: r.item_code, _rowNum: r._rowNum, field: 'price_used',   value: r.price_used });
        return suspects;
      });
      if (suspectItems.length) setErrorItems(suspectItems);

      if (msg.includes('cost_source_check'))        setError('Database rejected one or more cost_source values.' + (raw ? ' ' + raw : ''));
      else if (msg.includes('price_source_check'))  setError('Database rejected one or more price_source values.' + (raw ? ' ' + raw : ''));
      else if (msg.includes('price_used_check'))    setError('Database rejected one or more price_used values.' + (raw ? ' ' + raw : ''));
      else if (msg.includes('violates check constraint')) setError('A row failed a database constraint. ' + msg + (raw ? ' | ' + raw : ''));
      else setError(msg + (raw ? ' | ' + raw : ''));
    }
    finally { setImporting(false); }
  };

  const fmtNum = v => v!=null&&!isNaN(v) ? Number(v).toLocaleString() : '—';

  const EDITABLE_COLS = {
    brand_code:            {},  // handled by BrandSelect, not EditCell
    cost_currency:         { options: CURRENCIES },
    msrp_primary_currency: { options: CURRENCIES },
    price_used:            { options: PRICE_USED_OPTIONS },
    cost_source:           { options: SOURCES },
    price_source:          { options: SOURCES },
    item_code:             { isText: true },
    item_name:             { isText: true },
    exw_cost:              { isText: true },
    target_margin_pct:     { isText: true },
  };


  // ── SUMMARY ───────────────────────────────────────────────────
  if (stage === 'summary') {
    const total   = rows.length;
    const ready   = rows.filter(r => r._status === 'ready');
    const errRows = rows.filter(r => r._status === 'error');

    const fillRate = (field) => {
      const filled = rows.filter(r => r[field] !== null && r[field] !== undefined && r[field] !== '').length;
      return total > 0 ? Math.round((filled / total) * 100) : 0;
    };

    const REQUIRED_COLS = ['item_code','item_name','brand_code','cost_currency','exw_cost','msrp_primary_currency','price_used'];
    const OPTIONAL_COLS = ['barcode','shipping_rate','customs_duty_rate','target_margin_pct','cost_source','price_source'];

    // EXW margin on ALL rows: (price_used_aed - exw_cost_aed) / price_used_aed
    const marginStats = (() => {
      const r8 = rates;
      const priceUsedMap = {
        primary_ex_vat:    r => ({ value: r.msrp_primary_ex_vat,    currency: r.msrp_primary_currency }),
        primary_inc_vat:   r => ({ value: r.msrp_primary_inc_vat,   currency: r.msrp_primary_currency }),
        secondary_ex_vat:  r => ({ value: r.msrp_secondary_ex_vat,  currency: r.msrp_secondary_currency }),
        secondary_inc_vat: r => ({ value: r.msrp_secondary_inc_vat, currency: r.msrp_secondary_currency }),
      };
      const items = rows.map(r => {
        if (!r.exw_cost || !r.cost_currency || !r.price_used) return null;
        const { value: priceVal, currency: priceCur } = priceUsedMap[r.price_used]?.(r) || {};
        if (!priceVal || !priceCur) return null;
        const priceRate = r8[priceCur];
        const costRate  = r8[r.cost_currency];
        if (!priceRate || !costRate) return null;
        const priceAED = toNum(priceVal) * priceRate;
        const costAED  = toNum(r.exw_cost) * costRate;
        if (!priceAED || priceAED <= 0) return null;
        const margin = ((priceAED - costAED) / priceAED) * 100;
        return { item_code: r.item_code, margin };
      }).filter(Boolean);
      if (!items.length) return null;
      const avg = items.reduce((s,i) => s + i.margin, 0) / items.length;
      const min = items.reduce((a,b) => a.margin < b.margin ? a : b);
      const max = items.reduce((a,b) => a.margin > b.margin ? a : b);
      const sorted = [...items].sort((a,b) => a.margin - b.margin);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid].margin : (sorted[mid-1].margin + sorted[mid].margin) / 2;
      const freq = {}; let maxF = 0, modeVal = null;
      for (const it of items) { const k = +it.margin.toFixed(1); freq[k] = (freq[k]||0)+1; if (freq[k] > maxF) { maxF = freq[k]; modeVal = k; } }
      return { avg, min, max, median, mode: maxF > 1 ? modeVal : null, count: items.length };
    })();

    const FillBar = ({ pct }) => (
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ flex:1, height:6, background:t.bg4, borderRadius:100, overflow:'hidden' }}>
          <div style={{ width:`${pct}%`, height:'100%', background:pct===100?t.green:pct>50?t.amber:t.red, borderRadius:100 }}/>
        </div>
        <span style={{ fontSize:12, color:pct===100?t.green:pct>50?t.amber:t.red, fontFamily:'var(--font-mono)', minWidth:36, textAlign:'right' }}>{pct}%</span>
      </div>
    );

    const rowSt = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:`1px solid ${t.b1}`, fontSize:13 };

    return (
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:t.t1 }}>Import summary</div>
            <div style={{ display:'flex', gap:16, marginTop:6 }}>
              <span style={{ fontSize:13, color:t.green }}>{ready.length} ready</span>
              {errRows.length>0 && <span style={{ fontSize:13, color:t.red }}>{errRows.length} errors</span>}
              <span style={{ fontSize:13, color:t.t4 }}>{total} total rows</span>
            </div>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button style={btnG} onClick={()=>{setStage('drop');setRows([]);setError(null);setShowErrorsOnly(false);}}>Back</button>
            <button style={{...btnW,opacity:isViewer?0.4:1,cursor:isViewer?'not-allowed':'pointer'}} disabled={isViewer} onClick={()=>setStage('review')}>Review rows →</button>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom:16 }}>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>Required columns</div>
            {REQUIRED_COLS.map(col => (
              <div key={col} style={{ marginBottom:10 }}>
                <div style={{ fontSize:11, color:t.t3, fontFamily:'var(--font-mono)', marginBottom:4 }}>{col}</div>
                <FillBar pct={fillRate(col)}/>
              </div>
            ))}
          </div>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>Optional columns</div>
            {OPTIONAL_COLS.map(col => (
              <div key={col} style={{ marginBottom:10 }}>
                <div style={{ fontSize:11, color:t.t3, fontFamily:'var(--font-mono)', marginBottom:4 }}>{col}</div>
                <FillBar pct={fillRate(col)}/>
              </div>
            ))}
          </div>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>EXW margins</div>
            {!marginStats ? (
              <div style={{ fontSize:13, color:t.t4 }}>No cost data available</div>
            ) : (
              <>
                <div style={rowSt}>
                  <span style={{ color:t.t4 }}>Average</span>
                  <span style={{ color:marginStats.avg>=30?t.green:marginStats.avg>=20?t.amber:t.red, fontFamily:'var(--font-mono)', fontWeight:600, fontSize:15 }}>{marginStats.avg.toFixed(1)}%</span>
                </div>
                <div style={rowSt}>
                  <span style={{ color:t.t4 }}>Median</span>
                  <span style={{ color:marginStats.median>=30?t.green:marginStats.median>=20?t.amber:t.red, fontFamily:'var(--font-mono)', fontWeight:600 }}>{marginStats.median.toFixed(1)}%</span>
                </div>
                <div style={rowSt}>
                  <span style={{ color:t.t4 }}>Mode</span>
                  <span style={{ fontFamily:'var(--font-mono)', fontWeight:600, color:marginStats.mode != null ? (marginStats.mode>=30?t.green:marginStats.mode>=20?t.amber:t.red) : t.t4 }}>{marginStats.mode != null ? `${marginStats.mode.toFixed(1)}%` : '—'}</span>
                </div>
                <div style={rowSt}>
                  <span style={{ color:t.t4 }}>Minimum</span>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ color:t.red, fontFamily:'var(--font-mono)', fontWeight:600 }}>{marginStats.min.margin.toFixed(1)}%</div>
                    <div style={{ fontSize:11, color:t.t4, marginTop:2 }}>{marginStats.min.item_code}</div>
                  </div>
                </div>
                <div style={{ ...rowSt, borderBottom:'none' }}>
                  <span style={{ color:t.t4 }}>Maximum</span>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ color:t.green, fontFamily:'var(--font-mono)', fontWeight:600 }}>{marginStats.max.margin.toFixed(1)}%</div>
                    <div style={{ fontSize:11, color:t.t4, marginTop:2 }}>{marginStats.max.item_code}</div>
                  </div>
                </div>
                <div style={{ marginTop:12, padding:'8px 12px', background:t.bg3, borderRadius:8, fontSize:11, color:t.t4 }}>
                  {marginStats.count} of {ready.length} ready rows had cost data
                </div>
              </>
            )}
          </div>
        </div>

        {(() => {
          const dupInFileCodes = [...new Set(rows.filter(r => r._dupInFile).map(r => r.item_code?.toUpperCase()))];
          return dupInFileCodes.length > 0 && (
            <div style={{ background:'rgba(245,166,35,0.07)', border:'1px solid rgba(245,166,35,0.25)', borderRadius:10, padding:'12px 16px', fontSize:13, color:t.amber, marginBottom:10 }}>
              <strong>{dupInFileCodes.length} duplicate item code{dupInFileCodes.length>1?'s':''} found in your file</strong> — only the last row for each code will be imported. Fix or remove the earlier rows in Review.
              <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:6 }}>
                {dupInFileCodes.map(c => <span key={c} style={{ fontSize:11, padding:'2px 8px', background:'rgba(245,166,35,0.12)', border:'1px solid rgba(245,166,35,0.3)', borderRadius:100, fontFamily:'var(--font-mono)' }}>{c}</span>)}
              </div>
            </div>
          );
        })()}
        {errRows.length > 0 && (
          <div style={{ background:'rgba(242,100,100,0.06)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:10, padding:'12px 16px', fontSize:13, color:t.red }}>
            {errRows.length} row{errRows.length>1?'s':''} have errors and will be skipped unless fixed. Click <strong>Review rows →</strong> to fix them inline.
          </div>
        )}
      </div>
    );
  }

  // ── SUMMARY 2 ─────────────────────────────────────────────────
  if (stage === 'summary2') {
    const newItems  = readyRows.filter(r => !existingCodes.has(r.item_code.toUpperCase()));
    const dupItems  = readyRows.filter(r => existingCodes.has(r.item_code.toUpperCase()));

    const getMode = (itemCode) => dupOverrides[itemCode] ?? dupMode;

    const itemsToImport = [
      ...newItems,
      ...dupItems.filter(r => getMode(r.item_code) === 'keep_new'),
    ];
    const itemsSkipped = dupItems.filter(r => getMode(r.item_code) === 'keep_old');

    const fmtNum = v => v != null && !isNaN(v) ? Number(v).toLocaleString() : '—';

    return (
      <div>
        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:t.t1 }}>Pre-import review</div>
            <div style={{ display:'flex', gap:16, marginTop:6 }}>
              <span style={{ fontSize:13, color:t.green }}>{newItems.length} new items</span>
              {dupItems.length>0 && <span style={{ fontSize:13, color:t.amber }}>{dupItems.length} duplicates</span>}
              {errorRows.length>0 && <span style={{ fontSize:13, color:t.red }}>{errorRows.length} errors skipped</span>}
            </div>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button style={btnG} onClick={()=>{ setShowDiffModal(false); setStage('review'); }}>Back to review</button>
            <button style={{ ...btnW, opacity:(importing||!itemsToImport.length||isViewer)?0.6:1 }}
              onClick={handleConfirm} disabled={importing||!itemsToImport.length||isViewer}>
              {importing?'Importing...':`Import ${itemsToImport.length} item${itemsToImport.length!==1?'s':''}`}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background:'rgba(242,100,100,0.08)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:8, padding:'12px 16px', color:t.red, fontSize:13, marginBottom:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
              <span>{error}</span>
              {errorItems.length > 0 && (
                <button onClick={() => setExpandImportErr(v => !v)}
                  style={{ flexShrink:0, fontSize:11, color:t.red, background:'rgba(242,100,100,0.12)', border:'1px solid rgba(242,100,100,0.3)', borderRadius:6, padding:'3px 10px', cursor:'pointer', fontFamily:'var(--font-sans)', whiteSpace:'nowrap' }}>
                  {expandImportErr ? 'Hide' : `Show ${errorItems.length} affected row${errorItems.length>1?'s':''}`}
                </button>
              )}
            </div>
            {expandImportErr && errorItems.length > 0 && (
              <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:4 }}>
                {errorItems.map((item, idx) => (
                  <div key={idx} style={{ display:'flex', gap:10, fontSize:12, fontFamily:'var(--font-mono)', background:'rgba(242,100,100,0.08)', borderRadius:6, padding:'5px 10px' }}>
                    <span style={{ color:t.red, fontWeight:600 }}>{item.item_code}</span>
                    <span style={{ color:'rgba(242,100,100,0.6)' }}>row {item._rowNum}</span>
                    <span style={{ color:t.red }}>{item.field}</span>
                    <span style={{ color:'rgba(242,100,100,0.8)' }}>= "{item.value}"</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Summary cards */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom:20 }}>
          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12, fontWeight:600 }}>New items</div>
            <div style={{ fontSize:28, fontWeight:500, color:t.green, fontFamily:'var(--font-mono)' }}>{newItems.length}</div>
            <div style={{ fontSize:12, color:t.t4, marginTop:4 }}>Will be created in DB</div>
          </div>
          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12, fontWeight:600 }}>Duplicates found</div>
            <div style={{ fontSize:28, fontWeight:500, color:dupItems.length>0?t.amber:t.t4, fontFamily:'var(--font-mono)' }}>{dupItems.length}</div>
            <div style={{ fontSize:12, color:t.t4, marginTop:4 }}>Item codes already exist in DB</div>
          </div>
          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12, fontWeight:600 }}>Will import</div>
            <div style={{ fontSize:28, fontWeight:500, color:t.t1, fontFamily:'var(--font-mono)' }}>{itemsToImport.length}</div>
            <div style={{ fontSize:12, color:t.t4, marginTop:4 }}>{itemsSkipped.length} duplicates will be skipped</div>
          </div>
        </div>

        {/* Preview changes button — only when there are items being updated */}
        {(() => {
          const updatingItems = dupItems.filter(r => getMode(r.item_code) === 'keep_new');
          return updatingItems.length > 0 && (
            <div style={{ marginBottom:16, display:'flex', alignItems:'center', gap:12 }}>
              <button
                style={{ ...btnG, color:t.amber, borderColor:'rgba(245,166,35,0.3)', background:'rgba(245,166,35,0.07)' }}
                onClick={() => setShowDiffModal(true)}
              >Preview {updatingItems.length} change{updatingItems.length!==1?'s':''} →</button>
              <span style={{ fontSize:12, color:t.t4 }}>See what will change before committing</span>
            </div>
          );
        })()}

        {showDiffModal && (
          <DiffModal
            items={dupItems.filter(r => getMode(r.item_code) === 'keep_new')}
            existingItems={existingItems}
            rates={rates}
            onClose={() => setShowDiffModal(false)}
          />
        )}

        {/* Duplicate handling */}
        {dupItems.length > 0 && (
          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, overflow:'hidden', marginBottom:16 }}>
            {/* Global toggle */}
            <div style={{ padding:'16px 20px', borderBottom:`1px solid ${t.b2}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:13, fontWeight:500, color:t.t1 }}>Duplicate handling</div>
                <div style={{ fontSize:12, color:t.t4, marginTop:2 }}>Apply globally · override per row below</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button
                  style={{ ...btnSm, padding:'8px 16px', fontSize:12, cursor:'pointer', fontFamily:'var(--font-sans)', borderRadius:8, border:`1px solid ${dupMode==='keep_old'?'rgba(77,159,255,0.5)':'rgba(255,255,255,0.1)'}`, background:dupMode==='keep_old'?'rgba(77,159,255,0.12)':'transparent', color:dupMode==='keep_old'?t.blue:t.t3 }}
                  onClick={()=>{ setDupMode('keep_old'); setDupOverrides({}); }}
                >Keep existing data</button>
                <button
                  style={{ ...btnSm, padding:'8px 16px', fontSize:12, cursor:'pointer', fontFamily:'var(--font-sans)', borderRadius:8, border:`1px solid ${dupMode==='keep_new'?'rgba(62,207,142,0.5)':'rgba(255,255,255,0.1)'}`, background:dupMode==='keep_new'?'rgba(62,207,142,0.12)':'transparent', color:dupMode==='keep_new'?t.green:t.t3 }}
                  onClick={()=>{ setDupMode('keep_new'); setDupOverrides({}); }}
                >Update with new data</button>
              </div>
            </div>
            <div style={{ padding:'12px 20px', borderBottom:`1px solid ${t.b1}` }}>
              <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
                <input type="checkbox" style={{ accentColor:t.blue, cursor:'pointer', width:14, height:14 }}
                  checked={mergeEmpty} onChange={e => setMergeEmpty(e.target.checked)} />
                <div>
                  <div style={{ fontSize:12, fontWeight:500, color:mergeEmpty ? t.t1 : t.t3 }}>Keep existing values for blank fields</div>
                  <div style={{ fontSize:11, color:t.t4, marginTop:2 }}>Fields left blank in this import won't overwrite existing data — e.g. barcodes not in your file stay intact</div>
                </div>
              </label>
            </div>

            {/* Duplicate rows */}
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:t.bg3, borderBottom:`1px solid ${t.b2}` }}>
                  {['Item code','Item name','UAE price','KSA price','QAT price','EXW cost','Action'].map(h=>(
                    <th key={h} style={{ padding:'9px 14px', textAlign:'left', fontSize:11, color:t.t2, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:600, whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dupItems.slice(dupPage * REVIEW_PAGE_SIZE, (dupPage + 1) * REVIEW_PAGE_SIZE).map((row,di) => {
                  const mode = getMode(row.item_code);
                  const isUpdate = mode === 'keep_new';
                  return (
                    <tr key={di} style={{ background:isUpdate?'rgba(62,207,142,0.04)':'rgba(255,255,255,0.01)', borderBottom:`1px solid ${t.b1}` }}>
                      <td style={{ padding:'10px 14px', fontSize:13, color:t.blue, fontFamily:'var(--font-mono)', fontWeight:500 }}>{row.item_code}</td>
                      <td style={{ padding:'10px 14px', fontSize:13, color:t.t2 }} title={row.item_name}>{row.item_name?.length>28?row.item_name.slice(0,28)+'…':row.item_name}</td>
                      <td style={{ padding:'10px 14px', fontSize:13, color:t.t1, fontFamily:'var(--font-mono)' }}>{row.msrp_aed?`AED ${fmtNum(row.msrp_aed)}`:'—'}</td>
                      <td style={{ padding:'10px 14px', fontSize:13, color:t.t2, fontFamily:'var(--font-mono)' }}>{row.msrp_sar?`SAR ${fmtNum(row.msrp_sar)}`:'—'}</td>
                      <td style={{ padding:'10px 14px', fontSize:13, color:t.t2, fontFamily:'var(--font-mono)' }}>{row.msrp_qat?`QAR ${fmtNum(row.msrp_qat)}`:'—'}</td>
                      <td style={{ padding:'10px 14px', fontSize:13, color:t.t2, fontFamily:'var(--font-mono)' }}>{row.exw_cost?`${row.cost_currency} ${fmtNum(row.exw_cost)}`:'—'}</td>
                      <td style={{ padding:'10px 14px' }}>
                        <div style={{ display:'flex', gap:6 }}>
                          <button
                            style={{ fontSize:11, padding:'4px 10px', borderRadius:6, cursor:'pointer', fontFamily:'var(--font-sans)', border:`1px solid ${mode==='keep_old'?'rgba(77,159,255,0.5)':'rgba(255,255,255,0.1)'}`, background:mode==='keep_old'?'rgba(77,159,255,0.12)':'transparent', color:mode==='keep_old'?t.blue:t.t4 }}
                            onClick={()=>setDupOverrides(prev=>({...prev,[row.item_code]:'keep_old'}))}
                          >Keep old</button>
                          <button
                            style={{ fontSize:11, padding:'4px 10px', borderRadius:6, cursor:'pointer', fontFamily:'var(--font-sans)', border:`1px solid ${mode==='keep_new'?'rgba(62,207,142,0.5)':'rgba(255,255,255,0.1)'}`, background:mode==='keep_new'?'rgba(62,207,142,0.12)':'transparent', color:mode==='keep_new'?t.green:t.t4 }}
                            onClick={()=>setDupOverrides(prev=>({...prev,[row.item_code]:'keep_new'}))}
                          >Update</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {Math.ceil(dupItems.length / REVIEW_PAGE_SIZE) > 1 && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 20px', borderTop:`1px solid ${t.b1}` }}>
                <span style={{ fontSize:12, color:t.t4 }}>
                  {(dupPage * REVIEW_PAGE_SIZE + 1).toLocaleString()}–{Math.min((dupPage + 1) * REVIEW_PAGE_SIZE, dupItems.length).toLocaleString()} of {dupItems.length.toLocaleString()} duplicates
                </span>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <button style={{ ...btnG, opacity: dupPage === 0 ? 0.4 : 1 }} disabled={dupPage === 0} onClick={() => setDupPage(p => p - 1)}>← Prev</button>
                  <span style={{ fontSize:12, color:t.t3, padding:'7px 12px', border:`1px solid ${t.b2}`, borderRadius:6, fontFamily:'var(--font-mono)' }}>{dupPage + 1} / {Math.ceil(dupItems.length / REVIEW_PAGE_SIZE)}</span>
                  <button style={{ ...btnG, opacity: dupPage >= Math.ceil(dupItems.length/REVIEW_PAGE_SIZE)-1 ? 0.4 : 1 }} disabled={dupPage >= Math.ceil(dupItems.length/REVIEW_PAGE_SIZE)-1} onClick={() => setDupPage(p => p + 1)}>Next →</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* New items preview */}
        {newItems.length > 0 && (
          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'14px 20px' }}>
            <div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>{newItems.length} new items — all will be created</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {newItems.slice(0, 500).map((r,ni)=>(
                <span key={ni} style={{ fontSize:11, padding:'3px 10px', background:t.bg3, border:`1px solid ${t.b2}`, borderRadius:100, color:t.green, fontFamily:'var(--font-mono)' }}>{r.item_code}</span>
              ))}
              {newItems.length > 500 && (
                <span style={{ fontSize:11, padding:'3px 10px', background:t.bg3, border:`1px solid ${t.b2}`, borderRadius:100, color:t.t4, fontFamily:'var(--font-mono)' }}>+{(newItems.length - 500).toLocaleString()} more</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── DONE ──────────────────────────────────────────────────────
  if (stage === 'done') {
    const { imported = [], existingBefore = {} } = lastImport || {};
    const updatedItems = imported.filter(r => existingBefore[r.item_code?.toUpperCase()]);
    const newItems2    = imported.filter(r => !existingBefore[r.item_code?.toUpperCase()]);
    const skipped      = readyRows.length - imported.length;

    const getExwAed = (item) => {
      const rate = rates[item.cost_currency];
      if (!rate || item.exw_cost == null) return null;
      return toNum(item.exw_cost) * rate;
    };
    const getLandedAed = (item) => {
      const exwAed = getExwAed(item);
      if (exwAed == null) return null;
      const ship = toNum(item.shipping_rate) ?? 0;
      const duty = toNum(item.customs_duty_rate) ?? 5.5;
      return exwAed * (1 + ship / 100) * (1 + duty / 100);
    };
    const statOf = (vals) => {
      const v = vals.filter(x => x != null);
      if (!v.length) return null;
      const sorted = [...v].sort((a,b) => a-b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
      const freq = {}; let maxF = 0, modeVal = null;
      for (const n of v) { const k = Math.round(n); freq[k] = (freq[k]||0)+1; if (freq[k] > maxF) { maxF = freq[k]; modeVal = k; } }
      return { min: sorted[0], max: sorted[sorted.length-1], avg: v.reduce((a,b) => a+b, 0) / v.length, median, mode: maxF > 1 ? modeVal : null, count: v.length };
    };

    const exwStats    = statOf(imported.map(getExwAed));
    const landedStats = statOf(imported.map(getLandedAed));

    const msrpChanges = updatedItems.map(r => {
      const code   = r.item_code?.toUpperCase();
      const before = toNum(existingBefore[code]?.msrp_aed);
      const after  = toNum(r.msrp_aed);
      if (!before || !after || before === 0) return null;
      return ((after - before) / before) * 100;
    }).filter(v => v != null);
    const avgMsrpChange = msrpChanges.length
      ? msrpChanges.reduce((a,b) => a+b, 0) / msrpChanges.length
      : null;

    const fmtAED = v => v != null ? `AED ${Number(v).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 })}` : '—';
    const rowSt  = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:`1px solid ${t.b1}`, fontSize:13 };
    const resetAll = () => { setStage('drop'); setRows([]); setError(null); setImportedCount(0); setLastImport(null); };

    return (
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:t.t1 }}>Import complete</div>
            <div style={{ display:'flex', gap:16, marginTop:6 }}>
              <span style={{ fontSize:13, color:t.green }}>✓ {imported.length} saved</span>
              {newItems2.length > 0    && <span style={{ fontSize:13, color:t.green }}>{newItems2.length} new</span>}
              {updatedItems.length > 0 && <span style={{ fontSize:13, color:t.blue }}>{updatedItems.length} updated</span>}
              {skipped > 0             && <span style={{ fontSize:13, color:t.amber }}>{skipped} skipped</span>}
              {errorRows.length > 0    && <span style={{ fontSize:13, color:t.red }}>{errorRows.length} errors</span>}
            </div>
          </div>
          <button style={btnG} onClick={resetAll}>Close summary</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>EXW cost — AED equivalent</div>
            {!exwStats ? (
              <div style={{ fontSize:13, color:t.t4 }}>No cost data</div>
            ) : (
              <>
                <div style={rowSt}><span style={{ color:t.t4 }}>Average</span><span style={{ fontFamily:'var(--font-mono)', color:t.t1 }}>{fmtAED(exwStats.avg)}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Median</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(exwStats.median)}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Mode</span><span style={{ fontFamily:'var(--font-mono)', color:exwStats.mode != null ? t.t2 : t.t4 }}>{exwStats.mode != null ? fmtAED(exwStats.mode) : '—'}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Minimum</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(exwStats.min)}</span></div>
                <div style={{ ...rowSt, borderBottom:'none' }}><span style={{ color:t.t4 }}>Maximum</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(exwStats.max)}</span></div>
                <div style={{ marginTop:12, fontSize:11, color:t.t4 }}>{exwStats.count} of {imported.length} items had cost data</div>
              </>
            )}
          </div>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>Landed cost — AED</div>
            {!landedStats ? (
              <div style={{ fontSize:13, color:t.t4 }}>No cost data</div>
            ) : (
              <>
                <div style={rowSt}><span style={{ color:t.t4 }}>Average</span><span style={{ fontFamily:'var(--font-mono)', color:t.t1 }}>{fmtAED(landedStats.avg)}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Median</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(landedStats.median)}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Mode</span><span style={{ fontFamily:'var(--font-mono)', color:landedStats.mode != null ? t.t2 : t.t4 }}>{landedStats.mode != null ? fmtAED(landedStats.mode) : '—'}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Minimum</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(landedStats.min)}</span></div>
                <div style={{ ...rowSt, borderBottom:'none' }}><span style={{ color:t.t4 }}>Maximum</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(landedStats.max)}</span></div>
                <div style={{ marginTop:12, fontSize:11, color:t.t4 }}>{landedStats.count} of {imported.length} items had cost data</div>
              </>
            )}
          </div>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>MSRP AED change</div>
            {updatedItems.length === 0 ? (
              <div style={{ fontSize:13, color:t.t4 }}>No updated items — all were new</div>
            ) : avgMsrpChange == null ? (
              <div style={{ fontSize:13, color:t.t4 }}>No MSRP data for updated items</div>
            ) : (
              <>
                <div style={{ fontSize:28, fontWeight:500, fontFamily:'var(--font-mono)', marginBottom:4, color: avgMsrpChange > 0.05 ? t.green : avgMsrpChange < -0.05 ? t.red : t.t4 }}>
                  {avgMsrpChange > 0 ? '+' : ''}{avgMsrpChange.toFixed(1)}%
                </div>
                <div style={{ fontSize:12, color:t.t4 }}>avg change across {msrpChanges.length} updated item{msrpChanges.length!==1?'s':''}</div>
              </>
            )}
          </div>

        </div>
      </div>
    );
  }

  // ── REVIEW ────────────────────────────────────────────────────
  if (stage === 'review') return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:500, color:t.t1 }}>Review import</div>
          <div style={{ display:'flex', gap:16, marginTop:6 }}>
            <span style={{ fontSize:13, color:t.green }}>{readyRows.length} ready</span>
            {errorRows.length>0 && <span style={{ fontSize:13, color:t.red }}>{errorRows.length} errors — fix inline or they'll be skipped</span>}
          </div>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button style={btnG} onClick={()=>{setStage('summary');setShowErrorsOnly(false);}}>Back</button>
          {errorRows.length > 0 && (
            <button
              style={{ ...btnG, border: showErrorsOnly ? '1px solid rgba(242,100,100,0.5)' : undefined, background: showErrorsOnly ? 'rgba(242,100,100,0.1)' : undefined, color: showErrorsOnly ? t.red : undefined }}
              onClick={() => { setShowErrorsOnly(v => !v); setReviewPage(0); }}
            >{showErrorsOnly ? `Errors only (${errorRows.length})` : `Show errors only`}</button>
          )}
          <button style={{ ...btnW, opacity:(!readyRows.length||isViewer)?0.6:1 }}
            onClick={async () => {
              setError(null);
              setDupPage(0);
              try {
                const codes = readyRows.map(r => r.item_code.toUpperCase());
                const existing = await checkExisting(codes);
                setExistingCodes(existing);
                setDupOverrides({});
                setDupMode('keep_new');
                const dupCodes = [...existing];
                if (dupCodes.length > 0) {
                  const items = await fetchItemsByCodes(dupCodes);
                  setExistingItems(items);
                } else {
                  setExistingItems({});
                }
                setShowDiffModal(false);
                setStage('summary2');
              } catch (e) {
                setError(e.message || 'Failed to check for duplicates. Please try again.');
              }
            }} disabled={!readyRows.length||isViewer}>
            Review & confirm →
          </button>
        </div>
      </div>

      {error && <div style={{ background:'rgba(242,100,100,0.08)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:8, padding:'12px 16px', color:t.red, fontSize:13, marginBottom:16 }}>{error}</div>}

      {/* Apply-to-all hint */}
      {errorRows.length > 0 && (
        <div style={{ fontSize:12, color:t.t4, marginBottom:12, fontFamily:'var(--font-mono)' }}>
          Tip: change a dropdown on any row → click the ↕ button to apply that value to all error rows or all rows
        </div>
      )}

      <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, overflow:'hidden' }}>
        <div style={{ overflowX:'auto', maxHeight:'calc(100vh - 300px)', overflowY:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:t.bg3, borderBottom:`1px solid ${t.b2}` }}>
                {['Row','Status','Item code','Item name','Brand','Cost curr.','MSRP curr.','Price used','Margin %','MSRP value','→ UAE','→ KSA','→ QAT','EXW cost','Cost src.','Price src.',''].map(h=>(
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, color:t.t2, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap', fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const filteredWithIdx = rows.map((row, i) => ({ row, i })).filter(({ row }) => !showErrorsOnly || row._status === 'error');
                const pageItems = filteredWithIdx.slice(reviewPage * REVIEW_PAGE_SIZE, (reviewPage + 1) * REVIEW_PAGE_SIZE);
                return pageItems.map(({ row, i }) => {
                const priceVal = { primary_ex_vat:row.msrp_primary_ex_vat, primary_inc_vat:row.msrp_primary_inc_vat, secondary_ex_vat:row.msrp_secondary_ex_vat, secondary_inc_vat:row.msrp_secondary_inc_vat }[row.price_used];
                const priceCurr = row.price_used?.startsWith('primary') ? row.msrp_primary_currency : row.msrp_secondary_currency;
                const isErr = row._status === 'error';

                const fieldHasError = (field) => isErr && row._errors.some(e => e.toLowerCase().includes(field.replace('_',' ').toLowerCase()) || e.toLowerCase().includes(field));

                const InlineEdit = ({ field }) => {
                  const col = EDITABLE_COLS[field];
                  if (!col) return <span style={{ fontSize:13, color:t.t2 }}>{row[field]||'—'}</span>;
                  const hasErr = fieldHasError(field);
                  const handleChange = val => {
                    updateField(i, field, val);
                    setApplyAll({ field, value: val, rowIdx: i });
                  };
                  return (
                    <div style={{ position:'relative', display:'flex', gap:4, alignItems:'center' }}>
                      {field === 'brand_code' ? (
                        <BrandSelect
                          brands={brands}
                          value={row.brand_code || ''}
                          onChange={handleChange}
                          placeholder="—"
                          hasError={hasErr}
                          style={{ minWidth: 180 }}
                        />
                      ) : (
                        <EditCell
                          value={row[field]}
                          options={col.options}
                          isText={col.isText}
                          hasError={hasErr}
                          onChange={handleChange}
                        />
                      )}
                      {applyAll?.rowIdx===i && applyAll?.field===field && (
                        <div style={{ position:'relative' }}>
                          <button
                            style={{ ...btnG, ...btnSm, fontSize:11, padding:'4px 8px', color:t.blue, borderColor:'rgba(77,159,255,0.3)' }}
                            onClick={() => setApplyAll(a => a ? { ...a, open:!a.open } : null)}
                          >↕</button>
                          {applyAll?.open && (
                            <ApplyAll
                              onApplyErrors={() => applyToRows(field, applyAll.value, true)}
                              onApplyAll={() => applyToRows(field, applyAll.value, false)}
                              onDismiss={() => setApplyAll(null)}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <React.Fragment key={i}>
                    <tr style={{ background:isErr?'rgba(242,100,100,0.03)':i%2===0?'transparent':'rgba(255,255,255,0.01)', borderBottom:`1px solid ${t.b1}` }}>
                      <td style={{ padding:'8px 14px', fontSize:12, color:t.t4, fontFamily:'var(--font-mono)' }}>{row._rowNum}</td>
                      <td style={{ padding:'8px 14px' }}>
                        <div style={{ display:'flex', flexDirection:'column', gap:4, alignItems:'flex-start' }}>
                          <div
                            style={{ cursor: isErr ? 'pointer' : 'default' }}
                            onClick={() => isErr && setExpandErr(expandErr === i ? null : i)}
                            title={isErr ? (expandErr === i ? 'Hide errors' : `${row._errors.length} error${row._errors.length>1?'s':''} — click to expand`) : undefined}
                          >
                            <StatusBadge status={row._status}/>
                          </div>
                          {row._dupInFile && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:100, background:'rgba(245,166,35,0.12)', border:'1px solid rgba(245,166,35,0.3)', color:t.amber, fontFamily:'var(--font-mono)', whiteSpace:'nowrap' }}>dup in file</span>}
                          {row._warnings?.length > 0 && <span style={{ fontSize:10, color:t.amber, fontFamily:'var(--font-sans)', whiteSpace:'nowrap' }}>⚠ {row._warnings.join(', ')}</span>}
                        </div>
                      </td>
                      <td style={{ padding:'8px 14px' }}><InlineEdit field="item_code"/></td>
                      <td style={{ padding:'8px 14px' }}><InlineEdit field="item_name"/></td>
                      <td style={{ padding:'8px 14px' }}><InlineEdit field="brand_code"/></td>
                      <td style={{ padding:'8px 14px' }}><InlineEdit field="cost_currency"/></td>
                      <td style={{ padding:'8px 14px' }}><InlineEdit field="msrp_primary_currency"/></td>
                      <td style={{ padding:'8px 14px' }}><InlineEdit field="price_used"/></td>
                      <td style={{ padding:'8px 14px' }}>{row.price_used==='cost_based'?<InlineEdit field="target_margin_pct"/>:<span style={{ fontSize:13, color:t.t4 }}>—</span>}</td>
                      <td style={{ padding:'8px 14px', fontSize:13, color:t.t2, whiteSpace:'nowrap' }}>{priceVal?`${priceCurr} ${fmtNum(priceVal)}`:'—'}</td>
                      <td style={{ padding:'8px 14px', fontSize:13, color:t.green, fontWeight:500, whiteSpace:'nowrap', textAlign:'right' }}>{row.msrp_aed?`AED ${fmtNum(row.msrp_aed)}`:'—'}</td>
                      <td style={{ padding:'8px 14px', fontSize:13, color:t.t2, whiteSpace:'nowrap', textAlign:'right' }}>{row.msrp_sar?`SAR ${fmtNum(row.msrp_sar)}`:'—'}</td>
                      <td style={{ padding:'8px 14px', fontSize:13, color:t.t2, whiteSpace:'nowrap', textAlign:'right' }}>{row.msrp_qat?`QAR ${fmtNum(row.msrp_qat)}`:'—'}</td>
                      <td style={{ padding:'8px 14px', fontSize:13, color:t.t2, whiteSpace:'nowrap' }}>{row.exw_cost?`${row.cost_currency} ${fmtNum(row.exw_cost)}`:'—'}</td>
                      <td style={{ padding:'8px 14px' }}><InlineEdit field="cost_source"/></td>
                      <td style={{ padding:'8px 14px' }}><InlineEdit field="price_source"/></td>
                      <td style={{ padding:'8px 14px' }}>
                        <button
                          onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))}
                          title="Remove from import"
                          style={{ fontSize:13, color:t.t4, background:'none', border:'none', cursor:'pointer', padding:'2px 6px', borderRadius:4, lineHeight:1 }}
                          onMouseEnter={e => { e.currentTarget.style.color = t.red; e.currentTarget.style.background = 'rgba(242,100,100,0.1)'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = t.t4; e.currentTarget.style.background = 'none'; }}
                        >×</button>
                      </td>
                    </tr>
                    {expandErr===i && (
                      <tr>
                        <td colSpan={17} style={{ padding:'10px 16px 14px', background:'rgba(242,100,100,0.06)', borderBottom:`1px solid ${t.b1}` }}>
                          {row._errors.map((e,ei) => (
                            <div key={ei} style={{ fontSize:12, color:t.red, marginBottom:4, display:'flex', gap:8 }}>
                              <span style={{ color:'rgba(242,100,100,0.5)' }}>✕</span>{e}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              });
              })()}
            </tbody>
          </table>
        </div>
        {(() => {
          const filteredLen = rows.filter(r => !showErrorsOnly || r._status === 'error').length;
          const totalPages  = Math.ceil(filteredLen / REVIEW_PAGE_SIZE);
          if (totalPages <= 1) return null;
          return (
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 20px', borderTop:`1px solid ${t.b1}` }}>
              <span style={{ fontSize:12, color:t.t4 }}>
                Rows {(reviewPage * REVIEW_PAGE_SIZE + 1).toLocaleString()}–{Math.min((reviewPage + 1) * REVIEW_PAGE_SIZE, filteredLen).toLocaleString()} of {filteredLen.toLocaleString()}
              </span>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <button style={{ ...btnG, opacity: reviewPage === 0 ? 0.4 : 1 }} disabled={reviewPage === 0} onClick={() => setReviewPage(p => p - 1)}>← Prev</button>
                <span style={{ fontSize:12, color:t.t3, padding:'7px 12px', border:`1px solid ${t.b2}`, borderRadius:6, fontFamily:'var(--font-mono)' }}>{reviewPage + 1} / {totalPages}</span>
                <button style={{ ...btnG, opacity: reviewPage >= totalPages-1 ? 0.4 : 1 }} disabled={reviewPage >= totalPages-1} onClick={() => setReviewPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );

  // ── DROP ──────────────────────────────────────────────────────
  return (
    <div>
      {isViewer && <div style={{ background:'rgba(245,166,35,0.07)', border:'1px solid rgba(245,166,35,0.25)', borderRadius:8, padding:'10px 16px', color:t.amber, fontSize:13, marginBottom:16 }}>View only — bulk import is disabled for your account.</div>}
      {error && <div style={{ background:'rgba(242,100,100,0.08)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:8, padding:'12px 16px', color:t.red, fontSize:13, marginBottom:16 }}>{error}</div>}

      {/* ── Input mode ─────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {[{ k:'file', label:'Upload .xlsx' }, { k:'paste', label:'Paste columns' }].map(({ k, label }) => (
          <button key={k} onClick={()=>{ setInputMode(k); setError(null); }}
            style={{ ...btnG, ...btnSm, padding:'8px 16px',
              background: inputMode===k ? 'rgba(77,159,255,0.09)' : 'transparent',
              borderColor: inputMode===k ? 'rgba(77,159,255,0.3)' : t.b2,
              color: inputMode===k ? t.blue : t.t3 }}>
            {label}
          </button>
        ))}
      </div>

      {inputMode === 'paste' ? (
      <>
        {/* Full writes the whole row; Update patches only the fields fed;
            Mass Override pins market prices as manual overrides. */}
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          {[{ k:'full', label:'Full' }, { k:'update', label:'Update' }, { k:'override', label:'Mass Override' }].map(({ k, label }) => (
            <button key={k} onClick={()=>{ setPasteMode(k); setError(null); }}
              style={{ ...btnG, ...btnSm, padding:'6px 14px',
                background: pasteMode===k ? 'rgba(77,159,255,0.09)' : 'transparent',
                borderColor: pasteMode===k ? 'rgba(77,159,255,0.3)' : t.b2,
                color: pasteMode===k ? t.blue : t.t3 }}>
              {k === 'override' ? label : `Paste columns: ${label}`}
            </button>
          ))}
        </div>
        {pasteMode === 'override' ? (
          <MassOverride onToast={onToast} isViewer={isViewer} />
        ) : pasteMode === 'update' ? (
          <BulkUpdatePaste onToast={onToast} isViewer={isViewer} />
        ) : (
        <PastePanel
          paste={paste} setPasteField={setPasteField}
          opts={pasteOpts} setOpt={setOpt}
          brands={Object.values(brandMap)}
          processing={processing} isViewer={isViewer}
          onProcess={handlePasteProcess}
        />
        )}
      </>
      ) : (
      <>
      <div style={{ ...groupBox(false), marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontSize:14, fontWeight:500, color:t.t1, marginBottom:4 }}>Download import template</div>
          <div style={{ fontSize:13, color:t.t3 }}>Generated from current DB — includes all active brands and valid reference values</div>
        </div>
        <button style={{ ...btnG, color:t.blue, borderColor:'rgba(77,159,255,0.3)', whiteSpace:'nowrap' }}
          onClick={handleDownloadTemplate} disabled={dlLoading}>
          {dlLoading?'Generating...':'↓ Download template (.xlsx)'}
        </button>
      </div>

      <div
        onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];f?.name.endsWith('.xlsx')?handleFile(f):setError('Only .xlsx files are supported.');}}
        onDragOver={e=>e.preventDefault()}
        style={{ background:t.bg2, border:`1px dashed ${t.b2}`, borderRadius:12, padding:'56px 24px', display:'flex', flexDirection:'column', alignItems:'center', gap:12, marginBottom:16, cursor:'pointer', transition:'border-color 0.15s' }}
        onMouseEnter={e=>e.currentTarget.style.borderColor=t.b3}
        onMouseLeave={e=>e.currentTarget.style.borderColor=t.b2}
      >
        {processing?(
          <>
            <div style={{ fontSize:28, color:t.t4 }}>⟳</div>
            <div style={{ fontSize:15, color:t.t2 }}>Processing file...</div>
          </>
        ):(
          <>
            <div style={{ fontSize:28, color:t.t4 }}>↑</div>
            <div style={{ fontSize:15, color:t.t2 }}>Drop your .xlsx file here</div>
            <div style={{ fontSize:13, color:t.t4 }}>or</div>
            <label style={{ ...btnG, cursor:'pointer' }}>
              Browse files
              <input type="file" accept=".xlsx" style={{ display:'none' }} onChange={e=>handleFile(e.target.files[0])}/>
            </label>
          </>
        )}
      </div>

      <div style={groupBox(false)}>
        <div style={{ ...groupHead, marginBottom:14 }}>
          Expected columns <span style={{ color:t.t4, fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:11 }}>· * = required · do not include msrp_aed / msrp_sar / msrp_qat — prices are calculated on import</span>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          {[
            {col:'sku',req:true},{col:'item_name',req:false},{col:'brand_code',req:true},
            {col:'cost_currency',req:true},{col:'exw_cost',req:true},
            {col:'msrp_primary_currency',req:true},{col:'price_used',req:true},
            {col:'shipping_rate',req:false},{col:'customs_duty_rate',req:false},
            {col:'msrp_primary_ex_vat',req:false},{col:'msrp_primary_inc_vat',req:false},
            {col:'msrp_secondary_currency',req:false},{col:'msrp_secondary_ex_vat',req:false},
            {col:'msrp_secondary_inc_vat',req:false},
            {col:'target_margin_pct',req:false},
            {col:'cost_source',req:false},{col:'price_source',req:false},{col:'barcode',req:false},
          ].map(({col,req})=>(
            <span key={col} style={{ fontSize:11, padding:'4px 10px', background:req?'rgba(77,159,255,0.08)':t.bg3, border:`1px solid ${req?'rgba(77,159,255,0.25)':t.b2}`, borderRadius:100, color:req?t.blue:t.t3, fontFamily:'var(--font-mono)' }}>
              {col}{req?' *':''}
            </span>
          ))}
        </div>
      </div>
      </>
      )}
    </div>
  );
}