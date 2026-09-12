import React, { useState, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx-js-style';
import { toNum } from '../../lib/num';
import { fetchBrands, fetchRates, bulkSaveItems, checkExisting, fetchItemsByCodes } from '../../lib/db';
import { resolvePriceUsed } from '../../lib/pricing';
import { t, inp, sel, btnW, btnG, btnSm, lbl, groupBox, groupHead, CURRENCIES } from './styles';
import { useAuth } from '../../lib/AuthContext';
import BrandSelect from './BrandSelect';
import BulkUpdatePaste from './BulkUpdatePaste';
import MassOverride from './MassOverride';
import BulkCodeOps from './BulkCodeOps';
import {
  PRICE_USED_OPTIONS, SOURCES, LARGE_THRESHOLD, REVIEW_PAGE_SIZE, MERGE_FIELDS,
  generateTemplate, validateAndCalc, processRows,
} from '../../lib/bulkImport';
import PastePanel from './bulk/PastePanel';
import DiffModal from './bulk/DiffModal';
import { EditCell, ApplyAll, StatusBadge } from './bulk/cells';
import ImportSummary from './bulk/ImportSummary';
import ImportDone from './bulk/ImportDone';

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
  if (stage === 'summary') return (
    <ImportSummary
      rows={rows} rates={rates} isViewer={isViewer}
      setRows={setRows} setError={setError} setShowErrorsOnly={setShowErrorsOnly}
      onBack={() => { setStage('drop'); setRows([]); setError(null); setShowErrorsOnly(false); }}
      onNext={() => setStage('review')}
    />
  );


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
  if (stage === 'done') return (
    <ImportDone
      lastImport={lastImport} rates={rates}
      readyCount={readyRows.length} errorCount={errorRows.length}
      onReset={() => { setStage('drop'); setRows([]); setError(null); setImportedCount(0); setLastImport(null); }}
    />
  );


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
                const { value: priceVal } = resolvePriceUsed(row);
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
          {[{ k:'full', label:'Full' }, { k:'update', label:'Update' }, { k:'override', label:'Mass Override' }, { k:'rename', label:'Rename codes' }, { k:'delete', label:'Delete items' }].map(({ k, label }) => (
            <button key={k} onClick={()=>{ setPasteMode(k); setError(null); }}
              style={{ ...btnG, ...btnSm, padding:'6px 14px',
                background: pasteMode===k ? 'rgba(77,159,255,0.09)' : 'transparent',
                borderColor: pasteMode===k ? 'rgba(77,159,255,0.3)' : t.b2,
                color: pasteMode===k ? (k === 'delete' ? t.red : t.blue) : t.t3 }}>
              {(k === 'override' || k === 'rename' || k === 'delete') ? label : `Paste columns: ${label}`}
            </button>
          ))}
        </div>
        {pasteMode === 'delete' ? (
          <BulkCodeOps mode="delete" onToast={onToast} isViewer={isViewer} />
        ) : pasteMode === 'rename' ? (
          <BulkCodeOps mode="rename" onToast={onToast} isViewer={isViewer} />
        ) : pasteMode === 'override' ? (
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
            {col:'cost_currency',req:true},{col:'exw_cost',req:false},
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