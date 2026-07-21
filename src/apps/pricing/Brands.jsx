import React, { useState, useEffect, useRef } from 'react';
import { fetchBrandsWithStats, updateBrandMarkup, insertBrand, fetchBrandItems, bulkUpdateMarkupPrices } from '../../lib/db';
import { calcEXWMargin, calcLandedCost, calcMargin, formatMargin, MARGIN_COLORS, suggestKSAPrice, suggestQATPrice, resolvePriceUsed, compoundMarkup, calcMSRPs } from '../../lib/pricing';
import { t, inp, btnW, btnG, btnSm, lbl, sub, fg, groupBox, groupHead } from './styles';
import { useAuth } from '../../lib/AuthContext';

const PRICE_USED_LABELS = {
  cost_based:       'Cost based',
  primary_ex_vat:   'Pri ex VAT',
  primary_inc_vat:  'Pri inc VAT',
  secondary_ex_vat: 'Sec ex VAT',
  secondary_inc_vat:'Sec inc VAT',
};

const thStyle = {
  padding:'11px 16px', textAlign:'left', fontSize:11, color:t.t2,
  fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.06em',
  whiteSpace:'nowrap', borderBottom:`1px solid ${t.b2}`, background:t.bg3, fontWeight:600,
};
const tdStyle = { padding:'11px 16px', fontSize:13, color:t.t2, borderBottom:`1px solid ${t.b1}`, verticalAlign:'middle' };

const fmtPrice = v => v != null && !isNaN(v) ? Number(v).toFixed(2) : '—';
const fmtDiff  = v => {
  if (v == null || isNaN(v) || v === 0) return null;
  return (v > 0 ? '+' : '') + Number(v).toFixed(2);
};

// ── FILL BAR ──────────────────────────────────────────────────
function FillBar({ pct }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
      <div style={{ flex:1, height:5, background:t.bg4, borderRadius:100, overflow:'hidden' }}>
        <div style={{ width:`${pct}%`, height:'100%', background:pct===100?t.green:pct>50?t.amber:t.red, borderRadius:100 }}/>
      </div>
      <span style={{ fontSize:11, color:pct===100?t.green:pct>50?t.amber:t.red, fontFamily:'var(--font-mono)', minWidth:34, textAlign:'right' }}>{pct}%</span>
    </div>
  );
}

// ── MARGIN STATS ──────────────────────────────────────────────
function MarginStats({ label, items }) {
  if (!items.length) return (
    <div>
      <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12, fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:12, color:t.t4 }}>Not enough data to calculate</div>
    </div>
  );
  const avg = items.reduce((s,i) => s + i.margin, 0) / items.length;
  const min = items.reduce((a,b) => a.margin < b.margin ? a : b);
  const max = items.reduce((a,b) => a.margin > b.margin ? a : b);
  const sorted = [...items].sort((a,b) => a.margin - b.margin);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid].margin : (sorted[mid-1].margin + sorted[mid].margin) / 2;
  const freq = {}; let maxF = 0, modeMargin = null;
  for (const it of items) { const k = +it.margin.toFixed(1); freq[k] = (freq[k]||0)+1; if (freq[k] > maxF) { maxF = freq[k]; modeMargin = k; } }
  const mode = maxF > 1 ? modeMargin : null;
  const avgFmt = formatMargin(avg);
  const rowSt = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:`1px solid ${t.b1}`, fontSize:13 };
  return (
    <div>
      <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12, fontWeight:600 }}>{label}</div>
      <div style={rowSt}>
        <span style={{ color:t.t4, fontSize:12 }}>Average</span>
        <span style={{ color:MARGIN_COLORS[avgFmt.status], fontFamily:'var(--font-mono)', fontWeight:600, fontSize:14 }}>{avgFmt.label}</span>
      </div>
      <div style={rowSt}>
        <span style={{ color:t.t4, fontSize:12 }}>Median</span>
        <span style={{ color:MARGIN_COLORS[formatMargin(median).status], fontFamily:'var(--font-mono)', fontWeight:600, fontSize:13 }}>{formatMargin(median).label}</span>
      </div>
      <div style={rowSt}>
        <span style={{ color:t.t4, fontSize:12 }}>Mode</span>
        <span style={{ fontFamily:'var(--font-mono)', fontWeight:600, color: mode != null ? MARGIN_COLORS[formatMargin(mode).status] : t.t4, fontSize:13 }}>{mode != null ? formatMargin(mode).label : '—'}</span>
      </div>
      <div style={rowSt}>
        <span style={{ color:t.t4, fontSize:12 }}>Minimum</span>
        <div style={{ textAlign:'right' }}>
          <div style={{ color:t.red, fontFamily:'var(--font-mono)', fontWeight:600, fontSize:13 }}>{formatMargin(min.margin).label}</div>
          <div style={{ fontSize:11, color:t.t4, marginTop:2 }}>{min.item_code}</div>
        </div>
      </div>
      <div style={{ ...rowSt, borderBottom:'none' }}>
        <span style={{ color:t.t4, fontSize:12 }}>Maximum</span>
        <div style={{ textAlign:'right' }}>
          <div style={{ color:t.green, fontFamily:'var(--font-mono)', fontWeight:600, fontSize:13 }}>{formatMargin(max.margin).label}</div>
          <div style={{ fontSize:11, color:t.t4, marginTop:2 }}>{max.item_code}</div>
        </div>
      </div>
      <div style={{ marginTop:10, padding:'7px 10px', background:t.bg3, borderRadius:6, fontSize:11, color:t.t4 }}>
        {items.length} item{items.length!==1?'s':''} with sufficient data
      </div>
    </div>
  );
}

// ── BRAND SUMMARY CARD ────────────────────────────────────────
function BrandSummary({ brand, rates }) {
  const [items,   setItems]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBrandItems(brand.brand_code)
      .then(data => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [brand.brand_code]);

  if (loading) return (
    <tr><td colSpan={8} style={{ padding:'20px 24px', background:t.bg1, borderBottom:`2px solid ${t.b2}` }}>
      <div style={{ fontSize:12, color:t.t4, fontFamily:'var(--font-mono)' }}>Loading...</div>
    </td></tr>
  );
  if (!items) return null;

  const total = items.length;
  const fillRate = (fn) => total > 0 ? Math.round(items.filter(fn).length / total * 100) : 0;

  const fillRates = [
    { label:'barcode',        pct: fillRate(r => r.barcode) },
    { label:'exw_cost',       pct: fillRate(r => r.exw_cost) },
    { label:'msrp filled',    pct: fillRate(r => r.msrp_primary_ex_vat || r.msrp_primary_inc_vat) },
    { label:'cost_source',    pct: fillRate(r => r.cost_source) },
    { label:'price_source',   pct: fillRate(r => r.price_source) },
    { label:'shipping_rate',  pct: fillRate(r => r.shipping_rate != null && r.shipping_rate !== 0) },
    { label:'customs_duty',   pct: fillRate(r => r.customs_duty_rate != null) },
  ];

  const exwItems = items.map(r => {
    const m = calcEXWMargin(r, rates);
    return m != null ? { item_code: r.item_code, margin: m } : null;
  }).filter(Boolean);

  const landedItems = items.map(r => {
    const landed = calcLandedCost(r, rates);
    if (!landed || !r.msrp_aed) return null;
    const m = calcMargin(r.msrp_aed, landed);
    return m != null ? { item_code: r.item_code, margin: m } : null;
  }).filter(Boolean);

  return (
    <tr>
      <td colSpan={8} style={{ padding:0, background:'rgba(77,159,255,0.03)', borderBottom:`2px solid ${t.b2}`, borderLeft:`3px solid ${t.blue}` }}>
        <div style={{ padding:'20px 28px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 1fr', gap:24 }}>
            <div>
              <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>
                Fill rates · {total.toLocaleString()} SKUs
              </div>
              {fillRates.map(({ label, pct }) => (
                <div key={label} style={{ marginBottom:10 }}>
                  <div style={{ fontSize:11, color:t.t3, fontFamily:'var(--font-mono)', marginBottom:4 }}>{label}</div>
                  <FillBar pct={pct}/>
                </div>
              ))}
            </div>
            <MarginStats label="EXW margins" items={exwItems}/>
            <MarginStats label="Landed margins" items={landedItems}/>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── CONTEXT MENU ──────────────────────────────────────────────
function ContextMenu({ x, y, brand, isExpanded, onToggle, onEdit, onDismiss, isViewer }) {
  const ref = useRef();
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onDismiss(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onDismiss]);

  const clampedX = Math.min(x, window.innerWidth - 190);
  const clampedY = Math.min(y, window.innerHeight - 100);

  const menuItems = [
    { label: isExpanded ? 'Collapse ↑' : 'View summary', icon: isExpanded ? '⊟' : '⊞', action: onToggle },
    ...(!isViewer ? [{ label: 'Edit markup', icon: '✎', action: onEdit }] : []),
  ];

  return (
    <div ref={ref} style={{ position:'fixed', left:clampedX, top:clampedY, zIndex:500, background:t.bg2, border:`1px solid ${t.b3}`, borderRadius:10, boxShadow:'0 8px 32px rgba(0,0,0,0.6)', overflow:'hidden', minWidth:180 }}>
      <div style={{ padding:'4px 0' }}>
        {menuItems.map(({ label, icon, action }) => (
          <button key={label} onClick={() => { action(); onDismiss(); }}
            style={{ display:'flex', alignItems:'center', gap:12, width:'100%', padding:'10px 16px', background:'none', border:'none', cursor:'pointer', fontSize:13, color:t.t2, fontFamily:'var(--font-sans)', textAlign:'left' }}
            onMouseEnter={e=>e.currentTarget.style.background=t.bg3}
            onMouseLeave={e=>e.currentTarget.style.background='none'}
          >
            <span style={{ fontSize:15, color:t.t4, width:18 }}>{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── MARKUP PREVIEW MODAL ──────────────────────────────────────
function computeChanges(items, newMarkup, additionalMarkupPct, rates) {
  return items.map(item => {
    const { value: priceVal, currency: priceCur } = resolvePriceUsed(item);
    const pf2 = v => v != null ? parseFloat(v.toFixed(2)) : v;

    // Default to existing values
    let new_real_aed = item.real_msrp_aed ?? item.msrp_aed;
    let new_aed      = item.msrp_aed;

    // Two-pass prettification via calcMSRPs — only when source price exists and UAE not overridden
    if (!item.uae_overridden && priceVal && priceCur) {
      const msrps = calcMSRPs(priceVal, priceCur, newMarkup, additionalMarkupPct ?? null, rates);
      if (msrps) { new_real_aed = msrps.real_msrp_aed; new_aed = msrps.msrp_aed; }
    }

    // SAR and QAT derived from the current AED values (override-aware)
    const new_real_sar = (!item.ksa_overridden && new_real_aed) ? pf2(suggestKSAPrice(new_real_aed) ?? item.real_msrp_sar) : (item.real_msrp_sar ?? item.msrp_sar);
    const new_real_qat = (!item.qat_overridden && new_real_aed) ? pf2(suggestQATPrice(new_real_aed) ?? item.real_msrp_qat) : (item.real_msrp_qat ?? item.msrp_qat);
    const new_sar = (!item.ksa_overridden && new_aed) ? pf2(suggestKSAPrice(new_aed) ?? item.msrp_sar) : item.msrp_sar;
    const new_qat = (!item.qat_overridden && new_aed) ? pf2(suggestQATPrice(new_aed) ?? item.msrp_qat) : item.msrp_qat;

    const aed_diff = new_aed != null && item.msrp_aed != null ? new_aed - item.msrp_aed : null;
    const sar_diff = new_sar != null && item.msrp_sar != null ? new_sar - item.msrp_sar : null;
    const qat_diff = new_qat != null && item.msrp_qat != null ? new_qat - item.msrp_qat : null;

    return {
      item_code: item.item_code,
      old_aed: item.msrp_aed, new_aed, aed_diff,
      old_sar: item.msrp_sar, new_sar, sar_diff,
      old_qat: item.msrp_qat, new_qat, qat_diff,
      new_real_aed, new_real_sar, new_real_qat,
    };
  });
}

function avgDiff(changes, field) {
  const vals = changes.map(c => c[field]).filter(v => v != null && v !== 0);
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function DiffCell({ oldVal, newVal, diff }) {
  const color = diff == null || diff === 0 ? t.t4 : diff > 0 ? t.green : t.red;
  const diffStr = fmtDiff(diff);
  return (
    <td style={{ ...tdStyle, fontFamily:'var(--font-mono)', fontSize:12 }}>
      <div style={{ color:t.t3 }}>{fmtPrice(oldVal)}</div>
      <div style={{ color:t.t1, marginTop:1 }}>{fmtPrice(newVal)}</div>
      {diffStr && <div style={{ color, fontSize:11, marginTop:1 }}>{diffStr}</div>}
    </td>
  );
}

function MarkupPreviewModal({ brand, oldMarkup, newMarkup, changes, applying, onConfirm, onCancel }) {
  const SAMPLE = 10;
  const showAll = changes.length <= SAMPLE * 2;
  const first   = showAll ? changes : changes.slice(0, SAMPLE);
  const last    = showAll ? []      : changes.slice(-SAMPLE);
  const middle  = showAll ? 0       : changes.length - SAMPLE * 2;

  const aedAvg = avgDiff(changes, 'aed_diff');
  const sarAvg = avgDiff(changes, 'sar_diff');
  const qatAvg = avgDiff(changes, 'qat_diff');
  const affected = changes.filter(c =>
    (c.aed_diff != null && c.aed_diff !== 0) ||
    (c.sar_diff != null && c.sar_diff !== 0) ||
    (c.qat_diff != null && c.qat_diff !== 0)
  ).length;

  const statColor = v => v == null ? t.t4 : v > 0 ? t.green : t.red;

  const previewTh = { ...thStyle, background:t.bg2, position:'sticky', top:0, zIndex:1 };

  const renderRows = (rows) => rows.map(c => (
    <tr key={c.item_code}>
      <td style={{ ...tdStyle, fontFamily:'var(--font-mono)', fontSize:12, color:t.blue }}>{c.item_code}</td>
      <DiffCell oldVal={c.old_aed} newVal={c.new_aed} diff={c.aed_diff} />
      <DiffCell oldVal={c.old_sar} newVal={c.new_sar} diff={c.sar_diff} />
      <DiffCell oldVal={c.old_qat} newVal={c.new_qat} diff={c.qat_diff} />
    </tr>
  ));

  return (
    <div style={{ position:'fixed', inset:0, zIndex:600, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:t.bg2, border:`1px solid ${t.b2}`, borderRadius:16, width:'100%', maxWidth:860, maxHeight:'85vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 80px rgba(0,0,0,0.7)' }}>

        {/* Header */}
        <div style={{ padding:'20px 28px', borderBottom:`1px solid ${t.b1}` }}>
          <div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>Markup change preview</div>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:18, fontWeight:500, color:t.blue, fontFamily:'var(--font-mono)' }}>{brand.brand_code}</span>
            <span style={{ fontSize:14, color:t.t3 }}>{brand.brand_name}</span>
            <span style={{ marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize:15 }}>
              <span style={{ color:t.t3 }}>{oldMarkup}%</span>
              <span style={{ color:t.t4, margin:'0 8px' }}>→</span>
              <span style={{ color:t.amber }}>{newMarkup}%</span>
            </span>
          </div>
        </div>

        {/* Stats */}
        <div style={{ padding:'16px 28px', borderBottom:`1px solid ${t.b1}`, display:'flex', gap:32 }}>
          <div>
            <div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', marginBottom:3 }}>items</div>
            <div style={{ fontSize:20, color:t.t1, fontFamily:'var(--font-mono)', fontWeight:500 }}>{changes.length}</div>
          </div>
          <div>
            <div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', marginBottom:3 }}>affected</div>
            <div style={{ fontSize:20, color:affected > 0 ? t.amber : t.t4, fontFamily:'var(--font-mono)', fontWeight:500 }}>{affected}</div>
          </div>
          {[['avg Δ AED', aedAvg], ['avg Δ SAR', sarAvg], ['avg Δ QAR', qatAvg]].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', marginBottom:3 }}>{label}</div>
              <div style={{ fontSize:20, color:statColor(val), fontFamily:'var(--font-mono)', fontWeight:500 }}>
                {val != null ? (val > 0 ? '+' : '') + val.toFixed(2) : '—'}
              </div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ overflowY:'auto', flex:1 }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...previewTh, minWidth:160 }}>Item code</th>
                <th style={{ ...previewTh, minWidth:150 }}>AED (old / new / Δ)</th>
                <th style={{ ...previewTh, minWidth:150 }}>SAR (old / new / Δ)</th>
                <th style={{ ...previewTh, minWidth:150 }}>QAR (old / new / Δ)</th>
              </tr>
            </thead>
            <tbody>
              {renderRows(first)}
              {middle > 0 && (
                <tr>
                  <td colSpan={4} style={{ padding:'10px 16px', textAlign:'center', fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', background:'rgba(255,255,255,0.02)', borderBottom:`1px solid ${t.b1}` }}>
                    ··· {middle.toLocaleString()} more items ···
                  </td>
                </tr>
              )}
              {renderRows(last)}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding:'16px 28px', borderTop:`1px solid ${t.b1}`, display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button style={{ ...btnG, opacity:applying?0.5:1 }} onClick={onCancel} disabled={applying}>Cancel</button>
          <button
            style={{ ...btnW, opacity:applying?0.6:1, cursor:applying?'not-allowed':'pointer' }}
            onClick={onConfirm}
            disabled={applying}
          >
            {applying ? 'Applying...' : `Confirm & apply to ${changes.length} item${changes.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────
export default function Brands({ rates = {}, onToast, refreshKey }) {
  const { isViewer } = useAuth();
  const [brands,         setBrands]         = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [editRow,        setEditRow]        = useState(null);
  const [editVal,        setEditVal]        = useState('');
  const [saving,         setSaving]         = useState(false);
  const [showAdd,        setShowAdd]        = useState(false);
  const [newBrand,       setNewBrand]       = useState({ brand_code:'', brand_name:'', markup_percentage:'10' });
  const [addErr,         setAddErr]         = useState(null);
  const [refreshCounters, setRefreshCounters] = useState({});
  const [contextMenu,    setContextMenu]    = useState(null);
  const [expanded,       setExpanded]       = useState(new Set());
  const [preview,        setPreview]        = useState(null);   // { brand, newMarkup, changes }
  const [applying,       setApplying]       = useState(false);

  const load = async () => {
    setLoading(true);
    try { setBrands(await fetchBrandsWithStats()); }
    catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const refreshKeyRef = useRef(false);
  useEffect(() => {
    if (!refreshKeyRef.current) { refreshKeyRef.current = true; return; }
    load();
  }, [refreshKey]);

  const showToast = (msg, ok=true) => onToast?.(msg, ok);

  const handleRefresh = (e, brandCode) => {
    e.stopPropagation();
    setRefreshCounters(c => ({ ...c, [brandCode]: (c[brandCode] || 0) + 1 }));
  };

  // Load preview instead of saving directly
  const handleEditPreview = async (brand) => {
    const val = parseFloat(editVal);
    if (isNaN(val) || val < 0 || val > 100) return;
    setSaving(true);
    try {
      const items = await fetchBrandItems(brand.brand_code);
      const changes = computeChanges(items, val, brand.additional_markup_pct, rates);
      setPreview({ brand, newMarkup: val, changes });
    } catch(e) {
      showToast(e.message, false);
    } finally {
      setSaving(false);
    }
  };

  const handleApplyMarkup = async () => {
    if (!preview) return;
    const { brand, newMarkup, changes } = preview;
    setApplying(true);
    try {
      await updateBrandMarkup(brand.brand_code, newMarkup);
      const updates = changes
        .filter(c => c.new_aed != null || c.new_sar != null || c.new_qat != null)
        .map(c => ({
          item_code:    c.item_code,
          msrp_aed:     c.new_aed,
          msrp_sar:     c.new_sar,
          msrp_qat:     c.new_qat,
          real_msrp_aed: c.new_real_aed,
          real_msrp_sar: c.new_real_sar,
          real_msrp_qat: c.new_real_qat,
        }));
      await bulkUpdateMarkupPrices(updates);
      setBrands(prev => prev.map(b => b.brand_code === brand.brand_code ? { ...b, markup_percentage: newMarkup } : b));
      setPreview(null);
      setEditRow(null);
      showToast(`${brand.brand_code} markup → ${newMarkup}% · ${updates.length} items updated`);
    } catch(e) {
      showToast(e.message, false);
    } finally {
      setApplying(false);
    }
  };

  const handleAddBrand = async () => {
    setAddErr(null);
    const code   = newBrand.brand_code.trim().toUpperCase();
    const name   = newBrand.brand_name.trim();
    const markup = parseFloat(newBrand.markup_percentage);
    if (!code)         return setAddErr('Brand code is required');
    if (!name)         return setAddErr('Brand name is required');
    if (isNaN(markup) || markup < 0 || markup > 100) return setAddErr('Markup must be a number between 0 and 100');
    if (brands.find(b => b.brand_code === code)) return setAddErr('Brand code already exists');
    setSaving(true);
    try {
      await insertBrand(code, name, markup);
      setShowAdd(false);
      setNewBrand({ brand_code:'', brand_name:'', markup_percentage:'10' });
      showToast(`${code} added`);
      await load();
    } catch(e) { setAddErr(e.message); }
    finally { setSaving(false); }
  };

  const handleRowClick = (e, brand) => {
    e.preventDefault();
    setContextMenu({ brand, x: e.clientX, y: e.clientY + 12 });
  };

  const toggleExpanded = (brandCode) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(brandCode) ? next.delete(brandCode) : next.add(brandCode);
      return next;
    });
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:500, color:t.t1 }}>Brand management</div>
          <div style={{ fontSize:12, color:t.t4, marginTop:2 }}>
            {brands.length} brands · click a row for options
            {expanded.size > 0 && (
              <button style={{ ...btnG, ...btnSm, fontSize:11, color:t.t4, marginLeft:12 }}
                onClick={() => setExpanded(new Set())}>
                Collapse all ({expanded.size})
              </button>
            )}
          </div>
        </div>
        {!isViewer && (
          <button style={btnW} onClick={() => setShowAdd(s => !s)}>
            {showAdd ? 'Cancel' : '+ Add brand'}
          </button>
        )}
      </div>

      {/* Add brand form */}
      {showAdd && (
        <div style={{ ...groupBox(false), marginBottom:16 }}>
          <div style={{ ...groupHead, marginBottom:16 }}>New brand</div>
          {addErr && <div style={{ background:'rgba(242,100,100,0.08)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:8, padding:'10px 14px', color:t.red, fontSize:13, marginBottom:14 }}>{addErr}</div>}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr 1fr auto', gap:12, alignItems:'end' }}>
            <div style={fg}>
              <label style={lbl}>Brand code</label>
              <input style={inp(!!newBrand.brand_code, false)} placeholder="e.g. KLIM"
                value={newBrand.brand_code}
                onChange={e => setNewBrand(b => ({ ...b, brand_code: e.target.value.toUpperCase() }))}
                onKeyDown={e => e.key === 'Enter' && handleAddBrand()}/>
              <span style={sub}>Auto-uppercased · used as prefix in item codes</span>
            </div>
            <div style={fg}>
              <label style={lbl}>Brand name</label>
              <input style={inp(!!newBrand.brand_name, false)} placeholder="e.g. KLIM Motorsports"
                value={newBrand.brand_name}
                onChange={e => setNewBrand(b => ({ ...b, brand_name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAddBrand()}/>
            </div>
            <div style={fg}>
              <label style={lbl}>Markup %</label>
              <input style={inp(!!newBrand.markup_percentage, false)} type="text" inputMode="decimal"
                placeholder="10" value={newBrand.markup_percentage}
                onChange={e => setNewBrand(b => ({ ...b, markup_percentage: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAddBrand()}/>
            </div>
            <button style={{ ...btnW, height:42, alignSelf:'end', opacity:saving?0.6:1 }}
              onClick={handleAddBrand} disabled={saving}>
              {saving ? 'Saving...' : 'Add brand'}
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ background:'rgba(242,100,100,0.08)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:8, padding:'12px 16px', color:t.red, fontSize:13, marginBottom:16 }}>{error}</div>}

      {loading ? (
        <div className="loading-pulse" style={{ textAlign:'center', padding:'48px 0', color:t.t4, fontFamily:'var(--font-mono)', fontSize:12, letterSpacing:'0.1em' }}>LOADING...</div>
      ) : (
        <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, minWidth:100 }}>Code</th>
                <th style={{ ...thStyle, minWidth:200 }}>Brand name</th>
                <th style={{ ...thStyle, minWidth:120, textAlign:'center' }}>Markup %</th>
                <th style={{ ...thStyle, minWidth:100, textAlign:'right' }}>Additional %</th>
                <th style={{ ...thStyle, minWidth:100, textAlign:'right' }}>Effective %</th>
                <th style={{ ...thStyle, minWidth:80, textAlign:'right' }}>SKUs</th>
                <th style={{ ...thStyle, minWidth:300 }}>Price used (distinct)</th>
                <th style={{ ...thStyle, minWidth:80 }}></th>
              </tr>
            </thead>
            <tbody>
              {brands.map((brand, i) => {
                const isExp = expanded.has(brand.brand_code);
                const rowBg = isExp ? 'rgba(77,159,255,0.06)' : i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)';
                return (
                  <React.Fragment key={brand.brand_code}>
                    <tr
                      style={{ cursor:'pointer', background:rowBg, borderLeft:isExp?`3px solid ${t.blue}`:'3px solid transparent', transition:'background 0.1s' }}
                      onClick={e => handleRowClick(e, brand)}
                      onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = t.bg3; }}
                      onMouseLeave={e => { if (!isExp) e.currentTarget.style.background = rowBg; }}
                    >
                      <td style={{ ...tdStyle, color:t.blue, fontFamily:'var(--font-mono)', fontWeight:500 }}>{brand.brand_code}</td>
                      <td style={{ ...tdStyle, color:t.t1 }}>{brand.brand_name}</td>
                      <td style={{ ...tdStyle, textAlign:'center' }}>
                        {editRow === brand.brand_code && !isViewer ? (
                          <div style={{ display:'flex', gap:6, justifyContent:'center', alignItems:'center' }}>
                            <input
                              style={{ ...inp(true, false), width:70, textAlign:'center', padding:'6px 8px', fontSize:13 }}
                              type="text" inputMode="decimal" value={editVal}
                              onChange={e => setEditVal(e.target.value)}
                              onKeyDown={e => { if (e.key==='Enter') handleEditPreview(brand); if (e.key==='Escape') setEditRow(null); }}
                              autoFocus onClick={e => e.stopPropagation()}
                            />
                            <span style={{ fontSize:13, color:t.t3 }}>%</span>
                            <button
                              style={{ ...btnG, ...btnSm, color:t.green, borderColor:'rgba(62,207,142,0.3)', fontSize:12, opacity:saving?0.5:1 }}
                              onClick={e => { e.stopPropagation(); handleEditPreview(brand); }}
                              disabled={saving}
                            >
                              {saving ? '…' : '✓'}
                            </button>
                            <button style={{ ...btnG, ...btnSm, fontSize:12 }}
                              onClick={e => { e.stopPropagation(); setEditRow(null); }}>✕</button>
                          </div>
                        ) : (
                          <button
                            onClick={e => { if (isViewer) return; e.stopPropagation(); setEditRow(brand.brand_code); setEditVal(String(brand.markup_percentage)); }}
                            style={{ background:'rgba(77,159,255,0.08)', border:'1px solid rgba(77,159,255,0.2)', borderRadius:6, padding:'5px 14px', fontSize:13, color:isViewer?t.t4:t.blue, cursor:isViewer?'default':'pointer', fontFamily:'var(--font-mono)', fontWeight:500 }}
                            onMouseEnter={e=>{ if (!isViewer) e.currentTarget.style.background='rgba(77,159,255,0.15)'; }}
                            onMouseLeave={e=>e.currentTarget.style.background='rgba(77,159,255,0.08)'}
                          >{brand.markup_percentage}%</button>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign:'right', fontFamily:'var(--font-mono)', color: brand.additional_markup_pct ? t.t2 : t.t4 }}>
                        {brand.additional_markup_pct != null ? `${brand.additional_markup_pct}%` : '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign:'right', fontFamily:'var(--font-mono)', color: brand.additional_markup_pct ? t.blue : t.t4 }}>
                        {brand.additional_markup_pct != null
                          ? `${compoundMarkup(brand.markup_percentage, brand.additional_markup_pct).toFixed(2)}%`
                          : `${brand.markup_percentage}%`}
                      </td>
                      <td style={{ ...tdStyle, textAlign:'right', color:brand.sku_count>0?t.t1:t.t4, fontFamily:'var(--font-mono)' }}>
                        {brand.sku_count.toLocaleString()}
                      </td>
                      <td style={{ ...tdStyle }}>
                        {brand.price_used_types.length === 0 ? (
                          <span style={{ fontSize:12, color:t.t4 }}>No items yet</span>
                        ) : (
                          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                            {brand.price_used_types.map(type => (
                              <span key={type} style={{ fontSize:11, padding:'3px 10px', background:'rgba(255,255,255,0.05)', border:`1px solid ${t.b2}`, borderRadius:100, color:t.t2, fontFamily:'var(--font-mono)' }}>
                                {PRICE_USED_LABELS[type] || type}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ ...tdStyle }}>
                        <div style={{ display:'flex', gap:8, alignItems:'center', justifyContent:'flex-end' }}>
                          {isExp && (
                            <button
                              title="Refresh data"
                              onClick={e => handleRefresh(e, brand.brand_code)}
                              style={{ background:'none', border:`1px solid ${t.b2}`, borderRadius:6, padding:'3px 8px', cursor:'pointer', color:t.t4, fontSize:13, lineHeight:1, transition:'all 0.15s' }}
                              onMouseEnter={e => { e.currentTarget.style.color=t.t2; e.currentTarget.style.borderColor=t.b3; }}
                              onMouseLeave={e => { e.currentTarget.style.color=t.t4; e.currentTarget.style.borderColor=t.b2; }}
                            >↺</button>
                          )}
                          <span style={{ fontSize:11, color:isExp?t.blue:t.t4, fontFamily:'var(--font-mono)' }}>{isExp ? '▲' : '▼'}</span>
                        </div>
                      </td>
                    </tr>
                    {isExp && <BrandSummary key={`${refreshCounters[brand.brand_code] || 0}_${refreshKey || 0}`} brand={brand} rates={rates}/>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          brand={contextMenu.brand}
          isExpanded={expanded.has(contextMenu.brand.brand_code)}
          onToggle={() => toggleExpanded(contextMenu.brand.brand_code)}
          onEdit={() => { setEditRow(contextMenu.brand.brand_code); setEditVal(String(contextMenu.brand.markup_percentage)); }}
          onDismiss={() => setContextMenu(null)}
          isViewer={isViewer}
        />
      )}

      {/* Markup preview modal */}
      {preview && (
        <MarkupPreviewModal
          brand={preview.brand}
          oldMarkup={preview.brand.markup_percentage}
          newMarkup={preview.newMarkup}
          changes={preview.changes}
          applying={applying}
          onConfirm={handleApplyMarkup}
          onCancel={() => setPreview(null)}
        />
      )}

    </div>
  );
}
