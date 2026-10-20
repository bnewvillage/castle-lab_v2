import { t, inp, lbl, groupBox, groupHead } from '../pricing/styles';

const ERP_EMAIL_PH = 'you@company.example';
const ERP_HOST     = 'erp.company.example';

// The ERP login every ERP page uses. Held by the page container, so it carries
// between ERP pages; sent with each proxy call and never stored.
export default function ErpConnection({ creds, setCreds, style }) {
  const set = (k) => (e) => { const v = e.target.value; setCreds(c => ({ ...c, [k]: v })); };
  return (
    <div style={{ ...groupBox(false), ...style }}>
      <div style={{ ...groupHead, marginBottom: 16 }}>ERP Connection</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1.2 }}>
          <label style={lbl}>ERP Email</label>
          <input type="email" value={creds.email} onChange={set('email')} placeholder={ERP_EMAIL_PH}
            style={{ ...inp(!!creds.email, false), width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>ERP Password</label>
          <input type="password" value={creds.password} onChange={set('password')} placeholder="Enter your ERP password"
            style={{ ...inp(!!creds.password, false), width: '100%' }} />
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: t.t4, fontFamily: 'var(--font-mono)' }}>{ERP_HOST}</div>
    </div>
  );
}
