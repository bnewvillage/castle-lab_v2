import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchProjectItems, saveProjectItem, deleteProjectItem, bulkUpdateProjectItems } from '../../lib/db';
import { calcProjectPrice, formatMargin, MARGIN_COLORS, suggestKSAPrice, suggestQATPrice, DEFAULT_PROJECT_MARGIN_PCT } from '../../lib/pricing';
import { BulkEditBar, BulkEditModal } from './ProjectBulkEdit';
import ProjectItemForm from './ProjectItemForm';
import { t, inp, sel, btnW, btnG, btnSm, lbl, sub, fg, groupBox, groupHead } from './styles';
import { toNum, hasNum, round, money } from '../../lib/num';
import { downloadCSV } from '../../lib/csvExport';

import { LOCAL_CURRENCIES } from './projectConstants';
import { useAuth } from '../../lib/AuthContext';

const hasVal = hasNum;


// ── SELECT INDICATOR ─────────────────────────────────────────
function SelectDot({ checked }) {
  return (
    <div style={{
      width:15, height:15, borderRadius:4, flexShrink:0,
      background: checked ? t.blue : 'transparent',
      border: `1.5px solid ${checked ? t.blue : 'rgba(255,255,255,0.14)'}`,
      display:'flex', alignItems:'center', justifyContent:'center',
      transition:'all 0.12s',
    }}>
      {checked && <span style={{ color:'#fff', fontSize:9, lineHeight:1, fontWeight:700, marginTop:1 }}>✓</span>}
    </div>
  );
}

// ── TOAST ─────────────────────────────────────────────────────


// ── SORT HEADERS ─────────────────────────────────────────────
const SORT_HEADERS = [
  { label: 'Item code',     key: 'item_code' },
  { label: 'Name',          key: 'project_item_name' },
  { label: 'Cost',          key: 'cost' },
  { label: 'Inc VAT (AED)', key: 'msrp_aed_inc_vat' },
  { label: 'Ex VAT (AED)', key: 'msrp_aed_ex_vat' },
  { label: 'KSA (SAR)',    key: 'msrp_sar' },
  { label: 'QAT (QAR)',   key: 'msrp_qat' },
  { label: 'Margin',      key: 'target_margin_pct' },
  { label: '',             key: null },
];

const GRID_COLS = '32px 145px 1fr 105px 125px 115px 110px 110px 80px auto';

// ── ROOT ──────────────────────────────────────────────────────
export default function ProjectItems({ rates, setExportActions, onToast, isActive, refreshKey }) {
  const { isViewer }                  = useAuth();
  const [items,         setItems]     = useState([]);
  const [loading,       setLoading]   = useState(true);
  const [showForm,      setShowForm]  = useState(false);
  const [editItem,      setEditItem]  = useState(null);
  const [selectedCodes, setSelectedCodes] = useState(new Set());
  const [sortCol,       setSortCol]       = useState('created_at');
  const [sortDir,       setSortDir]       = useState('desc');
  const [bulkOpen,      setBulkOpen]      = useState(false);
  const [bulkSaving,    setBulkSaving]    = useState(false);

  const load = useCallback(async () => {
    try { setLoading(true); setItems(await fetchProjectItems()); }
    catch(e) { console.error(e); }
    finally   { setLoading(false); }
  }, []);

  // Attach computed landed cost + gross margin to each project item row before export
  const flattenForExport = (item) => {
    const result = rates ? calcProjectPrice({
      cost:              item.cost,
      cost_currency:     item.cost_currency,
      shipping_rate:     item.shipping_rate,
      customs_duty_rate: item.customs_duty_rate,
      target_margin_pct: item.target_margin_pct,
    }, rates) : null;
    const landedAED = result?.landed_cost_aed ?? null;
    const exVat     = item.msrp_aed_ex_vat;
    const margin    = (exVat > 0 && landedAED != null)
      ? parseFloat(((exVat - landedAED) / exVat * 100).toFixed(2))
      : null;
    return {
      ...item,
      target_margin_pct: item.target_margin_pct ?? DEFAULT_PROJECT_MARGIN_PCT,
      landed_cost_aed:   landedAED,
      gross_margin_pct:  margin,
    };
  };

  useEffect(() => {
    if (!setExportActions || !isActive) return;
    if (items.length === 0) { setExportActions([]); return; }
    const today = new Date().toISOString().slice(0, 10);
    if (selectedCodes.size > 0) {
      setExportActions([{
        label: `Export selected (${selectedCodes.size})`,
        onClick: () => {
          const rows = items.filter(i => selectedCodes.has(i.item_code)).map(flattenForExport);
          downloadCSV(rows, `project_items_selected_${today}.csv`);
        },
      }]);
    } else {
      setExportActions([{
        label: `Export all (${items.length})`,
        onClick: () => downloadCSV(items.map(flattenForExport), `project_items_${today}.csv`),
      }]);
    }
  }, [isActive, items, selectedCodes, rates, setExportActions]);

  useEffect(() => { load(); }, [load]);

  const refreshKeyRef = useRef(false);
  useEffect(() => {
    if (!refreshKeyRef.current) { refreshKeyRef.current = true; return; }
    load();
  }, [refreshKey]);

  const handleEdit = (item) => { setEditItem(item); setShowForm(true); };

  // Recompute each selected item from its merged cost inputs, leaving any
  // market the row has manually overridden exactly as the user set it.
  const handleBulkApply = async (rows) => {
    setBulkSaving(true);
    try {
      const updates = rows.map(({ item, merged, priced }) => {
        const exVat = item.uae_overridden ? item.msrp_aed_ex_vat : (priced?.msrp_aed_ex_vat ?? null);
        return {
          item_code:         item.item_code,
          shipping_rate:     merged.shipping_rate,
          customs_duty_rate: merged.customs_duty_rate,
          target_margin_pct: merged.target_margin_pct,
          msrp_aed_inc_vat:  item.uae_overridden ? item.msrp_aed_inc_vat : (priced?.msrp_aed_inc_vat ?? null),
          msrp_aed_ex_vat:   exVat,
          msrp_sar: item.ksa_overridden ? item.msrp_sar : round(suggestKSAPrice(exVat)),
          msrp_qat: item.qat_overridden ? item.msrp_qat : round(suggestQATPrice(exVat)),
        };
      });
      await bulkUpdateProjectItems(updates);
      setBulkOpen(false);
      setSelectedCodes(new Set());
      onToast?.(`Updated ${updates.length} item${updates.length !== 1 ? 's' : ''}`);
      await load();
    } catch(e) {
      onToast?.(e.message || 'Bulk update failed', false);
    } finally { setBulkSaving(false); }
  };

  const handleDelete = async (code) => {
    if (!window.confirm(`Delete ${code}? This cannot be undone.`)) return;
    try {
      await deleteProjectItem(code);
      setSelectedCodes(prev => { const next = new Set(prev); next.delete(code); return next; });
      onToast?.(`Deleted: ${code}`);
      await load();
    } catch(e) {
      onToast?.(e.message || 'Delete failed', false);
    }
  };

  const handleSaved = async (code) => {
    setShowForm(false); setEditItem(null);
    onToast?.(`Saved: ${code}`);
    await load();
  };

  const handleFailed = (msg) => onToast?.(msg || 'Save failed', false);

  const handleViewExisting = (itemCode) => {
    const item = items.find(i => i.item_code === itemCode);
    if (item) handleEdit(item);
  };

  const handleSortClick = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortedItems = [...items].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortCol === 'item_code' || sortCol === 'project_item_name')
      return dir * (a[sortCol] || '').localeCompare(b[sortCol] || '');
    if (sortCol === 'created_at')
      return dir * (new Date(a.created_at || 0) - new Date(b.created_at || 0));
    return dir * ((a[sortCol] || 0) - (b[sortCol] || 0));
  });

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <p style={{ fontSize:13, color:t.t3, margin:0 }}>
          Cost-driven pricing — PRJT brand · {DEFAULT_PROJECT_MARGIN_PCT}% default margin on landed cost, adjustable per item · no brand markup applied.
        </p>
        {!showForm && (
          <button
            style={{ ...btnW, opacity:isViewer?0.4:1, cursor:isViewer?'not-allowed':'pointer' }}
            disabled={isViewer}
            onClick={() => { setEditItem(null); setShowForm(true); }}
          >+ Add item</button>
        )}
      </div>

      {/* Form */}
      <AnimatePresence mode="wait">
        {showForm && (
          <motion.div
            key={editItem?.item_code ?? 'new'}
            initial={{ opacity:0, x: editItem ? -24 : 0, y: editItem ? 0 : 8 }}
            animate={{ opacity:1, x:0, y:0 }}
            exit={{ opacity:0 }}
            transition={{ duration:0.18 }}>
            <ProjectItemForm
              rates={rates}
              existing={editItem}
              existingCodes={new Set(items.map(i => i.item_code))}
              onSave={handleSaved}
              onFail={handleFailed}
              onCancel={() => { setShowForm(false); setEditItem(null); }}
              onViewExisting={handleViewExisting}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk edit */}
      {!showForm && selectedCodes.size > 0 && (
        <BulkEditBar
          count={selectedCodes.size}
          disabled={isViewer}
          onEdit={() => setBulkOpen(true)}
          onClear={() => setSelectedCodes(new Set())}
        />
      )}
      {/* Mounted directly rather than through AnimatePresence: applying an edit
          clears the selection while the modal is closing, and an exit animation
          racing that state change can strand the overlay in the DOM at opacity 0,
          where it still swallows clicks. */}
      {bulkOpen && (
        <BulkEditModal
          items={items.filter(i => selectedCodes.has(i.item_code))}
          rates={rates}
          saving={bulkSaving}
          onClose={() => setBulkOpen(false)}
          onApply={handleBulkApply}
        />
      )}

      {/* List */}
      {!showForm && (
        loading ? (
          <div style={{ color:t.t4, fontSize:13, textAlign:'center', padding:'40px 0',
            fontFamily:'var(--font-mono)', letterSpacing:'0.08em' }}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={{ color:t.t4, fontSize:13, textAlign:'center', padding:'64px 0' }}>
            No project items yet. Add one to get started.
          </div>
        ) : (
          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, overflow:'hidden' }}>
            {/* Table header */}
            <div style={{
              display:'grid',
              gridTemplateColumns:GRID_COLS,
              padding:'10px 20px', background:t.bg1, borderBottom:`1px solid ${t.b1}`,
              alignItems:'center',
            }}>
              {/* Select-all indicator */}
              <div
                onClick={() => setSelectedCodes(
                  selectedCodes.size === items.length && items.length > 0
                    ? new Set() : new Set(items.map(i => i.item_code))
                )}
                style={{ cursor:'pointer', display:'flex', alignItems:'center' }}
              >
                <SelectDot checked={selectedCodes.size === items.length && items.length > 0} />
              </div>
              {SORT_HEADERS.map((h, i) => (
                <span key={i}
                  onClick={h.key ? () => handleSortClick(h.key) : undefined}
                  style={{
                    fontSize:10, color: (sortCol === h.key && h.key) ? t.blue : t.t4,
                    textTransform:'uppercase', letterSpacing:'0.07em', fontFamily:'var(--font-mono)',
                    cursor: h.key ? 'pointer' : 'default', userSelect:'none',
                    display:'flex', alignItems:'center', gap:3,
                  }}
                >
                  {h.label}
                  {sortCol === h.key && h.key && (
                    <span style={{ fontSize:9, lineHeight:1 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </span>
              ))}
            </div>

            {sortedItems.map((item, i) => {
              const isSelected = selectedCodes.has(item.item_code);
              const toggleRow = () => setSelectedCodes(prev => {
                const next = new Set(prev);
                isSelected ? next.delete(item.item_code) : next.add(item.item_code);
                return next;
              });
              return (
                <div key={item.item_code} style={{
                  display:'grid',
                  gridTemplateColumns:GRID_COLS,
                  padding:'12px 20px',
                  borderBottom: i < sortedItems.length - 1 ? `1px solid ${t.b1}` : 'none',
                  alignItems:'center', transition:'background 0.1s',
                  cursor:'pointer',
                  background: isSelected ? 'rgba(77,159,255,0.06)' : 'transparent',
                  borderLeft: isSelected ? `2px solid ${t.blue}` : '2px solid transparent',
                }}
                  onClick={toggleRow}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = t.bg3; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(77,159,255,0.06)' : 'transparent'; }}
                >
                  <SelectDot checked={isSelected} />
                  <span style={{ fontSize:13, color:t.t1, fontFamily:'var(--font-mono)' }}>{item.item_code}</span>
                  <span style={{ fontSize:13, color:t.t2 }}>{item.project_item_name || <span style={{ color:t.t4 }}>—</span>}</span>
                  <span style={{ fontSize:12, color:t.t3, fontFamily:'var(--font-mono)' }}>
                    {item.cost_currency} {Number(item.cost).toLocaleString()}
                  </span>
                  <div>
                    <span style={{ fontSize:13, color:t.t1, fontFamily:'var(--font-mono)' }}>
                      {money(item.msrp_aed_inc_vat, 'AED')}
                    </span>
                    {item.uae_overridden && (
                      <span style={{ fontSize:10, color:t.amber, marginLeft:6, fontFamily:'var(--font-mono)' }}>override</span>
                    )}
                  </div>
                  <span style={{ fontSize:12, color:t.t2, fontFamily:'var(--font-mono)' }}>
                    {money(item.msrp_aed_ex_vat, 'AED', 2)}
                  </span>
                  <span style={{ fontSize:12, color:t.t3, fontFamily:'var(--font-mono)' }}>
                    {money(item.msrp_sar, 'SAR', 2)}
                    {item.ksa_overridden && <span style={{ fontSize:9, color:t.amber, marginLeft:4 }}>↑</span>}
                  </span>
                  <span style={{ fontSize:12, color:t.t3, fontFamily:'var(--font-mono)' }}>
                    {money(item.msrp_qat, 'QAR', 2)}
                    {item.qat_overridden && <span style={{ fontSize:9, color:t.amber, marginLeft:4 }}>↑</span>}
                  </span>
                  <span style={{ fontSize:12, color:t.t3, fontFamily:'var(--font-mono)' }}>
                    {item.target_margin_pct ?? DEFAULT_PROJECT_MARGIN_PCT}%
                  </span>
                  <div style={{ display:'flex', gap:6 }} onClick={e => e.stopPropagation()}>
                    <button style={{ ...btnG, ...btnSm }} onClick={() => handleEdit(item)}>Edit</button>
                    {!isViewer && (
                      <button
                        style={{ ...btnG, ...btnSm, color:t.red, border:'1px solid rgba(242,100,100,0.25)' }}
                        onClick={() => handleDelete(item.item_code)}
                      >Delete</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

    </div>
  );
}
