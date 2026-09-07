import { useState, useEffect } from 'react';
import { toNum } from '../../lib/num';
import * as XLSX from 'xlsx-js-style';
import { fetchItemsByCodes, fetchItemsForOverride, bulkUpdateItemFields, fetchBrands } from '../../lib/db';
import { suggestKSAPrice, suggestQATPrice } from '../../lib/pricing';
import { t, inp, btnW, btnG, lbl, groupBox, groupHead } from './styles';
import BrandSelect from './BrandSelect';

const pf2   = (v) => (v != null ? parseFloat(v.toFixed(2)) : null);
const fmt   = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString());

// Rendering every row of a 90k-item filter would lock the tab, so the diff list
// is capped — the counts above it still reflect the whole set.
const PREVIEW_CAP = 200;
const MATCH_CAP   = 500;   // rows rendered in the match list, same reason

// KSA/QAT derive from AED only — the app has no inverse formula — so UAE has no
// "auto" mode and is always either given explicitly or left as stored.
const MARKETS = [
  { k:'uae', label:'UAE (AED)', field:'msrp_aed', flag:'uae_overridden', auto:false },
  { k:'ksa', label:'KSA (SAR)', field:'msrp_sar', flag:'ksa_overridden', auto:true, derive:suggestKSAPrice },
  { k:'qat', label:'QAT (QAR)', field:'msrp_qat', flag:'qat_overridden', auto:true, derive:suggestQATPrice },
];

const box = {
  width:'100%', minHeight:240, resize:'vertical',
  background:t.bg2, border:`1px solid ${t.b2}`, borderRadius:8,
  padding:'10px 12px', fontSize:12.5, lineHeight:1.7,
  color:t.t1, fontFamily:'var(--font-mono)',
  outline:'none', boxSizing:'border-box', whiteSpace:'pre',
};

const same = (a, b) => {
  const x = toNum(a), y = toNum(b);
  if (x === null && y === null) return true;
  if (x === null || y === null) return false;
  return Math.abs(x - y) < 1e-9;
};

function downloadNotFound(codes) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['sku'], ...codes.map(c => [c])]);
  codes.forEach((_, i) => {
    const addr = XLSX.utils.encode_cell({ r: i + 1, c: 0 });
    if (ws[addr]) { ws[addr].t = 's'; ws[addr].s = { numFmt: '@' }; }
  });
  ws['!cols'] = [{ wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Not found');
  XLSX.writeFile(wb, `override_not_found_${new Date().toISOString().slice(0,10)}.xlsx`);
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

function Seg({ choices, value, onChange }) {
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
      {choices.map(c => (
        <button key={c.k} onClick={() => onChange(c.k)}
          style={{ ...btnG, padding:'6px 12px', fontSize:12,
            background: value===c.k ? 'rgba(77,159,255,0.09)' : 'transparent',
            borderColor: value===c.k ? 'rgba(77,159,255,0.3)' : t.b2,
            color: value===c.k ? t.blue : t.t3 }}>
          {c.label}
        </button>
      ))}
    </div>
  );
}
export default function MassOverride({ onToast, isViewer }) {
  const [selectMode, setSelectMode] = useState('paste');   // 'paste' | 'filter'
  const [modes, setModes] = useState({ uae:'value', ksa:'auto', qat:'auto' });
  const [cols,  setCols]  = useState({ sku:'', uae:'', ksa:'', qat:'' });
  const [single, setSingle] = useState({ uae:'', ksa:'', qat:'' });

  const [filter, setFilter]         = useState({ brandCode:'', search:'' });
  const [matches, setMatches]       = useState(null);   // rows from the filter
  const [brands, setBrands]         = useState([]);

  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => { fetchBrands().then(setBrands).catch(e => setErr(e.message)); }, []);

  const reset    = () => { setPlan(null); setDone(null); };
  const setMode  = (k, v) => { setModes(m => ({ ...m, [k]: v })); reset(); };
  const setCol   = (k, v) => { setCols(c => ({ ...c, [k]: v }));  reset(); };
  const setVal   = (k, v) => { setSingle(s => ({ ...s, [k]: v })); reset(); };
  const setFilt  = (k, v) => { setFilter(f => ({ ...f, [k]: v })); setMatches(null); reset(); };

  const skuCount = cols.sku.split('\n').filter(s => s.trim()).length;
  const anyWrite = MARKETS.some(m => modes[m.k] !== 'keep');
  const needsBase = MARKETS.some(m => m.auto && modes[m.k] === 'auto');
  // In filter mode a per-row column makes no sense — one value covers the set.
  const explicitLabel = selectMode === 'filter' ? 'Set one value' : 'Paste values';

  const findMatches = async () => {
    setBusy(true); setErr(''); setMatches(null); reset();
    try {
      const rows = await fetchItemsForOverride({
        brandCode: filter.brandCode || undefined,
        search:    filter.search || undefined,
      });
      setMatches(rows);
    } catch (e) {
      setErr(e.message || 'Search failed');
    } finally { setBusy(false); }
  };

  const buildPlan = async () => {
    setBusy(true); setErr(''); setPlan(null); setDone(null);
    try {
      if (!anyWrite) { setErr('Every market is set to leave unchanged — nothing to write.'); setBusy(false); return; }

      let rows, lineOf = null, notFound = [];

      if (selectMode === 'filter') {
        if (!matches?.length) { setErr('Run the search first.'); setBusy(false); return; }
        rows = matches;
      } else {
        const lines = Object.fromEntries(
          ['sku','uae','ksa','qat'].map(k => [k, cols[k].split('\n').map(s => s.trim())]),
        );
        const entries = [];
        lines.sku.forEach((sku, i) => { if (sku) entries.push({ sku, i }); });
        if (!entries.length) { setErr('No item codes pasted.'); setBusy(false); return; }
        const existing = await fetchItemsByCodes(entries.map(e => e.sku.toUpperCase()));
        rows = [];
        const idx = new Map();
        for (const { sku, i } of entries) {
          const row = existing[sku.toUpperCase()];
          if (!row) { notFound.push(sku); continue; }
          idx.set(row.item_code, i);
          rows.push(row);
        }
        lineOf = (row, k) => lines[k][idx.get(row.item_code)];
      }

      const changed = [], unchanged = [], noBase = [];

      for (const row of rows) {
        // The AED figure auto conversions key off: the explicit value if one is
        // given for this row, otherwise whatever is already stored.
        const explicitAed = modes.uae === 'value'
          ? toNum(selectMode === 'filter' ? single.uae : lineOf(row, 'uae'))
          : null;
        const baseAed = explicitAed ?? toNum(row.msrp_aed);
        if (needsBase && baseAed == null) { noBase.push(row.item_code); continue; }

        const targets = {};
        for (const m of MARKETS) {
          const mode = modes[m.k];
          if (mode === 'keep') continue;
          if (mode === 'value') {
            const v = toNum(selectMode === 'filter' ? single[m.k] : lineOf(row, m.k));
            if (v == null) continue;   // blank = skip this market for this row
            targets[m.field] = v;
          } else if (mode === 'auto' && m.derive) {
            targets[m.field] = pf2(m.derive(baseAed));
          }
        }

        const diffs = [];
        for (const m of MARKETS) {
          if (!(m.field in targets)) continue;
          if (!same(row[m.field], targets[m.field])) {
            diffs.push({ market:m.label, field:m.field, flag:m.flag, from:row[m.field], to:targets[m.field] });
          } else if (!row[m.flag]) {
            // Value already matches but is not pinned — still worth flagging so a
            // later recalculation cannot move it.
            diffs.push({ market:m.label, field:m.field, flag:m.flag, from:row[m.field], to:targets[m.field], flagOnly:true });
          }
        }

        if (diffs.length) changed.push({ item_code: row.item_code, diffs });
        else unchanged.push(row.item_code);
      }

      setPlan({ changed, unchanged, notFound, noBase });
    } catch (e) {
      setErr(e.message || 'Failed to build override plan');
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
          patch[d.flag]  = true;   // pin it — this is what "override" means here
        }
        return patch;
      });
      await bulkUpdateItemFields(updates);
      const n = updates.length;
      setDone(n); setPlan(null); setMatches(null);
      onToast?.(`${n} item${n===1?'':'s'} overridden`);
    } catch (e) {
      setErr(e.message || 'Override failed');
    } finally { setBusy(false); }
  };

  const pasteCols = [
    { k:'sku', label:'Item code *', ph:'ALPN-ABC123', show:true },
    ...MARKETS.map(m => ({ k:m.k, label:`${m.label} price`, ph:'1250', show: modes[m.k] === 'value' })),
  ].filter(c => c.show);

  const canPreview = !busy && !isViewer && anyWrite &&
    (selectMode === 'filter' ? !!matches?.length : skuCount > 0);
  return (
    <>
      {err && <div style={{ background:'rgba(242,100,100,0.08)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:8, padding:'12px 16px', color:t.red, fontSize:13, marginBottom:16 }}>{err}</div>}
      {done != null && <div style={{ background:'rgba(62,207,142,0.08)', border:'1px solid rgba(62,207,142,0.3)', borderRadius:8, padding:'12px 16px', color:t.green, fontSize:13, marginBottom:16 }}>{done} item{done===1?'':'s'} overridden.</div>}

      {/* Which items to target */}
      <div style={{ ...groupBox(false), marginBottom:16 }}>
        <div style={{ ...groupHead, marginBottom:12 }}>Select items</div>
        <Seg
          choices={[{ k:'paste', label:'By item code' }, { k:'filter', label:'By filter' }]}
          value={selectMode}
          onChange={v => { setSelectMode(v); setMatches(null); reset(); }}
        />

        {selectMode === 'filter' && (
          <div style={{ marginTop:14 }}>
            <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-start' }}>
              <div style={{ flex:'1 1 200px', minWidth:180, display:'flex', flexDirection:'column' }}>
                <label style={lbl}>Brand</label>
                <BrandSelect brands={brands} value={filter.brandCode} nullable
                  onChange={v => setFilt('brandCode', v)} placeholder="All brands" />
              </div>
              <div style={{ flex:'2 1 260px', minWidth:200, display:'flex', flexDirection:'column' }}>
                <label style={lbl}>Search</label>
                <input value={filter.search} onChange={e => setFilt('search', e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && findMatches()}
                  placeholder="Item code or name — A//B for several" style={inp(!!filter.search, false)} />
              </div>
              <div style={{ display:'flex', flexDirection:'column' }}>
                <label style={{ ...lbl, visibility:'hidden' }} aria-hidden="true">.</label>
                <button onClick={findMatches} disabled={busy}
                  style={{ ...btnG, height:42, whiteSpace:'nowrap', opacity:busy?0.5:1 }}>
                  {busy && matches === null ? 'Searching...' : 'Find matches'}
                </button>
              </div>
            </div>
            {matches && (
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:13, color: matches.length ? t.t2 : t.amber, marginBottom:10 }}>
                  {matches.length.toLocaleString()} item{matches.length===1?'':'s'} matched
                  {matches.length > 1000 && (
                    <span style={{ color:t.amber }}> — large set, review before pushing.</span>
                  )}
                </div>

                {matches.length > 0 && (
                  <div style={{ border:`1px solid ${t.b1}`, borderRadius:8, overflow:'hidden' }}>
                    <div style={{ overflowX:'auto', maxHeight:340, overflowY:'auto' }}>
                      <table style={{ width:'100%', borderCollapse:'collapse' }}>
                        <thead>
                          <tr>
                            {['Item code','Name','UAE (AED)','KSA (SAR)','QAT (QAR)'].map((h, i) => (
                              <th key={h} style={{
                                position:'sticky', top:0, zIndex:1, background:t.bg3,
                                textAlign: i > 1 ? 'right' : 'left',
                                padding:'8px 12px', fontSize:10, color:t.t4,
                                fontFamily:'var(--font-mono)', textTransform:'uppercase',
                                letterSpacing:'0.07em', fontWeight:500, whiteSpace:'nowrap',
                                borderBottom:`1px solid ${t.b1}`,
                              }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {matches.slice(0, MATCH_CAP).map((r, i) => (
                            <tr key={r.item_code} style={{ background: i % 2 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                              <td style={{ padding:'7px 12px', fontSize:12, color:t.blue, fontFamily:'var(--font-mono)', whiteSpace:'nowrap' }}>{r.item_code}</td>
                              <td style={{ padding:'7px 12px', fontSize:12, color:t.t2, maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.item_name}>{r.item_name || '—'}</td>
                              {MARKETS.map(m => (
                                <td key={m.k} style={{
                                  padding:'7px 12px', fontSize:12, textAlign:'right',
                                  fontFamily:'var(--font-mono)',
                                  color: r[m.flag] ? t.amber : t.t2, whiteSpace:'nowrap',
                                }} title={r[m.flag] ? 'Already pinned as an override' : undefined}>
                                  {fmt(r[m.field])}{r[m.flag] ? ' •' : ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {matches.length > MATCH_CAP && (
                  <div style={{ marginTop:8, fontSize:11.5, color:t.t4, fontFamily:'var(--font-mono)' }}>
                    showing first {MATCH_CAP} of {matches.length.toLocaleString()} — all matched items are included
                  </div>
                )}
                {matches.some(r => MARKETS.some(m => r[m.flag])) && (
                  <div style={{ marginTop:8, fontSize:11.5, color:t.t4 }}>
                    <span style={{ color:t.amber }}>•</span> already pinned as a manual override
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Markets */}
      <div style={{ ...groupBox(false), marginBottom:16 }}>
        <div style={{ ...groupHead, marginBottom:4 }}>Markets</div>
        <div style={{ fontSize:12, color:t.t4, marginBottom:14 }}>
          Every market written here is pinned as a manual override, so later recalculations leave it alone.
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:16 }}>
          {MARKETS.map(m => (
            <div key={m.k} style={{ flex:'1 1 220px', minWidth:200 }}>
              <label style={lbl}>{m.label}</label>
              <Seg
                choices={[
                  ...(m.auto ? [{ k:'auto', label:'Auto from AED' }] : []),
                  { k:'value', label:explicitLabel },
                  { k:'keep',  label:'Leave unchanged' },
                ]}
                value={modes[m.k]}
                onChange={v => setMode(m.k, v)}
              />
              {selectMode === 'filter' && modes[m.k] === 'value' && (
                <input value={single[m.k]} onChange={e => setVal(m.k, e.target.value)}
                  placeholder="1250" style={{ ...inp(!!single[m.k], false), marginTop:8 }} />
              )}
            </div>
          ))}
        </div>
        {needsBase && modes.uae !== 'value' && (
          <div style={{ marginTop:12, fontSize:12, color:t.t4 }}>
            Auto conversion will key off each item&apos;s stored UAE price.
          </div>
        )}
      </div>

      {/* Paste columns — only in code mode */}
      {selectMode === 'paste' && (
        <div style={{ ...groupBox(false), marginBottom:16 }}>
          <div style={{ ...groupHead, marginBottom:4 }}>Paste columns</div>
          <div style={{ fontSize:12, color:t.t4, marginBottom:14 }}>
            Matched on item code. A blank line skips that market for that row.
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'flex-start' }}>
            {pasteCols.map(c => {
              const n = cols[c.k].split('\n').filter(s => s.trim()).length;
              const mismatch = c.k !== 'sku' && n > 0 && n !== skuCount;
              return (
                <div key={c.k} style={{ flex:'1 1 170px', minWidth:150 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:6 }}>
                    <label style={{ ...lbl, marginBottom:6 }}>{c.label}</label>
                    {n > 0 && <span style={{ fontSize:10, marginBottom:6, fontFamily:'var(--font-mono)', color:mismatch?t.amber:t.t4 }}>{n}</span>}
                  </div>
                  <textarea value={cols[c.k]} onChange={e => setCol(c.k, e.target.value)}
                    placeholder={c.ph} spellCheck={false}
                    style={{ ...box, borderColor: mismatch ? 'rgba(245,166,35,0.4)' : t.b2 }} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ marginBottom:16 }}>
        <button onClick={buildPlan} disabled={!canPreview}
          style={{ ...btnW, opacity:canPreview?1:0.4, cursor:canPreview?'pointer':'not-allowed' }}>
          {busy && !plan ? 'Checking...' : 'Preview changes →'}
        </button>
      </div>

      {plan && (
        <div style={groupBox(false)}>
          <div style={{ ...groupHead, marginBottom:14 }}>Before commit</div>

          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
            <Pill label="will change" value={plan.changed.length.toLocaleString()}   color={plan.changed.length ? t.green : t.t1} />
            <Pill label="no change"   value={plan.unchanged.length.toLocaleString()} color={t.t3} />
            {plan.noBase.length   > 0 && <Pill label="no AED base" value={plan.noBase.length.toLocaleString()}   color={t.amber} />}
            {plan.notFound.length > 0 && <Pill label="not found"   value={plan.notFound.length.toLocaleString()} color={t.red} />}
          </div>

          {plan.noBase.length > 0 && (
            <div style={{ background:'rgba(245,166,35,0.06)', border:'1px solid rgba(245,166,35,0.25)', borderRadius:8, padding:'12px 16px', marginBottom:16, fontSize:13, color:t.t2 }}>
              {plan.noBase.length.toLocaleString()} item{plan.noBase.length===1?' has':'s have'} no UAE price to convert from — skipped.
              <div style={{ marginTop:8, fontSize:11.5, color:t.t4, fontFamily:'var(--font-mono)', lineHeight:1.7 }}>
                {plan.noBase.slice(0, 30).join(', ')}{plan.noBase.length > 30 ? ` … +${(plan.noBase.length - 30).toLocaleString()} more` : ''}
              </div>
            </div>
          )}

          {plan.notFound.length > 0 && (
            <div style={{ background:'rgba(242,100,100,0.06)', border:'1px solid rgba(242,100,100,0.25)', borderRadius:8, padding:'14px 16px', marginBottom:16 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, flexWrap:'wrap' }}>
                <div style={{ fontSize:13, color:t.t2 }}>
                  {plan.notFound.length} item code{plan.notFound.length===1?' is':'s are'} not in the pricing master — skipped.
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
            <>
              <div style={{ border:`1px solid ${t.b1}`, borderRadius:8, maxHeight:420, overflowY:'auto', marginBottom:8 }}>
                {plan.changed.slice(0, PREVIEW_CAP).map(c => (
                  <div key={c.item_code} style={{ borderTop:`1px solid ${t.b1}`, padding:'10px 14px' }}>
                    <div style={{ fontSize:12.5, color:t.blue, fontFamily:'var(--font-mono)', marginBottom:6 }}>{c.item_code}</div>
                    {c.diffs.map(d => (
                      <div key={d.field} style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 1fr', gap:8, padding:'3px 0', fontSize:12, fontFamily:'var(--font-mono)', alignItems:'center' }}>
                        <span style={{ color:t.t3 }}>{d.market}</span>
                        <span style={{ color:t.t4, textDecoration:'line-through' }}>{fmt(d.from)}</span>
                        <span style={{ color:d.flagOnly ? t.t4 : t.green }}>
                          {fmt(d.to)}{d.flagOnly ? ' (pin only)' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {plan.changed.length > PREVIEW_CAP && (
                <div style={{ fontSize:11.5, color:t.t4, marginBottom:8, fontFamily:'var(--font-mono)' }}>
                  showing first {PREVIEW_CAP} of {plan.changed.length.toLocaleString()} — all of them will be written
                </div>
              )}
            </>
          )}

          <div style={{ fontSize:11.5, color:t.t4, margin:'8px 0 16px', lineHeight:1.6 }}>
            Pushing marks each written market as overridden. Reference prices (real_msrp_*) are left as they are,
            so you can still see what the pricing engine would have produced.
          </div>

          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <button onClick={push} disabled={!plan.changed.length || busy || isViewer}
              style={{ ...btnW, background:t.amber, color:t.bg0,
                opacity:(!plan.changed.length||busy||isViewer)?0.4:1,
                cursor:(!plan.changed.length||busy||isViewer)?'not-allowed':'pointer' }}>
              {busy ? 'Pushing...' : `Override ${plan.changed.length.toLocaleString()} item${plan.changed.length===1?'':'s'}`}
            </button>
            <button style={btnG} onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}