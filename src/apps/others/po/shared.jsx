import { t, btnG, btnSm, lbl } from '../../pricing/styles';
import { erpDate, addDays } from '../../../lib/purchaseOrder';

export const dateInput = {
  background: t.bg1, border: `1px solid ${t.b2}`, borderRadius: 6, color: t.t1,
  fontSize: 12.5, fontFamily: 'var(--font-mono)', padding: '5px 8px', colorScheme: 'dark',
};

const pad = (n) => String(n).padStart(2, '0');
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const money = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WEEKS = [2, 4, 6, 8, 12];

export function Pill({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      background: t.bg3, border: `1px solid ${t.b2}`, borderRadius: 10,
      padding: '10px 18px', minWidth: 84,
    }}>
      <span style={{ fontSize: 18, fontWeight: 500, color: color || t.t1, fontFamily: 'var(--font-mono)' }}>{value}</span>
      <span style={{ fontSize: 10, color: t.t4, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>{label}</span>
    </div>
  );
}

// The default expected delivery date, with one-click "+N weeks from today".
export function DefaultDelivery({ value, onChange, style }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', ...style }}>
      <span style={{ ...lbl, marginBottom: 0 }}>Default expected delivery</span>
      <input type="date" value={value} onChange={e => onChange(e.target.value)} style={dateInput} />
      {WEEKS.map(w => {
        const v = addDays(todayIso(), w * 7);
        const on = value === v;
        return (
          <button key={w} onClick={() => onChange(v)} title={erpDate(v)}
            style={{ ...btnG, ...btnSm, color: on ? t.t1 : t.t3, borderColor: on ? t.b3 : t.b2 }}>+{w} wk</button>
        );
      })}
      {value && <span style={{ fontSize: 12, color: t.t3, fontFamily: 'var(--font-mono)' }}>{erpDate(value)}</span>}
    </div>
  );
}

// One line's expected delivery, plus "copy to every line below".
export function LineDelivery({ value, isOwn, onChange, onFillDown }) {
  return (
    <>
      <input type="date" value={value} onChange={e => onChange(e.target.value)}
        style={{ ...dateInput, color: isOwn ? t.t1 : t.t3 }} title={isOwn ? 'Set on this line' : 'The default'} />
      <button onClick={onFillDown} disabled={!value} title="Copy this date to every line below"
        style={{ ...btnG, ...btnSm, marginLeft: 6, padding: '4px 9px', opacity: value ? 1 : 0.35, cursor: value ? 'pointer' : 'not-allowed' }}>↓ fill</button>
    </>
  );
}
