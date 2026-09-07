import { useState, useEffect, useCallback, useRef } from 'react';
// Strip thousands-separator commas before parseFloat — guards against pasted Excel values like "1,185.00"
const pf = (v) => parseFloat(String(v ?? '').replace(/,/g, ''));
import { motion, AnimatePresence } from 'framer-motion';
import { fetchBrandRule, searchItems, fetchItem, fetchHistory, saveItem } from '../../lib/db';
import { calcAllMargins, suggestKSAPrice, suggestQATPrice, suggestUAEPrice, calcEmployeePrice, formatMargin, MARGIN_COLORS, compoundMarkup, calcMSRPs, calcCostBasedMSRPs, DEFAULT_COST_MARGIN_PCT } from '../../lib/pricing';
import { t, inp, sel, btnW, btnG, btnSm, lbl, sub, fg, groupBox, groupHead, segDiv, CURRENCIES, SOURCES, PRICE_USED_OPTIONS } from './styles';
import BrandSelect from './BrandSelect';
import { useAuth } from '../../lib/AuthContext';
import { downloadXLSX } from '../../lib/xlsxExport';

// ── ROOT ──────────────────────────────────────────────────────
const BLANK = {
  sku_suffix:'', item_name:'', brand_code:'', barcode:'',
  msrp_primary_ex_vat:'', msrp_primary_inc_vat:'', msrp_primary_currency:'EUR',
  msrp_secondary_ex_vat:'', msrp_secondary_inc_vat:'', msrp_secondary_currency:'',
  price_used:'', price_source:'',
  msrp_aed:'', msrp_sar:'', msrp_qat:'', target_margin_pct:'',
  uae_overridden:false, ksa_overridden:false, qat_overridden:false,
  cost_currency:'EUR', exw_cost:'', shipping_rate:'0', customs_duty_rate:'5.5', cost_source:'',
};

const PERSIST_KEYS = ['brand_code','cost_currency','shipping_rate','customs_duty_rate','cost_source','price_source','msrp_primary_currency'];

// ── SINGLE SKU ────────────────────────────────────────────────
export default function SingleSKU({ rates, brands, editTarget, onEditTargetConsumed, onToast }) {
  const { isViewer } = useAuth();
  const [query,setQuery]       = useState('');
  const [results,setResults]   = useState([]);
  const [selected,setSelected] = useState(null);
  const [history,setHistory]   = useState([]);
  const [showForm,setShowForm] = useState(false);
  const [editMode,setEditMode] = useState(false);

  // Open view card when editTarget arrives from Item List — user clicks Edit to enter form
  useEffect(() => {
    if (!editTarget) return;
    setSelected(editTarget);
    setEditMode(false);
    setShowForm(false);
    setQuery(editTarget.item_code);
    setResults([]);
    onEditTargetConsumed();
    fetchHistory(editTarget.item_code).then(setHistory).catch(() => {});
  }, [editTarget]);

  const handleSearch = useCallback(async(q) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    try { setResults(await searchItems(q)); } catch(e) { console.error(e); }
  }, []);

  const handleSelect = async(item) => {
    setSelected(item); setResults([]); setQuery(item.item_code);
    setHistory(await fetchHistory(item.item_code));
    setShowForm(false); setEditMode(false);
  };

  const handleSaved = async(itemCode, msg) => {
    setShowForm(false); setEditMode(false);
    onToast?.(msg || 'Item saved successfully');
    handleSelect(await fetchItem(itemCode));
  };

  const handleFailed = (msg) => onToast?.(msg || 'Save failed — check your data', false);

  const margins = selected ? calcAllMargins(selected, rates) : null;
  const emp     = selected ? calcEmployeePrice(selected, rates) : null;

  const handleExportSelected = () => {
    if (!selected) return;
    const today = new Date().toISOString().slice(0, 10);
    const row = {
      item_code:               selected.item_code ?? '',
      item_name:               selected.item_name ?? '',
      brand_code:              selected.brand_code ?? '',
      barcode:                 selected.barcode ?? '',
      cost_currency:           selected.cost_currency ?? '',
      exw_cost:                selected.exw_cost ?? '',
      shipping_rate:           selected.shipping_rate ?? '',
      customs_duty_rate:       selected.customs_duty_rate ?? '',
      msrp_primary_ex_vat:     selected.msrp_primary_ex_vat ?? '',
      msrp_primary_inc_vat:    selected.msrp_primary_inc_vat ?? '',
      msrp_primary_currency:   selected.msrp_primary_currency ?? '',
      msrp_secondary_ex_vat:   selected.msrp_secondary_ex_vat ?? '',
      msrp_secondary_inc_vat:  selected.msrp_secondary_inc_vat ?? '',
      msrp_secondary_currency: selected.msrp_secondary_currency ?? '',
      price_used:              selected.price_used ?? '',
      price_source:            selected.price_source ?? '',
      cost_source:             selected.cost_source ?? '',
      msrp_aed:                selected.msrp_aed ?? '',
      msrp_sar:                selected.msrp_sar ?? '',
      msrp_qat:                selected.msrp_qat ?? '',
      landed_cost_aed:         margins?.landed_cost_aed != null ? +margins.landed_cost_aed.toFixed(2) : '',
      uae_margin_pct:          margins?.uae_margin != null ? +margins.uae_margin.toFixed(2) : '',
      ksa_margin_pct:          margins?.ksa_margin != null ? +margins.ksa_margin.toFixed(2) : '',
      qat_margin_pct:          margins?.qat_margin != null ? +margins.qat_margin.toFixed(2) : '',
      exw_margin_pct:          margins?.exw_margin != null ? +margins.exw_margin.toFixed(2) : '',
      employee_price_aed:      emp ?? '',
      updated_at:              selected.updated_at ?? '',
      updated_by:              selected.updated_by ?? '',
    };
    downloadXLSX([row], `${selected.item_code}_${today}.xlsx`);
  };

  return (
    <div>
      <div style={{ display:'flex', gap:10, marginBottom:20 }}>
        <div style={{ flex:1, position:'relative' }}>
          <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:t.t4, fontSize:16 }}>⌕</span>
          <input style={{ ...inp(!!query,false), paddingLeft:42, fontSize:14 }}
            placeholder="Search item code or name..." value={query}
            onChange={e=>handleSearch(e.target.value)}
            onBlur={()=>setTimeout(()=>setResults([]),200)}
          />
          {results.length>0 && (
            <div style={{ position:'absolute', top:'100%', left:0, right:0, background:t.bg2, border:`1px solid ${t.b2}`, borderRadius:10, zIndex:50, marginTop:4, maxHeight:280, overflowY:'auto', boxShadow:'0 8px 32px rgba(0,0,0,0.5)' }}>
              {results.map(r => (
                <div key={r.item_code} style={{ padding:'12px 16px', cursor:'pointer', borderBottom:`1px solid ${t.b1}` }}
                  onMouseDown={()=>handleSelect(r)}
                  onMouseEnter={e=>e.currentTarget.style.background=t.bg3}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                >
                  <div style={{ fontSize:13, fontWeight:500, color:t.t1, fontFamily:'var(--font-mono)' }}>{r.item_code}</div>
                  <div style={{ fontSize:12, color:t.t3, marginTop:2 }}>{r.item_name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {selected&&!showForm&&<button style={btnG} onClick={()=>{setSelected(null);setQuery('');setResults([]);setHistory([]);}}>Clear</button>}
        <button style={{...btnW,opacity:isViewer?0.4:1,cursor:isViewer?'not-allowed':'pointer'}} disabled={isViewer} onClick={()=>{setShowForm(true);setEditMode(false);setSelected(null);setQuery('');}}>+ Add item</button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>
            <ItemForm rates={rates} brands={brands} existing={editMode?selected:null}
              onSave={handleSaved} onFail={handleFailed}
              onCancel={()=>{setShowForm(false);setEditMode(false);}}/>
          </motion.div>
        )}
      </AnimatePresence>

      {selected&&!showForm&&(
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'16px 24px', borderBottom:`1px solid ${t.b1}`, display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize:15, fontWeight:500, color:t.t1, fontFamily:'var(--font-mono)' }}>{selected.item_code}</div>
                <div style={{ fontSize:13, color:t.t3, marginTop:4 }}>{selected.item_name}</div>
                {selected.barcode&&<div style={{ fontSize:12, color:t.t4, fontFamily:'var(--font-mono)', marginTop:3 }}>↳ {selected.barcode}</div>}
                {(selected.updated_at||selected.updated_by)&&(
                  <div style={{ fontSize:11, color:t.t4, marginTop:5, fontFamily:'var(--font-mono)' }}>
                    Last edited {selected.updated_at?new Date(selected.updated_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):'—'}
                    {selected.updated_by?` · ${selected.updated_by}`:''}
                  </div>
                )}
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span style={{ fontSize:12, color:t.blue, background:'rgba(77,159,255,0.1)', padding:'4px 12px', borderRadius:100 }}>{selected.brand_code}</span>
                <button style={{ ...btnG, ...btnSm }} onClick={handleExportSelected} title="Export this item with calculations">↓ Export</button>
                <button style={{ ...btnG, ...btnSm }} onClick={()=>{setEditMode(true);setShowForm(true);}}>View</button>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:1, background:t.b1 }}>
              {[
                {country:'UAE',price:selected.msrp_aed!=null?`AED ${selected.msrp_aed.toLocaleString()}`:'—',margin:margins?.uae_margin},
                {country:'KSA',price:selected.msrp_sar!=null?`SAR ${selected.msrp_sar.toLocaleString()}`:'—',margin:margins?.ksa_margin},
                {country:'QAT',price:selected.msrp_qat!=null?`QAR ${selected.msrp_qat.toLocaleString()}`:'—',margin:margins?.qat_margin},
              ].map(({country,price,margin}) => {
                const m=formatMargin(margin);
                return (
                  <div key={country} style={{ background:t.bg2, padding:'16px 20px' }}>
                    <div style={{ fontSize:11, color:t.t4, textTransform:'uppercase', letterSpacing:'0.06em', fontFamily:'var(--font-mono)', marginBottom:6 }}>{country}</div>
                    <div style={{ fontSize:18, fontWeight:500, color:t.t1, marginBottom:4 }}>{price}</div>
                    <div style={{ fontSize:12, color:MARGIN_COLORS[m.status] }}>↑ {m.label} margin</div>
                  </div>
                );
              })}
            </div>
            {(() => {
              const exwFmt = formatMargin(margins?.exw_margin);
              return (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:1, background:t.b1 }}>
                  <div style={{ background:t.bg2, padding:'14px 20px' }}><div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>EXW cost</div><div style={{ fontSize:13, color:t.t2 }}>{selected.cost_currency} {selected.exw_cost!=null?selected.exw_cost.toLocaleString():'—'}</div></div>
                  <div style={{ background:t.bg2, padding:'14px 20px' }}><div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>EXW margin</div><div style={{ fontSize:13, fontWeight:500, color:MARGIN_COLORS[exwFmt.status] }}>{exwFmt.label}</div><div style={{ fontSize:10, color:t.t4, marginTop:2 }}>price used vs cost · no markup</div></div>
                  <div style={{ background:t.bg2, padding:'14px 20px' }}><div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Landed cost</div><div style={{ fontSize:13, fontWeight:500, color:t.t1 }}>{margins?.landed_cost_aed?`AED ${margins.landed_cost_aed.toFixed(2)}`:'—'}</div></div>
                  <div style={{ background:t.bg2, padding:'14px 20px' }}><div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Employee price</div><div style={{ fontSize:13, color:t.amber }}>AED {emp?.toLocaleString()||'—'}</div></div>
                </div>
              );
            })()}
            {history.length>0&&(
              <div style={{ background:t.bg1, borderTop:`1px solid ${t.b1}`, padding:'20px 24px' }}>
                <div style={{ fontSize:11, color:t.t4, textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:'var(--font-mono)', marginBottom:14 }}>Price history</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
                  {[
                    {label:'EXW cost',newKey:'new_exw_cost',prefix:(selected.cost_currency||'')+' '},
                    {label:'UAE price (AED)',newKey:'new_msrp_aed',prefix:'AED '},
                    {label:'Primary MSRP ex',newKey:'new_msrp_primary_ex_vat',prefix:(selected.msrp_primary_currency||'')+' '},
                  ].map(({label,newKey,prefix}) => (
                    <div key={label}>
                      <div style={{ fontSize:11, color:t.t4, marginBottom:10, fontFamily:'var(--font-mono)' }}>{label}</div>
                      {history.filter(h=>h[newKey]!==null).slice(0,5).map(h => (
                        <div key={h.id} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:`1px solid ${t.b1}` }}>
                          <span style={{ fontSize:12, color:t.t4 }}>{new Date(h.changed_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'})}</span>
                          <span style={{ fontSize:12, color:t.t2 }}>{prefix}{h[newKey]?.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {!selected&&!showForm&&!query&&(
        <div style={{ textAlign:'center', padding:'64px 0', color:t.t4, fontSize:14 }}>
          Search for an item code or name to get started.
        </div>
      )}

    </div>
  );
}

// ── ITEM FORM ─────────────────────────────────────────────────

function ItemForm({ rates, brands, existing, onSave, onFail, onCancel }) {
  const { isViewer } = useAuth();
  const [form,setForm]             = useState(existing?{...BLANK,...existing,sku_suffix:existing.item_code?.split('-').slice(1).join('-')||'',barcode:existing.barcode||''}:BLANK);
  const [markup,setMarkup]                   = useState(null);
  const [additionalMarkup,setAdditionalMarkup] = useState(null);
  const [hint,setHint]             = useState(null);
  const [priceHint,setPriceHint]   = useState(null);
  const [fieldErrs,setFieldErrs]   = useState({});
  const [groupErrs,setGroupErrs]   = useState({});
  const [modal,setModal]           = useState(null);
  const [saving,setSaving]         = useState(false);
  const [viewMode,setViewMode]     = useState(!!existing);
  const [showSecondary,setShowSecondary] = useState(!!(existing?.msrp_secondary_ex_vat||existing?.msrp_secondary_inc_vat));
  const [estimateTarget,setEstimateTarget] = useState('');
  const [showEstimate,setShowEstimate]     = useState(false);
  const [estimateError,setEstimateError]   = useState('');
  const persistRef = useRef({});

  const set = (key,val) => setForm(f=>({...f,[key]:val}));

  // Recalc KSA/QAT when UAE changes
  useEffect(() => {
    if (viewMode) return;
    const uae = pf(form.msrp_aed);
    if (!uae) return;
    setForm(f => ({
      ...f,
      msrp_sar: f.ksa_overridden ? f.msrp_sar : parseFloat((suggestKSAPrice(uae)||0).toFixed(2)),
      msrp_qat: f.qat_overridden ? f.msrp_qat : parseFloat((suggestQATPrice(uae)||0).toFixed(2)),
    }));
  }, [form.msrp_aed, viewMode]);

  // When UAE override is reverted, re-trigger suggestion by nudging markup dependency
  useEffect(() => {
    if (viewMode) return;
    if (form.uae_overridden) return;
    if (!form.price_used) return;
    if (form.price_used === 'cost_based') {
      const msrps = calcCostBasedMSRPs(pf(form.exw_cost), form.cost_currency, hasVal(form.target_margin_pct) ? pf(form.target_margin_pct) : DEFAULT_COST_MARGIN_PCT, rates, additionalMarkup ?? null);
      if (!msrps) return;
      setForm(f => ({
        ...f,
        msrp_aed:      msrps.msrp_aed,
        msrp_sar:      f.ksa_overridden ? f.msrp_sar : msrps.msrp_sar,
        msrp_qat:      f.qat_overridden ? f.msrp_qat : msrps.msrp_qat,
        real_msrp_aed: msrps.real_msrp_aed,
        real_msrp_sar: msrps.real_msrp_sar,
        real_msrp_qat: msrps.real_msrp_qat,
      }));
      return;
    }
    if (markup === null || markup === undefined) return;
    const map = {
      primary_ex_vat:    { value: pf(form.msrp_primary_ex_vat),    currency: form.msrp_primary_currency },
      primary_inc_vat:   { value: pf(form.msrp_primary_inc_vat),   currency: form.msrp_primary_currency },
      secondary_ex_vat:  { value: pf(form.msrp_secondary_ex_vat),  currency: form.msrp_secondary_currency },
      secondary_inc_vat: { value: pf(form.msrp_secondary_inc_vat), currency: form.msrp_secondary_currency },
    };
    const { value, currency } = map[form.price_used] || {};
    if (value == null || isNaN(value) || !currency) return;
    const effectiveMarkup = compoundMarkup(markup, additionalMarkup ?? 0);
    const uae = suggestUAEPrice(value, currency, effectiveMarkup, rates);
    if (!uae) return;
    const uaeR = parseFloat(uae.toFixed(2));
    const realUae = suggestUAEPrice(value, currency, markup, rates);
    const realUaeR = realUae != null ? parseFloat(realUae.toFixed(2)) : null;
    setForm(f => ({
      ...f,
      msrp_aed:      uaeR,
      msrp_sar:      f.ksa_overridden ? f.msrp_sar : parseFloat((suggestKSAPrice(uaeR)||0).toFixed(2)),
      msrp_qat:      f.qat_overridden ? f.msrp_qat : parseFloat((suggestQATPrice(uaeR)||0).toFixed(2)),
      real_msrp_aed: realUaeR,
      real_msrp_sar: realUaeR != null ? parseFloat((suggestKSAPrice(realUaeR)||0).toFixed(2)) : null,
      real_msrp_qat: realUaeR != null ? parseFloat((suggestQATPrice(realUaeR)||0).toFixed(2)) : null,
    }));
  }, [form.uae_overridden, viewMode]);

  // Load markup + hints
  useEffect(() => {
    if (!form.brand_code) { setMarkup(null); setAdditionalMarkup(null); setHint(null); setPriceHint(null); return; }
    fetchBrandRule(form.brand_code).then(r => {
      setMarkup(r?.markup_percentage ?? 10);
      setAdditionalMarkup(r?.additional_markup_pct ?? null);
    });
    import('../../lib/supabase').then(({supabase}) => {
      supabase.from('pricing_master')
        .select('cost_currency,shipping_rate,customs_duty_rate,cost_source,msrp_primary_currency,price_used,price_source')
        .eq('brand_code',form.brand_code).order('created_at',{ascending:false}).limit(30)
        .then(({data}) => {
          if (!data?.length) { setHint(null); setPriceHint(null); return; }
          const mode = arr => arr.filter(Boolean).sort((a,b)=>arr.filter(v=>v===a).length-arr.filter(v=>v===b).length).pop();
          setHint({ cost_currency:mode(data.map(d=>d.cost_currency)), shipping_rate:mode(data.map(d=>String(d.shipping_rate))), customs_duty_rate:mode(data.map(d=>String(d.customs_duty_rate))), cost_source:mode(data.map(d=>d.cost_source)) });
          setPriceHint({ price_used:mode(data.map(d=>d.price_used)), price_source:mode(data.map(d=>d.price_source)), msrp_primary_currency:mode(data.map(d=>d.msrp_primary_currency)) });
        });
    });
  }, [form.brand_code]);

  // Auto-suggest prices — two-pass prettification: base markup → real_msrp, additional → msrp
  useEffect(() => {
    if (viewMode) return;
    if (!form.price_used) return;
    if (form.price_used === 'cost_based') {
      const msrps = calcCostBasedMSRPs(pf(form.exw_cost), form.cost_currency, hasVal(form.target_margin_pct) ? pf(form.target_margin_pct) : DEFAULT_COST_MARGIN_PCT, rates, additionalMarkup ?? null);
      if (!msrps) return;
      setForm(f => {
        const effectiveAed = f.uae_overridden ? f.msrp_aed : msrps.msrp_aed;
        return {
          ...f,
          msrp_aed:      effectiveAed,
          msrp_sar:      f.ksa_overridden ? f.msrp_sar : parseFloat((suggestKSAPrice(effectiveAed)||0).toFixed(2)),
          msrp_qat:      f.qat_overridden ? f.msrp_qat : parseFloat((suggestQATPrice(effectiveAed)||0).toFixed(2)),
          real_msrp_aed: msrps.real_msrp_aed,
          real_msrp_sar: msrps.real_msrp_sar,
          real_msrp_qat: msrps.real_msrp_qat,
        };
      });
      return;
    }
    if (markup===null || markup===undefined) return;
    const map = {
      primary_ex_vat:    {value:pf(form.msrp_primary_ex_vat),   currency:form.msrp_primary_currency},
      primary_inc_vat:   {value:pf(form.msrp_primary_inc_vat),  currency:form.msrp_primary_currency},
      secondary_ex_vat:  {value:pf(form.msrp_secondary_ex_vat), currency:form.msrp_secondary_currency},
      secondary_inc_vat: {value:pf(form.msrp_secondary_inc_vat),currency:form.msrp_secondary_currency},
    };
    const {value,currency} = map[form.price_used]||{};
    if (value == null || isNaN(value) || !currency) return;
    const msrps = calcMSRPs(value, currency, markup, additionalMarkup ?? null, rates);
    if (!msrps) return;
    setForm(f => {
      const effectiveAed = f.uae_overridden ? f.msrp_aed : msrps.msrp_aed;
      return {
        ...f,
        msrp_aed:      effectiveAed,
        msrp_sar:      f.ksa_overridden ? f.msrp_sar : parseFloat((suggestKSAPrice(effectiveAed)||0).toFixed(2)),
        msrp_qat:      f.qat_overridden ? f.msrp_qat : parseFloat((suggestQATPrice(effectiveAed)||0).toFixed(2)),
        real_msrp_aed: msrps.real_msrp_aed,
        real_msrp_sar: msrps.real_msrp_sar,
        real_msrp_qat: msrps.real_msrp_qat,
      };
    });
  }, [form.price_used,form.msrp_primary_ex_vat,form.msrp_primary_inc_vat,form.msrp_primary_currency,
      form.msrp_secondary_ex_vat,form.msrp_secondary_inc_vat,form.msrp_secondary_currency,
      form.exw_cost,form.cost_currency,form.target_margin_pct,markup,additionalMarkup,viewMode]);

  // Zero is a legitimate cost/price (not-for-sale items, costs never supplied),
  // so only a blank or non-numeric entry counts as missing.
  const hasVal = v => v!==''&&v!==null&&v!==undefined&&!isNaN(pf(v));
  const availablePriceUsed = PRICE_USED_OPTIONS.filter(o => hasVal(form[o.needs]));
  const priceUsedOptions   = availablePriceUsed.length>0 ? availablePriceUsed : PRICE_USED_OPTIONS;
  const itemCode = form.brand_code&&form.sku_suffix ? `${form.brand_code}-${form.sku_suffix}` : '';

  const asItem = () => ({
    ...form,
    item_code:              itemCode,
    barcode:                form.barcode||null,
    exw_cost:               form.exw_cost!==''?pf(form.exw_cost)||0:null,
    shipping_rate:          pf(form.shipping_rate)||0,
    customs_duty_rate:      pf(form.customs_duty_rate)??5.5,
    msrp_primary_ex_vat:    hasVal(form.msrp_primary_ex_vat)?pf(form.msrp_primary_ex_vat):null,
    msrp_primary_inc_vat:   hasVal(form.msrp_primary_inc_vat)?pf(form.msrp_primary_inc_vat):null,
    msrp_secondary_ex_vat:  hasVal(form.msrp_secondary_ex_vat)?pf(form.msrp_secondary_ex_vat):null,
    msrp_secondary_inc_vat: hasVal(form.msrp_secondary_inc_vat)?pf(form.msrp_secondary_inc_vat):null,
    msrp_aed:               hasVal(form.msrp_aed)?pf(form.msrp_aed):null,
    msrp_sar:               hasVal(form.msrp_sar)?pf(form.msrp_sar):null,
    msrp_qat:               hasVal(form.msrp_qat)?pf(form.msrp_qat):null,
    real_msrp_aed:          hasVal(form.real_msrp_aed)?pf(form.real_msrp_aed):null,
    real_msrp_sar:          hasVal(form.real_msrp_sar)?pf(form.real_msrp_sar):null,
    real_msrp_qat:          hasVal(form.real_msrp_qat)?pf(form.real_msrp_qat):null,
    target_margin_pct:      form.price_used==='cost_based' ? (hasVal(form.target_margin_pct)?pf(form.target_margin_pct):DEFAULT_COST_MARGIN_PCT) : null,
  });

  const item    = asItem();
  const margins = (()=>{try{return calcAllMargins(item,rates);}catch{return null;}})();
  const emp     = calcEmployeePrice(item, rates);

  const handleEstimate = () => {
    if (form.price_used === 'cost_based') {
      setEstimateError('Not needed — price is already derived from cost via target margin');
      return;
    }
    const target = pf(estimateTarget);
    if (isNaN(target) || target <= 0 || target >= 100) {
      setEstimateError('Enter a margin % between 0 and 100');
      return;
    }
    const priceMap = {
      primary_ex_vat:    { value: pf(form.msrp_primary_ex_vat),    currency: form.msrp_primary_currency },
      primary_inc_vat:   { value: pf(form.msrp_primary_inc_vat),   currency: form.msrp_primary_currency },
      secondary_ex_vat:  { value: pf(form.msrp_secondary_ex_vat),  currency: form.msrp_secondary_currency },
      secondary_inc_vat: { value: pf(form.msrp_secondary_inc_vat), currency: form.msrp_secondary_currency },
    };
    const { value: priceVal, currency: priceCurrency } = priceMap[form.price_used] || {};
    if (!priceVal || isNaN(priceVal) || !priceCurrency) {
      setEstimateError('Select a price used and fill MSRP first');
      return;
    }
    const priceRate     = rates[priceCurrency] || 1;
    const costRate      = rates[form.cost_currency] || 1;
    const priceAED      = priceVal * priceRate;
    const estimatedCost = parseFloat((priceAED * (1 - target / 100) / costRate).toFixed(4));
    set('exw_cost', estimatedCost);
    setEstimateError('');
    setShowEstimate(false); setEstimateTarget('');
  };

  const validate = () => {
    const fe={}, ge={};
    if (!form.brand_code)         { fe.brand_code=true; ge.identity=true; }
    if (!form.sku_suffix?.trim()) { fe.sku_suffix=true; ge.identity=true; }
    if (!form.item_name?.trim())  { fe.item_name=true;  ge.identity=true; }
    const costBased = form.price_used === 'cost_based';
    const hasPri = hasVal(form.msrp_primary_ex_vat) || hasVal(form.msrp_primary_inc_vat);
    const hasSec = hasVal(form.msrp_secondary_ex_vat) || hasVal(form.msrp_secondary_inc_vat);
    if (!hasPri && !costBased)    { fe.msrp_primary=true; ge.priceData=true; }
    if (!form.msrp_primary_currency && (hasPri || !costBased)) { fe.msrp_primary_currency=true; ge.priceData=true; }
    if (costBased && !hasVal(form.exw_cost)) { fe.exw_cost=true; ge.costData=true; }
    if (costBased && form.target_margin_pct !== '' && form.target_margin_pct != null
        && !(pf(form.target_margin_pct) > 0 && pf(form.target_margin_pct) < 100)) { fe.target_margin_pct=true; ge.priceData=true; }
    if (hasSec&&!form.msrp_secondary_currency) { fe.msrp_secondary_currency=true; ge.priceData=true; }
    if (hasPri&&!form.price_used) { fe.price_used=true; ge.priceData=true; }
    if (!hasVal(form.msrp_aed))   { fe.msrp_aed=true; ge.priceData=true; }
    if (!form.price_source)       { fe.price_source=true; ge.priceData=true; }
    if (!form.cost_source)        { fe.cost_source=true; ge.costData=true; }
    return {fe,ge};
  };

  const handleSaveClick = () => {
    const {fe,ge} = validate();
    setFieldErrs(fe); setGroupErrs(ge);
    if (Object.keys(fe).length>0) return;
    if (asItem().exw_cost == null) { setModal('zeroCost'); return; }
    setModal('summary');
  };

  const handleConfirmSave = async() => {
    setSaving(true);
    try {
      const it = asItem();
      await saveItem(it);
      const persisted = Object.fromEntries(PERSIST_KEYS.map(k=>[k,form[k]]));
      persistRef.current = persisted;
      setForm({...BLANK,...persisted});
      setFieldErrs({}); setGroupErrs({});
      setModal(null);
      onSave(it.item_code.toUpperCase(), 'Saved: '+it.item_code);
    } catch(e) {
      setModal(null);
      onFail(e.message||'Save failed — check your data and try again');
    } finally { setSaving(false); }
  };

  const I = (key,err,extra={}) => ({
    style:{...inp(hasVal(form[key]),err||fieldErrs[key]),...extra},
    value:form[key]??'',
    onChange:e=>set(key,e.target.value),
  });
  const S = (key,err) => ({
    style:sel(!!form[key],err||fieldErrs[key]),
    value:form[key]??'',
    onChange:e=>set(key,e.target.value),
  });
  const GH = (label,errKey,hintText) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
      <span style={{...groupHead,marginBottom:0}}>
        {label}{groupErrs[errKey]&&<span style={{color:t.red,fontWeight:400}}> · incomplete</span>}
      </span>
      {hintText&&<span style={{fontSize:11,color:t.t4,fontFamily:'var(--font-mono)'}}>{hintText}</span>}
    </div>
  );

  const costHint   = hint      ? `common: ${hint.cost_currency||'?'} · ${hint.shipping_rate??'?'}% · ${hint.customs_duty_rate??'?'}% duty · ${hint.cost_source||'?'}` : '';
  const priceHint2 = priceHint ? `common: ${priceHint.msrp_primary_currency||'?'} · ${PRICE_USED_OPTIONS.find(o=>o.value===priceHint.price_used)?.label||'?'} · ${priceHint.price_source||'?'}` : '';

  return (
    <>
    {viewMode && existing && (
      <div style={{ marginBottom:16, padding:'10px 16px', background:'rgba(77,159,255,0.06)', border:`1px solid rgba(77,159,255,0.15)`, borderRadius:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:12, color:t.t4 }}>
          <span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{existing.item_code}</span>
          {' — view only · click Edit to make changes'}
        </span>
        <div style={{ display:'flex', gap:8 }}>
          <button style={{ ...btnG, ...btnSm }} onClick={onCancel}>Close</button>
          {!isViewer && <button style={{ ...btnW, ...btnSm }} onClick={() => setViewMode(false)}>Edit</button>}
        </div>
      </div>
    )}
    <div style={{ pointerEvents: viewMode ? 'none' : undefined }}>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1.6fr', gridTemplateRows:'auto auto', gap:20, marginBottom:20, alignItems:'start' }}>

      {/* 1×1 IDENTITY */}
      <div style={{...groupBox(groupErrs.identity), gridColumn:1, gridRow:1}}>
        {GH('Identity','identity','')}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div style={fg}>
            <label style={lbl}>Brand</label>
            <BrandSelect
              brands={brands}
              value={form.brand_code}
              onChange={v=>set('brand_code',v)}
              placeholder="Select brand"
              hasError={!!fieldErrs.brand_code}
            />
            {markup!==null&&<span style={{...sub,color:t.blue}}>Markup: {markup}%</span>}
          </div>
          <div style={fg}>
            <label style={lbl}>Item code</label>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <div style={{ padding:'10px 14px', background:t.bg1, border:`1px solid ${t.b1}`, borderRadius:8, fontSize:13, color:t.t4, fontFamily:'var(--font-mono)', whiteSpace:'nowrap', minWidth:72 }}>
                {form.brand_code||'BRAND'}
              </div>
              <span style={{color:t.t4,fontSize:16}}>–</span>
              <input {...I('sku_suffix')} placeholder="SKU suffix" style={{...inp(!!form.sku_suffix,fieldErrs.sku_suffix),fontFamily:'var(--font-mono)',flex:1}}/>
            </div>
            {itemCode&&<span style={{...sub,color:t.t2,marginTop:6}}>{itemCode}</span>}
          </div>
          <div style={fg}>
            <label style={lbl}>Item name</label>
            <input {...I('item_name')} placeholder="Full item description"/>
          </div>
          <div style={fg}>
            <label style={lbl}>Barcode <span style={{color:t.t4,fontWeight:400,textTransform:'none',letterSpacing:0}}>optional</span></label>
            <input {...I('barcode')} placeholder="Leading zeros preserved" style={{...inp(!!form.barcode,false),fontFamily:'var(--font-mono)'}}/>
          </div>
        </div>
      </div>

      {/* 2×1 LIVE SUMMARY */}
      <div style={{...groupBox(false), gridColumn:2, gridRow:1, background:t.bg1}}>
        <div style={{...groupHead,marginBottom:20}}>Live summary</div>
        {!margins&&!item.msrp_aed?(
          <div style={{color:t.t4,fontSize:13,textAlign:'center',padding:'24px 0'}}>Fill in price data to see calculations</div>
        ):(
          <div style={{display:'flex',flexDirection:'column',gap:0}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:1,background:t.b1,borderRadius:8,overflow:'hidden',marginBottom:12}}>
              {[
                {country:'UAE',price:item.msrp_aed!=null?`AED ${Number(item.msrp_aed).toLocaleString()}`:'—',margin:margins?.uae_margin},
                {country:'KSA',price:item.msrp_sar!=null?`SAR ${Number(item.msrp_sar).toLocaleString()}`:'—',margin:margins?.ksa_margin},
                {country:'QAT',price:item.msrp_qat!=null?`QAR ${Number(item.msrp_qat).toLocaleString()}`:'—',margin:margins?.qat_margin},
              ].map(({country,price,margin})=>{
                const m=formatMargin(margin);
                return(
                  <div key={country} style={{background:t.bg2,padding:'14px 16px'}}>
                    <div style={{fontSize:11,color:t.t4,textTransform:'uppercase',letterSpacing:'0.06em',fontFamily:'var(--font-mono)',marginBottom:5}}>{country}</div>
                    <div style={{fontSize:16,fontWeight:500,color:t.t1,marginBottom:3}}>{price}</div>
                    <div style={{fontSize:12,color:MARGIN_COLORS[m.status]}}>↑ {m.label}</div>
                  </div>
                );
              })}
            </div>
            {[
              ['Landed cost',margins?.landed_cost_aed?`AED ${margins.landed_cost_aed.toFixed(2)}`:'—',t.t1],
              ['Employee price',emp!=null?`AED ${emp.toLocaleString()}`:'—',t.amber],
              ['Price used',PRICE_USED_OPTIONS.find(o=>o.value===form.price_used)?.label||'—',t.t3],
              ['Item code',itemCode||'—',t.t3],
            ].map(([label,value,color])=>(
              <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${t.b1}`,fontSize:13}}>
                <span style={{color:t.t4}}>{label}</span>
                <span style={{color,fontWeight:label==='Landed cost'?500:400,fontFamily:'var(--font-mono)',fontSize:12}}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 1×2 PRICE DATA */}
      <div style={{gridColumn:1,gridRow:2,display:'flex',flexDirection:'column',gap:16}}>
        <div style={segDiv}>▸ price data</div>

        <div style={groupBox(groupErrs.priceData)}>
          {GH('Primary MSRP','priceData',priceHint2)}
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div style={fg}>
              <label style={lbl}>Currency</label>
              <select {...S('msrp_primary_currency',fieldErrs.msrp_primary_currency)}>
                {CURRENCIES.map(cur=><option key={cur}>{cur}</option>)}
              </select>
              <span style={sub}>Vendor invoice currency for primary MSRP</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={fg}>
                <label style={lbl}>w/o VAT (ex VAT)</label>
                <input {...I('msrp_primary_ex_vat',fieldErrs.msrp_primary)} type="text" inputMode="decimal" placeholder="—"/>
                <span style={sub}>Before vendor's local tax</span>
              </div>
              <div style={fg}>
                <label style={lbl}>w/ VAT (inc VAT)</label>
                <input {...I('msrp_primary_inc_vat',fieldErrs.msrp_primary)} type="text" inputMode="decimal" placeholder="—"/>
                <span style={sub}>Including vendor's local tax</span>
              </div>
            </div>
          </div>
        </div>

        {!showSecondary?(
          <button style={{...btnG,fontSize:12,padding:'8px 14px',color:t.t4,borderColor:t.b1,alignSelf:'flex-start'}}
            onClick={()=>setShowSecondary(true)}>+ Add secondary MSRP</button>
        ):(
          <div style={groupBox(groupErrs.secondaryMSRP)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <span style={{...groupHead,marginBottom:0}}>Secondary MSRP</span>
              <button style={{...btnG,...btnSm,color:t.t4,borderColor:t.b1}} onClick={()=>{setShowSecondary(false);set('msrp_secondary_ex_vat','');set('msrp_secondary_inc_vat','');set('msrp_secondary_currency','');}}>Remove</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:16}}>
              <div style={fg}>
                <label style={lbl}>Currency</label>
                <select {...S('msrp_secondary_currency',fieldErrs.msrp_secondary_currency)}>
                  <option value="">None</option>
                  {CURRENCIES.map(cur=><option key={cur}>{cur}</option>)}
                </select>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div style={fg}><label style={lbl}>w/o VAT</label><input {...I('msrp_secondary_ex_vat')} type="text" inputMode="decimal" placeholder="—"/></div>
                <div style={fg}><label style={lbl}>w/ VAT</label><input {...I('msrp_secondary_inc_vat')} type="text" inputMode="decimal" placeholder="—"/></div>
              </div>
            </div>
          </div>
        )}

        <div style={groupBox(groupErrs.priceData)}>
          {GH('Selling prices','priceData','')}
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={fg}>
                <label style={lbl}>Price used</label>
                <select {...S('price_used',fieldErrs.price_used)}>
                  <option value="">Select...</option>
                  {priceUsedOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span style={sub}>{availablePriceUsed.length>0?`${availablePriceUsed.length} option${availablePriceUsed.length>1?'s':''} from filled MSRP`:'Fill MSRP above to filter'}</span>
              </div>
              <div style={fg}>
                <label style={lbl}>Price source</label>
                <select {...S('price_source',fieldErrs.price_source)}>
                  <option value="">Select source</option>
                  {SOURCES.map(src=><option key={src}>{src}</option>)}
                </select>
                <span style={sub}>Where selling price was obtained</span>
              </div>
            </div>
            {form.price_used==='cost_based' && (
              <div style={fg}>
                <label style={lbl}>Target margin (%) <span style={{color:t.t4,fontWeight:400,textTransform:'none',letterSpacing:0}}>default {DEFAULT_COST_MARGIN_PCT}</span></label>
                <input {...I('target_margin_pct',fieldErrs.target_margin_pct)} type="text" inputMode="decimal" placeholder={String(DEFAULT_COST_MARGIN_PCT)}/>
                <span style={sub}>Price = EXW cost in AED ÷ (1 − margin) · shipping & customs excluded</span>
              </div>
            )}
            <div style={fg}>
              <label style={lbl}>UAE — Ex VAT (AED) <span style={{color:form.uae_overridden?t.amber:t.green}}>{form.uae_overridden?'overridden':'suggested'}</span></label>
              <div style={{display:'flex',gap:8}}>
                <input {...I('msrp_aed',fieldErrs.msrp_aed)} type="text" inputMode="decimal"
                  placeholder="Auto-calculated" readOnly={!form.uae_overridden}
                  style={{...inp(hasVal(form.msrp_aed),fieldErrs.msrp_aed),flex:1,
                    color:form.uae_overridden?t.t1:t.t2,
                    borderColor:form.uae_overridden?'rgba(245,166,35,0.4)':hasVal(form.msrp_aed)?'rgba(62,207,142,0.4)':fieldErrs.msrp_aed?'rgba(242,100,100,0.6)':t.b2}}
                />
                <button style={{...btnG,...btnSm,color:form.uae_overridden?t.amber:t.t4}}
                  onClick={()=>set('uae_overridden',!form.uae_overridden)}>
                  {form.uae_overridden?'Revert':'Override'}
                </button>
              </div>
              <span style={sub}>{form.price_used==='cost_based'?'Ex-VAT · derived from cost at target margin · override to set manually · KSA/QAT recalc on change':'Ex-VAT · brand markup applied · override to set manually · KSA/QAT recalc on change'}</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={fg}>
                <label style={lbl}>KSA (SAR) <span style={{color:form.ksa_overridden?t.amber:t.t4}}>{form.ksa_overridden?'overridden':'auto-suggested'}</span></label>
                <div style={{display:'flex',gap:8}}>
                  <input {...I('msrp_sar')} type="text" inputMode="decimal" readOnly={!form.ksa_overridden}
                    style={{...inp(hasVal(form.msrp_sar),false),flex:1,color:form.ksa_overridden?t.t1:t.t3,borderColor:form.ksa_overridden?'rgba(245,166,35,0.4)':t.b2}}
                  />
                  <button style={{...btnG,...btnSm,color:form.ksa_overridden?t.amber:t.t4}} onClick={()=>set('ksa_overridden',!form.ksa_overridden)}>
                    {form.ksa_overridden?'Revert':'Override'}
                  </button>
                </div>
                <span style={sub}>UAE × 1.03 × 1.15 formula</span>
              </div>
              <div style={fg}>
                <label style={lbl}>QAT (QAR) <span style={{color:form.qat_overridden?t.amber:t.t4}}>{form.qat_overridden?'overridden':'auto-suggested'}</span></label>
                <div style={{display:'flex',gap:8}}>
                  <input {...I('msrp_qat')} type="text" inputMode="decimal" readOnly={!form.qat_overridden}
                    style={{...inp(hasVal(form.msrp_qat),false),flex:1,color:form.qat_overridden?t.t1:t.t3,borderColor:form.qat_overridden?'rgba(245,166,35,0.4)':t.b2}}
                  />
                  <button style={{...btnG,...btnSm,color:form.qat_overridden?t.amber:t.t4}} onClick={()=>set('qat_overridden',!form.qat_overridden)}>
                    {form.qat_overridden?'Revert':'Override'}
                  </button>
                </div>
                <span style={sub}>UAE × 1.01 formula</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2×2 COST DATA */}
      <div style={{gridColumn:2,gridRow:2,display:'flex',flexDirection:'column',gap:16}}>
        <div style={segDiv}>▸ cost data</div>

        <div style={groupBox(groupErrs.costData)}>
          {GH('Cost','costData',costHint)}
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={fg}>
                <label style={lbl}>Cost currency</label>
                <select {...S('cost_currency')}>
                  {CURRENCIES.map(cur=><option key={cur}>{cur}</option>)}
                </select>
                <span style={sub}>Currency of EXW price / vendor invoice</span>
              </div>
              <div style={fg}>
                <label style={lbl}>EXW cost <span style={{color:t.t4,fontWeight:400,textTransform:'none',letterSpacing:0}}>0 = no data</span></label>
                <div style={{display:'flex',gap:8}}>
                  <input {...I('exw_cost')} type="text" inputMode="decimal" placeholder="0.00" style={{...inp(hasVal(form.exw_cost),false),flex:1}}/>
                  <button style={{...btnG,...btnSm,color:t.blue,borderColor:'rgba(77,159,255,0.3)'}} onClick={()=>setShowEstimate(!showEstimate)}>Estimate</button>
                </div>
                <span style={sub}>Ex-works in vendor currency before shipping</span>
                {showEstimate&&(
                  <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:6}}>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <input style={{...inp(!!estimateTarget,!!estimateError),width:90}} type="text" inputMode="decimal"
                        placeholder="%" value={estimateTarget}
                        onChange={e=>{setEstimateTarget(e.target.value);setEstimateError('');}}
                        onKeyDown={e=>e.key==='Enter'&&handleEstimate()}
                      />
                      <span style={{fontSize:12,color:t.t4}}>% EXW margin target</span>
                      <button style={{...btnG,...btnSm,color:t.blue}} onClick={handleEstimate}>Apply</button>
                      <button style={{...btnG,...btnSm}} onClick={()=>{setShowEstimate(false);setEstimateTarget('');setEstimateError('');}}>✕</button>
                    </div>
                    {estimateError&&<span style={{fontSize:11,color:t.red,fontFamily:'var(--font-mono)'}}>{estimateError}</span>}
                  </div>
                )}
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={fg}>
                <label style={lbl}>Shipping rate (%)</label>
                <input {...I('shipping_rate')} type="text" inputMode="decimal" placeholder="0"/>
                <span style={sub}>Applied to EXW before FX conversion</span>
              </div>
              <div style={fg}>
                <label style={lbl}>Customs duty (%) <span style={{color:t.t4,fontWeight:400,textTransform:'none',letterSpacing:0}}>default 5.5</span></label>
                <input {...I('customs_duty_rate')} type="text" inputMode="decimal" placeholder="5.5"/>
                <span style={sub}>Applied after FX · overridable per item</span>
              </div>
            </div>
            <div style={fg}>
              <label style={lbl}>Cost source</label>
              <select {...S('cost_source',fieldErrs.cost_source)}>
                <option value="">Select source</option>
                {SOURCES.map(src=><option key={src}>{src}</option>)}
              </select>
              <span style={sub}>Where the cost figure was obtained</span>
            </div>
          </div>
        </div>

        <div style={{display:'flex',justifyContent:'flex-end',gap:10,paddingTop:4}}>
          <button style={btnG} onClick={onCancel}>Cancel</button>
          <button style={{...btnW,opacity:isViewer?0.4:1,cursor:isViewer?'not-allowed':'pointer'}} disabled={isViewer} onClick={handleSaveClick}>Review & submit</button>
        </div>
      </div>
    </div>
    </div>

    {/* MODAL — Zero cost */}
    <AnimatePresence>
      {modal==='zeroCost'&&(
        <motion.div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}
          initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setModal(null)}>
          <motion.div style={{background:'#111',border:`1px solid ${t.b2}`,borderRadius:16,padding:'28px 32px',width:'100%',maxWidth:440}}
            initial={{scale:0.95,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.95,opacity:0}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:500,color:t.t1,marginBottom:8}}>No cost entered</div>
            <div style={{fontSize:14,color:t.t3,marginBottom:24,lineHeight:1.6}}>The EXW cost field is blank, so margin calculations won't be available for this item. Enter 0 if the item genuinely has no cost, or continue to save it without one.</div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:10}}>
              <button style={btnG} onClick={()=>setModal(null)}>Go back</button>
              <button style={btnW} onClick={()=>setModal('summary')}>Continue</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* MODAL — Summary / Diff */}
    <AnimatePresence>
      {modal==='summary'&&(()=>{
        const it  = asItem();
        const m   = calcAllMargins(it, rates);
        const ep  = calcEmployeePrice(it, rates);
        const isEdit = !!existing;

        const DIFF_FIELDS = [
          {key:'exw_cost',            label:'EXW cost',        fmt:v=>v!=null?`${it.cost_currency} ${Number(v).toLocaleString()}`:'—'},
          {key:'shipping_rate',       label:'Shipping rate',   fmt:v=>v!=null?`${v}%`:'—'},
          {key:'customs_duty_rate',   label:'Customs duty',    fmt:v=>v!=null?`${v}%`:'—'},
          {key:'msrp_primary_ex_vat', label:'Primary MSRP ex', fmt:v=>v!=null?`${it.msrp_primary_currency} ${Number(v).toLocaleString()}`:'—'},
          {key:'msrp_primary_inc_vat',label:'Primary MSRP inc',fmt:v=>v!=null?`${it.msrp_primary_currency} ${Number(v).toLocaleString()}`:'—'},
          {key:'msrp_aed',            label:'UAE price',       fmt:v=>v!=null?`AED ${Number(v).toLocaleString()}`:'—'},
          {key:'msrp_sar',            label:'KSA price',       fmt:v=>v!=null?`SAR ${Number(v).toLocaleString()}`:'—'},
          {key:'msrp_qat',            label:'QAT price',       fmt:v=>v!=null?`QAR ${Number(v).toLocaleString()}`:'—'},
          {key:'price_used',          label:'Price used',      fmt:v=>PRICE_USED_OPTIONS.find(o=>o.value===v)?.label||v||'—'},
          {key:'target_margin_pct',   label:'Target margin',   fmt:v=>v!=null?v+'%':'—'},
          {key:'price_source',        label:'Price source',    fmt:v=>v||'—'},
          {key:'cost_source',         label:'Cost source',     fmt:v=>v||'—'},
          {key:'item_name',           label:'Item name',       fmt:v=>v||'—'},
          {key:'barcode',             label:'Barcode',         fmt:v=>v||'—'},
        ];

        const pctChange = (oldVal,newVal) => {
          const o=parseFloat(oldVal), n=parseFloat(newVal);
          if (!o||!n||isNaN(o)||isNaN(n)) return null;
          const pct=((n-o)/Math.abs(o))*100;
          return pct===0?null:(pct>0?`+${pct.toFixed(1)}%`:`${pct.toFixed(1)}%`);
        };

        const changedFields = isEdit
          ? DIFF_FIELDS.filter(f=>String(existing[f.key]??'')!==String(it[f.key]??''))
          : [];

        return(
          <motion.div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}
            initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setModal(null)}>
            <motion.div style={{background:'#111',border:`1px solid ${t.b2}`,borderRadius:16,padding:'28px 32px',width:'100%',maxWidth:560,maxHeight:'85vh',overflowY:'auto'}}
              initial={{scale:0.95,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.95,opacity:0}} onClick={e=>e.stopPropagation()}>
              <div style={{fontSize:18,fontWeight:500,color:t.t1,marginBottom:4}}>{isEdit?'Confirm changes':'Confirm save'}</div>
              <div style={{fontSize:13,color:t.t4,marginBottom:24}}>{isEdit?`Editing ${it.item_code} — review changes before pushing to database.`:'Review before pushing to database.'}</div>

              {isEdit?(
                <>
                  {changedFields.length===0?(
                    <div style={{fontSize:14,color:t.t4,textAlign:'center',padding:'20px 0'}}>No changes detected.</div>
                  ):(
                    <>
                      <div style={{fontSize:11,color:t.t4,fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:12}}>
                        {changedFields.length} field{changedFields.length>1?'s':''} changed
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,padding:'6px 0',borderBottom:`1px solid ${t.b2}`,marginBottom:4}}>
                        {['Field','Before','After'].map(h=><span key={h} style={{fontSize:10,color:t.t4,fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.06em'}}>{h}</span>)}
                      </div>
                      {changedFields.map(f=>{
                        const oldV=existing[f.key], newV=it[f.key];
                        const pct=pctChange(oldV,newV);
                        return(
                          <div key={f.key} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,padding:'10px 0',borderBottom:`1px solid ${t.b1}`,alignItems:'center'}}>
                            <span style={{fontSize:12,color:t.t3}}>{f.label}</span>
                            <span style={{fontSize:12,color:t.t4,fontFamily:'var(--font-mono)',textDecoration:'line-through'}}>{f.fmt(oldV)}</span>
                            <div>
                              <span style={{fontSize:12,color:t.t1,fontFamily:'var(--font-mono)',fontWeight:500}}>{f.fmt(newV)}</span>
                              {pct&&<span style={{fontSize:11,color:pct.startsWith('+')?t.green:t.red,marginLeft:8,fontFamily:'var(--font-mono)'}}>{pct}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                  <div style={{height:1,background:t.b2,margin:'16px 0'}}/>
                  <div style={{fontSize:11,color:t.t4,fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:12}}>Recalculated outputs</div>
                  {[['UAE price',it.msrp_aed!=null?`AED ${Number(it.msrp_aed).toLocaleString()}`:'—',t.t1],
                    ['KSA price',it.msrp_sar!=null?`SAR ${Number(it.msrp_sar).toLocaleString()}`:'—',t.t1],
                    ['QAT price',it.msrp_qat!=null?`QAR ${Number(it.msrp_qat).toLocaleString()}`:'—',t.t1],
                    ['Landed cost',m?.landed_cost_aed!=null?`AED ${m.landed_cost_aed.toFixed(2)}`:'—',t.t2],
                  ].map(([label,val,color])=>(
                    <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:`1px solid ${t.b1}`,fontSize:13}}>
                      <span style={{color:t.t3}}>{label}</span>
                      <span style={{color,fontFamily:'var(--font-mono)',fontSize:12}}>{val}</span>
                    </div>
                  ))}
                  {m&&[['UAE margin',m.uae_margin],['KSA margin',m.ksa_margin],['QAT margin',m.qat_margin]].map(([label,mg])=>{
                    const fmt=formatMargin(mg);
                    return(
                      <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:`1px solid ${t.b1}`,fontSize:13}}>
                        <span style={{color:t.t3}}>{label}</span>
                        <span style={{color:MARGIN_COLORS[fmt.status],fontWeight:500,fontFamily:'var(--font-mono)',fontSize:12}}>{fmt.label}</span>
                      </div>
                    );
                  })}
                  {ep&&<div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',fontSize:13}}>
                    <span style={{color:t.t3}}>Employee price</span>
                    <span style={{color:t.amber,fontFamily:'var(--font-mono)',fontSize:12}}>AED {ep.toLocaleString()}</span>
                  </div>}
                </>
              ):(
                <>
                  {[['Item code',it.item_code],['Item name',it.item_name],['Brand',it.brand_code],
                    ['Barcode',it.barcode||'—'],['Price used',PRICE_USED_OPTIONS.find(o=>o.value===it.price_used)?.label||'—'],
                    ['Price source',it.price_source||'—'],['Cost source',it.cost_source||'—'],
                  ].map(([label,val])=>(
                    <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:`1px solid ${t.b1}`,fontSize:14}}>
                      <span style={{color:t.t3}}>{label}</span>
                      <span style={{color:t.t1,fontWeight:500,fontFamily:'var(--font-mono)',fontSize:13}}>{val}</span>
                    </div>
                  ))}
                  <div style={{height:1,background:t.b2,margin:'16px 0'}}/>
                  {[['UAE price',it.msrp_aed!=null?`AED ${Number(it.msrp_aed).toLocaleString()}`:'—',t.t1],
                    ['KSA price',it.msrp_sar!=null?`SAR ${Number(it.msrp_sar).toLocaleString()}`:'—',t.t1],
                    ['QAT price',it.msrp_qat!=null?`QAR ${Number(it.msrp_qat).toLocaleString()}`:'—',t.t1],
                    ['Landed cost',m?.landed_cost_aed!=null?`AED ${m.landed_cost_aed.toFixed(2)}`:'—',t.t2],
                  ].map(([label,val,color])=>(
                    <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:`1px solid ${t.b1}`,fontSize:14}}>
                      <span style={{color:t.t3}}>{label}</span>
                      <span style={{color,fontFamily:'var(--font-mono)',fontSize:13}}>{val}</span>
                    </div>
                  ))}
                  {m&&[['UAE margin',m.uae_margin],['KSA margin',m.ksa_margin],['QAT margin',m.qat_margin]].map(([label,mg])=>{
                    const fmt=formatMargin(mg);
                    return(
                      <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:`1px solid ${t.b1}`,fontSize:14}}>
                        <span style={{color:t.t3}}>{label}</span>
                        <span style={{color:MARGIN_COLORS[fmt.status],fontWeight:500,fontFamily:'var(--font-mono)',fontSize:13}}>{fmt.label}</span>
                      </div>
                    );
                  })}
                  {ep&&<div style={{display:'flex',justifyContent:'space-between',padding:'9px 0',fontSize:14}}>
                    <span style={{color:t.t3}}>Employee price</span>
                    <span style={{color:t.amber,fontFamily:'var(--font-mono)',fontSize:13}}>AED {ep.toLocaleString()}</span>
                  </div>}
                </>
              )}

              <div style={{display:'flex',justifyContent:'flex-end',gap:10,marginTop:24}}>
                <button style={btnG} onClick={()=>setModal(null)}>Back to edit</button>
                <button style={{...btnW,opacity:(saving||isViewer)?0.6:1}} onClick={handleConfirmSave} disabled={saving||isViewer}>
                  {saving?'Saving...':'Submit'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        );
      })()}
    </AnimatePresence>
    </>
  );
}