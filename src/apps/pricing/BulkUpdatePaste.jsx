import { useState, useEffect } from 'react';
import { toNum } from '../../lib/num';
import * as XLSX from 'xlsx-js-style';
import { fetchBrands, fetchRates, fetchItemsByCodes, bulkUpdateItemFields } from '../../lib/db';
import { calcMSRPs, calcCostBasedMSRPs, DEFAULT_COST_MARGIN_PCT, resolvePriceUsed } from '../../lib/pricing';
import { t, inp, sel, btnW, btnG, lbl, groupBox, groupHead, CURRENCIES } from './styles';
import BrandSelect from './BrandSelect';

const SOURCES         = ['Portal','File','Website','Invoice','Estimate'];
const PRICE_USED_OPTS = ['primary_ex_vat','primary_inc_vat','cost_based'];
const NO_CHANGE       = '';   // sentinel for "leave this column alone"

// Columns pasted per row. A blank line leaves that field untouched for that item.
const PASTE_FIELDS = [
  { k:'sku',                  label:'Item code *',  ph:'ALPN-ABC123',   key:false },
  { k:'item_name',            label:'Item name',    ph:'Description',   key:true },
  { k:'exw_cost',             label:'EXW cost',     ph:'120.50',        key:true, num:true },
  { k:'msrp_primary_ex_vat',  label:'MSRP ex VAT',  ph:'400',           key:true, num:true },
  { k:'msrp_primary_inc_vat', label:'MSRP inc VAT', ph:'480',           key:true, num:true },
  { k:'barcode',              label:'Barcode',      ph:'5901234123457', key:true },
];
const ROW_FIELDS = PASTE_FIELDS.filter(f => f.key);

// Applied to every matched row. Left at NO_CHANGE they are never written.
const OPT_FIELDS = [
  { k:'cost_currency',         label:'Cost currency',   opts:CURRENCIES },
  { k:'msrp_primary_currency', label:'MSRP currency',   opts:CURRENCIES },
  { k:'price_used',            label:'MSRP source',     opts:PRICE_USED_OPTS },
  { k:'cost_source',           label:'Cost source',     opts:SOURCES },
  { k:'price_source',          label:'Price source',    opts:SOURCES },
  { k:'shipping_rate',         label:'Shipping %',      num:true, ph:'0' },
  { k:'customs_duty_rate',     label:'Customs %',       num:true, ph:'5.5' },
  { k:'target_margin_pct',     label:'Target margin %', num:true, ph:'25' },
];

const PRICE_COLS = [
  { k:'msrp_aed', label:'UAE price', flag:'uae_overridden' },
  { k:'msrp_sar', label:'KSA price', flag:'ksa_overridden' },
  { k:'msrp_qat', label:'QAT price', flag:'qat_overridden' },
];
const REAL_OF = { msrp_aed:'real_msrp_aed', msrp_sar:'real_msrp_sar', msrp_qat:'real_msrp_qat' };

// Only these feed the price calculation. Editing a name or barcode must never
// trigger a price rewrite off whatever happens to be stored.
const PRICE_INPUTS = new Set([
  'exw_cost','msrp_primary_ex_vat','msrp_primary_inc_vat',
  'cost_currency','msrp_primary_currency','price_used','target_margin_pct',
]);
const ALL_FIELDS = [...ROW_FIELDS, ...OPT_FIELDS];
const LABELS = Object.fromEntries([...ALL_FIELDS, ...PRICE_COLS].map(f => [f.k, f.label]));
const isNumField = (k) => !!ALL_FIELDS.find(f => f.k === k)?.num;

const box = {
  width:'100%', minHeight:280, resize:'vertical',
  background:t.bg2, border:`1px solid ${t.b2}`, borderRadius:8,
  padding:'10px 12px', fontSize:12.5, lineHeight:1.7,
  color:t.t1, fontFamily:'var(--font-mono)',
  outline:'none', boxSizing:'border-box', whiteSpace:'pre',
};

const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

// Numeric fields compare as numbers so "1,250", 1250 and "1250.00" are the same value.
function sameValue(a, b, isNum) {
  if (isNum) {
    const x = toNum(a), y = toNum(b);
    if (x === null && y === null) return true;
    if (x === null || y === null) return false;
    return Math.abs(x - y) < 1e-9;
  }
  return String(a ?? '').trim() === String(b ?? '').trim();
}

function recalcPrices(merged, markup, additional, rates) {
  try {
    if (merged.price_used === 'cost_based') {
      return calcCostBasedMSRPs(
        toNum(merged.exw_cost), merged.cost_currency,
        toNum(merged.target_margin_pct) ?? DEFAULT_COST_MARGIN_PCT, rates, additional,
      );
    }
    const { value, currency } = resolvePriceUsed(merged);
    if (value == null || !currency) return null;
    return calcMSRPs(value, currency, markup ?? 10, additional, rates);
  } catch { return null; }
}

// SKUs go out as text-formatted cells so Excel cannot mangle numeric-looking codes.
function downloadNotFound(codes) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['sku'], ...codes.map(c => [c])]);
  codes.forEach((_, i) => {
    const addr = XLSX.utils.encode_cell({ r: i + 1, c: 0 });
    if (ws[addr]) { ws[addr].t = 's'; ws[addr].s = { numFmt: '@' }; }
  });
  ws['!cols'] = [{ wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Not found');
  XLSX.writeFile(wb, `not_found_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function Pill({ label, value, color }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4,
      background:t.bg3, border:`1px solid ${t.b2}`, borderRadius:10, padding:'10px 18px', minWidth:88 }}>
      <span style={{ fontSize:18, fontWeight:500, color:color||t.t1, fontFamily:'var(--font-mono)' }}>{value}</span>
      <span style={{ fontSize:10, color:t.t4, textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:'var(--font-mono)' }}>{label}</span>
    </div>
  );
}
export default function BulkUpdatePaste({ onToast, isViewer }) {
  const [paste, setPaste] = useState(Object.fromEntries(PASTE_FIELDS.map(f => [f.k, ''])));
  const [opts,  setOpts]  = useState({
    brand_code: '', ...Object.fromEntries(OPT_FIELDS.map(f => [f.k, NO_CHANGE])),
  });
  const [brands, setBrands] = useState([]);
  const [plan,   setPlan]   = useState(null);
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');
  const [done,   setDone]   = useState(null);

  useEffect(() => { fetchBrands().then(setBrands).catch(e => setErr(e.message)); }, []);

  const setField = (k, v) => { setPaste(p => ({ ...p, [k]: v })); setPlan(null); setDone(null); };
  const setOpt   = (k, v) => { setOpts(p => ({ ...p, [k]: v }));  setPlan(null); setDone(null); };

  const skuCount = paste.sku.split('\n').filter(s => s.trim()).length;

  const buildPlan = async () => {
    setBusy(true); setErr(''); setPlan(null); setDone(null);
    try {
      // Line index joins the columns, so split on newlines only.
      const lines = Object.fromEntries(PASTE_FIELDS.map(f => [f.k, paste[f.k].split('\n').map(s => s.trim())]));
      const brand = opts.brand_code.toUpperCase().trim();

      const entries = [];
      lines.sku.forEach((sku, i) => { if (sku) entries.push({ sku, i }); });
      if (!entries.length) { setErr('No item codes pasted.'); setBusy(false); return; }

      // Brand is optional: with one set we try BRAND-SKU as well as the bare
      // code, so either form of paste resolves.
      const candidates = new Set();
      for (const e of entries) {
        candidates.add(e.sku.toUpperCase());
        if (brand) candidates.add(`${brand}-${e.sku}`.toUpperCase());
      }

      const [existing, rates, brandList] = await Promise.all([
        fetchItemsByCodes([...candidates]), fetchRates(), fetchBrands(),
      ]);
      const rules = Object.fromEntries(brandList.map(b => [b.brand_code, {
        markup:     b.brand_rules?.markup_percentage ?? 10,
        additional: b.brand_rules?.additional_markup_pct ?? null,
      }]));

      // Only fields the user is actually feeding are considered — everything
      // else is left alone and never appears in the summary.
      const fedRow = ROW_FIELDS.filter(f => lines[f.k].some(v => v !== ''));
      const fedOpt = OPT_FIELDS.filter(f => String(opts[f.k] ?? '').trim() !== '');
      if (!fedRow.length && !fedOpt.length) {
        setErr('Nothing to update — paste at least one column or set one override.');
        setBusy(false); return;
      }

      const changed = [], unchanged = [], notFound = [];

      for (const { sku, i } of entries) {
        const prefixed = brand ? `${brand}-${sku}`.toUpperCase() : null;
        const row = (prefixed && existing[prefixed]) || existing[sku.toUpperCase()] || null;
        if (!row) { notFound.push(sku); continue; }

        const incoming = {};
        for (const f of fedRow) {
          const v = lines[f.k][i];
          if (v !== undefined && v !== '') incoming[f.k] = v;
        }
        for (const f of fedOpt) incoming[f.k] = opts[f.k];

        const diffs = [];
        for (const [k, v] of Object.entries(incoming)) {
          if (!sameValue(row[k], v, isNumField(k))) {
            diffs.push({ field:k, from:row[k], to:isNumField(k) ? toNum(v) : v, computed:false });
          }
        }

        // Recalculate market prices from the merged row — a cost or MSRP change
        // that did not flow through would leave msrp_aed/sar/qat stale.
        const merged = { ...row };
        for (const [k, v] of Object.entries(incoming)) merged[k] = isNumField(k) ? toNum(v) : v;
        const rule   = rules[row.brand_code] || {};
        const touchesPrice = diffs.some(d => PRICE_INPUTS.has(d.field));
        const prices = touchesPrice ? recalcPrices(merged, rule.markup, rule.additional, rates) : null;
        if (prices) {
          for (const pc of PRICE_COLS) {
            // A manually overridden market price stays put — recalculating it
            // would silently discard the override.
            if (row[pc.flag]) continue;
            if (!sameValue(row[pc.k], prices[pc.k], true)) {
              diffs.push({ field:pc.k, from:row[pc.k], to:prices[pc.k], computed:true, real:prices[REAL_OF[pc.k]] });
            }
          }
        }

        if (diffs.length) changed.push({ item_code: row.item_code, sku, diffs });
        else unchanged.push({ item_code: row.item_code, sku });
      }

      setPlan({ changed, unchanged, notFound });
    } catch (e) {
      setErr(e.message || 'Failed to build update plan');
    } finally { setBusy(false); }
  };

  const push = async () => {
    if (!plan?.changed.length || busy) return;
    setBusy(true); setErr('');
    try {
      const updates = plan.changed.map(c => {
        const patch = { item_code: c.item_code };
        for (const d of c.diffs) {
          patch[d.field] = d.to;
          if (d.computed && REAL_OF[d.field]) patch[REAL_OF[d.field]] = d.real ?? null;
        }
        return patch;
      });
      await bulkUpdateItemFields(updates);
      const n = updates.length;
      setDone(n); setPlan(null);
      onToast?.(`${n} item${n===1?'':'s'} updated`);
    } catch (e) {
      setErr(e.message || 'Update failed');
    } finally { setBusy(false); }
  };

  const Field = ({ label, children }) => (
    <div style={{ flex:'1 1 150px', minWidth:140, display:'flex', flexDirection:'column' }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );

  const hasComputed = plan?.changed.some(c => c.diffs.some(d => d.computed));
  return (
    <>
      {err && <div style={{ background:'rgba(242,100,100,0.08)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:8, padding:'12px 16px', color:t.red, fontSize:13, marginBottom:16 }}>{err}</div>}
      {done != null && <div style={{ background:'rgba(62,207,142,0.08)', border:'1px solid rgba(62,207,142,0.3)', borderRadius:8, padding:'12px 16px', color:t.green, fontSize:13, marginBottom:16 }}>{done} item{done===1?'':'s'} updated.</div>}

      <div style={{ ...groupBox(false), marginBottom:16 }}>
        <div style={{ ...groupHead, marginBottom:4 }}>Optional overrides</div>
        <div style={{ fontSize:12, color:t.t4, marginBottom:14 }}>
          Anything left blank is not written. Nothing here is required.
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
          <Field label="Brand prefix">
            <BrandSelect brands={brands} value={opts.brand_code} nullable
              onChange={v => setOpt('brand_code', v)} placeholder="None" />
          </Field>
          {OPT_FIELDS.map(f => (
            <Field key={f.k} label={f.label}>
              {f.opts ? (
                <select value={opts[f.k]} onChange={e => setOpt(f.k, e.target.value)} style={sel(!!opts[f.k], false)}>
                  <option value={NO_CHANGE}>— no change</option>
                  {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input value={opts[f.k]} onChange={e => setOpt(f.k, e.target.value)}
                  placeholder={f.ph} style={inp(!!opts[f.k], false)} />
              )}
            </Field>
          ))}
        </div>
      </div>

      <div style={{ ...groupBox(false), marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap', marginBottom:14 }}>
          <div>
            <div style={{ ...groupHead, marginBottom:4 }}>Paste columns</div>
            <div style={{ fontSize:12, color:t.t4 }}>
              Matched on item code. A blank line leaves that field as it is — only the item code column is required.
            </div>
          </div>
          <button onClick={buildPlan} disabled={!skuCount || busy || isViewer}
            style={{ ...btnW, opacity:(!skuCount||busy||isViewer)?0.4:1, cursor:(!skuCount||busy||isViewer)?'not-allowed':'pointer', whiteSpace:'nowrap' }}>
            {busy && !plan ? 'Checking...' : `Preview ${skuCount} row${skuCount===1?'':'s'} →`}
          </button>
        </div>

        <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'flex-start' }}>
          {PASTE_FIELDS.map(f => {
            const n = paste[f.k].split('\n').filter(s => s.trim()).length;
            const mismatch = f.k !== 'sku' && n > 0 && n !== skuCount;
            return (
              <div key={f.k} style={{ flex:'1 1 150px', minWidth:140 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:6 }}>
                  <label style={{ ...lbl, marginBottom:6 }}>{f.label}</label>
                  {n > 0 && <span style={{ fontSize:10, marginBottom:6, fontFamily:'var(--font-mono)', color:mismatch?t.amber:t.t4 }}>{n}</span>}
                </div>
                <textarea value={paste[f.k]} onChange={e => setField(f.k, e.target.value)}
                  placeholder={f.ph} spellCheck={false}
                  style={{ ...box, borderColor: mismatch ? 'rgba(245,166,35,0.4)' : t.b2 }} />
              </div>
            );
          })}
        </div>
      </div>

      {plan && (
        <div style={groupBox(false)}>
          <div style={{ ...groupHead, marginBottom:14 }}>Before commit</div>

          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
            <Pill label="will change" value={plan.changed.length}   color={plan.changed.length ? t.green : t.t1} />
            <Pill label="no change"   value={plan.unchanged.length} color={t.t3} />
            {plan.notFound.length > 0 && <Pill label="not found" value={plan.notFound.length} color={t.red} />}
          </div>

          {plan.notFound.length > 0 && (
            <div style={{ background:'rgba(242,100,100,0.06)', border:'1px solid rgba(242,100,100,0.25)', borderRadius:8, padding:'14px 16px', marginBottom:16 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, flexWrap:'wrap' }}>
                <div style={{ fontSize:13, color:t.t2 }}>
                  {plan.notFound.length} item code{plan.notFound.length===1?' is':'s are'} not in the pricing master — {plan.notFound.length===1?'it':'they'} will be skipped.
                </div>
                <button style={{ ...btnG, whiteSpace:'nowrap' }} onClick={() => downloadNotFound(plan.notFound)}>
                  ↓ Download not found (.xlsx)
                </button>
              </div>
              <div style={{ marginTop:10, fontSize:11.5, color:t.t4, fontFamily:'var(--font-mono)', maxHeight:80, overflowY:'auto', lineHeight:1.7 }}>
                {plan.notFound.slice(0, 40).join(', ')}{plan.notFound.length > 40 ? ` … +${plan.notFound.length - 40} more` : ''}
              </div>
            </div>
          )}

          {plan.changed.length > 0 && (
            <div style={{ border:`1px solid ${t.b1}`, borderRadius:8, maxHeight:420, overflowY:'auto', marginBottom:12 }}>
              {plan.changed.map(c => (
                <div key={c.item_code} style={{ borderTop:`1px solid ${t.b1}`, padding:'10px 14px' }}>
                  <div style={{ fontSize:12.5, color:t.blue, fontFamily:'var(--font-mono)', marginBottom:6 }}>{c.item_code}</div>
                  {c.diffs.map(d => (
                    <div key={d.field} style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 1fr', gap:8, padding:'3px 0', fontSize:12, fontFamily:'var(--font-mono)', alignItems:'center' }}>
                      <span style={{ color:d.computed ? t.amber : t.t3 }}>
                        {d.computed ? '↳ ' : ''}{LABELS[d.field] || d.field}
                      </span>
                      <span style={{ color:t.t4, textDecoration:'line-through' }}>{fmt(d.from)}</span>
                      <span style={{ color:t.green }}>{fmt(d.to)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {hasComputed && (
            <div style={{ fontSize:11.5, color:t.t4, marginBottom:16, lineHeight:1.6 }}>
              <span style={{ color:t.amber }}>↳</span> recalculated from the new values. Market prices carrying a manual override are left untouched.
            </div>
          )}

          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <button onClick={push} disabled={!plan.changed.length || busy || isViewer}
              style={{ ...btnW, opacity:(!plan.changed.length||busy||isViewer)?0.4:1, cursor:(!plan.changed.length||busy||isViewer)?'not-allowed':'pointer' }}>
              {busy ? 'Pushing...' : `Push ${plan.changed.length} update${plan.changed.length===1?'':'s'}`}
            </button>
            <button style={btnG} onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}