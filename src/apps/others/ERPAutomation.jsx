import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { t, inp, btnW, btnG, lbl, groupBox, groupHead } from '../pricing/styles';
import {
  fetchAllItemsForErpAutomation, fetchBrands,
  syncErpItemsBatch, pruneStaleErpItems, fetchErpCoverage, filterCodesInErpCache,
  countErpItems, getErpCacheInfo, updateErpSyncMeta,
  saveErpSyncCursor, getErpMaxModified,
} from '../../lib/db';
import { downloadXLSX } from '../../lib/xlsxExport';
import { supabase } from '../../lib/supabase';
import { DEMO } from '../../demo/demoConfig';
import { demoErpReport } from '../../demo/demoErp';

const PROXY_URL    = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/erp-proxy`;
const ERP_EMAIL_PH = 'you@company.example';
const ERP_HOST     = 'erp.company.example';

const STOCK_NO_PRICE_REPORT = 'Item In Stock Without Price';
// The report's own column naming isn't known up front, so the item code column
// is detected from the first of these that actually carries values.
const ITEM_CODE_KEYS = ['item_code', 'item', 'name', 'sku', 'item_id'];

const PRICE_REPORTS = [
  { key: 'aed', name: 'PRICE-AED_ValidFromLatest', dbField: 'msrp_aed', currency: 'AED' },
  { key: 'sar', name: 'PRICE-SAR_ValidFromLatest', dbField: 'msrp_sar', currency: 'SAR' },
  { key: 'qar', name: 'PRICE-QAR_ValidFromLatest', dbField: 'msrp_qat', currency: 'QAR' },
];

async function callProxy(email, password, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey':        process.env.REACT_APP_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password, ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Proxy error (${res.status})`);
  return json;
}

async function fetchReport(email, password, report_name) {
  if (DEMO) return demoErpReport(report_name);
  const json = await callProxy(email, password, { report_name });
  return json.rows;
}

function detectItemKey(rows) {
  if (!rows?.length) return null;
  return ITEM_CODE_KEYS.find(k => rows.some(r => r?.[k])) ?? null;
}

function mergeByCode(erpRows, dbByCode, dbByBarcode, dbField) {
  return erpRows.map(row => {
    const byCode    = dbByCode[row.item_code];
    const byBarcode = !byCode ? dbByBarcode[row.item_code] : null;
    const match     = byCode ?? byBarcode ?? null;
    return {
      ...row,
      new_rate:   match?.[dbField] ?? null,
      barcode:    match?.barcode    ?? '',
      match_type: byCode ? 'item_code' : byBarcode ? 'barcode' : '',
      _missing:   !match,
    };
  });
}

// ── Sub-components ─────────────────────────────────────────────
// Optional brand narrowing. Empty selection means every brand, so the default
// behaviour is unchanged.
function BrandMultiSelect({ brands, selected, onChange }) {
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
function StatPill({ label, value, color }) {
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

function LogBox({ lines, progress }) {
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

function ErrBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ marginTop: 12, background: 'rgba(242,100,100,0.08)', border: '1px solid rgba(242,100,100,0.3)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: t.red }}>
      {msg}
    </div>
  );
}

function RunBtn({ label, loading, disabled, onClick }) {
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

// ── Root ───────────────────────────────────────────────────────
export default function ERPAutomation() {
  const navigate = useNavigate();
  const [email,    setEmail]    = useState(DEMO ? 'demo@castillo.lab' : '');
  const [password, setPassword] = useState(DEMO ? 'demo-access'       : '');
  const isConnected = !!(email.trim() && password.trim());

  // ── Section 3b: Stock Without Price ──────────────────────────
  const [stkState,  setStkState]  = useState('idle');
  const [stkResult, setStkResult] = useState(null);
  const [stkLog,    setStkLog]    = useState([]);
  const [stkErr,    setStkErr]    = useState('');

  const handleStockNoPrice = async () => {
    if (!isConnected || stkState === 'loading') return;
    setStkState('loading'); setStkErr(''); setStkLog([]); setStkResult(null);
    const addLog = m => setStkLog(p => [...p, m]);
    try {
      addLog('Fetching stock-without-price report...');
      const rows = await fetchReport(email.trim(), password.trim(), STOCK_NO_PRICE_REPORT);
      addLog(`${rows.length.toLocaleString()} rows returned.`);
      if (!rows.length) { setStkResult({ rows: [], headers: [], matched: 0 }); setStkState('done'); return; }

      const itemKey = detectItemKey(rows);
      if (!itemKey) {
        throw new Error(
          `Could not find an item code column. Columns returned: ${Object.keys(rows[0]).join(', ')}`,
        );
      }
      addLog(`Matching on "${itemKey}".`);

      addLog('Fetching DB prices...');
      const dbRows      = await fetchAllItemsForErpAutomation();
      const dbByCode    = Object.fromEntries(dbRows.map(r => [r.item_code?.toUpperCase(), r]));
      const dbByBarcode = Object.fromEntries(dbRows.filter(r => r.barcode).map(r => [String(r.barcode).toUpperCase(), r]));
      addLog(`DB: ${dbRows.length.toLocaleString()} rows.`);

      const filled = rows.map(r => {
        const key    = String(r[itemKey] ?? '').toUpperCase();
        const byCode = dbByCode[key];
        const byBar  = !byCode ? dbByBarcode[key] : null;
        const db     = byCode ?? byBar ?? null;
        return {
          ...r,
          barcode:    db?.barcode  ?? '',
          msrp_aed:   db?.msrp_aed ?? '',
          msrp_sar:   db?.msrp_sar ?? '',
          msrp_qat:   db?.msrp_qat ?? '',
          match_type: byCode ? 'item_code' : byBar ? 'barcode' : 'no_match',
          _missing:   !db,
        };
      });

      // Report columns first, then the ones we appended — keeps the sheet
      // recognisable next to the ERP view.
      const added    = ['barcode', 'msrp_aed', 'msrp_sar', 'msrp_qat', 'match_type'];
      const original = Object.keys(rows[0]).filter(k => !added.includes(k));
      const matched  = filled.filter(r => !r._missing).length;
      addLog(`${matched.toLocaleString()} of ${filled.length.toLocaleString()} priced from the DB.`);

      setStkResult({ rows: filled, headers: [...original, ...added], matched });
      setStkState('done');
    } catch (err) {
      setStkErr(err.message || 'Unknown error');
      setStkState('error');
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  // ── ERP Item Cache ───────────────────────────────────────────
  const [cacheInfo,     setCacheInfo]     = useState(null);
  const [syncState,     setSyncState]     = useState('idle');
  const [syncProgress,  setSyncProgress]  = useState('');
  const [syncLog,       setSyncLog]       = useState([]);
  const [syncErr,       setSyncErr]       = useState('');

  useEffect(() => { getErpCacheInfo().then(setCacheInfo).catch(() => {}); }, []);
  useEffect(() => { fetchBrands().then(setBrandList).catch(() => {}); }, []);

  // full=false pulls only items whose `modified` is newer than the stored
  // cursor; full=true rebuilds from scratch and prunes items deleted in ERP.
  const runSync = async (full) => {
    if (!isConnected || syncState === 'loading') return;
    setSyncState('loading'); setSyncErr(''); setSyncLog([]); setSyncProgress('');
    const addLog = m => setSyncLog(p => [...p, m]);
    try {
      const startedAt = new Date().toISOString();
      let since = full ? null : cacheInfo?.cursor;
      // Metadata row missing or never written — resume from what's already cached
      // rather than re-crawling the whole catalogue.
      if (!full && !since) {
        since = await getErpMaxModified();
        if (since) addLog('Recovered sync position from cached items.');
      }
      let total = 0, start = 0, rounds = 0, cursor = since;

      // Each call walks several ERP pages on one login and hands back where to
      // resume; page-level pacing and retries happen server-side.
      for (;;) {
        const { items, nextStart, done } = await callProxy(email.trim(), password.trim(), {
          action: 'items', limit_start: start, pages: 10,
          ...(since ? { modified_since: since } : {}),
        });
        if (items?.length) {
          await syncErpItemsBatch(items, startedAt);
          // Frappe timestamps sort correctly as plain strings.
          for (const i of items) if (i.modified && (!cursor || i.modified > cursor)) cursor = i.modified;
          total += items.length;
          setSyncProgress(`${full ? 'Full sync' : 'Syncing changes'}... ${total.toLocaleString()} items`);
          // Checkpoint so a dropped connection doesn't cost the whole run.
          if (++rounds % 2 === 0 && cursor) await saveErpSyncCursor(cursor, startedAt);
        }
        if (done) break;
        start = nextStart;
      }

      setSyncProgress('');
      addLog(total === 0
        ? 'Already up to date — no changes in ERP.'
        : `${total.toLocaleString()} item${total === 1 ? '' : 's'} ${full ? 'synced' : 'updated'}.`);

      if (full) {
        await pruneStaleErpItems(startedAt);
        addLog('Removed items no longer in ERP.');
      }

      const count = await countErpItems();
      await updateErpSyncMeta({ syncedAt: startedAt, cursor, count });
      setCacheInfo({ count, syncedAt: startedAt, cursor });
      setSyncState('done');
    } catch (err) {
      setSyncProgress('');
      setSyncErr(err.message || 'Unknown error');
      setSyncState('error');
    }
  };

  // ── Section 1: Price Export ──────────────────────────────────
  const [brandList, setBrandList] = useState([]);
  const [expBrands, setExpBrands] = useState([]);   // empty = all brands
  const [expState,  setExpState]  = useState('idle');
  const [expMerged, setExpMerged] = useState(null);
  const [expLog,    setExpLog]    = useState([]);
  const [expErr,    setExpErr]    = useState('');

  const handlePriceExport = async () => {
    if (!isConnected || expState === 'loading') return;
    setExpState('loading'); setExpErr(''); setExpLog([]); setExpMerged(null);
    const addLog = m => setExpLog(p => [...p, m]);
    try {
      const scoped = expBrands.length > 0;
      addLog(scoped ? `Fetching DB prices for ${expBrands.length} brand(s)...` : 'Fetching DB prices...');
      const dbRows      = await fetchAllItemsForErpAutomation(scoped ? expBrands : undefined);
      addLog(`DB: ${dbRows.length.toLocaleString()} rows.`);
      const dbByCode    = Object.fromEntries(dbRows.map(r => [r.item_code, r]));
      const dbByBarcode = Object.fromEntries(dbRows.filter(r => r.barcode).map(r => [r.barcode, r]));

      // The ERP report API returns the whole price list, so brand narrowing is
      // applied here: keep a row if its code carries a selected brand prefix or
      // its matched DB row belongs to one.
      const prefixes = expBrands.map(b => `${b}-`);
      const inScope  = (row) =>
        !scoped ||
        prefixes.some(p => (row.item_code || '').toUpperCase().startsWith(p)) ||
        (dbByCode[row.item_code] && expBrands.includes(dbByCode[row.item_code].brand_code));

      const merged = {};
      for (const rep of PRICE_REPORTS) {
        addLog(`Fetching ${rep.currency} report...`);
        const all  = await fetchReport(email.trim(), password.trim(), rep.name);
        const rows = all.filter(inScope);
        merged[rep.key] = mergeByCode(rows, dbByCode, dbByBarcode, rep.dbField);
        addLog(scoped
          ? `${rep.currency}: ${rows.length.toLocaleString()} of ${all.length.toLocaleString()} rows in scope, ${merged[rep.key].filter(r => !r._missing).length} matched.`
          : `${rep.currency}: ${rows.length.toLocaleString()} rows, ${merged[rep.key].filter(r => !r._missing).length} matched.`);
      }
      setExpMerged(merged);
      setExpState('done');
    } catch (err) {
      setExpErr(err.message || 'Unknown error');
      setExpState('error');
    }
  };

  // ── Section 2: Item Coverage ─────────────────────────────────
  const [covState,  setCovState]  = useState('idle');
  const [covResult, setCovResult] = useState(null);
  const [covLog,    setCovLog]    = useState([]);
  const [covErr,    setCovErr]    = useState('');
  const [covBrands, setCovBrands] = useState([]);   // empty = all brands

  // The anti-join runs in Postgres and returns only the missing rows. Brand
  // scoping narrows the pricing-master side; the ERP cache is always checked in
  // full, so a scoped run can never report an item as missing that is present.
  const handleCoverage = async () => {
    if (covState === 'loading') return;
    setCovState('loading'); setCovErr(''); setCovLog([]); setCovResult(null);
    const addLog = m => setCovLog(p => [...p, m]);
    try {
      const scoped = covBrands.length > 0;
      addLog(scoped ? `Comparing ${covBrands.length} brand(s) against the ERP cache...`
                    : 'Comparing the pricing master against the ERP cache...');
      const result = await fetchErpCoverage(scoped ? covBrands : undefined);
      addLog(`ERP cache: ${result.erpTotal.toLocaleString()} items.`);
      addLog(scoped ? `DB in scope: ${result.dbTotal.toLocaleString()} items.`
                    : `DB: ${result.dbTotal.toLocaleString()} items.`);
      addLog(`${result.notInErp.length.toLocaleString()} DB items not in ERP.`);
      setCovResult({ ...result, scoped, brands: covBrands });
      setCovState('done');
    } catch (err) {
      setCovErr(err.message || 'Unknown error');
      setCovState('error');
    }
  };

  // ── Section 3: Price Match ───────────────────────────────────
  const [matchState,  setMatchState]  = useState('idle');
  const [matchResult, setMatchResult] = useState(null);
  const [matchLog,    setMatchLog]    = useState([]);
  const [matchErr,    setMatchErr]    = useState('');

  const handlePriceMatch = async () => {
    if (!isConnected || matchState === 'loading') return;
    setMatchState('loading'); setMatchErr(''); setMatchLog([]); setMatchResult(null);
    const addLog = m => setMatchLog(p => [...p, m]);
    try {
      addLog('Fetching price list reports...');
      const withPrice = new Set();
      for (const rep of PRICE_REPORTS) {
        const rows = await fetchReport(email.trim(), password.trim(), rep.name);
        rows.forEach(r => {
          if (r.item_code && Number(r.price_list_rate) > 0)
            withPrice.add(r.item_code.toUpperCase());
        });
        addLog(`${rep.currency}: ${rows.length.toLocaleString()} rows.`);
      }
      addLog(`${withPrice.size.toLocaleString()} items with retail price across all lists.`);

      addLog('Loading DB items...');
      const dbRows = await fetchAllItemsForErpAutomation();
      addLog(`DB: ${dbRows.length.toLocaleString()} items.`);

      // Narrow to unpriced items FIRST, then ask the cache about only those —
      // avoids materialising the whole ERP catalogue to answer a membership test.
      const candidates = dbRows.filter(r => !withPrice.has(r.item_code?.toUpperCase()));
      addLog(`${candidates.length.toLocaleString()} DB items with no retail price list entry.`);

      addLog('Checking which exist in ERP...');
      const inErp = await filterCodesInErpCache(
        candidates.map(r => r.item_code?.toUpperCase()).filter(Boolean)
      );

      const rows = candidates
        .filter(r => inErp.has(r.item_code?.toUpperCase()))
        .map(r => ({
          item_code:  r.item_code,
          item_name:  r.item_name,
          brand_code: r.brand_code,
          barcode:    r.barcode   ?? '',
          msrp_aed:   r.msrp_aed  ?? '',
          msrp_sar:   r.msrp_sar  ?? '',
          msrp_qat:   r.msrp_qat  ?? '',
        }));

      addLog(`${rows.length.toLocaleString()} of those exist in ERP.`);
      setMatchResult({ total: rows.length, rows });
      setMatchState('done');
    } catch (err) {
      setMatchErr(err.message || 'Unknown error');
      setMatchState('error');
    }
  };

  const hasCache = !!(cacheInfo?.count);

  return (
    <div style={{ maxWidth: 760, paddingBottom: 60 }}>

      {/* ── Connection ──────────────────────────────────────────── */}
      <div style={groupBox(false)}>
        <div style={{ ...groupHead, marginBottom: 16 }}>ERP Connection</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1.2 }}>
            <label style={lbl}>ERP Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={ERP_EMAIL_PH}
              style={{ ...inp(!!email, false), width: '100%' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>ERP Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your ERP password"
              style={{ ...inp(!!password, false), width: '100%' }}
            />
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: t.t4, fontFamily: 'var(--font-mono)' }}>{ERP_HOST}</div>
      </div>

      {/* ── Cost Lookup ──────────────────────────────────────────── */}
      <div style={{ ...groupBox(false), marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ ...groupHead, marginBottom: 4 }}>Cost Lookup</div>
            <div style={{ fontSize: 12, color: t.t4 }}>
              Paste a list of item codes and get their EXW costs back.
            </div>
          </div>
          <button
            onClick={() => navigate('/apps/others/cost-lookup')}
            style={{ ...btnG, marginLeft: 16, flexShrink: 0 }}
          >Open →</button>
        </div>
      </div>

      {/* ── ERP Item Cache ───────────────────────────────────────── */}
      <div style={{ ...groupBox(false), marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ ...groupHead, marginBottom: 4 }}>ERP Item Cache</div>
            <div style={{ fontSize: 12, color: t.t4 }}>
              {cacheInfo === null
                ? 'Checking cache...'
                : cacheInfo.count === 0
                  ? 'Empty — run a full sync to pull the ERP item list.'
                  : `${cacheInfo.count.toLocaleString()} items · last synced ${new Date(cacheInfo.syncedAt).toLocaleString()}`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <button
              onClick={() => runSync(true)}
              disabled={!isConnected || syncState === 'loading'}
              style={{
                ...btnG, marginLeft: 16, whiteSpace: 'nowrap',
                opacity: (!isConnected || syncState === 'loading') ? 0.4 : 1,
                cursor:  (!isConnected || syncState === 'loading') ? 'not-allowed' : 'pointer',
              }}
            >Full Resync</button>
            <RunBtn
              label={cacheInfo?.count ? 'Sync Changes' : 'Sync Now'}
              loading={syncState === 'loading'}
              disabled={!isConnected}
              onClick={() => runSync(false)}
            />
          </div>
        </div>
        <LogBox lines={syncLog} progress={syncProgress} />
        <ErrBox msg={syncErr} />
      </div>

      {/* ── Section 1: Price Export ──────────────────────────────── */}
      <div style={{ ...groupBox(false), marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ ...groupHead, marginBottom: 4 }}>Price Export</div>
            <div style={{ fontSize: 12, color: t.t4, marginBottom: expLog.length ? 0 : 4 }}>
              Fetch the three ERP price list reports and generate upload-ready CSVs with updated rates.
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, marginLeft:16 }}>
            <BrandMultiSelect brands={brandList} selected={expBrands} onChange={setExpBrands} />
            <RunBtn label="Fetch Reports" loading={expState === 'loading'} disabled={!isConnected} onClick={handlePriceExport} />
          </div>
        </div>

        <LogBox lines={expLog} />
        <ErrBox msg={expErr} />

        {expState === 'done' && expMerged && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PRICE_REPORTS.map(rep => {
              const rows    = expMerged[rep.key];
              const matched = rows.filter(r => !r._missing).length;
              return (
                <div key={rep.key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
                  background: t.bg3, border: `1px solid ${t.b2}`, borderRadius: 10, padding: '12px 16px',
                }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1 }}>
                    <span style={{ fontSize: 13, color: t.t1, fontWeight: 500, minWidth: 50 }}>{rep.currency}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <StatPill label="ERP rows" value={rows.length} />
                      <StatPill label="matched"  value={matched} color={t.green} />
                      {rows.length - matched > 0 && <StatPill label="no price" value={rows.length - matched} color={t.amber} />}
                    </div>
                  </div>
                  <button
                    onClick={() => downloadXLSX(rows, `${rep.name}_${today}.xlsx`, { headers: ['name', 'item_code', 'price_list', 'currency', 'price_list_rate', 'new_rate', 'barcode', 'match_type'] })}
                    style={{ ...btnG, display: 'flex', alignItems: 'center', gap: 6 }}
                  >↓ XLSX</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Section 2: Item Coverage ─────────────────────────────── */}
      <div style={{ ...groupBox(false), marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ ...groupHead, marginBottom: 4 }}>Item Coverage</div>
            <div style={{ fontSize: 12, color: t.t4, marginBottom: covLog.length ? 0 : 4 }}>
              Compare the pricing master against the ERP item cache — find DB items missing from ERP.
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, marginLeft:16 }}>
            <BrandMultiSelect brands={brandList} selected={covBrands} onChange={setCovBrands} />
            <RunBtn label="Check Coverage" loading={covState === 'loading'} disabled={!hasCache} onClick={handleCoverage} />
          </div>
        </div>

        <LogBox lines={covLog} />
        <ErrBox msg={covErr} />

        {covState === 'done' && covResult && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <StatPill label="ERP cached" value={covResult.erpTotal.toLocaleString()} />
              <StatPill label={covResult.scoped ? 'DB in scope' : 'DB items'} value={covResult.dbTotal.toLocaleString()} />
              <StatPill
                label="not in ERP"
                value={covResult.notInErp.length.toLocaleString()}
                color={covResult.notInErp.length > 0 ? t.amber : t.green}
              />
            </div>
            {/* A scoped run answers a narrower question than the headline pills
                suggest, so say which brands it covered. */}
            {covResult.scoped && (
              <div style={{ fontSize: 12, color: t.t4, marginBottom: 10 }}>
                Scoped to {covResult.brands.join(', ')} — the full ERP cache was still checked.
              </div>
            )}
            {covResult.notInErp.length > 0 && (
              <button
                onClick={() => downloadXLSX(covResult.notInErp, `db_not_in_erp_${covResult.scoped ? covResult.brands.join('-') + '_' : ''}${today}.xlsx`, { headers: ['item_code', 'item_name', 'brand_code', 'barcode', 'msrp_aed', 'msrp_sar', 'msrp_qat'] })}
                style={{ ...btnG, display: 'flex', alignItems: 'center', gap: 6 }}
              >↓ XLSX ({covResult.notInErp.length.toLocaleString()} items)</button>
            )}
            {covResult.notInErp.length === 0 && (
              <div style={{ fontSize: 13, color: t.green }}>
                {covResult.scoped ? 'All DB items in scope are present in the ERP.' : 'All DB items are present in the ERP.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Section 3: Stock Without Price ───────────────────────── */}
      <div style={{ ...groupBox(false), marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ ...groupHead, marginBottom: 4 }}>Stock Without Price</div>
            <div style={{ fontSize: 12, color: t.t4, marginBottom: stkLog.length ? 0 : 4 }}>
              Pull the ERP&apos;s in-stock-without-price report and fill in AED, SAR and QAR from the pricing master.
            </div>
          </div>
          <RunBtn label="Fetch & Fill" loading={stkState === 'loading'} disabled={!isConnected} onClick={handleStockNoPrice} />
        </div>

        <LogBox lines={stkLog} />
        <ErrBox msg={stkErr} />

        {stkState === 'done' && stkResult && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <StatPill label="in report" value={stkResult.rows.length.toLocaleString()} />
              <StatPill label="priced"    value={stkResult.matched.toLocaleString()} color={t.green} />
              {stkResult.rows.length - stkResult.matched > 0 && (
                <StatPill label="no DB price" value={(stkResult.rows.length - stkResult.matched).toLocaleString()} color={t.amber} />
              )}
            </div>
            {stkResult.rows.length > 0 ? (
              <button
                onClick={() => downloadXLSX(stkResult.rows, `stock_without_price_${today}.xlsx`, { headers: stkResult.headers })}
                style={{ ...btnG, display: 'flex', alignItems: 'center', gap: 6 }}
              >↓ XLSX ({stkResult.rows.length.toLocaleString()} rows)</button>
            ) : (
              <div style={{ fontSize: 13, color: t.green }}>Nothing in stock is missing a price.</div>
            )}
          </div>
        )}
      </div>

      {/* ── Section 4: Price Match ───────────────────────────────── */}
      <div style={{ ...groupBox(false), marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ ...groupHead, marginBottom: 4 }}>Price Match Report</div>
            <div style={{ fontSize: 12, color: t.t4, marginBottom: matchLog.length ? 0 : 4 }}>
              DB items not covered by any retail price list — matched against the ERP item cache.
            </div>
          </div>
          <RunBtn label="Generate Report" loading={matchState === 'loading'} disabled={!isConnected || !hasCache} onClick={handlePriceMatch} />
        </div>

        <LogBox lines={matchLog} />
        <ErrBox msg={matchErr} />

        {matchState === 'done' && matchResult && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <StatPill label="DB items" value={matchResult.total.toLocaleString()} />
            </div>
            <button
              onClick={() => downloadXLSX(matchResult.rows, `unpriced_items_${today}.xlsx`, { headers: ['item_code', 'item_name', 'brand_code', 'barcode', 'msrp_aed', 'msrp_sar', 'msrp_qat'] })}
              style={{ ...btnG, display: 'flex', alignItems: 'center', gap: 6 }}
            >↓ XLSX ({matchResult.total.toLocaleString()} items)</button>
          </div>
        )}
      </div>

    </div>
  );
}
