import { t, btnG } from '../styles';
import { toNum } from '../../../lib/num';
import { resolvePriceUsed } from '../../../lib/pricing';

// ── DIFF MODAL ────────────────────────────────────────────────
// Shows before/after for every duplicate item being updated, plus aggregate margin stats.
export default function DiffModal({ items, existingItems, rates, onClose }) {
  const fmtSrc  = (val, cur) => (val != null && cur) ? `${cur} ${Number(val).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 })}` : '—';
  const fmtMgn  = v => v != null ? `${v.toFixed(1)}%` : '—';
  const fmtDelta = (d, pts) => {
    if (d == null) return '—';
    const s = d > 0 ? '+' : '';
    return pts ? `${s}${d.toFixed(1)} pts` : `${s}${d.toFixed(1)}%`;
  };
  const dColor  = d => d == null ? t.t4 : d > 0.05 ? t.green : d < -0.05 ? t.red : t.t4;

  const getMargin = (item) => {
    const { value: pv, currency: pc } = resolvePriceUsed(item);
    if (!pv || !pc) return null;
    const pr = rates[pc];
    const cr = rates[item.cost_currency];
    if (!pr || !cr || item.exw_cost == null) return null;
    const pAed = pv * pr;
    const cAed = toNum(item.exw_cost) * cr;
    if (!pAed || pAed <= 0) return null;
    return ((pAed - cAed) / pAed) * 100;
  };

  const diffRows = items.map(fileRow => {
    const code  = fileRow.item_code?.toUpperCase();
    const dbRow = existingItems[code];
    if (!dbRow) return null;

    const exwB     = { value: toNum(dbRow.exw_cost),  currency: dbRow.cost_currency };
    const exwA     = { value: toNum(fileRow.exw_cost), currency: fileRow.cost_currency };
    const exwAedB  = exwB.value != null && rates[exwB.currency]  ? exwB.value  * rates[exwB.currency]  : null;
    const exwAedA  = exwA.value != null && rates[exwA.currency]  ? exwA.value  * rates[exwA.currency]  : null;
    const exwDelta = exwAedB && exwAedA ? ((exwAedA - exwAedB) / Math.abs(exwAedB)) * 100 : null;

    const priceB    = resolvePriceUsed(dbRow);
    const priceA    = resolvePriceUsed(fileRow);
    const prAedB    = priceB.value && rates[priceB.currency] ? priceB.value * rates[priceB.currency] : null;
    const prAedA    = priceA.value && rates[priceA.currency] ? priceA.value * rates[priceA.currency] : null;
    const priceDelta = prAedB && prAedA ? ((prAedA - prAedB) / Math.abs(prAedB)) * 100 : null;

    const mgB      = getMargin(dbRow);
    const mgA      = getMargin(fileRow);
    const mgDelta  = mgB != null && mgA != null ? mgA - mgB : null;

    const msrpB    = toNum(dbRow.msrp_aed);
    const msrpA    = toNum(fileRow.msrp_aed);
    const msrpDelta = msrpB && msrpA ? ((msrpA - msrpB) / Math.abs(msrpB)) * 100 : null;

    return { code, exwB, exwA, exwDelta, priceB, priceA, priceDelta, mgB, mgA, mgDelta, msrpB, msrpA, msrpDelta };
  }).filter(Boolean);

  const statsOf = (vals) => {
    const v = vals.filter(x => x != null);
    if (!v.length) return null;
    const sorted = [...v].sort((a,b) => a-b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
    const freq = {}; let maxF = 0, modeVal = null;
    for (const n of v) { const k = +n.toFixed(1); freq[k] = (freq[k]||0)+1; if (freq[k] > maxF) { maxF = freq[k]; modeVal = k; } }
    return { min: sorted[0], max: sorted[sorted.length-1], avg: v.reduce((a,b)=>a+b,0)/v.length, median, mode: maxF > 1 ? modeVal : null };
  };
  const mgsBefore = statsOf(diffRows.map(r => r.mgB));
  const mgsAfter  = statsOf(diffRows.map(r => r.mgA));

  const thSt = { padding:'10px 14px', textAlign:'left', fontSize:11, color:t.t2, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:600, whiteSpace:'nowrap' };
  const tdSt = { padding:'10px 14px', fontSize:12, fontFamily:'var(--font-mono)', whiteSpace:'nowrap', verticalAlign:'top' };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={onClose}
    >
      <div style={{ background:t.bg2, border:`1px solid ${t.b2}`, borderRadius:16, width:'92vw', maxWidth:1080, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding:'20px 24px', borderBottom:`1px solid ${t.b1}`, display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:t.t1 }}>Change preview — {items.length} item{items.length!==1?'s':''} will be updated</div>
            <div style={{ fontSize:12, color:t.t4, marginTop:3 }}>These items already exist in the database. Review changes before confirming.</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:t.t4, padding:'4px 8px', borderRadius:6, lineHeight:1 }}>×</button>
        </div>

        {/* Aggregate margin stats */}
        {(mgsBefore || mgsAfter) && (
          <div style={{ padding:'16px 24px', borderBottom:`1px solid ${t.b1}`, background:t.bg3, flexShrink:0 }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:600, marginBottom:12 }}>EXW margin impact — updating items only</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:12 }}>
              {[
                { label:'Average', b: mgsBefore?.avg,    a: mgsAfter?.avg    },
                { label:'Median',  b: mgsBefore?.median, a: mgsAfter?.median },
                { label:'Mode',    b: mgsBefore?.mode,   a: mgsAfter?.mode   },
                { label:'Minimum', b: mgsBefore?.min,    a: mgsAfter?.min    },
                { label:'Maximum', b: mgsBefore?.max,    a: mgsAfter?.max    },
              ].map(({ label, b, a }) => {
                const d = b != null && a != null ? a - b : null;
                return (
                  <div key={label} style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:10, padding:'12px 16px' }}>
                    <div style={{ fontSize:10, color:t.t4, marginBottom:8 }}>{label}</div>
                    <div style={{ display:'flex', gap:16, alignItems:'center' }}>
                      <div>
                        <div style={{ fontSize:10, color:t.t4 }}>Before</div>
                        <div style={{ fontSize:14, fontFamily:'var(--font-mono)', color:t.t3 }}>{fmtMgn(b)}</div>
                      </div>
                      <div style={{ color:t.t4 }}>→</div>
                      <div>
                        <div style={{ fontSize:10, color:t.t4 }}>After</div>
                        <div style={{ fontSize:14, fontFamily:'var(--font-mono)', color: a!=null&&b!=null ? (a>b?t.green:a<b?t.red:t.t2) : t.t2 }}>{fmtMgn(a)}</div>
                      </div>
                      {d != null && <div style={{ marginLeft:'auto', fontSize:12, fontFamily:'var(--font-mono)', fontWeight:600, color:dColor(d) }}>{fmtDelta(d, true)}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Diff table */}
        <div style={{ flex:1, overflowY:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead style={{ position:'sticky', top:0, background:t.bg3, zIndex:1 }}>
              <tr style={{ borderBottom:`1px solid ${t.b2}` }}>
                {['Item code','EXW cost','Δ EXW','Price used','Δ Price','EXW margin','Δ Margin','MSRP AED','Δ MSRP'].map(h => (
                  <th key={h} style={thSt}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diffRows.map((row, i) => (
                <tr key={i} style={{ borderBottom:`1px solid ${t.b1}`, background:i%2===0?'transparent':'rgba(255,255,255,0.01)' }}>
                  <td style={{ ...tdSt, color:t.blue, fontWeight:500 }}>{row.code}</td>
                  <td style={tdSt}>
                    <div style={{ color:t.t4, fontSize:11 }}>{fmtSrc(row.exwB.value, row.exwB.currency)}</div>
                    <div style={{ color:t.t2 }}>{fmtSrc(row.exwA.value, row.exwA.currency)}</div>
                  </td>
                  <td style={{ ...tdSt, color:dColor(row.exwDelta) }}>{fmtDelta(row.exwDelta)}</td>
                  <td style={tdSt}>
                    <div style={{ color:t.t4, fontSize:11 }}>{fmtSrc(row.priceB.value, row.priceB.currency)}</div>
                    <div style={{ color:t.t2 }}>{fmtSrc(row.priceA.value, row.priceA.currency)}</div>
                  </td>
                  <td style={{ ...tdSt, color:dColor(row.priceDelta) }}>{fmtDelta(row.priceDelta)}</td>
                  <td style={tdSt}>
                    <div style={{ color:t.t4, fontSize:11 }}>{fmtMgn(row.mgB)}</div>
                    <div style={{ color: row.mgA!=null&&row.mgB!=null ? (row.mgA>row.mgB?t.green:row.mgA<row.mgB?t.red:t.t2) : t.t2 }}>{fmtMgn(row.mgA)}</div>
                  </td>
                  <td style={{ ...tdSt, color:dColor(row.mgDelta) }}>{fmtDelta(row.mgDelta, true)}</td>
                  <td style={tdSt}>
                    <div style={{ color:t.t4, fontSize:11 }}>{row.msrpB!=null?`AED ${Number(row.msrpB).toLocaleString()}`:'—'}</div>
                    <div style={{ color:t.t2 }}>{row.msrpA!=null?`AED ${Number(row.msrpA).toLocaleString()}`:'—'}</div>
                  </td>
                  <td style={{ ...tdSt, color:dColor(row.msrpDelta) }}>{fmtDelta(row.msrpDelta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding:'16px 24px', borderTop:`1px solid ${t.b1}`, display:'flex', justifyContent:'flex-end', flexShrink:0 }}>
          <button style={{ ...btnG, padding:'9px 20px' }} onClick={onClose}>Close preview</button>
        </div>
      </div>
    </div>
  );
}
