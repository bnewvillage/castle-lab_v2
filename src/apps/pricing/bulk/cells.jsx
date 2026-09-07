import { useState } from 'react';
import { t } from '../styles';

// ── INLINE EDITABLE CELL ──────────────────────────────────────
export function EditCell({ value, options, isText, onChange, hasError }) {
  const [changed, setChanged] = useState(false);

  const handleChange = (v) => {
    setChanged(true);
    onChange(v);
  };

  const style = {
    background: hasError ? 'rgba(242,100,100,0.08)' : t.bg3,
    border: `1px solid ${hasError ? 'rgba(242,100,100,0.4)' : changed ? t.b3 : t.b2}`,
    borderRadius: 6, padding: '5px 8px', fontSize: 12,
    color: t.t1, fontFamily: 'var(--font-sans)', outline: 'none',
    width: '100%', minWidth: 120,
  };

  if (options) return (
    <select style={{ ...style, cursor: 'pointer' }} value={value||''} onChange={e=>handleChange(e.target.value)}>
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <input style={style} value={value||''} onChange={e=>handleChange(e.target.value)}/>
  );
}

// ── APPLY TO ALL POPOVER ──────────────────────────────────────
export function ApplyAll({ onApplyErrors, onApplyAll, onDismiss }) {
  return (
    <div style={{
      position:'absolute', top:'100%', right:0, zIndex:100, marginTop:4,
      background:t.bg2, border:`1px solid ${t.b3}`, borderRadius:8,
      boxShadow:'0 4px 16px rgba(0,0,0,0.5)', overflow:'hidden', minWidth:160,
    }}>
      {[
        { label:'Apply to error rows', action: onApplyErrors },
        { label:'Apply to all rows',   action: onApplyAll   },
      ].map(({ label, action }) => (
        <button key={label} onClick={() => { action(); onDismiss(); }}
          style={{ display:'block', width:'100%', padding:'9px 14px', background:'none', border:'none', cursor:'pointer', fontSize:12, color:t.t2, fontFamily:'var(--font-sans)', textAlign:'left', transition:'background 0.1s' }}
          onMouseEnter={e=>e.currentTarget.style.background=t.bg3}
          onMouseLeave={e=>e.currentTarget.style.background='none'}
        >{label}</button>
      ))}
    </div>
  );
}

export function StatusBadge({ status }) {
  const colors = {
    ready: { bg:'rgba(62,207,142,0.1)', border:'rgba(62,207,142,0.3)', color:t.green },
    error: { bg:'rgba(242,100,100,0.1)', border:'rgba(242,100,100,0.3)', color:t.red },
  };
  const st = colors[status]||colors.error;
  return <span style={{ fontSize:11, padding:'3px 10px', borderRadius:100, fontFamily:'var(--font-mono)', background:st.bg, border:`1px solid ${st.border}`, color:st.color }}>{status}</span>;
}
