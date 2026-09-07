import { t, btnW, btnG } from '../styles';
import { toNum } from '../../../lib/num';
import { resolvePriceUsed } from '../../../lib/pricing';

// First screen after parsing: column fill rates and the EXW margin spread,
// so a bad file is obvious before anyone reaches the row editor.
export default function ImportSummary({ rows, rates, isViewer, onBack, onNext, setRows, setError, setShowErrorsOnly }) {

    const total   = rows.length;
    const ready   = rows.filter(r => r._status === 'ready');
    const errRows = rows.filter(r => r._status === 'error');

    const fillRate = (field) => {
      const filled = rows.filter(r => r[field] !== null && r[field] !== undefined && r[field] !== '').length;
      return total > 0 ? Math.round((filled / total) * 100) : 0;
    };

    const REQUIRED_COLS = ['item_code','item_name','brand_code','cost_currency','msrp_primary_currency','price_used'];
    const OPTIONAL_COLS = ['barcode','exw_cost','shipping_rate','customs_duty_rate','target_margin_pct','cost_source','price_source'];

    // EXW margin on ALL rows: (price_used_aed - exw_cost_aed) / price_used_aed
    const marginStats = (() => {
      const r8 = rates;
      const items = rows.map(r => {
        if (!r.exw_cost || !r.cost_currency || !r.price_used) return null;
        const { value: priceVal, currency: priceCur } = resolvePriceUsed(r);
        if (!priceVal || !priceCur) return null;
        const priceRate = r8[priceCur];
        const costRate  = r8[r.cost_currency];
        if (!priceRate || !costRate) return null;
        const priceAED = toNum(priceVal) * priceRate;
        const costAED  = toNum(r.exw_cost) * costRate;
        if (!priceAED || priceAED <= 0) return null;
        const margin = ((priceAED - costAED) / priceAED) * 100;
        return { item_code: r.item_code, margin };
      }).filter(Boolean);
      if (!items.length) return null;
      const avg = items.reduce((s,i) => s + i.margin, 0) / items.length;
      const min = items.reduce((a,b) => a.margin < b.margin ? a : b);
      const max = items.reduce((a,b) => a.margin > b.margin ? a : b);
      const sorted = [...items].sort((a,b) => a.margin - b.margin);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid].margin : (sorted[mid-1].margin + sorted[mid].margin) / 2;
      const freq = {}; let maxF = 0, modeVal = null;
      for (const it of items) { const k = +it.margin.toFixed(1); freq[k] = (freq[k]||0)+1; if (freq[k] > maxF) { maxF = freq[k]; modeVal = k; } }
      return { avg, min, max, median, mode: maxF > 1 ? modeVal : null, count: items.length };
    })();

    const FillBar = ({ pct }) => (
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ flex:1, height:6, background:t.bg4, borderRadius:100, overflow:'hidden' }}>
          <div style={{ width:`${pct}%`, height:'100%', background:pct===100?t.green:pct>50?t.amber:t.red, borderRadius:100 }}/>
        </div>
        <span style={{ fontSize:12, color:pct===100?t.green:pct>50?t.amber:t.red, fontFamily:'var(--font-mono)', minWidth:36, textAlign:'right' }}>{pct}%</span>
      </div>
    );

    const rowSt = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:`1px solid ${t.b1}`, fontSize:13 };

    return (
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:t.t1 }}>Import summary</div>
            <div style={{ display:'flex', gap:16, marginTop:6 }}>
              <span style={{ fontSize:13, color:t.green }}>{ready.length} ready</span>
              {errRows.length>0 && <span style={{ fontSize:13, color:t.red }}>{errRows.length} errors</span>}
              <span style={{ fontSize:13, color:t.t4 }}>{total} total rows</span>
            </div>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button style={btnG} onClick={()=>{onBack();setRows([]);setError(null);setShowErrorsOnly(false);}}>Back</button>
            <button style={{...btnW,opacity:isViewer?0.4:1,cursor:isViewer?'not-allowed':'pointer'}} disabled={isViewer} onClick={()=>onNext()}>Review rows →</button>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom:16 }}>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>Required columns</div>
            {REQUIRED_COLS.map(col => (
              <div key={col} style={{ marginBottom:10 }}>
                <div style={{ fontSize:11, color:t.t3, fontFamily:'var(--font-mono)', marginBottom:4 }}>{col}</div>
                <FillBar pct={fillRate(col)}/>
              </div>
            ))}
          </div>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>Optional columns</div>
            {OPTIONAL_COLS.map(col => (
              <div key={col} style={{ marginBottom:10 }}>
                <div style={{ fontSize:11, color:t.t3, fontFamily:'var(--font-mono)', marginBottom:4 }}>{col}</div>
                <FillBar pct={fillRate(col)}/>
              </div>
            ))}
          </div>

          <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:t.blue, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>EXW margins</div>
            {!marginStats ? (
              <div style={{ fontSize:13, color:t.t4 }}>No cost data available</div>
            ) : (
              <>
                <div style={rowSt}>
                  <span style={{ color:t.t4 }}>Average</span>
                  <span style={{ color:marginStats.avg>=30?t.green:marginStats.avg>=20?t.amber:t.red, fontFamily:'var(--font-mono)', fontWeight:600, fontSize:15 }}>{marginStats.avg.toFixed(1)}%</span>
                </div>
                <div style={rowSt}>
                  <span style={{ color:t.t4 }}>Median</span>
                  <span style={{ color:marginStats.median>=30?t.green:marginStats.median>=20?t.amber:t.red, fontFamily:'var(--font-mono)', fontWeight:600 }}>{marginStats.median.toFixed(1)}%</span>
                </div>
                <div style={rowSt}>
                  <span style={{ color:t.t4 }}>Mode</span>
                  <span style={{ fontFamily:'var(--font-mono)', fontWeight:600, color:marginStats.mode != null ? (marginStats.mode>=30?t.green:marginStats.mode>=20?t.amber:t.red) : t.t4 }}>{marginStats.mode != null ? `${marginStats.mode.toFixed(1)}%` : '—'}</span>
                </div>
                <div style={rowSt}>
                  <span style={{ color:t.t4 }}>Minimum</span>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ color:t.red, fontFamily:'var(--font-mono)', fontWeight:600 }}>{marginStats.min.margin.toFixed(1)}%</div>
                    <div style={{ fontSize:11, color:t.t4, marginTop:2 }}>{marginStats.min.item_code}</div>
                  </div>
                </div>
                <div style={{ ...rowSt, borderBottom:'none' }}>
                  <span style={{ color:t.t4 }}>Maximum</span>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ color:t.green, fontFamily:'var(--font-mono)', fontWeight:600 }}>{marginStats.max.margin.toFixed(1)}%</div>
                    <div style={{ fontSize:11, color:t.t4, marginTop:2 }}>{marginStats.max.item_code}</div>
                  </div>
                </div>
                <div style={{ marginTop:12, padding:'8px 12px', background:t.bg3, borderRadius:8, fontSize:11, color:t.t4 }}>
                  {marginStats.count} of {ready.length} ready rows had cost data
                </div>
              </>
            )}
          </div>
        </div>

        {(() => {
          const dupInFileCodes = [...new Set(rows.filter(r => r._dupInFile).map(r => r.item_code?.toUpperCase()))];
          return dupInFileCodes.length > 0 && (
            <div style={{ background:'rgba(245,166,35,0.07)', border:'1px solid rgba(245,166,35,0.25)', borderRadius:10, padding:'12px 16px', fontSize:13, color:t.amber, marginBottom:10 }}>
              <strong>{dupInFileCodes.length} duplicate item code{dupInFileCodes.length>1?'s':''} found in your file</strong> — only the last row for each code will be imported. Fix or remove the earlier rows in Review.
              <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:6 }}>
                {dupInFileCodes.map(c => <span key={c} style={{ fontSize:11, padding:'2px 8px', background:'rgba(245,166,35,0.12)', border:'1px solid rgba(245,166,35,0.3)', borderRadius:100, fontFamily:'var(--font-mono)' }}>{c}</span>)}
              </div>
            </div>
          );
        })()}
        {errRows.length > 0 && (
          <div style={{ background:'rgba(242,100,100,0.06)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:10, padding:'12px 16px', fontSize:13, color:t.red }}>
            {errRows.length} row{errRows.length>1?'s':''} have errors and will be skipped unless fixed. Click <strong>Review rows →</strong> to fix them inline.
          </div>
        )}
      </div>
    );
}
