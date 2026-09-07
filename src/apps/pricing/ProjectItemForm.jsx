import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { saveProjectItem } from '../../lib/db';
import { calcProjectPrice, formatMargin, MARGIN_COLORS, suggestKSAPrice, suggestQATPrice, DEFAULT_PROJECT_MARGIN_PCT } from '../../lib/pricing';
import { t, inp, sel, btnW, btnG, btnSm, lbl, sub, fg, groupBox, groupHead } from './styles';
import { toNum, hasNum, round, money } from '../../lib/num';
import { useAuth } from '../../lib/AuthContext';
import { LOCAL_CURRENCIES, PROJECT_CURRENCIES } from './projectConstants';

const hasVal = hasNum;

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

// ── ITEM FORM ─────────────────────────────────────────────────
export default function ProjectItemForm({ rates, existing, existingCodes, onSave, onFail, onCancel, onViewExisting }) {
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
    const cost = toNum(form.cost);
    if (cost == null || cost < 0 || !form.cost_currency || !rates?.[form.cost_currency]) {
      setForm(f => ({ ...f, msrp_aed_inc_vat: '', msrp_aed_ex_vat: '' }));
      return;
    }
    const result = calcProjectPrice({
      cost,
      cost_currency:     form.cost_currency,
      shipping_rate:     toNum(form.shipping_rate) || 0,
      customs_duty_rate: toNum(form.customs_duty_rate) ?? 5.5,
      target_margin_pct: toNum(form.target_margin_pct) || DEFAULT_PROJECT_MARGIN_PCT,
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
    const exVat = toNum(form.msrp_aed_ex_vat);
    if (exVat == null || exVat < 0) {
      setForm(f => ({ ...f, msrp_sar: f.ksa_overridden ? f.msrp_sar : '', msrp_qat: f.qat_overridden ? f.msrp_qat : '' }));
      return;
    }
    setForm(f => ({
      ...f,
      msrp_sar: f.ksa_overridden ? f.msrp_sar : round(suggestKSAPrice(exVat)),
      msrp_qat: f.qat_overridden ? f.msrp_qat : round(suggestQATPrice(exVat)),
    }));
  }, [form.msrp_aed_ex_vat]);

  // ── Re-suggest on override revert ─────────────────────────────
  // Deps intentionally include only the override flag — we want these to fire only when
  // the flag is toggled off. The SAR/QAT suggestion effect above handles re-suggestion
  // whenever msrp_aed_ex_vat itself changes.
  useEffect(() => {
    if (form.ksa_overridden) return;
    const exVat = toNum(form.msrp_aed_ex_vat);
    if (exVat != null && exVat >= 0) setForm(f => ({ ...f, msrp_sar: round(suggestKSAPrice(exVat)) }));
  }, [form.ksa_overridden]); // intentional: msrp_aed_ex_vat omitted — handled by suggestion effect above

  useEffect(() => {
    if (form.qat_overridden) return;
    const exVat = toNum(form.msrp_aed_ex_vat);
    if (exVat != null && exVat >= 0) setForm(f => ({ ...f, msrp_qat: round(suggestQATPrice(exVat)) }));
  }, [form.qat_overridden]); // intentional: msrp_aed_ex_vat omitted — handled by suggestion effect above

  useEffect(() => {
    if (!existing) writeFormCache(form.cost_currency, form.shipping_rate);
  }, [form.cost_currency, form.shipping_rate]); // existing is stable for the component's lifetime

  // ── Derived display values ──────────────────────────────────
  const costVal    = toNum(form.cost);
  const incVatVal  = toNum(form.msrp_aed_inc_vat);
  const exVatVal   = toNum(form.msrp_aed_ex_vat);
  const sarVal     = toNum(form.msrp_sar);
  const qatVal     = toNum(form.msrp_qat);

  // Landed cost always computed from cost inputs (regardless of override)
  const landedResult = (costVal != null && costVal >= 0 && form.cost_currency && rates?.[form.cost_currency])
    ? calcProjectPrice({
        cost:              costVal,
        cost_currency:     form.cost_currency,
        shipping_rate:     toNum(form.shipping_rate) || 0,
        customs_duty_rate: toNum(form.customs_duty_rate) ?? 5.5,
        target_margin_pct: toNum(form.target_margin_pct) || DEFAULT_PROJECT_MARGIN_PCT,
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

  const showNudge = costVal > 0 && (toNum(form.shipping_rate) || 0) === 0 && !LOCAL_CURRENCIES.includes(form.cost_currency);

  // ── Validation ──────────────────────────────────────────────
  const validate = () => {
    const fe = {};
    if (!form.sku_suffix?.trim())                       fe.sku_suffix     = true;
    if (costVal == null || costVal < 0)                  fe.cost           = true;
    if (!form.cost_currency)                            fe.cost_currency  = true;
    const mg = toNum(form.target_margin_pct);
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
      const incVat = toNum(form.msrp_aed_inc_vat);
      const exVat  = toNum(form.msrp_aed_ex_vat);
      await saveProjectItem({
        item_code:         itemCode,
        project_item_name: form.project_item_name || null,
        cost:              costVal,
        cost_currency:     form.cost_currency,
        shipping_rate:     toNum(form.shipping_rate) || 0,
        customs_duty_rate: toNum(form.customs_duty_rate) ?? 5.5,
        target_margin_pct: toNum(form.target_margin_pct) || DEFAULT_PROJECT_MARGIN_PCT,
        msrp_aed_inc_vat:  toNum(incVat),
        msrp_aed_ex_vat:   toNum(exVat),
        msrp_sar:          toNum(toNum(form.msrp_sar)),
        msrp_qat:          toNum(toNum(form.msrp_qat)),
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
                ['Ex VAT (AED)',                    money(exVatVal, 'AED', 2), t.t2],
                ['Landed cost (AED)',               money(landedAED, 'AED', 2), t.t3],
                [`Cost ex customs (${srcCur})`,     money(costExCustomsSrc, srcCur, 2), t.t3],
                [`Landed cost (${srcCur})`,         money(landedSrc, srcCur, 2), t.t3],
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
                    const v   = toNum(raw);
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
              <span style={sub}>{toNum(form.target_margin_pct) || DEFAULT_PROJECT_MARGIN_PCT}% margin on landed cost · override to set manually</span>
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
              ['Cost',             money(costVal, form.cost_currency)],
              ['Shipping',         `${toNum(form.shipping_rate) || 0}%`],
              ['Customs duty',     `${toNum(form.customs_duty_rate) ?? 5.5}%`],
              ['Target margin',    `${toNum(form.target_margin_pct) || DEFAULT_PROJECT_MARGIN_PCT}%`],
              ['Landed cost',      money(landedAED, 'AED', 2)],
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

