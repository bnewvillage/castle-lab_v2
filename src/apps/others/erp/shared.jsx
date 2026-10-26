// What the two ERP pages (Price Lists, Catalogue Checks) share: the price-list
// reports, report fetching and code matching, one run's state, and the small
// pieces of UI every section uses.
import { useState, useEffect } from 'react';
import { t, inp, btnW, btnG, groupBox, groupHead } from '../../pricing/styles';
import { fetchBrands } from '../../../lib/db';
import { callErpProxy } from '../../../lib/erpProxy';
import { MARKETS } from '../../../lib/markets';
import { DEMO } from '../../../demo/demoConfig';
import { demoErpReport } from '../../../demo/demoErp';

// One ERP price list per market. Until a market's report exists in the ERP it
// is skipped with "not set up in the ERP yet" and the other lists carry on
// (fetchReportsIndependently).
export const PRICE_REPORTS = MARKETS.map(m => ({ key: m.key, name: m.report, dbField: m.price, currency: m.currency }));

export async function fetchReport(email, password, report_name) {
  if (DEMO) return demoErpReport(report_name);
  const json = await callErpProxy(email, password, { report_name });
  return json.rows;
}

// Matching is case-insensitive. pricing_master stores item_code uppercased,
// while an ERP report returns whatever casing the ERP holds — so
// BTMO-Flasher-HONDA-EU4/EU5 must still find BTMO-FLASHER-HONDA-EU4/EU5. Only
// the lookup is normalised; an emitted row keeps the ERP's own spelling,
// because the export is uploaded back into the ERP.
export const codeKey = (v) => String(v ?? '').trim().toUpperCase();

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * One run of a section: its state, log lines, error and result. `run(work)`
 * calls work(log) and keeps what it returns as the result; a throw becomes the
 * error. A second run while one is going is ignored.
 */
export function useJob() {
  const [state,  setState]  = useState('idle');
  const [result, setResult] = useState(null);
  const [log,    setLog]    = useState([]);
  const [err,    setErr]    = useState('');
  const run = async (work) => {
    if (state === 'loading') return;
    setState('loading'); setErr(''); setLog([]); setResult(null);
    try {
      setResult(await work(m => setLog(p => [...p, m])));
      setState('done');
    } catch (e) {
      setErr(e.message || 'Unknown error');
      setState('error');
    }
  };
  return { log, err, result: state === 'done' ? result : null, loading: state === 'loading', run };
}

export function useBrandList() {
  const [brands, setBrands] = useState([]);
  useEffect(() => { fetchBrands().then(setBrands).catch(() => {}); }, []);
  return brands;
}

// Optional brand narrowing. Empty selection means every brand, so the default
// behaviour is unchanged.
export function BrandMultiSelect({ brands, selected, onChange }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const shown = brands.filter(b =>
    !query.trim() ||
    b.brand_code.toLowerCase().includes(query.trim().toLowerCase()) ||
    (b.brand_name || '').toLowerCase().includes(query.trim().toLowerCase()));

  const toggle = (code) => onChange(
    selected.includes(code) ? selected.filter(c => c !== code) : [...selected, code]);

  const label = selected.length === 0
    ? 'All brands'
    : selected.length <= 2 ? selected.join(', ') : `${selected.length} brands`;

  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ ...btnG, padding:'7px 12px', fontSize:12.5, whiteSpace:'nowrap',
          color: selected.length ? t.blue : t.t3,
          borderColor: selected.length ? 'rgba(77,159,255,0.3)' : t.b2 }}>
        {label} ▾
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)}
            style={{ position:'fixed', inset:0, zIndex:20 }} />
          <div style={{ position:'absolute', top:'100%', left:0, marginTop:6, zIndex:21,
            background:t.bg3, border:`1px solid ${t.b2}`, borderRadius:10, padding:10,
            width:280, boxShadow:'0 8px 24px rgba(0,0,0,0.4)' }}>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Filter brands..." autoFocus
              style={{ ...inp(!!query, false), marginBottom:8, fontSize:12.5, padding:'7px 10px' }} />
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <button onClick={() => onChange(shown.map(b => b.brand_code))}
                style={{ ...btnG, padding:'4px 10px', fontSize:11 }}>Select shown</button>
              <button onClick={() => onChange([])}
                style={{ ...btnG, padding:'4px 10px', fontSize:11 }}>Clear</button>
            </div>
            <div style={{ maxHeight:240, overflowY:'auto' }}>
              {shown.map(b => (
                <label key={b.brand_code}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 4px',
                    cursor:'pointer', fontSize:12.5, color:t.t2 }}>
                  <input type="checkbox" checked={selected.includes(b.brand_code)}
                    onChange={() => toggle(b.brand_code)} />
                  <span style={{ fontFamily:'var(--font-mono)', color:t.t1 }}>{b.brand_code}</span>
                  <span style={{ color:t.t4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {b.brand_name}
                  </span>
                </label>
              ))}
              {shown.length === 0 && (
                <div style={{ fontSize:12, color:t.t4, padding:'6px 4px' }}>No brands match.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function StatPill({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      background: t.bg3, border: `1px solid ${t.b2}`, borderRadius: 10,
      padding: '12px 20px', minWidth: 90,
    }}>
      <span style={{ fontSize: 20, fontWeight: 500, color: color || t.t1, fontFamily: 'var(--font-mono)' }}>{value}</span>
      <span style={{ fontSize: 10, color: t.t4, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>{label}</span>
    </div>
  );
}

export function LogBox({ lines, progress }) {
  if (!lines.length && !progress) return null;
  return (
    <div style={{ marginTop: 12, background: t.bg1, border: `1px solid ${t.b1}`, borderRadius: 8, padding: '12px 16px' }}>
      {lines.map((line, i) => (
        <div key={i} style={{ fontSize: 12, color: t.t3, fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>{line}</div>
      ))}
      {progress && (
        <div style={{ fontSize: 12, color: t.t2, fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>{progress}</div>
      )}
    </div>
  );
}

export function ErrBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ marginTop: 12, background: 'rgba(242,100,100,0.08)', border: '1px solid rgba(242,100,100,0.3)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: t.red }}>
      {msg}
    </div>
  );
}

export function RunBtn({ label, loading, disabled, onClick }) {
  const off = disabled || loading;
  return (
    <button
      onClick={onClick}
      disabled={off}
      style={{ ...btnW, opacity: off ? 0.4 : 1, cursor: off ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 16 }}
    >
      {loading ? 'Working...' : label}
    </button>
  );
}

// A section's frame: title and description on the left, its controls on the
// right. `tight` drops the gap under the description once a log shows.
export function Section({ title, description, controls, tight, children }) {
  return (
    <div style={{ ...groupBox(false), marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ ...groupHead, marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 12, color: t.t4, marginBottom: tight ? 0 : 4 }}>{description}</div>
        </div>
        {controls}
      </div>
      {children}
    </div>
  );
}
