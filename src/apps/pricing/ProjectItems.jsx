import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchProjectItems, saveProjectItem, deleteProjectItem, bulkUpdateProjectItems } from '../../lib/db';
import { calcProjectPrice, formatMargin, MARGIN_COLORS, suggestKSAPrice, suggestQATPrice, DEFAULT_PROJECT_MARGIN_PCT } from '../../lib/pricing';
import { BulkEditBar, BulkEditModal } from './ProjectBulkEdit';
import { t, inp, sel, btnW, btnG, btnSm, lbl, sub, fg, groupBox, groupHead } from './styles';
import { downloadCSV } from '../../lib/csvExport';

const LOCAL_CURRENCIES   = ['AED', 'SAR', 'QAR'];
const PROJECT_CURRENCIES = [...LOCAL_CURRENCIES, 'EUR', 'USD', 'GBP', 'AUD', 'JPY'];
import { useAuth } from '../../lib/AuthContext';

// Strip commas from Excel-formatted numbers
const pf = (v) => parseFloat(String(v ?? '').replace(/,/g, ''));
// Zero is a legitimate cost/price, so only a blank or non-numeric entry counts as missing.
const hasVal = (v) => v !== '' && v !== null && v !== undefined && !isNaN(pf(v));
// Preserves 0 while mapping blank/non-numeric to null for the database.
const numOrNull = (v) => (v === null || v === undefined || isNaN(v)) ? null : v;

// ── FORM CACHE (cost_currency + shipping_rate, 1h TTL) ───────
const FORM_CACHE_KEY = 'prjt_form_defaults';
const readFormCache = () => {
  try {
    const raw = sessionStorage.getItem(FORM_CACHE_KEY);
    if (!raw) return null;
    const { v, exp } = JSON.parse(raw);
    if (Date.now() > exp) { sessionStorage.removeItem(FORM_CACHE_KEY); return null; }
    return v;
  } catch { return null; }
};
const writeFormCache = (cost_currency, shipping_rate) => {
  try { sessionStorage.setItem(FORM_CACHE_KEY, JSON.stringify({ v: { cost_currency, shipping_rate }, exp: Date.now() + 3600000 })); } catch {}
};

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

// ── BLANK FORM STATE ──────────────────────────────────────────
const BLANK = {
  sku_suffix:        '',
  project_item_name: '',
  cost:              '',
  cost_currency:     'EUR',
  shipping_rate:     '0',
  customs_duty_rate: '5.5',
  target_margin_pct: String(DEFAULT_PROJECT_MARGIN_PCT),
  uae_overridden:    false,
  ksa_overridden:    false,
  qat_overridden:    false,
  msrp_aed_inc_vat:  '',
  msrp_aed_ex_vat:   '',
  msrp_sar:          '',
  msrp_qat:          '',
};

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
          msrp_sar: item.ksa_overridden ? item.msrp_sar : (exVat != null ? parseFloat((suggestKSAPrice(exVat) ?? 0).toFixed(2)) : null),
          msrp_qat: item.qat_overridden ? item.msrp_qat : (exVat != null ? parseFloat((suggestQATPrice(exVat) ?? 0).toFixed(2)) : null),
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
                      {item.msrp_aed_inc_vat != null ? `AED ${Number(item.msrp_aed_inc_vat).toLocaleString()}` : '—'}
                    </span>
                    {item.uae_overridden && (
                      <span style={{ fontSize:10, color:t.amber, marginLeft:6, fontFamily:'var(--font-mono)' }}>override</span>
                    )}
                  </div>
                  <span style={{ fontSize:12, color:t.t2, fontFamily:'var(--font-mono)' }}>
                    {item.msrp_aed_ex_vat != null ? `AED ${Number(item.msrp_aed_ex_vat).toFixed(2)}` : '—'}
                  </span>
                  <span style={{ fontSize:12, color:t.t3, fontFamily:'var(--font-mono)' }}>
                    {item.msrp_sar != null ? `SAR ${Number(item.msrp_sar).toFixed(2)}` : '—'}
                    {item.ksa_overridden && <span style={{ fontSize:9, color:t.amber, marginLeft:4 }}>↑</span>}
                  </span>
                  <span style={{ fontSize:12, color:t.t3, fontFamily:'var(--font-mono)' }}>
                    {item.msrp_qat != null ? `QAR ${Number(item.msrp_qat).toFixed(2)}` : '—'}
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

// ── ITEM FORM ─────────────────────────────────────────────────
function ProjectItemForm({ rates, existing, existingCodes, onSave, onFail, onCancel, onViewExisting }) {
  const { isViewer } = useAuth();

  const toForm = (item) => item ? {
    sku_suffix:        item.item_code?.replace(/^PRJT-/i, '') || '',
    project_item_name: item.project_item_name || '',
    cost:              item.cost ?? '',
    cost_currency:     item.cost_currency || 'EUR',
    shipping_rate:     item.shipping_rate ?? '0',
    customs_duty_rate: item.customs_duty_rate ?? '5.5',
    target_margin_pct: item.target_margin_pct ?? String(DEFAULT_PROJECT_MARGIN_PCT),
    uae_overridden:    item.uae_overridden ?? false,
    ksa_overridden:    item.ksa_overridden ?? false,
    qat_overridden:    item.qat_overridden ?? false,
    msrp_aed_inc_vat:  item.msrp_aed_inc_vat ?? '',
    msrp_aed_ex_vat:   item.msrp_aed_ex_vat ?? '',
    msrp_sar:          item.msrp_sar ?? '',
    msrp_qat:          item.msrp_qat ?? '',
  } : { ...BLANK };

  const [form, setForm] = useState(() => {
    if (existing) return toForm(existing);
    const cache = readFormCache();
    return cache ? { ...BLANK, cost_currency: cache.cost_currency, shipping_rate: cache.shipping_rate } : { ...BLANK };
  });
  const [fieldErrs,     setFieldErrs]     = useState({});
  const [saving,        setSaving]        = useState(false);
  const [modal,         setModal]         = useState(null);
  const [duplicateCode, setDuplicateCode] = useState(null);

  const set = (key, val) => setForm(f => {
    const next = { ...f, [key]: val };
    if (key === 'cost_currency') {
      next.customs_duty_rate = LOCAL_CURRENCIES.includes(val) ? '0' : '5.5';
    }
    return next;
  });

  const itemCode = form.sku_suffix ? `PRJT-${form.sku_suffix.toUpperCase()}` : '';

  // ── Auto-compute AED from cost inputs (only when not overriding UAE) ──
  useEffect(() => {
    if (form.uae_overridden) return;
    const cost = pf(form.cost);
    if (isNaN(cost) || cost < 0 || !form.cost_currency || !rates?.[form.cost_currency]) {
      setForm(f => ({ ...f, msrp_aed_inc_vat: '', msrp_aed_ex_vat: '' }));
      return;
    }
    const result = calcProjectPrice({
      cost,
      cost_currency:     form.cost_currency,
      shipping_rate:     pf(form.shipping_rate) || 0,
      customs_duty_rate: pf(form.customs_duty_rate) ?? 5.5,
      target_margin_pct: pf(form.target_margin_pct) || DEFAULT_PROJECT_MARGIN_PCT,
    }, rates);
    if (result) {
      setForm(f => ({
        ...f,
        msrp_aed_inc_vat: result.msrp_aed_inc_vat,
        msrp_aed_ex_vat:  result.msrp_aed_ex_vat,
      }));
    }
  }, [form.cost, form.cost_currency, form.shipping_rate, form.customs_duty_rate, form.target_margin_pct, form.uae_overridden, rates]);

  // ── Auto-suggest SAR/QAT from AED ex_vat whenever it changes ──
  useEffect(() => {
    const exVat = pf(form.msrp_aed_ex_vat);
    if (isNaN(exVat) || exVat < 0) {
      setForm(f => ({ ...f, msrp_sar: f.ksa_overridden ? f.msrp_sar : '', msrp_qat: f.qat_overridden ? f.msrp_qat : '' }));
      return;
    }
    setForm(f => ({
      ...f,
      msrp_sar: f.ksa_overridden ? f.msrp_sar : parseFloat((suggestKSAPrice(exVat) ?? 0).toFixed(2)),
      msrp_qat: f.qat_overridden ? f.msrp_qat : parseFloat((suggestQATPrice(exVat) ?? 0).toFixed(2)),
    }));
  }, [form.msrp_aed_ex_vat]);

  // ── Re-suggest on override revert ─────────────────────────────
  // Deps intentionally include only the override flag — we want these to fire only when
  // the flag is toggled off. The SAR/QAT suggestion effect above handles re-suggestion
  // whenever msrp_aed_ex_vat itself changes.
  useEffect(() => {
    if (form.ksa_overridden) return;
    const exVat = pf(form.msrp_aed_ex_vat);
    if (!isNaN(exVat) && exVat >= 0) setForm(f => ({ ...f, msrp_sar: parseFloat((suggestKSAPrice(exVat) ?? 0).toFixed(2)) }));
  }, [form.ksa_overridden]); // intentional: msrp_aed_ex_vat omitted — handled by suggestion effect above

  useEffect(() => {
    if (form.qat_overridden) return;
    const exVat = pf(form.msrp_aed_ex_vat);
    if (!isNaN(exVat) && exVat >= 0) setForm(f => ({ ...f, msrp_qat: parseFloat((suggestQATPrice(exVat) ?? 0).toFixed(2)) }));
  }, [form.qat_overridden]); // intentional: msrp_aed_ex_vat omitted — handled by suggestion effect above

  useEffect(() => {
    if (!existing) writeFormCache(form.cost_currency, form.shipping_rate);
  }, [form.cost_currency, form.shipping_rate]); // existing is stable for the component's lifetime

  // ── Derived display values ──────────────────────────────────
  const costVal    = pf(form.cost);
  const incVatVal  = pf(form.msrp_aed_inc_vat);
  const exVatVal   = pf(form.msrp_aed_ex_vat);
  const sarVal     = pf(form.msrp_sar);
  const qatVal     = pf(form.msrp_qat);

  // Landed cost always computed from cost inputs (regardless of override)
  const landedResult = (!isNaN(costVal) && costVal >= 0 && form.cost_currency && rates?.[form.cost_currency])
    ? calcProjectPrice({
        cost:              costVal,
        cost_currency:     form.cost_currency,
        shipping_rate:     pf(form.shipping_rate) || 0,
        customs_duty_rate: pf(form.customs_duty_rate) ?? 5.5,
        target_margin_pct: pf(form.target_margin_pct) || DEFAULT_PROJECT_MARGIN_PCT,
      }, rates)
    : null;

  const landedAED         = landedResult?.landed_cost_aed;
  const costExCustomsSrc  = landedResult?.cost_ex_customs_src;
  const landedSrc         = landedResult?.landed_cost_src;
  const srcCur            = form.cost_currency;

  // Margin against the actual stored ex_vat (could be overridden)
  const margin = (exVatVal > 0 && landedAED > 0)
    ? ((exVatVal - landedAED) / exVatVal) * 100
    : null;
  const marginFmt = formatMargin(margin);

  const showNudge = costVal > 0 && (pf(form.shipping_rate) || 0) === 0 && !LOCAL_CURRENCIES.includes(form.cost_currency);

  // ── Validation ──────────────────────────────────────────────
  const validate = () => {
    const fe = {};
    if (!form.sku_suffix?.trim())                       fe.sku_suffix     = true;
    if (isNaN(costVal) || costVal < 0)                  fe.cost           = true;
    if (!form.cost_currency)                            fe.cost_currency  = true;
    const mg = pf(form.target_margin_pct);
    if (!(mg > 0 && mg < 100))                          fe.target_margin_pct = true;
    return fe;
  };

  const handleSaveClick = () => {
    const fe = validate();
    setFieldErrs(fe);
    if (Object.keys(fe).length > 0) return;
    // For new items only: block if item_code already exists
    if (!existing && itemCode && existingCodes?.has(itemCode)) {
      setDuplicateCode(itemCode);
      return;
    }
    setDuplicateCode(null);
    setModal('confirm');
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const incVat = pf(form.msrp_aed_inc_vat);
      const exVat  = pf(form.msrp_aed_ex_vat);
      await saveProjectItem({
        item_code:         itemCode,
        project_item_name: form.project_item_name || null,
        cost:              costVal,
        cost_currency:     form.cost_currency,
        shipping_rate:     pf(form.shipping_rate) || 0,
        customs_duty_rate: pf(form.customs_duty_rate) ?? 5.5,
        target_margin_pct: pf(form.target_margin_pct) || DEFAULT_PROJECT_MARGIN_PCT,
        msrp_aed_inc_vat:  numOrNull(incVat),
        msrp_aed_ex_vat:   numOrNull(exVat),
        msrp_sar:          numOrNull(pf(form.msrp_sar)),
        msrp_qat:          numOrNull(pf(form.msrp_qat)),
        uae_overridden:    form.uae_overridden,
        ksa_overridden:    form.ksa_overridden,
        qat_overridden:    form.qat_overridden,
      }, { isNew: !existing });
      setModal(null);
      onSave(itemCode);
    } catch(e) {
      setModal(null);
      if (e.isDuplicate) {
        setDuplicateCode(itemCode);
      } else {
        onFail(e.message || 'Save failed — check your data and try again');
      }
    } finally { setSaving(false); }
  };

  // ── Input helpers ───────────────────────────────────────────
  const I = (key, err, extra = {}) => ({
    style:    { ...inp(hasVal(form[key]), err || fieldErrs[key]), ...extra },
    value:    form[key] ?? '',
    onChange: e => set(key, e.target.value),
  });

  const S = (key, err) => ({
    style:    sel(!!form[key], err || fieldErrs[key]),
    value:    form[key] ?? '',
    onChange: e => set(key, e.target.value),
  });

  return (
    <>
    <div style={{
      display:'grid', gridTemplateColumns:'1fr 1fr',
      gap:20, marginBottom:20, alignItems:'start',
      position:'relative',
    }}>
      {/* Amber flash overlay — fades out after mounting, only when editing existing */}
      {existing && (
        <motion.div
          key="edit-flash"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.7, delay: 0.25 }}
          style={{
            position:'absolute', inset:-4, borderRadius:14, pointerEvents:'none', zIndex:10,
            border:'2px solid rgba(245,166,35,0.55)',
            background:'rgba(245,166,35,0.04)',
          }}
        />
      )}

      {/* ── LEFT: Identity + Cost ─────────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

        {/* Identity */}
        <div style={groupBox(false)}>
          <div style={{ ...groupHead, marginBottom:20 }}>Item details</div>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

            <div style={fg}>
              <label style={lbl}>Item code</label>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <div style={{
                  padding:'10px 14px', background:t.bg1,
                  border:`1px solid ${t.b1}`, borderRadius:8,
                  fontSize:13, color:t.t4,
                  fontFamily:'var(--font-mono)', whiteSpace:'nowrap',
                }}>PRJT</div>
                <span style={{ color:t.t4, fontSize:16 }}>–</span>
                <input
                  style={{ ...inp(!!form.sku_suffix, fieldErrs.sku_suffix), fontFamily:'var(--font-mono)', flex:1, opacity: existing ? 0.7 : 1 }}
                  value={form.sku_suffix}
                  placeholder="SKU suffix"
                  readOnly={!!existing}
                  onChange={e => { if (!existing) { set('sku_suffix', e.target.value.toUpperCase()); setDuplicateCode(null); } }}
                />
              </div>
              {itemCode && <span style={{ ...sub, color:t.t2, marginTop:6 }}>{itemCode}</span>}
              {existing && <span style={{ ...sub, marginTop:4 }}>Item code locked during edit</span>}
              {duplicateCode && (
                <div style={{
                  marginTop:10, background:'rgba(242,100,100,0.07)',
                  border:'1px solid rgba(242,100,100,0.35)',
                  borderRadius:8, padding:'10px 14px',
                  display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
                }}>
                  <span style={{ fontSize:12, color:t.red }}>
                    <strong>{duplicateCode}</strong> already exists.
                  </span>
                  <button
                    style={{
                      background:'rgba(242,100,100,0.12)', border:'1px solid rgba(242,100,100,0.3)',
                      borderRadius:6, padding:'4px 10px', fontSize:12, color:t.red,
                      cursor:'pointer', whiteSpace:'nowrap',
                    }}
                    onClick={() => onViewExisting(duplicateCode)}
                  >View existing →</button>
                </div>
              )}
            </div>

            <div style={fg}>
              <label style={lbl}>
                Item name <span style={{ color:t.t4, fontWeight:400, textTransform:'none', letterSpacing:0 }}>optional</span>
              </label>
              <input {...I('project_item_name')} placeholder="Project item description" />
            </div>

          </div>
        </div>

        {/* Cost */}
        <div style={groupBox(!!(fieldErrs.cost || fieldErrs.cost_currency))}>
          <div style={{ ...groupHead, marginBottom:20 }}>Cost</div>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div style={fg}>
                <label style={lbl}>Currency</label>
                <select {...S('cost_currency', fieldErrs.cost_currency)}>
                  {PROJECT_CURRENCIES.map(cur => <option key={cur}>{cur}</option>)}
                </select>
              </div>
              <div style={fg}>
                <label style={lbl}>Cost (EXW)</label>
                <input {...I('cost', fieldErrs.cost)} type="text" inputMode="decimal" placeholder="0.00" />
                <span style={sub}>Ex-works vendor price</span>
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div style={fg}>
                <label style={lbl}>Shipping (%)</label>
                <input {...I('shipping_rate')} type="text" inputMode="decimal" placeholder="0" />
                <span style={sub}>Applied to EXW before FX</span>
              </div>
              <div style={fg}>
                <label style={lbl}>
                  Customs duty (%) <span style={{ color:t.t4, fontWeight:400, textTransform:'none', letterSpacing:0 }}>
                    {LOCAL_CURRENCIES.includes(form.cost_currency) ? 'default 0' : 'default 5.5'}
                  </span>
                </label>
                <input {...I('customs_duty_rate')} type="text" inputMode="decimal"
                  placeholder={LOCAL_CURRENCIES.includes(form.cost_currency) ? '0' : '5.5'} />
                <span style={sub}>Applied after FX conversion</span>
              </div>
            </div>

            <div style={fg}>
              <label style={lbl}>
                Target margin (%) <span style={{ color:t.t4, fontWeight:400, textTransform:'none', letterSpacing:0 }}>
                  default {DEFAULT_PROJECT_MARGIN_PCT}
                </span>
              </label>
              <input {...I('target_margin_pct', fieldErrs.target_margin_pct)} type="text" inputMode="decimal"
                placeholder={String(DEFAULT_PROJECT_MARGIN_PCT)} />
              <span style={sub}>Gross margin enforced on landed cost — shipping and customs included</span>
            </div>

            {showNudge && (
              <div style={{
                background:'rgba(245,166,35,0.07)', border:'1px solid rgba(245,166,35,0.25)',
                borderRadius:8, padding:'10px 14px', fontSize:12, color:t.amber,
              }}>
                ⚠ Shipping rate is 0 — adding actual shipping and customs rates improves pricing accuracy.
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── RIGHT: Live summary + Override ───────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

        {/* Live summary */}
        <div style={{ ...groupBox(false), background:t.bg1 }}>
          <div style={{ ...groupHead, marginBottom:20 }}>Live summary</div>

          {!hasVal(form.msrp_aed_inc_vat) && !landedResult ? (
            <div style={{ color:t.t4, fontSize:13, textAlign:'center', padding:'24px 0' }}>
              Fill in cost data to see calculations.
            </div>
          ) : (
            <div>
              {/* Price hero — 3-country grid */}
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1.5fr 1.5fr', gap:1, background:t.b1, borderRadius:8, overflow:'hidden', marginBottom:12 }}>
                <div style={{ background:t.bg2, padding:'14px' }}>
                  <div style={{ fontSize:10, color:t.t4, textTransform:'uppercase', letterSpacing:'0.06em', fontFamily:'var(--font-mono)', marginBottom:5 }}>UAE (inc VAT)</div>
                  <div style={{ fontSize:20, fontWeight:500, color:t.t1, marginBottom:3 }}>
                    {hasVal(form.msrp_aed_inc_vat) ? `AED ${Number(incVatVal).toLocaleString()}` : '—'}
                  </div>
                  <div style={{ fontSize:11, color:MARGIN_COLORS[marginFmt.status] }}>↑ {marginFmt.label} margin</div>
                </div>
                <div style={{ background:t.bg2, padding:'14px' }}>
                  <div style={{ fontSize:10, color:t.t4, textTransform:'uppercase', letterSpacing:'0.06em', fontFamily:'var(--font-mono)', marginBottom:5 }}>
                    KSA{form.ksa_overridden && <span style={{ color:t.amber, marginLeft:4 }}>↑</span>}
                  </div>
                  <div style={{ fontSize:15, fontWeight:500, color: hasVal(form.msrp_sar) ? t.t1 : t.t4, marginBottom:3 }}>
                    {hasVal(form.msrp_sar) ? `SAR ${sarVal.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 })}` : '—'}
                  </div>
                </div>
                <div style={{ background:t.bg2, padding:'14px' }}>
                  <div style={{ fontSize:10, color:t.t4, textTransform:'uppercase', letterSpacing:'0.06em', fontFamily:'var(--font-mono)', marginBottom:5 }}>
                    QAT{form.qat_overridden && <span style={{ color:t.amber, marginLeft:4 }}>↑</span>}
                  </div>
                  <div style={{ fontSize:15, fontWeight:500, color: hasVal(form.msrp_qat) ? t.t1 : t.t4, marginBottom:3 }}>
                    {hasVal(form.msrp_qat) ? `QAR ${qatVal.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 })}` : '—'}
                  </div>
                </div>
              </div>

              {[
                ['Ex VAT (AED)',                    hasVal(form.msrp_aed_ex_vat) ? `AED ${exVatVal.toFixed(2)}`        : '—', t.t2],
                ['Landed cost (AED)',               landedAED != null            ? `AED ${landedAED.toFixed(2)}`        : '—', t.t3],
                [`Cost ex customs (${srcCur})`,     costExCustomsSrc != null      ? `${srcCur} ${costExCustomsSrc.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 })}` : '—', t.t3],
                [`Landed cost (${srcCur})`,         landedSrc != null             ? `${srcCur} ${landedSrc.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 })}` : '—', t.t3],
                ['Gross margin',                    marginFmt.label,                                                                                                                             MARGIN_COLORS[marginFmt.status]],
                ['Item code',                       itemCode || '—',                                                                                                                                 t.t3],
              ].map(([label, value, color]) => (
                <div key={label} style={{
                  display:'flex', justifyContent:'space-between',
                  padding:'9px 0', borderBottom:`1px solid ${t.b1}`, fontSize:13,
                }}>
                  <span style={{ color:t.t4 }}>{label}</span>
                  <span style={{ color, fontFamily:'var(--font-mono)', fontSize:12 }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Market prices override */}
        <div style={groupBox(false)}>
          <div style={{ ...groupHead, marginBottom:16 }}>Market prices</div>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

            {/* UAE */}
            <div style={fg}>
              <label style={lbl}>
                UAE — Inc VAT (AED){' '}
                <span style={{ color: form.uae_overridden ? t.amber : t.green, fontWeight:400, textTransform:'none', letterSpacing:0 }}>
                  {form.uae_overridden ? 'overridden' : 'suggested'}
                </span>
              </label>
              <div style={{ display:'flex', gap:8 }}>
                <input
                  type="text" inputMode="decimal"
                  placeholder="Auto-calculated"
                  readOnly={!form.uae_overridden}
                  value={form.msrp_aed_inc_vat ?? ''}
                  style={{
                    ...inp(hasVal(form.msrp_aed_inc_vat), false),
                    flex:1,
                    color: form.uae_overridden ? t.t1 : t.t2,
                    borderColor: form.uae_overridden
                      ? 'rgba(245,166,35,0.4)'
                      : hasVal(form.msrp_aed_inc_vat) ? 'rgba(62,207,142,0.4)' : t.b2,
                  }}
                  onChange={e => {
                    const raw = e.target.value;
                    const v   = pf(raw);
                    setForm(f => ({
                      ...f,
                      msrp_aed_inc_vat: raw,
                      msrp_aed_ex_vat:  v > 0 ? parseFloat((v / 1.05).toFixed(2)) : '',
                    }));
                  }}
                />
                <button
                  style={{ ...btnG, ...btnSm, color: form.uae_overridden ? t.amber : t.t4 }}
                  onClick={() => set('uae_overridden', !form.uae_overridden)}
                >{form.uae_overridden ? 'Revert' : 'Override'}</button>
              </div>
              <span style={sub}>{pf(form.target_margin_pct) || DEFAULT_PROJECT_MARGIN_PCT}% margin on landed cost · override to set manually</span>
              {hasVal(form.msrp_aed_ex_vat) && (
                <span style={{ ...sub, color:t.t3, marginTop:4 }}>Ex VAT: AED {exVatVal.toFixed(2)}</span>
              )}
            </div>

            {/* KSA */}
            <div style={fg}>
              <label style={lbl}>
                KSA — Ex VAT (SAR){' '}
                <span style={{ color: form.ksa_overridden ? t.amber : t.green, fontWeight:400, textTransform:'none', letterSpacing:0 }}>
                  {form.ksa_overridden ? 'overridden' : 'suggested'}
                </span>
              </label>
              <div style={{ display:'flex', gap:8 }}>
                <input
                  type="text" inputMode="decimal"
                  placeholder="Auto-calculated"
                  readOnly={!form.ksa_overridden}
                  value={form.msrp_sar ?? ''}
                  style={{
                    ...inp(hasVal(form.msrp_sar), false),
                    flex:1,
                    color: form.ksa_overridden ? t.t1 : t.t2,
                    borderColor: form.ksa_overridden
                      ? 'rgba(245,166,35,0.4)'
                      : hasVal(form.msrp_sar) ? 'rgba(62,207,142,0.4)' : t.b2,
                  }}
                  onChange={e => set('msrp_sar', e.target.value)}
                />
                <button
                  style={{ ...btnG, ...btnSm, color: form.ksa_overridden ? t.amber : t.t4 }}
                  onClick={() => set('ksa_overridden', !form.ksa_overridden)}
                >{form.ksa_overridden ? 'Revert' : 'Override'}</button>
              </div>
              <span style={sub}>UAE ex-VAT × 1.03 × 1.15 formula · result is SAR ex-VAT</span>
            </div>

            {/* QAT */}
            <div style={fg}>
              <label style={lbl}>
                QAT — Ex VAT (QAR){' '}
                <span style={{ color: form.qat_overridden ? t.amber : t.green, fontWeight:400, textTransform:'none', letterSpacing:0 }}>
                  {form.qat_overridden ? 'overridden' : 'suggested'}
                </span>
              </label>
              <div style={{ display:'flex', gap:8 }}>
                <input
                  type="text" inputMode="decimal"
                  placeholder="Auto-calculated"
                  readOnly={!form.qat_overridden}
                  value={form.msrp_qat ?? ''}
                  style={{
                    ...inp(hasVal(form.msrp_qat), false),
                    flex:1,
                    color: form.qat_overridden ? t.t1 : t.t2,
                    borderColor: form.qat_overridden
                      ? 'rgba(245,166,35,0.4)'
                      : hasVal(form.msrp_qat) ? 'rgba(62,207,142,0.4)' : t.b2,
                  }}
                  onChange={e => set('msrp_qat', e.target.value)}
                />
                <button
                  style={{ ...btnG, ...btnSm, color: form.qat_overridden ? t.amber : t.t4 }}
                  onClick={() => set('qat_overridden', !form.qat_overridden)}
                >{form.qat_overridden ? 'Revert' : 'Override'}</button>
              </div>
              <span style={sub}>UAE ex-VAT × 1.01 formula · Qatar has no VAT</span>
            </div>

          </div>
        </div>

        {/* Actions */}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button style={btnG} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...btnW, opacity:isViewer?0.4:1, cursor:isViewer?'not-allowed':'pointer' }}
            disabled={isViewer}
            onClick={handleSaveClick}
          >Review & submit</button>
        </div>

      </div>
    </div>

    {/* ── CONFIRM MODAL ──────────────────────────────────────── */}
    <AnimatePresence>
      {modal === 'confirm' && (
        <motion.div
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
          initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
          onClick={() => setModal(null)}
        >
          <motion.div
            style={{ background:'#111', border:`1px solid ${t.b2}`, borderRadius:16, padding:'28px 32px', width:'100%', maxWidth:440 }}
            initial={{ scale:0.95, opacity:0 }} animate={{ scale:1, opacity:1 }} exit={{ scale:0.95, opacity:0 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize:18, fontWeight:500, color:t.t1, marginBottom:4 }}>
              {existing ? 'Confirm changes' : 'Confirm save'}
            </div>
            <div style={{ fontSize:13, color:t.t4, marginBottom:20 }}>
              Review before saving to database.
            </div>

            {[
              ['Item code',        itemCode],
              ['Item name',        form.project_item_name || '—'],
              ['Cost',             `${form.cost_currency} ${isNaN(costVal) ? '—' : costVal.toLocaleString()}`],
              ['Shipping',         `${pf(form.shipping_rate) || 0}%`],
              ['Customs duty',     `${pf(form.customs_duty_rate) ?? 5.5}%`],
              ['Target margin',    `${pf(form.target_margin_pct) || DEFAULT_PROJECT_MARGIN_PCT}%`],
              ['Landed cost',      landedAED != null ? `AED ${landedAED.toFixed(2)}` : '—'],
              ['UAE inc VAT',  hasVal(form.msrp_aed_inc_vat) ? `AED ${incVatVal.toLocaleString()}` : '—'],
              ['UAE ex VAT',   hasVal(form.msrp_aed_ex_vat)  ? `AED ${exVatVal.toFixed(2)}`       : '—'],
              ['KSA (SAR)',    hasVal(form.msrp_sar) ? `SAR ${sarVal.toFixed(2)}` : '—'],
              ['QAT (QAR)',    hasVal(form.msrp_qat) ? `QAR ${qatVal.toFixed(2)}` : '—'],
              ['Gross margin', marginFmt.label],
              ...(form.uae_overridden ? [['UAE override', 'Yes — manual price']] : []),
              ...(form.ksa_overridden ? [['KSA override', 'Yes — manual price']] : []),
              ...(form.qat_overridden ? [['QAT override', 'Yes — manual price']] : []),
            ].map(([label, value]) => (
              <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'9px 0', borderBottom:`1px solid ${t.b1}`, fontSize:13 }}>
                <span style={{ color:t.t3 }}>{label}</span>
                <span style={{ color: label === 'Gross margin' ? MARGIN_COLORS[marginFmt.status] : t.t1, fontWeight:500, fontFamily:'var(--font-mono)', fontSize:12 }}>{value}</span>
              </div>
            ))}

            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <button style={btnG} onClick={() => setModal(null)}>Back to edit</button>
              <button
                style={{ ...btnW, opacity: (saving || isViewer) ? 0.6 : 1 }}
                onClick={handleConfirm}
                disabled={saving || isViewer}
              >
                {saving ? 'Saving...' : 'Submit'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
