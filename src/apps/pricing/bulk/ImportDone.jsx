import { t, btnG } from '../styles';
import { toNum } from '../../../lib/num';

// Post-import summary: cost spread of what landed, and how MSRPs moved.
export default function ImportDone({ lastImport, rates, readyCount, errorCount, onReset }) {

    const { imported = [], existingBefore = {} } = lastImport || {};
    const updatedItems = imported.filter(r => existingBefore[r.item_code?.toUpperCase()]);
    const newItems2    = imported.filter(r => !existingBefore[r.item_code?.toUpperCase()]);
    const skipped      = readyCount - imported.length;

    const getExwAed = (item) => {
      const rate = rates[item.cost_currency];
      if (!rate || item.exw_cost == null) return null;
      return toNum(item.exw_cost) * rate;
    };
    const getLandedAed = (item) => {
      const exwAed = getExwAed(item);
      if (exwAed == null) return null;
      const ship = toNum(item.shipping_rate) ?? 0;
      const duty = toNum(item.customs_duty_rate) ?? 5.5;
      return exwAed * (1 + ship / 100) * (1 + duty / 100);
    };
    const statOf = (vals) => {
      const v = vals.filter(x => x != null);
      if (!v.length) return null;
      const sorted = [...v].sort((a,b) => a-b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
      const freq = {}; let maxF = 0, modeVal = null;
      for (const n of v) { const k = Math.round(n); freq[k] = (freq[k]||0)+1; if (freq[k] > maxF) { maxF = freq[k]; modeVal = k; } }
      return { min: sorted[0], max: sorted[sorted.length-1], avg: v.reduce((a,b) => a+b, 0) / v.length, median, mode: maxF > 1 ? modeVal : null, count: v.length };
    };

    const exwStats    = statOf(imported.map(getExwAed));
    const landedStats = statOf(imported.map(getLandedAed));

    const msrpChanges = updatedItems.map(r => {
      const code   = r.item_code?.toUpperCase();
      const before = toNum(existingBefore[code]?.msrp_aed);
      const after  = toNum(r.msrp_aed);
      if (!before || !after || before === 0) return null;
      return ((after - before) / before) * 100;
    }).filter(v => v != null);
    const avgMsrpChange = msrpChanges.length
      ? msrpChanges.reduce((a,b) => a+b, 0) / msrpChanges.length
      : null;

    const fmtAED = v => v != null ? `AED ${Number(v).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 })}` : '—';
    const rowSt  = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:`1px solid ${t.b1}`, fontSize:13 };


    return (
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:t.t1 }}>Import complete</div>
            <div style={{ display:'flex', gap:16, marginTop:6 }}>
              <span style={{ fontSize:13, color:t.green }}>✓ {imported.length} saved</span>
              {newItems2.length > 0    && <span style={{ fontSize:13, color:t.green }}>{newItems2.length} new</span>}
              {updatedItems.length > 0 && <span style={{ fontSize:13, color:t.blue }}>{updatedItems.length} updated</span>}
              {skipped > 0             && <span style={{ fontSize:13, color:t.amber }}>{skipped} skipped</span>}
              {errorCount > 0    && <span style={{ fontSize:13, color:t.red }}>{errorCount} errors</span>}
            </div>
          </div>
          <button style={btnG} onClick={onReset}>Close summary</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>EXW cost — AED equivalent</div>
            {!exwStats ? (
              <div style={{ fontSize:13, color:t.t4 }}>No cost data</div>
            ) : (
              <>
                <div style={rowSt}><span style={{ color:t.t4 }}>Average</span><span style={{ fontFamily:'var(--font-mono)', color:t.t1 }}>{fmtAED(exwStats.avg)}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Median</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(exwStats.median)}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Mode</span><span style={{ fontFamily:'var(--font-mono)', color:exwStats.mode != null ? t.t2 : t.t4 }}>{exwStats.mode != null ? fmtAED(exwStats.mode) : '—'}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Minimum</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(exwStats.min)}</span></div>
                <div style={{ ...rowSt, borderBottom:'none' }}><span style={{ color:t.t4 }}>Maximum</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(exwStats.max)}</span></div>
                <div style={{ marginTop:12, fontSize:11, color:t.t4 }}>{exwStats.count} of {imported.length} items had cost data</div>
              </>
            )}
          </div>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>Landed cost — AED</div>
            {!landedStats ? (
              <div style={{ fontSize:13, color:t.t4 }}>No cost data</div>
            ) : (
              <>
                <div style={rowSt}><span style={{ color:t.t4 }}>Average</span><span style={{ fontFamily:'var(--font-mono)', color:t.t1 }}>{fmtAED(landedStats.avg)}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Median</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(landedStats.median)}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Mode</span><span style={{ fontFamily:'var(--font-mono)', color:landedStats.mode != null ? t.t2 : t.t4 }}>{landedStats.mode != null ? fmtAED(landedStats.mode) : '—'}</span></div>
                <div style={rowSt}><span style={{ color:t.t4 }}>Minimum</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(landedStats.min)}</span></div>
                <div style={{ ...rowSt, borderBottom:'none' }}><span style={{ color:t.t4 }}>Maximum</span><span style={{ fontFamily:'var(--font-mono)', color:t.t2 }}>{fmtAED(landedStats.max)}</span></div>
                <div style={{ marginTop:12, fontSize:11, color:t.t4 }}>{landedStats.count} of {imported.length} items had cost data</div>
              </>
            )}
          </div>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>MSRP AED change</div>
            {updatedItems.length === 0 ? (
              <div style={{ fontSize:13, color:t.t4 }}>No updated items — all were new</div>
            ) : avgMsrpChange == null ? (
              <div style={{ fontSize:13, color:t.t4 }}>No MSRP data for updated items</div>
            ) : (
              <>
                <div style={{ fontSize:28, fontWeight:500, fontFamily:'var(--font-mono)', marginBottom:4, color: avgMsrpChange > 0.05 ? t.green : avgMsrpChange < -0.05 ? t.red : t.t4 }}>
                  {avgMsrpChange > 0 ? '+' : ''}{avgMsrpChange.toFixed(1)}%
                </div>
                <div style={{ fontSize:12, color:t.t4 }}>avg change across {msrpChanges.length} updated item{msrpChanges.length!==1?'s':''}</div>
              </>
            )}
          </div>

        </div>
      </div>
    );
}
