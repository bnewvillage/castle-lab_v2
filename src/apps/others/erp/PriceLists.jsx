import { useState } from 'react';
import { t, btnG } from '../../pricing/styles';
import { fetchAllItemsForErpAutomation, fetchProjectItems } from '../../../lib/db';
import { PROJECT_BRAND, projectAsItem } from '../../../lib/rows';
import { downloadXLSX } from '../../../lib/xlsxExport';
import { fetchReportsIndependently } from '../../../lib/erpReports';
import { MARKETS, PRICE_COLUMNS } from '../../../lib/markets';
import ErpConnection from '../ErpConnection';
import {
  PRICE_REPORTS, fetchReport, codeKey, today, useJob, useBrandList,
  BrandMultiSelect, StatPill, LogBox, ErrBox, RunBtn, Section,
} from './shared';

const STOCK_NO_PRICE_REPORT = 'Item In Stock Without Price';
// The report's own column naming isn't known up front, so the item code column
// is detected from the first of these that actually carries values.
const ITEM_CODE_KEYS = ['item_code', 'item', 'name', 'sku', 'item_id'];
const CURRENCIES = MARKETS.map(m => m.currency);

function detectItemKey(rows) {
  if (!rows?.length) return null;
  return ITEM_CODE_KEYS.find(k => rows.some(r => r?.[k])) ?? null;
}

/**
 * The prices an ERP list is matched against: the catalogue's and the project
 * items'. brands narrows it (empty = everything); PROJECT_BRAND in it stands
 * for the project items.
 */
async function fetchPrices(brands = []) {
  const scoped    = brands.length > 0;
  const catalogue = brands.filter(b => b !== PROJECT_BRAND);
  const [items, projects] = await Promise.all([
    !scoped ? fetchAllItemsForErpAutomation() : catalogue.length ? fetchAllItemsForErpAutomation(catalogue) : [],
    !scoped || brands.includes(PROJECT_BRAND) ? fetchProjectItems() : [],
  ]);
  return { rows: [...items, ...projects.map(projectAsItem)], projects: projects.length };
}

const dbLog = ({ rows, projects }) => `DB: ${rows.length.toLocaleString()} rows${projects ? `, ${projects.toLocaleString()} of them project items` : ''}.`;

function mergeByCode(erpRows, dbByCode, dbByBarcode, dbField) {
  return erpRows.map(row => {
    const key       = codeKey(row.item_code);
    const byCode    = dbByCode[key];
    const byBarcode = !byCode ? dbByBarcode[key] : null;
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

// Files for the ERP's price lists: each list with its new rates, and prices for
// stock the ERP holds without one. The ERP login is held by the page container
// so it carries between the ERP pages.
export default function PriceLists({ creds, setCreds }) {
  const email = creds.email.trim(), password = creds.password.trim();
  const isConnected = !!(email && password);
  const brands = useBrandList();
  // Project items sit in the brand filter as one more brand.
  const brandList = brands.some(b => b.brand_code === PROJECT_BRAND)
    ? brands : [...brands, { brand_code: PROJECT_BRAND, brand_name: 'Project items' }];

  // ── Price Export ─────────────────────────────────────────────
  const [expBrands, setExpBrands] = useState([]);   // empty = all brands
  const exp = useJob();

  const handlePriceExport = () => isConnected && exp.run(async (addLog) => {
    const scoped = expBrands.length > 0;
    addLog(scoped ? `Fetching DB prices for ${expBrands.length} brand(s)...` : 'Fetching DB prices...');
    const db          = await fetchPrices(expBrands);
    const dbRows      = db.rows;
    addLog(dbLog(db));
    const dbByCode    = Object.fromEntries(dbRows.map(r => [codeKey(r.item_code), r]));
    const dbByBarcode = Object.fromEntries(dbRows.filter(r => r.barcode).map(r => [codeKey(r.barcode), r]));

    // The ERP report API returns the whole price list, so brand narrowing is
    // applied here: keep a row if its code carries a selected brand prefix or
    // its matched DB row belongs to one.
    const prefixes = expBrands.map(b => `${b}-`);
    const inScope  = (row) => {
      if (!scoped) return true;
      const key = codeKey(row.item_code);
      return prefixes.some(p => key.startsWith(p))
          || (dbByCode[key] && expBrands.includes(dbByCode[key].brand_code));
    };

    // Each price list on its own: one that fails is skipped, the rest still export.
    const merged = {};
    const { failed } = await fetchReportsIndependently(PRICE_REPORTS,
      (rep) => { addLog(`Fetching ${rep.currency} report...`); return fetchReport(email, password, rep.name); },
      (rep, all, why) => {
        if (!all) { addLog(`${rep.currency}: skipped — ${why}. The other lists are unaffected.`); return; }
        const rows = all.filter(inScope);
        merged[rep.key] = mergeByCode(rows, dbByCode, dbByBarcode, rep.dbField);
        addLog(scoped
          ? `${rep.currency}: ${rows.length.toLocaleString()} of ${all.length.toLocaleString()} rows in scope, ${merged[rep.key].filter(r => !r._missing).length} matched.`
          : `${rep.currency}: ${rows.length.toLocaleString()} rows, ${merged[rep.key].filter(r => !r._missing).length} matched.`);
      });
    return { merged, failed };
  });

  // ── Stock Without Price ──────────────────────────────────────
  const stk = useJob();

  const handleStockNoPrice = () => isConnected && stk.run(async (addLog) => {
    addLog('Fetching stock-without-price report...');
    const rows = await fetchReport(email, password, STOCK_NO_PRICE_REPORT);
    addLog(`${rows.length.toLocaleString()} rows returned.`);
    if (!rows.length) return { rows: [], headers: [], matched: 0 };

    const itemKey = detectItemKey(rows);
    if (!itemKey) {
      throw new Error(
        `Could not find an item code column. Columns returned: ${Object.keys(rows[0]).join(', ')}`,
      );
    }
    addLog(`Matching on "${itemKey}".`);

    addLog('Fetching DB prices...');
    const db          = await fetchPrices();
    const dbRows      = db.rows;
    const dbByCode    = Object.fromEntries(dbRows.map(r => [r.item_code?.toUpperCase(), r]));
    const dbByBarcode = Object.fromEntries(dbRows.filter(r => r.barcode).map(r => [String(r.barcode).toUpperCase(), r]));
    addLog(dbLog(db));

    const filled = rows.map(r => {
      const key    = String(r[itemKey] ?? '').toUpperCase();
      const byCode = dbByCode[key];
      const byBar  = !byCode ? dbByBarcode[key] : null;
      const db     = byCode ?? byBar ?? null;
      return {
        ...r,
        barcode:    db?.barcode  ?? '',
        ...Object.fromEntries(PRICE_COLUMNS.map(c => [c, db?.[c] ?? ''])),
        match_type: byCode ? 'item_code' : byBar ? 'barcode' : 'no_match',
        _missing:   !db,
      };
    });

    // Report columns first, then the ones we appended — keeps the sheet
    // recognisable next to the ERP view.
    const added    = ['barcode', ...PRICE_COLUMNS, 'match_type'];
    const original = Object.keys(rows[0]).filter(k => !added.includes(k));
    const matched  = filled.filter(r => !r._missing).length;
    addLog(`${matched.toLocaleString()} of ${filled.length.toLocaleString()} priced from the DB.`);
    return { rows: filled, headers: [...original, ...added], matched };
  });

  return (
    <div style={{ maxWidth: 760, paddingBottom: 60 }}>

      <ErpConnection creds={creds} setCreds={setCreds} />

      <Section title="Price Export" tight={exp.log.length > 0}
        description={`Fetch the ERP price list reports (${CURRENCIES.join(', ')}) and generate upload-ready files with updated rates, project items included. A list the ERP doesn't have yet is skipped; the others still export.`}
        controls={
          <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, marginLeft:16 }}>
            <BrandMultiSelect brands={brandList} selected={expBrands} onChange={setExpBrands} />
            <RunBtn label="Fetch Reports" loading={exp.loading} disabled={!isConnected} onClick={handlePriceExport} />
          </div>
        }>
        <LogBox lines={exp.log} />
        <ErrBox msg={exp.err} />

        {exp.result && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {exp.result.failed.map(({ report, reason }) => (
              <div key={report.key} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 10, padding: '12px 16px',
              }}>
                <span style={{ fontSize: 13, color: t.t1, fontWeight: 500, minWidth: 50 }}>{report.currency}</span>
                <span style={{ fontSize: 12.5, color: t.amber }}>Skipped — {reason}. The other lists are unaffected.</span>
              </div>
            ))}
            {PRICE_REPORTS.filter(rep => exp.result.merged[rep.key]).map(rep => {
              const rows    = exp.result.merged[rep.key];
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
                    onClick={() => downloadXLSX(rows, `${rep.name}_${today()}.xlsx`, { headers: ['name', 'item_code', 'price_list', 'currency', 'price_list_rate', 'new_rate', 'barcode', 'match_type'] })}
                    style={{ ...btnG, display: 'flex', alignItems: 'center', gap: 6 }}
                  >↓ XLSX</button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Stock Without Price" tight={stk.log.length > 0}
        description={`Pull the ERP's in-stock-without-price report and fill in ${CURRENCIES.slice(0, -1).join(', ')} and ${CURRENCIES[CURRENCIES.length - 1]} from the pricing master and project items.`}
        controls={<RunBtn label="Fetch & Fill" loading={stk.loading} disabled={!isConnected} onClick={handleStockNoPrice} />}>
        <LogBox lines={stk.log} />
        <ErrBox msg={stk.err} />

        {stk.result && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <StatPill label="in report" value={stk.result.rows.length.toLocaleString()} />
              <StatPill label="priced"    value={stk.result.matched.toLocaleString()} color={t.green} />
              {stk.result.rows.length - stk.result.matched > 0 && (
                <StatPill label="no DB price" value={(stk.result.rows.length - stk.result.matched).toLocaleString()} color={t.amber} />
              )}
            </div>
            {stk.result.rows.length > 0 ? (
              <button
                onClick={() => downloadXLSX(stk.result.rows, `stock_without_price_${today()}.xlsx`, { headers: stk.result.headers })}
                style={{ ...btnG, display: 'flex', alignItems: 'center', gap: 6 }}
              >↓ XLSX ({stk.result.rows.length.toLocaleString()} rows)</button>
            ) : (
              <div style={{ fontSize: 13, color: t.green }}>Nothing in stock is missing a price.</div>
            )}
          </div>
        )}
      </Section>

    </div>
  );
}
