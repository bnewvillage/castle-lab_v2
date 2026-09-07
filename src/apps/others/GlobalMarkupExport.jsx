import { useState, useEffect, useMemo } from 'react';
import { fetchBrandsWithStats, fetchBrandItems, fetchRates, updateBrandAdditionalMarkup, insertPriceHistoryBatch, bulkInsertPriceHistory, bulkUpdateMarkupPrices } from '../../lib/db';
import { applyAdditionalMarkupUAE, suggestKSAPrice, suggestQATPrice, compoundMarkup } from '../../lib/pricing';
import { t, inp, btnW, btnG, lbl, groupBox } from '../pricing/styles';
import { useAuth } from '../../lib/AuthContext';
import { downloadCSV } from '../../lib/csvExport';
import { downloadXLSX } from '../../lib/xlsxExport';


// Apply additional markup to the stored real_msrp_aed (prettified base), re-prettify, derive SAR/QAT.
// Uses real_msrp_aed as the anchor — idempotent across repeated calls with the same %.
function computePricesWithMarkup(item, additionalPct) {
  const pf2 = v => v != null ? parseFloat(v.toFixed(2)) : null;
  const baseAed = item.real_msrp_aed ?? item.msrp_aed;
  if (!baseAed) return { new_aed: null, new_sar: null, new_qat: null };

  const aedForDerivation = pf2(applyAdditionalMarkupUAE(baseAed, additionalPct));
  const new_aed = !item.uae_overridden ? aedForDerivation : null;
  const new_sar = (!item.ksa_overridden && aedForDerivation != null)
    ? pf2(suggestKSAPrice(aedForDerivation) ?? item.msrp_sar)
    : null;
  const new_qat = (!item.qat_overridden && aedForDerivation != null)
    ? pf2(suggestQATPrice(aedForDerivation) ?? item.msrp_qat)
    : null;

  return { new_aed, new_sar, new_qat };
}

// ── FILTER DROPDOWN ──────────────────────────────────────────
function FilterDropdown({ id, label, options, selected, onToggle, onClear, onSelectAll, openFilter, setOpenFilter, align = 'left', searchable = false }) {
  const [innerSearch, setInnerSearch] = useState('');
  const isOpen   = openFilter === id;
  const isActive = selected.size > 0;

  // Clear inner search when closed
  useEffect(() => { if (!isOpen) setInnerSearch(''); }, [isOpen]);

  const q = innerSearch.trim().toLowerCase();
  const filtered = searchable && q
    ? options.filter(o => o.label.toLowerCase().includes(q))
    : options;

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 3 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <span>{label}</span>
      <button
        onClick={() => setOpenFilter(isOpen ? null : id)}
        style={{
          background: isActive ? 'rgba(245,166,35,0.15)' : isOpen ? t.bg2 : 'rgba(255,255,255,0.06)',
          border: `1px solid ${isActive ? 'rgba(245,166,35,0.4)' : isOpen ? t.b2 : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 4, cursor: 'pointer',
          padding: '2px 6px', fontSize: 10, lineHeight: 1,
          color: isActive ? t.amber : t.t2,
          fontFamily: 'var(--font-mono)', transition: 'all 0.1s',
        }}
        title={isActive ? 'Filtered — click to adjust' : 'Filter'}
      >
        {isActive ? `${selected.size} ▾` : '▾'}
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)',
          ...(align === 'right' ? { right: 0 } : { left: 0 }),
          zIndex: 200, background: '#0e0e0e',
          border: `1px solid ${t.b2}`, borderRadius: 8,
          padding: '6px 0', minWidth: searchable ? 280 : 190,
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
        }}>
          {searchable && (
            <div style={{ padding: '6px 10px 8px', borderBottom: `1px solid ${t.b1}` }}>
              <input
                autoFocus
                value={innerSearch}
                onChange={e => setInnerSearch(e.target.value)}
                placeholder="Search brands..."
                style={{
                  width: '100%', background: t.bg2, border: `1px solid ${t.b2}`,
                  borderRadius: 5, padding: '5px 8px', fontSize: 12, color: t.t1,
                  outline: 'none', fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
                }}
              />
            </div>
          )}
          <div style={{ display: 'flex', padding: '5px 10px 6px', borderBottom: `1px solid ${t.b1}`, marginBottom: 2 }}>
            <button onClick={() => onSelectAll(filtered.map(o => o.value))} style={{
              fontSize: 11, color: t.blue, background: 'none', border: 'none',
              cursor: 'pointer', padding: '2px 8px 2px 0', fontFamily: 'var(--font-mono)',
            }}>
              {q ? `Select ${filtered.length} matching` : 'Select all'}
            </button>
            <button onClick={onClear} style={{
              fontSize: 11, color: t.t4, background: 'none', border: 'none',
              cursor: 'pointer', padding: '2px 0', fontFamily: 'var(--font-mono)',
            }}>Clear</button>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtered.length === 0
              ? <div style={{ padding: '8px 12px', fontSize: 12, color: t.t4 }}>No matches</div>
              : filtered.map(opt => (
                <label key={opt.value} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px',
                  cursor: 'pointer', fontSize: 12, color: t.t2, userSelect: 'none',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = t.bg3}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <input type="checkbox"
                    checked={selected.has(opt.value)}
                    onChange={() => onToggle(opt.value)}
                    style={{ accentColor: t.blue, margin: 0 }}
                  />
                  <span>{opt.label}</span>
                </label>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

const thSt = {
  padding: '10px 14px', textAlign: 'left', fontSize: 11, color: t.t2,
  fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em',
  whiteSpace: 'nowrap', borderBottom: `1px solid ${t.b2}`, background: t.bg3,
  fontWeight: 600, position: 'sticky', top: 0, zIndex: 1,
};
const tdSt = { padding: '9px 14px', fontSize: 13, color: t.t2, borderBottom: `1px solid ${t.b1}`, verticalAlign: 'middle' };

export default function GlobalMarkupExport({ setExportActions }) {
  const { user } = useAuth();
  const [brands,      setBrands]      = useState([]);
  const [rates,       setRates]       = useState({});
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [addMap,      setAddMap]      = useState({}); // { brand_code: string }
  const [lastFilled,  setLastFilled]  = useState(null);
  const [dirtyBrands, setDirtyBrands] = useState(new Set());
  const [generating,  setGenerating]  = useState(false);
  const [genLog,      setGenLog]      = useState([]);
  const [committing,  setCommitting]  = useState(false);
  const [committed,   setCommitted]   = useState(false);
  const [commitLog,   setCommitLog]   = useState([]);

  // Column filters
  const [filterBrands,    setFilterBrands]    = useState(new Set()); // brand_codes to show (empty = all)
  const [filterAddStatus, setFilterAddStatus] = useState(new Set()); // '__none__' and/or '__set__'
  const [openFilter,      setOpenFilter]      = useState(null);

  // Close filter dropdowns on outside click
  useEffect(() => {
    if (!openFilter) return;
    const handler = () => setOpenFilter(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openFilter]);

  useEffect(() => {
    Promise.all([fetchBrandsWithStats(), fetchRates()])
      .then(([b, r]) => {
        setBrands(b);
        setRates(r);
        // Seed addMap from DB values
        const seed = {};
        b.forEach(brand => {
          if (brand.additional_markup_pct != null) seed[brand.brand_code] = String(brand.additional_markup_pct);
        });
        setAddMap(seed);
      })
      .finally(() => setLoading(false));
  }, []);

  const addLog = msg => setGenLog(prev => [...prev, msg]);

  // Brand options for the filter dropdown (stable — only changes on brands reload)
  const brandOptions = useMemo(() =>
    brands.map(b => ({ value: b.brand_code, label: `${b.brand_code} — ${b.brand_name}` })),
  [brands]);

  const ADD_STATUS_OPTIONS = [
    { value: '__none__', label: 'No markup saved' },
    { value: '__set__',  label: 'Has markup saved' },
  ];

  const anyFilterActive = filterBrands.size > 0 || filterAddStatus.size > 0;

  const toggleBrand = v => setFilterBrands(prev => {
    const next = new Set(prev); next.has(v) ? next.delete(v) : next.add(v); return next;
  });
  const toggleAddStatus = v => setFilterAddStatus(prev => {
    const next = new Set(prev); next.has(v) ? next.delete(v) : next.add(v); return next;
  });

  const visible = useMemo(() => {
    let result = brands;
    const q = search.trim().toLowerCase();
    if (q) result = result.filter(b =>
      b.brand_code.toLowerCase().includes(q) || b.brand_name.toLowerCase().includes(q)
    );
    if (filterBrands.size > 0) {
      result = result.filter(b => filterBrands.has(b.brand_code));
    }
    // add status filter: only restrict when exactly one option is checked
    if (filterAddStatus.size === 1) {
      if (filterAddStatus.has('__none__')) result = result.filter(b => b.additional_markup_pct == null);
      if (filterAddStatus.has('__set__'))  result = result.filter(b => b.additional_markup_pct != null);
    }
    return result;
  }, [brands, search, filterBrands, filterAddStatus]);

  const setAdditional = (brandCode, val) => {
    setCommitted(false);
    setAddMap(prev => ({ ...prev, [brandCode]: val }));
    setDirtyBrands(prev => new Set([...prev, brandCode]));
    if (val.trim() !== '' && !isNaN(parseFloat(val))) setLastFilled(val.trim());
  };

  const handleCommit = async () => {
    // Only process brands that were actually edited this session
    const brandsToApply = brands.filter(b => {
      if (!dirtyBrands.has(b.brand_code)) return false;
      const v = addMap[b.brand_code]?.trim();
      return v !== undefined && v !== '' && !isNaN(parseFloat(v));
    });
    if (!brandsToApply.length) return;

    setCommitting(true);
    setCommitLog([]);
    const now     = new Date().toISOString();
    const batchId = crypto.randomUUID();
    const userEmail = user?.email ?? 'unknown';

    try {
      const historyRows  = [];
      const priceUpdates = [];

      // 1. Compute changes per brand
      for (const brand of brandsToApply) {
        const additional = parseFloat(addMap[brand.brand_code]);
        setCommitLog(prev => [...prev, additional === 0
          ? `${brand.brand_code} — reverting to base price (0% additional)`
          : `${brand.brand_code} — ${brand.markup_percentage}% base + ${additional}% additional`
        ]);

        const items = await fetchBrandItems(brand.brand_code);
        for (const item of items) {
          const { new_aed, new_sar, new_qat } = computePricesWithMarkup(item, additional);

          historyRows.push({
            item_code:    item.item_code,
            brand_code:   brand.brand_code,
            batch_id:     batchId,
            operation_type: 'global_markup',
            changed_at:   now,
            changed_by:   userEmail,
            old_msrp_aed: item.msrp_aed ?? null,
            new_msrp_aed: new_aed,
            old_msrp_sar: item.msrp_sar ?? null,
            new_msrp_sar: new_sar,
            old_msrp_qat: item.msrp_qat ?? null,
            new_msrp_qat: new_qat,
          });

          // Only queue a write if at least one price actually changed
          if (new_aed != null || new_sar != null || new_qat != null) {
            priceUpdates.push({
              item_code: item.item_code,
              msrp_aed:  new_aed ?? item.msrp_aed,
              msrp_sar:  new_sar ?? item.msrp_sar,
              msrp_qat:  new_qat ?? item.msrp_qat,
            });
          }
        }
        setCommitLog(prev => [...prev, `  ${items.length} items queued`]);
      }

      // 2. Record batch (triggers auto-prune)
      setCommitLog(prev => [...prev, 'Writing history batch...']);
      await insertPriceHistoryBatch({
        batch_id:       batchId,
        operation_type: 'global_markup',
        description:    `Global markup — ${brandsToApply.length} brand${brandsToApply.length !== 1 ? 's' : ''}, ${historyRows.length.toLocaleString()} items`,
        applied_by:     userEmail,
        item_count:     historyRows.length,
        brand_count:    brandsToApply.length,
        metadata:       { addMap: Object.fromEntries(brandsToApply.map(b => [b.brand_code, addMap[b.brand_code]])) },
      });

      // 3. Write history detail rows
      setCommitLog(prev => [...prev, `Writing ${historyRows.length.toLocaleString()} history rows...`]);
      await bulkInsertPriceHistory(historyRows);

      // 4. Apply new prices to pricing_master
      setCommitLog(prev => [...prev, 'Updating pricing_master...']);
      await bulkUpdateMarkupPrices(priceUpdates, userEmail, now);

      // 5. Save additional_markup_pct to brand_rules (only changed brands)
      const dirtySnap = new Set(dirtyBrands);
      await Promise.all(brands.filter(b => dirtySnap.has(b.brand_code)).map(brand => {
        const val = addMap[brand.brand_code]?.trim() ?? '';
        const parsed = val === '' ? null : parseFloat(val);
        if (val !== '' && isNaN(parsed)) return Promise.resolve();
        return updateBrandAdditionalMarkup(brand.brand_code, parsed);
      }));

      setCommitLog(prev => [...prev, `Done — ${priceUpdates.length.toLocaleString()} prices updated.`]);
      setDirtyBrands(new Set());
      setCommitted(true);
      setTimeout(() => setCommitted(false), 3000);
    } catch (e) {
      setCommitLog(prev => [...prev, `Error: ${e.message}`]);
    } finally {
      setCommitting(false);
    }
  };

  useEffect(() => {
    if (!setExportActions) return;
    if (visible.length === 0) { setExportActions([]); return; }
    const today = new Date().toISOString().slice(0, 10);
    setExportActions([{
      label: `Export brands (${visible.length})`,
      onClick: () => {
        const rows = visible.map(b => ({
          brand_code:            b.brand_code,
          brand_name:            b.brand_name,
          base_markup_pct:       b.markup_percentage,
          additional_markup_pct: addMap[b.brand_code]?.trim() || '',
          effective_markup_pct:  fmtEffective(b.brand_code, b.markup_percentage) || '',
          sku_count:             b.sku_count,
        }));
        downloadCSV(rows, `brands_${today}.csv`);
      },
    }]);
  }, [visible, addMap, setExportActions]);

  const visibleEmptyCount = visible.filter(b => !addMap[b.brand_code]?.trim()).length;

  const applyToVisibleEmpty = () => {
    if (!lastFilled) return;
    const newDirty = new Set(dirtyBrands);
    setAddMap(prev => {
      const next = { ...prev };
      visible.forEach(b => {
        if (!next[b.brand_code]?.trim()) {
          next[b.brand_code] = lastFilled;
          newDirty.add(b.brand_code);
        }
      });
      return next;
    });
    setDirtyBrands(newDirty);
  };

  // Overwrite ALL visible rows with lastFilled value
  const applyToAllVisible = () => {
    if (!lastFilled) return;
    const newDirty = new Set(dirtyBrands);
    setAddMap(prev => {
      const next = { ...prev };
      visible.forEach(b => {
        next[b.brand_code] = lastFilled;
        newDirty.add(b.brand_code);
      });
      return next;
    });
    setDirtyBrands(newDirty);
  };

  const selectedBrands = brands.filter(b => {
    const v = addMap[b.brand_code]?.trim();
    return v && !isNaN(parseFloat(v));
  });

  const handleGenerate = async () => {
    if (!selectedBrands.length) return;
    setGenerating(true);
    setGenLog([]);
    const rows = [];
    const now = new Date().toISOString().slice(0, 10);

    try {
      for (const brand of selectedBrands) {
        const additional = parseFloat(addMap[brand.brand_code]);
        addLog(`${brand.brand_code} — ${brand.markup_percentage}% base + ${additional}% additional`);

        const items = await fetchBrandItems(brand.brand_code);
        addLog(`  ${items.length} items fetched`);

        for (const item of items) {
          const { new_aed, new_sar, new_qat } = computePricesWithMarkup(item, additional);

          rows.push({
            item_code: item.item_code,
            barcode:   item.barcode ?? '',
            old_aed:   item.msrp_aed ?? '',
            old_sar:   item.msrp_sar ?? '',
            old_qat:   item.msrp_qat ?? '',
            new_aed:   new_aed != null ? new_aed.toFixed(2) : '',
            new_sar:   new_sar != null ? new_sar.toFixed(2) : '',
            new_qat:   new_qat != null ? new_qat.toFixed(2) : '',
          });
        }
      }

      addLog(`Done — ${rows.length} rows.`);
      downloadXLSX(rows, `global_markup_${now}.xlsx`);
    } catch (e) {
      addLog(`Error: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const fmtEffective = (brandCode, basePct) => {
    const v = addMap[brandCode]?.trim();
    if (!v || isNaN(parseFloat(v))) return null;
    return compoundMarkup(basePct, parseFloat(v)).toFixed(2);
  };

  if (loading) return (
    <div className="loading-pulse" style={{ fontSize: 12, color: t.t4, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', padding: '40px 0' }}>
      LOADING...
    </div>
  );

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* Controls row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter brands..."
          style={{ ...inp(!!search, false), width: 240 }}
        />
        <span style={{ fontSize: 12, color: t.t4, fontFamily: 'var(--font-mono)' }}>
          {visible.length} visible · {selectedBrands.length} with additional markup
          {dirtyBrands.size > 0 && <span style={{ color: t.amber }}> · {dirtyBrands.size} unsaved</span>}
          {anyFilterActive && <span style={{ color: t.blue }}> · filtered</span>}
        </span>
        {anyFilterActive && (
          <button
            onClick={() => { setFilterBrands(new Set()); setFilterAddStatus(new Set()); }}
            style={{ ...btnG, fontSize: 11, color: t.blue, borderColor: 'rgba(100,160,255,0.3)', whiteSpace: 'nowrap' }}
          >✕ Clear filters</button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastFilled && visible.length > 0 && (
            <button
              onClick={applyToAllVisible}
              style={{ ...btnG, fontSize: 12, color: t.t2, whiteSpace: 'nowrap' }}
            >
              Set all {visible.length} visible → {lastFilled}%
            </button>
          )}
          {lastFilled && visibleEmptyCount > 0 && (
            <button
              onClick={applyToVisibleEmpty}
              style={{ ...btnG, fontSize: 12, color: t.amber, borderColor: 'rgba(245,166,35,0.3)', whiteSpace: 'nowrap' }}
            >
              Fill {visibleEmptyCount} empty → {lastFilled}%
            </button>
          )}
          <button
            onClick={handleCommit}
            disabled={committing}
            style={{ ...btnG, color: committed ? t.green : t.t2, borderColor: committed ? 'rgba(62,207,142,0.4)' : undefined, opacity: committing ? 0.6 : 1, whiteSpace: 'nowrap' }}
          >
            {committing ? 'Saving...' : committed ? '✓ Saved' : dirtyBrands.size > 0 ? `Commit ${dirtyBrands.size} changed` : 'Commit markups'}
          </button>
          <button
            onClick={handleGenerate}
            disabled={!selectedBrands.length || generating}
            style={{ ...btnW, opacity: (!selectedBrands.length || generating) ? 0.4 : 1, cursor: (!selectedBrands.length || generating) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
          >
            {generating ? 'Generating...' : `Generate CSV · ${selectedBrands.length} brand${selectedBrands.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: t.bg2, border: `1px solid ${t.b1}`, borderRadius: 12, minHeight: 320, maxHeight: '60vh', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...thSt, minWidth: 100 }}>Code</th>
              <th style={{ ...thSt, minWidth: 200 }}>
                <FilterDropdown
                  id="brands"
                  label="Brand name"
                  options={brandOptions}
                  selected={filterBrands}
                  onToggle={toggleBrand}
                  onClear={() => setFilterBrands(new Set())}
                  onSelectAll={values => setFilterBrands(new Set(values))}
                  openFilter={openFilter}
                  setOpenFilter={setOpenFilter}
                  searchable
                />
              </th>
              <th style={{ ...thSt, minWidth: 110, textAlign: 'right' }}>Base markup</th>
              <th style={{ ...thSt, minWidth: 150, textAlign: 'center' }}>
                <FilterDropdown
                  id="add_status"
                  label="Additional %"
                  options={ADD_STATUS_OPTIONS}
                  selected={filterAddStatus}
                  onToggle={toggleAddStatus}
                  onClear={() => setFilterAddStatus(new Set())}
                  onSelectAll={values => setFilterAddStatus(new Set(values))}
                  openFilter={openFilter}
                  setOpenFilter={setOpenFilter}
                />
              </th>
              <th style={{ ...thSt, minWidth: 130, textAlign: 'right' }}>Effective markup</th>
              <th style={{ ...thSt, minWidth: 70, textAlign: 'right' }}>SKUs</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((brand, i) => {
              const effective = fmtEffective(brand.brand_code, brand.markup_percentage);
              const hasAdditional = !!addMap[brand.brand_code]?.trim();
              const rowBg = hasAdditional ? 'rgba(245,166,35,0.04)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)';
              return (
                <tr key={brand.brand_code} style={{ background: rowBg }}>
                  <td style={{ ...tdSt, color: t.blue, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{brand.brand_code}</td>
                  <td style={{ ...tdSt, color: t.t1 }}>{brand.brand_name}</td>
                  <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-mono)', color: t.t3 }}>{brand.markup_percentage}%</td>
                  <td style={{ ...tdSt, textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={addMap[brand.brand_code] ?? ''}
                        onChange={e => setAdditional(brand.brand_code, e.target.value)}
                        style={{ ...inp(hasAdditional, false), width: 80, textAlign: 'center', padding: '5px 10px', fontSize: 13 }}
                      />
                      <span style={{ fontSize: 12, color: t.t4 }}>%</span>
                    </div>
                  </td>
                  <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, color: effective ? t.amber : t.t4 }}>
                    {effective ? `${effective}%` : '—'}
                  </td>
                  <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-mono)', color: t.t3, fontSize: 12 }}>
                    {brand.sku_count.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Generation log */}
      {genLog.length > 0 && (
        <div style={{ marginTop: 12, background: t.bg1, border: `1px solid ${t.b1}`, borderRadius: 8, padding: '12px 16px', maxHeight: 200, overflowY: 'auto' }}>
          {genLog.map((line, i) => (
            <div key={i} style={{ fontSize: 12, color: t.t3, fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>{line}</div>
          ))}
        </div>
      )}

      {/* Commit log */}
      {commitLog.length > 0 && (
        <div style={{ marginTop: 12, background: t.bg1, border: `1px solid ${committed ? 'rgba(62,207,142,0.2)' : t.b1}`, borderRadius: 8, padding: '12px 16px', maxHeight: 200, overflowY: 'auto' }}>
          {commitLog.map((line, i) => (
            <div key={i} style={{ fontSize: 12, color: line.startsWith('Error') ? t.red : line.startsWith('Done') ? t.green : t.t3, fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>{line}</div>
          ))}
        </div>
      )}

    </div>
  );
}
