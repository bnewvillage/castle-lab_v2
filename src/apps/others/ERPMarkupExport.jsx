import { useState, useEffect, useMemo } from 'react';
import { fetchBrandsWithStats, fetchBrandItems, fetchRates, updateBrandAdditionalMarkup } from '../../lib/db';
import { t, inp, btnW, btnG, lbl, groupBox } from '../pricing/styles';
import { supabase } from '../../lib/supabase';
import { DEMO } from '../../demo/demoConfig';
import { demoErpReport } from '../../demo/demoErp';

// ── ERP proxy ─────────────────────────────────────────────────
const PROXY_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/erp-proxy`;

// Cosmetic placeholder only — no real internal host/domain in source.
const ERP_EMAIL_PH = 'you@company.example';

const REPORTS = [
  { key: 'aed', name: 'PRICE-AED_ValidFromLatest', overrideFlag: 'uae_overridden', newField: 'new_aed' },
  { key: 'sar', name: 'PRICE-SAR_ValidFromLatest', overrideFlag: 'ksa_overridden', newField: 'new_sar' },
  { key: 'qar', name: 'PRICE-QAR_ValidFromLatest', overrideFlag: 'qat_overridden', newField: 'new_qat' },
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

// ── Markup math ───────────────────────────────────────────────
function compoundMarkup(base, additional) {
  return ((1 + base / 100) * (1 + additional / 100) - 1) * 100;
}

// ── CSV ───────────────────────────────────────────────────────
const CSV_HEADERS = ['name', 'item_code', 'price_list', 'currency', 'price_list_rate', 'new_rate', 'match_type', 'overridden'];

function toCSV(rows) {
  const lines = [
    CSV_HEADERS.join(','),
    ...rows.map(r =>
      CSV_HEADERS.map(h => {
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
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Merge ERP rows with computed DB prices ────────────────────
function mergeReport(erpRows, computedByCode, computedByBarcode, newField, overrideFlag) {
  return erpRows.map(row => {
    const byCode    = computedByCode[row.item_code];
    const byBarcode = !byCode ? computedByBarcode[row.item_code] : null;
    const match     = byCode ?? byBarcode ?? null;
    const match_type = byCode ? 'item_code' : byBarcode ? 'barcode' : '';
    const new_rate   = match ? (match[newField] ?? null) : null;
    const overridden = match ? (match[overrideFlag] ? 'true' : 'false') : '';
    return { ...row, new_rate, match_type, overridden, _missing: new_rate == null };
  });
}

// ── Stat pill ─────────────────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4,
      background:t.bg3, border:`1px solid ${t.b2}`, borderRadius:10, padding:'12px 20px', minWidth:90 }}>
      <span style={{ fontSize:20, fontWeight:500, color:color||t.t1, fontFamily:'var(--font-mono)' }}>{value}</span>
      <span style={{ fontSize:10, color:t.t4, textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:'var(--font-mono)' }}>{label}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────
export default function ERPMarkupExport() {
  // ERP creds
  const [email,     setEmail]     = useState(DEMO ? 'demo@castillo.lab' : '');
  const [password,  setPassword]  = useState(DEMO ? 'demo-access' : '');

  // Brands / markup config
  const [brands,    setBrands]    = useState([]);
  const [rates,     setRates]     = useState({});
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [search,    setSearch]    = useState('');
  const [addMap,    setAddMap]    = useState({});   // brand_code → string
  const [lastFilled, setLastFilled] = useState(null);

  // Generation
  const [status,    setStatus]    = useState('idle'); // idle | loading | done | error
  const [errorMsg,  setErrorMsg]  = useState('');
  const [log,       setLog]       = useState([]);
  const [merged,    setMerged]    = useState(null);  // { aed, sar, qar }
  const [committing,  setCommitting]  = useState(false);
  const [committed,   setCommitted]   = useState(false);

  useEffect(() => {
    Promise.all([fetchBrandsWithStats(), fetchRates()])
      .then(([b, r]) => {
        setBrands(b);
        setRates(r);
        // Seed addMap from DB values
        const seed = {};
        b.forEach(brand => {
          if (brand.additional_markup_pct != null) seed[brand.brand_code] = String(brand.additional_markup_pct);
        });
        setAddMap(seed);
      })
      .finally(() => setLoadingBrands(false));
  }, []);

  const addLog = msg => setLog(prev => [...prev, msg]);

  // ── Visible brands (filtered) ──────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter(b =>
      b.brand_code.toLowerCase().includes(q) || b.brand_name.toLowerCase().includes(q)
    );
  }, [brands, search]);

  const setAdditional = (brandCode, val) => {
    setCommitted(false);
    setAddMap(prev => ({ ...prev, [brandCode]: val }));
    if (val.trim() !== '' && !isNaN(parseFloat(val))) setLastFilled(val.trim());
  };

  const handleCommit = async () => {
    setCommitting(true);
    try {
      await Promise.all(brands.map(brand => {
        const val = addMap[brand.brand_code]?.trim() ?? '';
        const parsed = val === '' ? null : parseFloat(val);
        if (val !== '' && isNaN(parsed)) return Promise.resolve();
        return updateBrandAdditionalMarkup(brand.brand_code, parsed);
      }));
      setCommitted(true);
      setTimeout(() => setCommitted(false), 2500);
    } finally {
      setCommitting(false);
    }
  };

  const visibleEmptyCount = visible.filter(b => !addMap[b.brand_code]?.trim()).length;

  const applyToVisibleEmpty = () => {
    if (!lastFilled) return;
    setAddMap(prev => {
      const next = { ...prev };
      visible.forEach(b => { if (!next[b.brand_code]?.trim()) next[b.brand_code] = lastFilled; });
      return next;
    });
  };

  const fmtEffective = (brandCode, basePct) => {
    const v = addMap[brandCode]?.trim();
    if (!v || isNaN(parseFloat(v))) return null;
    return compoundMarkup(basePct, parseFloat(v)).toFixed(2);
  };

  // ── Generate ───────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!email.trim() || !password.trim()) return;
    setStatus('loading');
    setErrorMsg('');
    setLog([]);
    setMerged(null);

    try {
      // 1. Build computed price map from DB + markup
      addLog('Loading DB items and applying markup...');
      const computedByCode    = {};
      const computedByBarcode = {};

      for (const brand of brands) {
        const addRaw = addMap[brand.brand_code]?.trim();
        const additional = addRaw && !isNaN(parseFloat(addRaw)) ? parseFloat(addRaw) : 0;
        const multiplier = 1 + additional / 100;

        const items = await fetchBrandItems(brand.brand_code);

        for (const item of items) {
          // Use real_msrp_* as base — these store brand-base-markup-only prices.
          // Applying additional markup on top of real_msrp is idempotent: running
          // the same % twice always produces the same result.
          const baseAed = item.real_msrp_aed ?? item.msrp_aed;
          const baseSar = item.real_msrp_sar ?? item.msrp_sar;
          const baseQat = item.real_msrp_qat ?? item.msrp_qat;
          const new_aed = item.uae_overridden
            ? item.msrp_aed
            : (baseAed != null ? baseAed * multiplier : null);
          const new_sar = item.ksa_overridden
            ? item.msrp_sar
            : (baseSar != null ? baseSar * multiplier : null);
          const new_qat = item.qat_overridden
            ? item.msrp_qat
            : (baseQat != null ? baseQat * multiplier : null);

          const entry = {
            item_code:      item.item_code,
            barcode:        item.barcode ?? null,
            uae_overridden: item.uae_overridden,
            ksa_overridden: item.ksa_overridden,
            qat_overridden: item.qat_overridden,
            new_aed: new_aed != null ? parseFloat(new_aed.toFixed(4)) : null,
            new_sar: new_sar != null ? parseFloat(new_sar.toFixed(4)) : null,
            new_qat: new_qat != null ? parseFloat(new_qat.toFixed(4)) : null,
          };

          computedByCode[item.item_code] = entry;
          if (item.barcode) computedByBarcode[item.barcode] = entry;
        }
      }

      addLog(`DB computed: ${Object.keys(computedByCode).length} items.`);

      // 2. Fetch ERP reports
      addLog('Fetching AED report from ERP...');
      const erpAed = await fetchOneReport(email.trim(), password.trim(), REPORTS[0].name);
      addLog(`AED: ${erpAed.length} rows.`);

      addLog('Fetching SAR report from ERP...');
      const erpSar = await fetchOneReport(email.trim(), password.trim(), REPORTS[1].name);
      addLog(`SAR: ${erpSar.length} rows.`);

      addLog('Fetching QAR report from ERP...');
      const erpQar = await fetchOneReport(email.trim(), password.trim(), REPORTS[2].name);
      addLog(`QAR: ${erpQar.length} rows.`);

      // 3. Merge
      const aed = mergeReport(erpAed, computedByCode, computedByBarcode, 'new_aed', 'uae_overridden');
      const sar = mergeReport(erpSar, computedByCode, computedByBarcode, 'new_sar', 'ksa_overridden');
      const qar = mergeReport(erpQar, computedByCode, computedByBarcode, 'new_qat', 'qat_overridden');

      addLog(`Matched — AED: ${aed.filter(r => !r._missing).length}/${erpAed.length}  SAR: ${sar.filter(r => !r._missing).length}/${erpSar.length}  QAR: ${qar.filter(r => !r._missing).length}/${erpQar.length}`);

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
    downloadCSV(toCSV(rows), `${report.name}_markup_${now}.csv`);
  };

  const stats = (key) => {
    if (!merged) return null;
    const rows = merged[key];
    const matched   = rows.filter(r => !r._missing).length;
    const overridden = rows.filter(r => r.overridden === 'true').length;
    return { total: rows.length, matched, missing: rows.length - matched, overridden };
  };

  const loading = status === 'loading';
  const ready   = !!(email.trim() && password.trim());

  // ── Table styles ───────────────────────────────────────────
  const thSt = {
    padding:'10px 14px', textAlign:'left', fontSize:11, color:t.t2,
    fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.06em',
    whiteSpace:'nowrap', borderBottom:`1px solid ${t.b2}`, background:t.bg3,
    fontWeight:600, position:'sticky', top:0, zIndex:1,
  };
  const tdSt = { padding:'9px 14px', fontSize:13, color:t.t2, borderBottom:`1px solid ${t.b1}`, verticalAlign:'middle' };

  if (loadingBrands) return (
    <div className="loading-pulse" style={{ fontSize:12, color:t.t4, fontFamily:'var(--font-mono)', letterSpacing:'0.1em', padding:'40px 0' }}>
      LOADING BRANDS...
    </div>
  );

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* ── Step 1: ERP credentials ── */}
      <div style={{ ...groupBox(false), marginBottom: 20 }}>
        <div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14, fontWeight:600 }}>
          Step 1 — ERP credentials
        </div>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200 }}>
            <div style={lbl}>ERP email</div>
            <input value={email} onChange={e => setEmail(e.target.value)}
              placeholder={ERP_EMAIL_PH}
              style={{ ...inp(!!email, false), width:'100%' }} />
          </div>
          <div style={{ flex:1, minWidth:200 }}>
            <div style={lbl}>ERP password</div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ ...inp(!!password, false), width:'100%' }} />
          </div>
        </div>
      </div>

      {/* ── Step 2: Per-brand additional markup ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10, fontWeight:600 }}>
          Step 2 — Additional markup per brand <span style={{ color:t.t4, fontWeight:400 }}>(leave blank = base markup only)</span>
        </div>

        {/* Controls */}
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10, flexWrap:'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter brands..."
            style={{ ...inp(!!search, false), width:220 }} />
          <span style={{ fontSize:12, color:t.t4, fontFamily:'var(--font-mono)' }}>
            {visible.length} visible
          </span>
          {lastFilled && visibleEmptyCount > 0 && (
            <button onClick={applyToVisibleEmpty}
              style={{ ...btnG, fontSize:12, color:t.amber, borderColor:'rgba(245,166,35,0.3)', whiteSpace:'nowrap' }}>
              Apply {lastFilled}% to {visibleEmptyCount} visible empty →
            </button>
          )}
          <button
            onClick={handleCommit}
            disabled={committing}
            style={{ ...btnG, marginLeft:'auto', color: committed ? t.green : t.t2, borderColor: committed ? 'rgba(62,207,142,0.4)' : undefined, opacity: committing ? 0.6 : 1, whiteSpace:'nowrap' }}
          >
            {committing ? 'Saving...' : committed ? '✓ Saved' : 'Commit markups'}
          </button>
        </div>

        {/* Brand table */}
        <div style={{ background:t.bg2, border:`1px solid ${t.b1}`, borderRadius:12, overflow:'hidden', maxHeight:'40vh', overflowY:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thSt, minWidth:100 }}>Code</th>
                <th style={{ ...thSt, minWidth:180 }}>Brand</th>
                <th style={{ ...thSt, minWidth:110, textAlign:'right' }}>Base markup</th>
                <th style={{ ...thSt, minWidth:140, textAlign:'center' }}>Additional %</th>
                <th style={{ ...thSt, minWidth:130, textAlign:'right' }}>Effective markup</th>
                <th style={{ ...thSt, minWidth:70, textAlign:'right' }}>SKUs</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((brand, i) => {
                const effective    = fmtEffective(brand.brand_code, brand.markup_percentage);
                const hasAdditional = !!addMap[brand.brand_code]?.trim();
                const rowBg = hasAdditional ? 'rgba(245,166,35,0.04)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)';
                return (
                  <tr key={brand.brand_code} style={{ background: rowBg }}>
                    <td style={{ ...tdSt, color:t.blue, fontFamily:'var(--font-mono)', fontWeight:500 }}>{brand.brand_code}</td>
                    <td style={{ ...tdSt, color:t.t1 }}>{brand.brand_name}</td>
                    <td style={{ ...tdSt, textAlign:'right', fontFamily:'var(--font-mono)', color:t.t3 }}>{brand.markup_percentage}%</td>
                    <td style={{ ...tdSt, textAlign:'center' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'center' }}>
                        <input type="text" inputMode="decimal" placeholder="0"
                          value={addMap[brand.brand_code] ?? ''}
                          onChange={e => setAdditional(brand.brand_code, e.target.value)}
                          style={{ ...inp(hasAdditional, false), width:80, textAlign:'center', padding:'5px 10px', fontSize:13 }} />
                        <span style={{ fontSize:12, color:t.t4 }}>%</span>
                      </div>
                    </td>
                    <td style={{ ...tdSt, textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:500, color: effective ? t.amber : t.t4 }}>
                      {effective ? `${effective}%` : `${brand.markup_percentage}%`}
                    </td>
                    <td style={{ ...tdSt, textAlign:'right', fontFamily:'var(--font-mono)', color:t.t3, fontSize:12 }}>
                      {brand.sku_count.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Generate button ── */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:20 }}>
        <button
          onClick={handleGenerate}
          disabled={!ready || loading}
          style={{ ...btnW, opacity:(!ready || loading) ? 0.4 : 1, cursor:(!ready || loading) ? 'not-allowed' : 'pointer', minWidth:200 }}>
          {loading ? 'Generating...' : 'Fetch ERP + Apply Markup →'}
        </button>
      </div>

      {/* ── Error ── */}
      {status === 'error' && (
        <div style={{ background:'rgba(242,100,100,0.08)', border:'1px solid rgba(242,100,100,0.2)', borderRadius:8, padding:'12px 16px', color:t.red, fontSize:13, marginBottom:16 }}>
          {errorMsg}
        </div>
      )}

      {/* ── Log ── */}
      {log.length > 0 && (
        <div style={{ marginBottom:16, background:t.bg1, border:`1px solid ${t.b1}`, borderRadius:8, padding:'12px 16px', maxHeight:160, overflowY:'auto' }}>
          {log.map((line, i) => (
            <div key={i} style={{ fontSize:12, color:t.t3, fontFamily:'var(--font-mono)', lineHeight:1.8 }}>{line}</div>
          ))}
        </div>
      )}

      {/* ── Results ── */}
      {status === 'done' && merged && (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {REPORTS.map(({ key, name }) => {
            const s = stats(key);
            return (
              <div key={key} style={{ ...groupBox(false) }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:t.t1, marginBottom:6 }}>{name}</div>
                    <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                      <StatPill label="ERP rows"  value={s.total}     color={t.t1} />
                      <StatPill label="Matched"   value={s.matched}   color={t.green} />
                      <StatPill label="No match"  value={s.missing}   color={s.missing > 0 ? t.amber : t.t4} />
                      <StatPill label="Overridden" value={s.overridden} color={t.blue} />
                    </div>
                  </div>
                  <button onClick={() => handleDownload(key)}
                    style={{ ...btnW, alignSelf:'center', whiteSpace:'nowrap' }}>
                    ↓ Download {key.toUpperCase()} CSV
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
