import React, { useState, useEffect, useRef } from 'react';
import { fetchItemList, fetchHistory, deleteItem } from '../../lib/db';
import { calcAllMargins, calcEmployeePrice, formatMargin, MARGIN_COLORS, resolvePriceUsed } from '../../lib/pricing';
import { money } from '../../lib/num';
import { t, inp, sel, btnW, btnG, btnSm, lbl, PRICE_USED_OPTIONS } from './styles';
import { useAuth } from '../../lib/AuthContext';
import BrandSelect from './BrandSelect';
import { flattenItem, downloadFullTableXLSX } from '../../lib/csvExport';
import { downloadXLSX } from '../../lib/xlsxExport';

const MARGIN_RANGES = [
  { label:'All margins',  min:null, max:null },
  { label:'Below 20%',   min:null, max:20   },
  { label:'20% – 30%',   min:20,   max:30   },
  { label:'30% – 40%',   min:30,   max:40   },
  { label:'Above 40%',   min:40,   max:null },
];

const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' }) : '—';
const fmtNum   = (v) => v != null ? Number(v).toLocaleString() : '—';
const fmtShort = (email) => email ? email.split('@')[0] : '—';

// ── TABLE STYLES ─────────────────────────────────────────────
const thStyle = {
  padding:'11px 16px', textAlign:'left', fontSize:11, color:t.t2,
  fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.06em',
  whiteSpace:'nowrap', borderBottom:`1px solid ${t.b2}`, background:t.bg3,
  position:'sticky', top:0, zIndex:2, fontWeight:600,
};
const tdBase = {
  padding:'11px 16px', fontSize:13, lineHeight:1.4,
  borderBottom:`1px solid ${t.b1}`, whiteSpace:'nowrap',
};
const td = (highlight, extra={}) => ({
  ...tdBase,
  color: highlight ? t.t1 : t.t2,
  fontFamily: highlight ? 'var(--font-mono)' : 'var(--font-sans)',
  ...extra,
});

// ── CONTEXT MENU ─────────────────────────────────────────────
function ContextMenu({ x, y, item, isExpanded, onEdit, onToggleSummary, onExportItem, onDelete, onDismiss, isViewer }) {
  const ref = useRef();
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onDismiss(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onDismiss]);

  // Clamp to viewport
  const clampedX = Math.min(x, window.innerWidth - 180);
  const clampedY = Math.min(y, window.innerHeight - 100);

  return (
    <div ref={ref} style={{
      position:'fixed', left:clampedX, top:clampedY, zIndex:500,
      background:t.bg2, border:`1px solid ${t.b3}`,
      borderRadius:10, boxShadow:'0 8px 32px rgba(0,0,0,0.6)',
      overflow:'hidden', minWidth:170,
    }}>
      <div style={{ padding:'4px 0' }}>
        {[
          ...(!isViewer ? [{ label:'Edit item', icon:'✎', action:onEdit }] : []),
          { label:isExpanded?'Collapse ↑':'View summary', icon:isExpanded?'⊟':'⊞', action:onToggleSummary },
          { label:'Export item', icon:'↓', action:onExportItem },
          // Destructive, so it sits below a divider and is styled apart from
          // the rest rather than being one more identical row to misclick.
          ...(!isViewer ? [{ label:'Delete item', icon:'✕', action:onDelete, danger:true }] : []),
        ].map(({ label, icon, action, danger }) => (
          <button key={label} onClick={() => { action(); onDismiss(); }}
            style={{
              display:'flex', alignItems:'center', gap:12,
              width:'100%', padding:'10px 16px',
              background:'none', border:'none', cursor:'pointer',
              borderTop: danger ? `1px solid ${t.b1}` : 'none',
              marginTop: danger ? 4 : 0,
              fontSize:13, color: danger ? t.red : t.t2, fontFamily:'var(--font-sans)',
              textAlign:'left', transition:'background 0.1s',
            }}
            onMouseEnter={e=>e.currentTarget.style.background = danger ? 'rgba(242,100,100,0.1)' : t.bg3}
            onMouseLeave={e=>e.currentTarget.style.background='none'}
          >
            <span style={{ fontSize:15, color: danger ? t.red : t.t4, width:18 }}>{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── INLINE SUMMARY ────────────────────────────────────────────
function InlineSummary({ item, rates }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory(item.item_code, 10)
      .then(data => { setHistory(data||[]); setLoading(false); })
      .catch(()=>setLoading(false));
  }, [item.item_code]);

  const margins = (() => { try { return calcAllMargins(item, rates); } catch { return null; } })();
  const emp     = calcEmployeePrice(item, rates);

  const lastFor = (keys) => history.find(h => keys.some(k => h[`new_${k}`]!=null));
  const lastPrice = lastFor(['msrp_aed','msrp_sar','msrp_qat','msrp_primary_ex_vat','msrp_primary_inc_vat','msrp_secondary_ex_vat','msrp_secondary_inc_vat']);
  const lastCost  = lastFor(['exw_cost']);
  const lastRules = lastFor(['shipping_rate','customs_duty_rate','price_used']);
  const recent    = history.slice(0,2);

  const rowStyle = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:`1px solid ${t.b1}`, fontSize:13 };
  const labelStyle = { color:t.t4, fontSize:12 };
  const valStyle   = { color:t.t1, fontFamily:'var(--font-mono)', fontSize:12 };

  return (
    <tr>
      <td colSpan={17} style={{ padding:0, background:'rgba(77,159,255,0.03)', borderBottom:`2px solid ${t.b2}`, borderLeft:`3px solid ${t.blue}` }}>
        <div style={{ padding:'20px 28px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:28 }}>

            {/* Col 1 — Current pricing */}
            <div>
              <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>
                Current pricing
              </div>
              {[
                ['UAE', money(item.msrp_aed, 'AED'), margins?.uae_margin],
                ['KSA', money(item.msrp_sar, 'SAR'), margins?.ksa_margin],
                ['QAT', money(item.msrp_qat, 'QAR'), margins?.qat_margin],
              ].map(([country, price, margin]) => {
                const m = formatMargin(margin);
                return (
                  <div key={country} style={rowStyle}>
                    <span style={labelStyle}>{country}</span>
                    <div style={{ display:'flex', gap:14, alignItems:'center' }}>
                      <span style={valStyle}>{price}</span>
                      <span style={{ color:MARGIN_COLORS[m.status], fontSize:12, fontWeight:500 }}>{m.label}</span>
                    </div>
                  </div>
                );
              })}
              <div style={rowStyle}>
                <span style={labelStyle}>Landed cost</span>
                <span style={valStyle}>{money(margins?.landed_cost_aed, 'AED', 2)}</span>
              </div>
              {(() => {
                const exwFmt = formatMargin(margins?.exw_margin);
                return (
                  <div style={rowStyle}>
                    <span style={labelStyle}>EXW margin</span>
                    <div style={{ textAlign:'right' }}>
                      <span style={{ color:MARGIN_COLORS[exwFmt.status], fontSize:12, fontWeight:500 }}>{exwFmt.label}</span>
                      <div style={{ fontSize:10, color:t.t4, marginTop:1 }}>price used vs cost · no markup</div>
                    </div>
                  </div>
                );
              })()}
              <div style={{ ...rowStyle, borderBottom:'none' }}>
                <span style={labelStyle}>Employee price</span>
                <span style={{ ...valStyle, color:t.amber }}>{money(emp, 'AED')}</span>
              </div>
            </div>

            {/* Col 2 — Last edited by */}
            <div>
              <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>
                Last edited by
              </div>
              {[
                { label:'Price fields', record:lastPrice },
                { label:'Cost fields',  record:lastCost  },
                { label:'Rules',        record:lastRules  },
                { label:'Item record',  record:{ changed_by:item.updated_by, changed_at:item.updated_at } },
              ].map(({ label, record }) => (
                <div key={label} style={rowStyle}>
                  <span style={labelStyle}>{label}</span>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ color:t.t1, fontSize:12 }}>{fmtShort(record?.changed_by)||'—'}</div>
                    {record?.changed_at&&<div style={{ color:t.t4, fontSize:11, marginTop:2 }}>{fmtDate(record.changed_at)}</div>}
                  </div>
                </div>
              ))}
            </div>

            {/* Col 3 — Recent changes */}
            <div>
              <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>
                Recent changes
              </div>
              {loading&&<div style={{ color:t.t4, fontSize:13 }}>Loading...</div>}
              {!loading&&recent.length===0&&<div style={{ color:t.t4, fontSize:13 }}>No history recorded yet.</div>}
              {recent.map((h,i) => {
                const puMap = {
                  primary_ex_vat:    { old:'old_msrp_primary_ex_vat',    new:'new_msrp_primary_ex_vat',    label:'MSRP 1 ex'  },
                  primary_inc_vat:   { old:'old_msrp_primary_inc_vat',   new:'new_msrp_primary_inc_vat',   label:'MSRP 1 inc' },
                  secondary_ex_vat:  { old:'old_msrp_secondary_ex_vat',  new:'new_msrp_secondary_ex_vat',  label:'MSRP 2 ex'  },
                  secondary_inc_vat: { old:'old_msrp_secondary_inc_vat', new:'new_msrp_secondary_inc_vat', label:'MSRP 2 inc' },
                };
                const pu = puMap[item.price_used] ?? puMap.primary_ex_vat;
                const changes = [
                  ['EXW cost',  h.old_exw_cost,       h.new_exw_cost,       null, null],
                  ['UAE price', h.old_msrp_aed,        h.new_msrp_aed,       null, null],
                  ['KSA price', h.old_msrp_sar,        h.new_msrp_sar,       null, null],
                  ['QAT price', h.old_msrp_qat,        h.new_msrp_qat,       null, null],
                  [pu.label,    h[pu.old],             h[pu.new],            null, null],
                  ['Ship %',    h.old_shipping_rate,   h.new_shipping_rate,  null, null],
                  ['Duty %',    h.old_customs_duty_rate, h.new_customs_duty_rate, null, null],
                ].filter(([,, nv]) => nv!=null);

                const pct = (oldV, newV) => {
                  const o = parseFloat(oldV), n = parseFloat(newV);
                  if (!o || isNaN(o) || isNaN(n)) return null;
                  const p = ((n - o) / Math.abs(o)) * 100;
                  return p === 0 ? null : (p > 0 ? `+${p.toFixed(1)}%` : `${p.toFixed(1)}%`);
                };

                return (
                  <div key={h.id} style={{ marginBottom:16, paddingBottom:16, borderBottom:i<recent.length-1?`1px solid ${t.b1}`:'none' }}>
                    {/* Header */}
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                      <span style={{ fontSize:12, color:t.t2, fontFamily:'var(--font-mono)', fontWeight:500 }}>{fmtDate(h.changed_at)}</span>
                      <span style={{ fontSize:11, color:t.t3 }}>{fmtShort(h.changed_by)}</span>
                    </div>
                    {/* Column headers */}
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 60px', gap:6, marginBottom:4 }}>
                      {['Field','Before','After','Δ'].map(hd=>(
                        <span key={hd} style={{ fontSize:10, color:t.t4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.06em' }}>{hd}</span>
                      ))}
                    </div>
                    {/* Rows */}
                    {changes.map(([field,oldV,newV]) => {
                      const delta = pct(oldV, newV);
                      const isUp  = delta?.startsWith('+');
                      return (
                        <div key={field} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 60px', gap:6, padding:'5px 0', borderTop:`1px solid ${t.b1}`, alignItems:'center' }}>
                          <span style={{ fontSize:12, color:t.t3 }}>{field}</span>
                          <span style={{ fontSize:12, color:t.t4, fontFamily:'var(--font-mono)', textDecoration:'line-through' }}>{fmtNum(oldV)}</span>
                          <span style={{ fontSize:12, color:t.t1, fontFamily:'var(--font-mono)', fontWeight:500 }}>{fmtNum(newV)}</span>
                          <span style={{ fontSize:11, color:delta?(isUp?t.green:t.red):t.t4, fontFamily:'var(--font-mono)', fontWeight:500 }}>{delta||'—'}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// key: null marks a column computed client-side (from _margins or resolveMSRP),
// which the server can't order by — those headers stay inert.
const LIST_COLUMNS = [
  { label:'Item code',   key:'item_code',         minWidth:160 },
  { label:'Name',        key:'item_name',         minWidth:240 },
  { label:'Barcode',     key:'barcode',           minWidth:130 },
  { label:'MSRP used',   key:null,                minWidth:120, align:'right' },
  { label:'Price curr.', key:null,                minWidth:90 },
  { label:'EXW cost',    key:'exw_cost',          minWidth:110, align:'right' },
  { label:'Cost curr.',  key:'cost_currency',     minWidth:90 },
  { label:'UAE price',   key:'msrp_aed',          minWidth:130, align:'right' },
  { label:'KSA price',   key:'msrp_sar',          minWidth:130, align:'right' },
  { label:'QAT price',   key:'msrp_qat',          minWidth:130, align:'right' },
  { label:'Ship %',      key:'shipping_rate',     minWidth:80,  align:'right' },
  { label:'Duty %',      key:'customs_duty_rate', minWidth:80,  align:'right' },
  { label:'Landed cost', key:null,                minWidth:130, align:'right' },
  { label:'UAE margin',  key:null,                minWidth:110, align:'right' },
  { label:'Price src.',  key:'price_source',      minWidth:100 },
  { label:'Cost src.',   key:'cost_source',       minWidth:100 },
  { label:'Created',     key:'created_at',        minWidth:130 },
  { label:'Last edited', key:'updated_at',        minWidth:130 },
];

// ── ITEM LIST ─────────────────────────────────────────────────
export default function ItemList({ rates, brands, onEditItem, maximized, setExportActions, isActive, refreshKey, onToast }) {
  const { isViewer } = useAuth();
  const [brandFilter, setBrandFilter] = useState('');
  const [search,      setSearch]      = useState('');
  const [marginRange, setMarginRange] = useState(0);
  const [rows,        setRows]        = useState([]);
  const [total,       setTotal]       = useState(null);
  const [page,        setPage]        = useState(0);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [loaded,      setLoaded]      = useState(false);
  const [contextMenu,    setContextMenu]    = useState(null);
  // Deleting is irreversible, so the menu only arms a confirmation.
  const [pendingDelete,  setPendingDelete]  = useState(null);
  const [deleting,       setDeleting]       = useState(false);
  const [expanded,       setExpanded]       = useState(new Set());
  const [exportingAll,   setExportingAll]   = useState(false);
  const [sortCol,        setSortCol]        = useState('item_code');
  const [sortDir,        setSortDir]        = useState('asc');

  const PAGE_SIZE = 100;

  // Sorting is server-side: the list pages in 100 at a time and accumulates, so
  // sorting the loaded rows alone would only order the slice already fetched.
  const loadItems = async (pg=0, sc=sortCol, sd=sortDir) => {
    setLoading(true); setError(null);
    try {
      const { data, count } = await fetchItemList({ brandCode:brandFilter||undefined, search:search||undefined, page:pg, pageSize:PAGE_SIZE, sortCol:sc, sortDir:sd });
      const withMargins = data.map(item => ({
        ...item,
        _margins: (()=>{ try{ return calcAllMargins(item,rates); } catch{ return null; } })(),
      }));
      const range    = MARGIN_RANGES[marginRange];
      const filtered = withMargins.filter(item => {
        if (!range.min&&!range.max) return true;
        const m = item._margins?.uae_margin;
        if (m==null) return false;
        if (range.min!==null&&m<range.min) return false;
        if (range.max!==null&&m>=range.max) return false;
        return true;
      });
      setRows(pg===0 ? filtered : prev=>[...prev,...filtered]);
      setTotal(count); setPage(pg); setLoaded(true);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // Removes the row locally as well as reloading: the reload restores the
  // current page, but dropping it immediately keeps the table honest if the
  // refetch is slow.
  const handleConfirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    const code = pendingDelete.item_code;
    try {
      await deleteItem(code);
      setRows(prev => prev.filter(r => r.item_code !== code));
      setTotal(n => (typeof n === 'number' ? Math.max(0, n - 1) : n));
      setPendingDelete(null);
      onToast?.(`Deleted ${code}`);
      await loadItems(0);
    } catch (e) {
      setPendingDelete(null);
      onToast?.(e.message || `Could not delete ${code}`, false);
    } finally { setDeleting(false); }
  };

  // Dates and numbers are most useful newest/highest first, so they open desc;
  // text columns open asc.
  const handleSort = (col) => {
    const nextDir = sortCol === col
      ? (sortDir === 'asc' ? 'desc' : 'asc')
      : (['created_at','updated_at','exw_cost','msrp_aed','msrp_sar','msrp_qat'].includes(col) ? 'desc' : 'asc');
    setSortCol(col); setSortDir(nextDir);
    setExpanded(new Set());
    loadItems(0, col, nextDir);
  };

  useEffect(() => {
    if (!setExportActions || !isActive) return;
    if (!loaded || rows.length === 0) { setExportActions([]); return; }
    const today = new Date().toISOString().slice(0, 10);
    setExportActions([
      {
        label: `Export visible (${rows.length})`,
        onClick: () => downloadXLSX(rows.map(flattenItem), `items_visible_${today}.xlsx`),
      },
      {
        label: exportingAll ? 'Exporting…' : total ? `Export all (${total.toLocaleString()})` : 'Export all',
        onClick: () => {
          if (exportingAll) return;
          setExportingAll(true);
          downloadFullTableXLSX({
            table: 'pricing_master',
            filters: { brandCode: brandFilter || undefined, search: search || undefined },
            filename: `items_all_${today}.xlsx`,
          }).catch(e => console.error('Export failed:', e)).finally(() => setExportingAll(false));
        },
      },
    ]);
  }, [isActive, rows, loaded, total, brandFilter, search, exportingAll, setExportActions]);

  const refreshKeyRef = useRef(false);
  useEffect(() => {
    if (!refreshKeyRef.current) { refreshKeyRef.current = true; return; }
    loadItems(page);
  }, [refreshKey]);

  const handleKeyDown = (e) => { if (e.key==='Enter') { setPage(0); loadItems(0); } };

  const handleRowClick = (e, item) => {
    e.preventDefault();
    setContextMenu({ item, x:e.clientX, y:e.clientY+12 });
  };

  const toggleExpanded = (itemCode) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(itemCode) ? next.delete(itemCode) : next.add(itemCode);
      return next;
    });
  };

  const tableHeight = maximized
    ? 'calc(100vh - 280px)'
    : 'calc(100vh - 340px)';

  return (
    <div>
      {/* Filter bar */}
      <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'16px 20px', marginBottom:16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr 1fr auto', gap:12, alignItems:'end' }}>
          <div>
            <label style={lbl}>Brand</label>
            <BrandSelect
              brands={brands}
              value={brandFilter}
              onChange={v=>{ setBrandFilter(v); }}
              placeholder="All brands"
              nullable
            />
          </div>
          <div>
            <label style={lbl}>Search</label>
            <input style={inp(!!search,false)} placeholder="Item code or name — A//B for several" value={search}
              onChange={e=>setSearch(e.target.value)} onKeyDown={handleKeyDown}/>
          </div>
          <div>
            <label style={lbl}>Margin range</label>
            <select style={sel(marginRange>0,false)} value={marginRange} onChange={e=>setMarginRange(Number(e.target.value))} onKeyDown={handleKeyDown}>
              {MARGIN_RANGES.map((r,i)=><option key={i} value={i}>{r.label}</option>)}
            </select>
          </div>
          <button style={{ ...btnW, height:42, alignSelf:'end' }} onClick={()=>{ setPage(0); loadItems(0); }} disabled={loading}>
            {loading?'Loading...':'Load items'}
          </button>
        </div>
        {loaded&&total!==null&&(
          <div style={{ marginTop:10, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:12, color:t.t4, fontFamily:'var(--font-mono)' }}>
              {rows.length} shown · {total.toLocaleString()} total in DB
              {MARGIN_RANGES[marginRange].min!==null||MARGIN_RANGES[marginRange].max!==null?' · margin filter applied':''}
            </span>
            {expanded.size>0&&(
              <button style={{ ...btnG, ...btnSm, fontSize:12, color:t.t4 }}
                onClick={()=>setExpanded(new Set())}>
                Collapse all ({expanded.size})
              </button>
            )}
          </div>
        )}
      </div>

      {error&&<div style={{ background:'rgba(242,100,100,0.08)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:8, padding:'12px 16px', color:t.red, fontSize:13, marginBottom:16 }}>{error}</div>}

      {!loaded&&!loading&&(
        <div style={{ textAlign:'center', padding:'64px 0', color:t.t4, fontSize:14 }}>
          Set filters and click <strong style={{ color:t.t2 }}>Load items</strong> to fetch.
        </div>
      )}

      {loaded&&rows.length===0&&!loading&&(
        <div style={{ textAlign:'center', padding:'64px 0', color:t.t4, fontSize:14 }}>No items match the current filters.</div>
      )}

      {rows.length>0&&(
        <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, overflow:'hidden' }}>
          <div style={{ overflowX:'auto', maxHeight:tableHeight, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  {LIST_COLUMNS.map((c, ci) => {
                    const active = c.key && sortCol === c.key;
                    return (
                      <th key={c.label}
                        onClick={c.key ? () => handleSort(c.key) : undefined}
                        title={c.key ? `Sort by ${c.label}` : 'Calculated column — not sortable'}
                        style={{
                          ...thStyle, minWidth:c.minWidth,
                          ...(c.align ? { textAlign:c.align } : {}),
                          ...(ci===0 ? { position:'sticky', left:0, zIndex:3 } : {}),
                          cursor: c.key ? 'pointer' : 'default',
                          userSelect: 'none',
                          color: active ? t.blue : undefined,
                        }}>
                        {c.label}
                        {active && <span style={{ marginLeft:4, fontSize:9 }}>{sortDir==='asc'?'↑':'↓'}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((item,i) => {
                  const msrp    = resolvePriceUsed(item);
                  const margins = item._margins;
                  const m       = formatMargin(margins?.uae_margin);
                  const landed  = margins?.landed_cost_aed;
                  const isExp   = expanded.has(item.item_code);
                  const rowBg   = isExp ? 'rgba(77,159,255,0.06)' : i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)';
                  return (
                    <React.Fragment key={item.item_code}>
                      <tr
                        style={{ cursor:'pointer', background:rowBg, borderLeft:isExp?`3px solid ${t.blue}`:'3px solid transparent', transition:'background 0.1s' }}
                        onClick={e=>handleRowClick(e,item)}
                        onMouseEnter={e=>{ if(!isExp) e.currentTarget.style.background=t.bg3; }}
                        onMouseLeave={e=>{ if(!isExp) e.currentTarget.style.background=rowBg; }}
                      >
                        <td style={{ ...td(true), position:'sticky', left:0, background:isExp?'rgba(77,159,255,0.06)':t.bg2, zIndex:1, color:t.blue }}>{item.item_code}</td>
                        <td style={td(false)} title={item.item_name}>{item.item_name?.length > 30 ? item.item_name.slice(0, 30) + '…' : item.item_name}</td>
                        <td style={{ ...td(false), fontFamily:'var(--font-mono)', color:t.t3, fontSize:12 }}>{item.barcode||'—'}</td>
                        <td style={{ ...td(false), textAlign:'right' }}>{fmtNum(msrp.value)}</td>
                        <td style={{ ...td(false), color:t.t3 }}>{msrp.currency||'—'}</td>
                        <td style={{ ...td(false), textAlign:'right' }}>{fmtNum(item.exw_cost)}</td>
                        <td style={{ ...td(false), color:t.t3 }}>{item.cost_currency||'—'}</td>
                        <td style={{ ...td(true), textAlign:'right' }}>{money(item.msrp_aed, 'AED')}</td>
                        <td style={{ ...td(false), textAlign:'right' }}>{money(item.msrp_sar, 'SAR')}</td>
                        <td style={{ ...td(false), textAlign:'right' }}>{money(item.msrp_qat, 'QAR')}</td>
                        <td style={{ ...td(false), textAlign:'right', color:t.t3 }}>{item.shipping_rate??'—'}</td>
                        <td style={{ ...td(false), textAlign:'right', color:t.t3 }}>{item.customs_duty_rate??'—'}</td>
                        <td style={{ ...td(false), textAlign:'right' }}>{money(landed, 'AED', 2)}</td>
                        <td style={{ ...td(false), textAlign:'right', color:MARGIN_COLORS[m.status], fontWeight:600 }}>{m.label}</td>
                        <td style={{ ...td(false), color:t.t3 }}>{item.price_source||'—'}</td>
                        <td style={{ ...td(false), color:t.t3 }}>{item.cost_source||'—'}</td>
                        <td style={{ ...td(false), color:t.t4, fontSize:12 }}>{fmtDate(item.created_at)}</td>
                        <td style={{ ...td(false), color:t.t4, fontSize:12 }}>
                          {fmtDate(item.updated_at)}
                          {item.updated_by&&<span style={{ display:'block', fontSize:11, color:t.t4, marginTop:2 }}>{item.updated_by.split('@')[0]}</span>}
                        </td>
                      </tr>
                      {isExp&&<InlineSummary key={`s-${item.item_code}`} item={item} rates={rates}/>}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rows.length<(total||0)&&(
            <div style={{ padding:'14px 20px', borderTop:`1px solid ${t.b1}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:13, color:t.t4, fontFamily:'var(--font-mono)' }}>
                Showing {rows.length} of {total?.toLocaleString()} items
              </span>
              <button style={{ ...btnG, fontSize:13, padding:'7px 16px' }} onClick={()=>loadItems(page+1)} disabled={loading}>
                {loading?'Loading...':`Load next ${PAGE_SIZE}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Context menu */}
      {contextMenu&&(
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          item={contextMenu.item}
          isExpanded={expanded.has(contextMenu.item.item_code)}
          onEdit={()=>onEditItem(contextMenu.item)}
          onToggleSummary={()=>toggleExpanded(contextMenu.item.item_code)}
          onExportItem={()=>{ downloadXLSX([flattenItem(contextMenu.item)], `${contextMenu.item.item_code}.xlsx`); setContextMenu(null); }}
          onDelete={()=>setPendingDelete(contextMenu.item)}
          onDismiss={()=>setContextMenu(null)}
          isViewer={isViewer}
        />
      )}

      {/* Delete confirmation — names the item and states that history survives,
          since "delete" reasonably reads as "delete everything about it". */}
      {pendingDelete && (
        <div
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:600,
                   display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            style={{ background:t.bg2, border:`1px solid ${t.b2}`, borderRadius:16,
                     padding:'26px 30px', width:'100%', maxWidth:460 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize:17, fontWeight:600, color:t.t1, marginBottom:8 }}>Delete this item?</div>
            <div style={{ fontSize:13.5, color:t.t3, lineHeight:1.6, marginBottom:16 }}>
              <span style={{ fontFamily:'var(--font-mono)', color:t.t1 }}>{pendingDelete.item_code}</span>
              {pendingDelete.item_name ? ` — ${pendingDelete.item_name}` : ''} will be removed from the
              pricing master. This cannot be undone.
            </div>
            <div style={{ fontSize:12.5, color:t.t4, background:t.bg1, border:`1px solid ${t.b1}`,
                          borderRadius:8, padding:'10px 14px', marginBottom:20 }}>
              Its price history is kept, so re-adding the same item code later reconnects to it.
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
              <button style={btnG} disabled={deleting} onClick={() => setPendingDelete(null)}>Cancel</button>
              <button
                style={{ ...btnW, background:t.red, color:'#fff', opacity: deleting ? 0.6 : 1,
                         cursor: deleting ? 'default' : 'pointer' }}
                disabled={deleting}
                onClick={handleConfirmDelete}
              >{deleting ? 'Deleting…' : 'Delete item'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}