import { t, inp, sel, btnW, btnG, lbl, groupBox, groupHead, CURRENCIES } from '../styles';
import BrandSelect from '../BrandSelect';
import { SOURCES, PASTE_PRICE_USED } from '../../../lib/bulkImport';

const PASTE_COLS = [
  { k:'sku',                  label:'SKU *',          ph:'ABC123' },
  { k:'item_name',            label:'Item name',      ph:'Description' },
  { k:'exw_cost',             label:'EXW cost *',     ph:'120.50' },
  { k:'msrp_primary_ex_vat',  label:'MSRP ex VAT',    ph:'400' },
  { k:'msrp_primary_inc_vat', label:'MSRP inc VAT',   ph:'480' },
  { k:'barcode',              label:'Barcode',        ph:'5901234123457' },
];

const pasteBox = {
  width:'100%', minHeight:300, resize:'vertical',
  background:t.bg2, border:`1px solid ${t.b2}`, borderRadius:8,
  padding:'10px 12px', fontSize:12.5, lineHeight:1.7,
  color:t.t1, fontFamily:'var(--font-mono)',
  outline:'none', boxSizing:'border-box', whiteSpace:'pre',
};

export default function PastePanel({ paste, setPasteField, opts, setOpt, brands, processing, isViewer, onProcess }) {
  const skuCount = paste.sku.split('\n').filter(s => s.trim()).length;
  const isCostBased = opts.price_used === 'cost_based';
  const ready = skuCount > 0 && opts.brand_code && !processing && !isViewer;

  const Field = ({ label, hint, children }) => (
    <div style={{ flex:'1 1 150px', minWidth:140 }}>
      <label style={lbl}>{label}</label>
      {children}
      {hint && <div style={{ fontSize:10, color:t.t4, marginTop:4, fontFamily:'var(--font-mono)' }}>{hint}</div>}
    </div>
  );

  return (
    <>
      {/* Options applied to every pasted row */}
      <div style={{ ...groupBox(false), marginBottom:16 }}>
        <div style={{ ...groupHead, marginBottom:14 }}>
          Applied to every row
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
          <Field label="Brand *">
            <BrandSelect brands={brands} value={opts.brand_code}
              onChange={v => setOpt('brand_code', v)} hasError={!opts.brand_code} />
          </Field>
          <Field label="MSRP source *" hint={isCostBased ? 'derived from cost' : undefined}>
            <select value={opts.price_used} onChange={e=>setOpt('price_used', e.target.value)}
              style={sel(true,false)}>
              {PASTE_PRICE_USED.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Cost currency *">
            <select value={opts.cost_currency} onChange={e=>setOpt('cost_currency', e.target.value)} style={sel(true,false)}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="MSRP currency" hint={isCostBased ? 'unused' : undefined}>
            <select value={opts.msrp_primary_currency} onChange={e=>setOpt('msrp_primary_currency', e.target.value)}
              style={{ ...sel(true,false), opacity: isCostBased ? 0.5 : 1 }} disabled={isCostBased}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Cost source">
            <select value={opts.cost_source} onChange={e=>setOpt('cost_source', e.target.value)} style={sel(!!opts.cost_source,false)}>
              <option value="">—</option>
              {SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Price source">
            <select value={opts.price_source} onChange={e=>setOpt('price_source', e.target.value)} style={sel(!!opts.price_source,false)}>
              <option value="">—</option>
              {SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Shipping %" hint="default 0">
            <input value={opts.shipping_rate} onChange={e=>setOpt('shipping_rate', e.target.value)}
              placeholder="0" style={inp(!!opts.shipping_rate,false)} />
          </Field>
          <Field label="Customs %" hint="default 5.5">
            <input value={opts.customs_duty_rate} onChange={e=>setOpt('customs_duty_rate', e.target.value)}
              placeholder="5.5" style={inp(!!opts.customs_duty_rate,false)} />
          </Field>
          {isCostBased && (
            <Field label="Target margin %" hint="default 25">
              <input value={opts.target_margin_pct} onChange={e=>setOpt('target_margin_pct', e.target.value)}
                placeholder="25" style={inp(!!opts.target_margin_pct,false)} />
            </Field>
          )}
        </div>
      </div>

      {/* Pasted columns */}
      <div style={{ ...groupBox(false), marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap', marginBottom:14 }}>
          <div>
            <div style={{ ...groupHead, marginBottom:4 }}>Paste columns</div>
            <div style={{ fontSize:12, color:t.t4 }}>
              One row per line. Columns join by line number — leave a line blank to skip that field, not the row.
            </div>
          </div>
          <button
            onClick={onProcess}
            disabled={!ready}
            style={{ ...btnW, opacity: ready?1:0.4, cursor: ready?'pointer':'not-allowed', whiteSpace:'nowrap' }}
          >{processing ? 'Processing...' : `Process ${skuCount} row${skuCount===1?'':'s'} →`}</button>
        </div>

        <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'flex-start' }}>
          {PASTE_COLS.map(({ k, label, ph }) => {
            const n = paste[k].split('\n').filter(s => s.trim()).length;
            const mismatch = k !== 'sku' && n > 0 && n !== skuCount;
            return (
              <div key={k} style={{ flex:'1 1 150px', minWidth:140 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:6 }}>
                  <label style={{ ...lbl, marginBottom:6 }}>{label}</label>
                  {n > 0 && (
                    <span style={{ fontSize:10, marginBottom:6, fontFamily:'var(--font-mono)', color: mismatch ? t.amber : t.t4 }}>{n}</span>
                  )}
                </div>
                <textarea
                  value={paste[k]}
                  onChange={e => setPasteField(k, e.target.value)}
                  placeholder={ph}
                  spellCheck={false}
                  style={{ ...pasteBox, borderColor: mismatch ? 'rgba(245,166,35,0.4)' : t.b2 }}
                />
              </div>
            );
          })}
        </div>

        {!opts.brand_code && skuCount > 0 && (
          <div style={{ marginTop:12, fontSize:12, color:t.amber }}>Pick a brand — item codes are built as BRAND-SKU.</div>
        )}
      </div>
    </>
  );
}
