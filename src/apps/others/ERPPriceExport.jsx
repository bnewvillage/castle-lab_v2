import { useState } from 'react';
import { t, inp, btnW, btnG, lbl, groupBox } from '../pricing/styles';
import { fetchAllPricesForExport } from '../../lib/db';
import { supabase } from '../../lib/supabase';
import { DEMO } from '../../demo/demoConfig';
import { demoErpReport } from '../../demo/demoErp';

const PROXY_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/erp-proxy`;

// Cosmetic placeholders only — no real internal host/domain in source.
const ERP_EMAIL_PH = 'you@company.example';
const ERP_HOST     = 'erp.company.example';

const REPORTS = [
  { key: 'aed', name: 'PRICE-AED_ValidFromLatest', dbField: 'msrp_aed', currency: 'AED' },
  { key: 'sar', name: 'PRICE-SAR_ValidFromLatest', dbField: 'msrp_sar', currency: 'SAR' },
  { key: 'qar', name: 'PRICE-QAR_ValidFromLatest', dbField: 'msrp_qat', currency: 'QAR' },
];

async function fetchOneReport(email, password, report_name) {
  if (DEMO) return demoErpReport(report_name);
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password, report_name }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Proxy error (${res.status})`);
  return json.rows;
}

function toCSV(rows) {
  const headers = ['name', 'item_code', 'price_list', 'currency', 'price_list_rate', 'new_rate', 'match_type'];
  const lines = [
    headers.join(','),
    ...rows.map(r =>
      headers.map(h => {
        const v = r[h] ?? '';
        return String(v).includes(',') ? `"${v}"` : v;
      }).join(',')
    ),
  ];
  return lines.join('\n');
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function mergeReport(erpRows, dbByCode, dbByBarcode, dbField) {
  return erpRows.map(row => {
    const byCode = dbByCode[row.item_code];
    const byBarcode = !byCode ? dbByBarcode[row.item_code] : null;
    const match = byCode ?? byBarcode ?? null;
    const new_rate = match?.[dbField] ?? null;
    const match_type = byCode ? 'item_code' : byBarcode ? 'barcode' : '';
    return { ...row, new_rate, match_type, _missing: new_rate == null };
  });
}

function StatPill({ label, value, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      background: t.bg3, border: `1px solid ${t.b2}`, borderRadius: 10, padding: '12px 20px', minWidth: 90 }}>
      <span style={{ fontSize: 20, fontWeight: 500, color: color || t.t1, fontFamily: 'var(--font-mono)' }}>{value}</span>
      <span style={{ fontSize: 10, color: t.t4, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>{label}</span>
    </div>
  );
}

export default function ERPPriceExport() {
  const [email, setEmail]         = useState(DEMO ? 'demo@castillo.lab' : '');
  const [password, setPassword]   = useState(DEMO ? 'demo-access' : '');
  const [status, setStatus]       = useState('idle'); // idle | loading | done | error
  const [errorMsg, setErrorMsg]   = useState('');
  const [merged, setMerged]       = useState(null); // { aed, sar, qar }
  const [log, setLog]             = useState([]);

  const addLog = (msg) => setLog(prev => [...prev, msg]);

  const handleFetch = async () => {
    if (!email.trim() || !password.trim()) return;
    setStatus('loading');
    setErrorMsg('');
    setLog([]);
    setMerged(null);

    try {
      addLog('Fetching DB prices...');
      const dbRows = await fetchAllPricesForExport();
      const dbByCode    = Object.fromEntries(dbRows.map(r => [r.item_code, r]));
      const dbByBarcode = Object.fromEntries(dbRows.filter(r => r.barcode).map(r => [r.barcode, r]));

      addLog('Fetching AED report...');
      const erpAed = await fetchOneReport(email.trim(), password.trim(), REPORTS[0].name);
      addLog(`AED: ${erpAed.length} rows.`);

      addLog('Fetching SAR report...');
      const erpSar = await fetchOneReport(email.trim(), password.trim(), REPORTS[1].name);
      addLog(`SAR: ${erpSar.length} rows.`);

      addLog('Fetching QAR report...');
      const erpQar = await fetchOneReport(email.trim(), password.trim(), REPORTS[2].name);
      addLog(`QAR: ${erpQar.length} rows.`);

      const aed = mergeReport(erpAed, dbByCode, dbByBarcode, 'msrp_aed');
      const sar = mergeReport(erpSar, dbByCode, dbByBarcode, 'msrp_sar');
      const qar = mergeReport(erpQar, dbByCode, dbByBarcode, 'msrp_qat');

      addLog(`AED: ${erpAed.length} ERP rows, ${aed.filter(r => !r._missing).length} matched.`);
      addLog(`SAR: ${erpSar.length} ERP rows, ${sar.filter(r => !r._missing).length} matched.`);
      addLog(`QAR: ${erpQar.length} ERP rows, ${qar.filter(r => !r._missing).length} matched.`);

      setMerged({ aed, sar, qar });
      setStatus('done');
    } catch (err) {
      setErrorMsg(err.message || 'Unknown error');
      setStatus('error');
    }
  };

  const handleDownload = (key) => {
    const rows = merged[key];
    const report = REPORTS.find(r => r.key === key);
    const now = new Date().toISOString().slice(0, 10);
    downloadCSV(toCSV(rows), `${report.name}_${now}.csv`);
  };

  const stats = (key) => {
    if (!merged) return null;
    const rows = merged[key];
    const matched = rows.filter(r => !r._missing).length;
    return { total: rows.length, matched, missing: rows.length - matched };
  };

  return (
    <div style={{ maxWidth: 760, paddingBottom: 60 }}>

      {/* Connection */}
      <div style={groupBox(false)}>
        <div style={{ fontSize: 11, color: t.t3, textTransform: 'uppercase', letterSpacing: '0.1em',
          fontFamily: 'var(--font-mono)', fontWeight: 600, marginBottom: 16 }}>
          ERP Connection
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1.2 }}>
            <label style={lbl}>ERP Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && status !== 'loading' && handleFetch()}
              placeholder={ERP_EMAIL_PH}
              style={{ ...inp(!!email, false), width: '100%' }}
              disabled={status === 'loading'}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>ERP Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && status !== 'loading' && handleFetch()}
              placeholder="Enter your ERP password"
              style={{ ...inp(!!password, false), width: '100%' }}
              disabled={status === 'loading'}
            />
          </div>
          <button
            onClick={handleFetch}
            disabled={!email.trim() || !password.trim() || status === 'loading'}
            style={{
              ...btnW,
              opacity: (!email.trim() || !password.trim() || status === 'loading') ? 0.4 : 1,
              cursor: (!email.trim() || !password.trim() || status === 'loading') ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {status === 'loading' ? 'Fetching...' : 'Fetch Reports'}
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 11, color: t.t4, fontFamily: 'var(--font-mono)' }}>
          {ERP_HOST}
        </div>
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div style={{ marginTop: 12, background: t.bg1, border: `1px solid ${t.b1}`,
          borderRadius: 8, padding: '12px 16px' }}>
          {log.map((line, i) => (
            <div key={i} style={{ fontSize: 12, color: t.t3, fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>
              {line}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div style={{ marginTop: 12, background: 'rgba(242,100,100,0.08)', border: '1px solid rgba(242,100,100,0.3)',
          borderRadius: 8, padding: '12px 16px', fontSize: 13, color: t.red }}>
          {errorMsg}
        </div>
      )}

      {/* Results */}
      {status === 'done' && merged && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {REPORTS.map(report => {
            const s = stats(report.key);
            return (
              <div key={report.key} style={{ ...groupBox(false), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1 }}>
                  <span style={{ fontSize: 13, color: t.t1, fontWeight: 500, minWidth: 50 }}>{report.currency}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <StatPill label="ERP rows" value={s.total} />
                    <StatPill label="matched" value={s.matched} color={t.green} />
                    {s.missing > 0 && <StatPill label="no price" value={s.missing} color={t.amber} />}
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(report.key)}
                  style={{ ...btnG, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  ↓ CSV
                </button>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
