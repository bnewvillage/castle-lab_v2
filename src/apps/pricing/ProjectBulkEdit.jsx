import { useState } from 'react';
import { motion } from 'framer-motion';
import { calcProjectPrice, formatMargin, MARGIN_COLORS, DEFAULT_PROJECT_MARGIN_PCT } from '../../lib/pricing';
import { t, inp, btnW, btnG, btnSm, lbl, sub, fg } from './styles';
import { toNum, money } from '../../lib/num';

// Fields offered for bulk edit. Blank = leave that field untouched.
const FIELDS = [
  { key:'target_margin_pct', label:'Target margin (%)', ph:String(DEFAULT_PROJECT_MARGIN_PCT), hint:'Margin on landed cost' },
  { key:'shipping_rate',     label:'Shipping (%)',      ph:'0',   hint:'Applied to EXW before FX' },
  { key:'customs_duty_rate', label:'Customs duty (%)',  ph:'5.5', hint:'Applied after FX conversion' },
];

// Merge the entered values over one item, leaving blanks as-is.
export function mergeItem(item, vals) {
  return {
    cost:              item.cost,
    cost_currency:     item.cost_currency,
    shipping_rate:     vals.shipping_rate     !== '' ? toNum(vals.shipping_rate)     : (item.shipping_rate ?? 0),
    customs_duty_rate: vals.customs_duty_rate !== '' ? toNum(vals.customs_duty_rate) : (item.customs_duty_rate ?? 5.5),
    target_margin_pct: vals.target_margin_pct !== '' ? toNum(vals.target_margin_pct) : (item.target_margin_pct ?? DEFAULT_PROJECT_MARGIN_PCT),
  };
}

// Landed cost for an item as currently stored (no pending edits).
function landedOf(item, rates) {
  if (!rates) return null;
  const r = calcProjectPrice({
    cost:              item.cost,
    cost_currency:     item.cost_currency,
    shipping_rate:     item.shipping_rate,
    customs_duty_rate: item.customs_duty_rate,
    target_margin_pct: item.target_margin_pct,
  }, rates);
  return r?.landed_cost_aed ?? null;
}

function marginOf(exVat, landed) {
  if (!(exVat > 0) || !(landed > 0)) return null;
  return ((exVat - landed) / exVat) * 100;
}

// ── SELECTION BAR ────────────────────────────────────────────
export function BulkEditBar({ count, onEdit, onClear, disabled }) {
  return (
    <motion.div
      initial={{ opacity:0, y:-6 }} animate={{ opacity:1, y:0 }}
      style={{
        display:'flex', alignItems:'center', gap:12, marginBottom:12,
        background:'rgba(77,159,255,0.07)', border:'1px solid rgba(77,159,255,0.25)',
        borderRadius:10, padding:'10px 16px',
      }}
    >
      <span style={{ fontSize:13, color:t.blue, fontWeight:500 }}>
        {count} item{count !== 1 ? 's' : ''} selected
      </span>
      <div style={{ flex:1 }} />
      <button
        style={{ ...btnG, ...btnSm, color:t.blue, borderColor:'rgba(77,159,255,0.35)',
                 opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
        disabled={disabled}
        onClick={onEdit}
      >Bulk edit</button>
      <button style={{ ...btnG, ...btnSm }} onClick={onClear}>Clear</button>
    </motion.div>
  );
}

// ── BULK EDIT MODAL ──────────────────────────────────────────
// Blank field = leave unchanged. Prices recompute from the merged cost
// inputs, except for markets the row has manually overridden.
export function BulkEditModal({ items, rates, saving, onClose, onApply }) {
  const [vals, setVals] = useState({ target_margin_pct:'', shipping_rate:'', customs_duty_rate:'' });
  const [err,  setErr]  = useState('');

  const set = (k, v) => { setVals(s => ({ ...s, [k]: v })); setErr(''); };
  const touched = Object.values(vals).some(v => String(v).trim() !== '');

  const rows = items.map(item => {
    const merged = mergeItem(item, vals);
    const priced = rates ? calcProjectPrice(merged, rates) : null;
    return {
      item, merged, priced,
      beforeIncVat: item.msrp_aed_inc_vat ?? null,
      // An overridden UAE price is manual — bulk edits never rewrite it.
      afterIncVat:  item.uae_overridden ? (item.msrp_aed_inc_vat ?? null) : (priced?.msrp_aed_inc_vat ?? null),
      beforeMargin: marginOf(item.msrp_aed_ex_vat, landedOf(item, rates)),
      afterMargin:  item.uae_overridden
        ? marginOf(item.msrp_aed_ex_vat, priced?.landed_cost_aed)
        : marginOf(priced?.msrp_aed_ex_vat, priced?.landed_cost_aed),
    };
  });

  const overriddenCount = items.filter(i => i.uae_overridden).length;

  const handleApply = () => {
    if (!touched) { setErr('Enter at least one value to apply.'); return; }
    const m = toNum(vals.target_margin_pct), s = toNum(vals.shipping_rate), d = toNum(vals.customs_duty_rate);
    if (vals.target_margin_pct !== '' && !(m > 0 && m < 100)) { setErr('Target margin must be between 0 and 100.'); return; }
    if (vals.shipping_rate     !== '' && !(s >= 0))           { setErr('Shipping rate must be 0 or greater.'); return; }
    if (vals.customs_duty_rate !== '' && !(d >= 0))           { setErr('Customs duty must be 0 or greater.'); return; }
    onApply(rows);
  };

  const cellSt = { padding:'8px 12px', fontSize:12, fontFamily:'var(--font-mono)', whiteSpace:'nowrap' };
  const thSt   = { padding:'8px 12px', textAlign:'left', fontSize:10, color:t.t4, fontFamily:'var(--font-mono)',
                   textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap' };

  return (
    <motion.div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:200,
               display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
      initial={{ opacity:0 }} animate={{ opacity:1 }}
      onClick={onClose}
    >
      <motion.div
        style={{ background:t.bg2, border:`1px solid ${t.b2}`, borderRadius:16,
                 width:'100%', maxWidth:860, maxHeight:'86vh', display:'flex', flexDirection:'column', overflow:'hidden' }}
        initial={{ scale:0.96, opacity:0 }} animate={{ scale:1, opacity:1 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding:'22px 26px 18px', borderBottom:`1px solid ${t.b1}` }}>
          <div style={{ fontSize:17, fontWeight:600, color:t.t1, marginBottom:4 }}>
            Bulk edit — {items.length} item{items.length !== 1 ? 's' : ''}
          </div>
          <div style={{ fontSize:12.5, color:t.t4 }}>
            Leave a field blank to keep each item's current value. Prices recalculate automatically.
          </div>
        </div>

        {/* Inputs */}
        <div style={{ padding:'20px 26px', borderBottom:`1px solid ${t.b1}`,
                      display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:14 }}>
          {FIELDS.map(({ key, label, ph, hint }) => (
            <div key={key} style={fg}>
              <label style={lbl}>{label}</label>
              <input
                style={inp(String(vals[key]).trim() !== '', false)}
                type="text" inputMode="decimal" placeholder={`unchanged (${ph})`}
                value={vals[key]}
                onChange={e => set(key, e.target.value)}
              />
              <span style={sub}>{hint}</span>
            </div>
          ))}
        </div>

        {err && (
          <div style={{ margin:'14px 26px 0', background:'rgba(242,100,100,0.08)',
                        border:'1px solid rgba(242,100,100,0.25)', borderRadius:8,
                        padding:'10px 14px', fontSize:12.5, color:t.red }}>{err}</div>
        )}

        {overriddenCount > 0 && (
          <div style={{ margin:'14px 26px 0', background:'rgba(245,166,35,0.07)',
                        border:'1px solid rgba(245,166,35,0.25)', borderRadius:8,
                        padding:'10px 14px', fontSize:12.5, color:t.amber }}>
            {overriddenCount} selected item{overriddenCount !== 1 ? 's have' : ' has'} a manual UAE price override —
            cost inputs will update but the price stays as entered.
          </div>
        )}

        {/* Preview */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px 26px 0' }}>
          <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase',
                        letterSpacing:'0.1em', fontWeight:600, marginBottom:10 }}>Preview</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${t.b2}` }}>
                {['Item code','Margin %','UAE inc VAT','','Gross margin',''].map((h, i) => (
                  <th key={i} style={thSt}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, merged, beforeIncVat, afterIncVat, beforeMargin, afterMargin }) => {
                const bf = formatMargin(beforeMargin), af = formatMargin(afterMargin);
                const priceChanged = beforeIncVat !== afterIncVat;
                const curMargin = item.target_margin_pct ?? DEFAULT_PROJECT_MARGIN_PCT;
                return (
                  <tr key={item.item_code} style={{ borderBottom:`1px solid ${t.b1}` }}>
                    <td style={{ ...cellSt, color:t.blue }}>{item.item_code}</td>
                    <td style={{ ...cellSt, color:t.t2 }}>
                      {curMargin}%
                      {merged.target_margin_pct !== curMargin && (
                        <span style={{ color:t.t1 }}> → {merged.target_margin_pct}%</span>
                      )}
                    </td>
                    <td style={{ ...cellSt, color:t.t4 }}>
                      {money(beforeIncVat, 'AED')}
                    </td>
                    <td style={{ ...cellSt, color: priceChanged ? t.t1 : t.t4 }}>
                      {priceChanged ? `→ ${money(afterIncVat, 'AED')}` : ''}
                    </td>
                    <td style={{ ...cellSt, color:MARGIN_COLORS[bf.status] }}>{bf.label}</td>
                    <td style={{ ...cellSt, color:MARGIN_COLORS[af.status] }}>→ {af.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div style={{ padding:'18px 26px', borderTop:`1px solid ${t.b1}`, display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button style={btnG} onClick={onClose}>Cancel</button>
          <button
            style={{ ...btnW, opacity: (saving || !touched) ? 0.5 : 1, cursor: saving ? 'default' : 'pointer' }}
            onClick={handleApply}
            disabled={saving}
          >{saving ? 'Applying…' : `Apply to ${items.length} item${items.length !== 1 ? 's' : ''}`}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
