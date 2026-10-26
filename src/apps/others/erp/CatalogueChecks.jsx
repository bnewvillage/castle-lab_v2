import { useState, useEffect } from 'react';
import { t, btnG } from '../../pricing/styles';
import {
  fetchAllItemsForErpAutomation,
  syncErpItemsBatch, pruneStaleErpItems, fetchErpCoverage, filterCodesInErpCache,
  countErpItems, getErpCacheInfo, updateErpSyncMeta,
  saveErpSyncCursor, getErpMaxModified,
} from '../../../lib/db';
import { downloadXLSX } from '../../../lib/xlsxExport';
import { callErpProxy } from '../../../lib/erpProxy';
import { fetchReportsIndependently } from '../../../lib/erpReports';
import { PRICE_COLUMNS } from '../../../lib/markets';
import ErpConnection from '../ErpConnection';
import {
  PRICE_REPORTS, fetchReport, today, useJob, useBrandList,
  BrandMultiSelect, StatPill, LogBox, ErrBox, RunBtn, Section,
} from './shared';

const ITEM_HEADERS = ['item_code', 'item_name', 'brand_code', 'barcode', ...PRICE_COLUMNS];

// The catalogue against the ERP: a local cache of the ERP's item list, the
// items missing from it, and the items no price list covers. The ERP login is
// held by the page container so it carries between the ERP pages.
export default function CatalogueChecks({ creds, setCreds }) {
  const email = creds.email.trim(), password = creds.password.trim();
  const isConnected = !!(email && password);
  const brandList = useBrandList();

  // ── ERP Item Cache ───────────────────────────────────────────
  const [cacheInfo,    setCacheInfo]    = useState(null);
  const [syncProgress, setSyncProgress] = useState('');
  const sync = useJob();

  useEffect(() => { getErpCacheInfo().then(setCacheInfo).catch(() => {}); }, []);

  // full=false pulls only items whose `modified` is newer than the stored
  // cursor; full=true rebuilds from scratch and prunes items deleted in ERP.
  const runSync = (full) => isConnected && sync.run(async (addLog) => {
    setSyncProgress('');
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
        const { items, nextStart, done } = await callErpProxy(email, password, {
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
      return { count };
    } finally {
      setSyncProgress('');
    }
  });

  const hasCache = !!(cacheInfo?.count);

  // ── Item Coverage ────────────────────────────────────────────
  const [covBrands, setCovBrands] = useState([]);   // empty = all brands
  const cov = useJob();

  // The anti-join runs in Postgres and returns only the missing rows. Brand
  // scoping narrows the pricing-master side; the ERP cache is always checked in
  // full, so a scoped run can never report an item as missing that is present.
  const handleCoverage = () => cov.run(async (addLog) => {
    const scoped = covBrands.length > 0;
    addLog(scoped ? `Comparing ${covBrands.length} brand(s) against the ERP cache...`
                  : 'Comparing the pricing master against the ERP cache...');
    const result = await fetchErpCoverage(scoped ? covBrands : undefined);
    addLog(`ERP cache: ${result.erpTotal.toLocaleString()} items.`);
    addLog(scoped ? `DB in scope: ${result.dbTotal.toLocaleString()} items.`
                  : `DB: ${result.dbTotal.toLocaleString()} items.`);
    addLog(`${result.notInErp.length.toLocaleString()} DB items not in ERP.`);
    return { ...result, scoped, brands: covBrands };
  });

  // ── Price Match ──────────────────────────────────────────────
  const match = useJob();

  const handlePriceMatch = () => isConnected && match.run(async (addLog) => {
    addLog('Fetching price list reports...');
    const withPrice = new Set();
    const { failed } = await fetchReportsIndependently(PRICE_REPORTS,
      (rep) => fetchReport(email, password, rep.name),
      (rep, rows, why) => {
        if (!rows) { addLog(`${rep.currency}: skipped — ${why}. Items priced only on that list will show as unpriced.`); return; }
        rows.forEach(r => {
          if (r.item_code && Number(r.price_list_rate) > 0)
            withPrice.add(r.item_code.toUpperCase());
        });
        addLog(`${rep.currency}: ${rows.length.toLocaleString()} rows.`);
      });
    if (failed.length) addLog(`Coverage below leaves out ${failed.map(f => f.report.currency).join(', ')}.`);
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
        barcode:    r.barcode ?? '',
        ...Object.fromEntries(PRICE_COLUMNS.map(c => [c, r[c] ?? ''])),
      }));

    addLog(`${rows.length.toLocaleString()} of those exist in ERP.`);
    return { total: rows.length, rows };
  });

  return (
    <div style={{ maxWidth: 760, paddingBottom: 60 }}>

      <ErpConnection creds={creds} setCreds={setCreds} />

      <Section title="ERP Item Cache" tight
        description={cacheInfo === null
          ? 'Checking cache...'
          : cacheInfo.count === 0
            ? 'Empty — run a full sync to pull the ERP item list.'
            : `${cacheInfo.count.toLocaleString()} items · last synced ${new Date(cacheInfo.syncedAt).toLocaleString()}`}
        controls={
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <button
              onClick={() => runSync(true)}
              disabled={!isConnected || sync.loading}
              style={{
                ...btnG, marginLeft: 16, whiteSpace: 'nowrap',
                opacity: (!isConnected || sync.loading) ? 0.4 : 1,
                cursor:  (!isConnected || sync.loading) ? 'not-allowed' : 'pointer',
              }}
            >Full Resync</button>
            <RunBtn
              label={cacheInfo?.count ? 'Sync Changes' : 'Sync Now'}
              loading={sync.loading}
              disabled={!isConnected}
              onClick={() => runSync(false)}
            />
          </div>
        }>
        <LogBox lines={sync.log} progress={syncProgress} />
        <ErrBox msg={sync.err} />
      </Section>

      <Section title="Item Coverage" tight={cov.log.length > 0}
        description="Compare the pricing master against the ERP item cache — find DB items missing from ERP."
        controls={
          <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, marginLeft:16 }}>
            <BrandMultiSelect brands={brandList} selected={covBrands} onChange={setCovBrands} />
            <RunBtn label="Check Coverage" loading={cov.loading} disabled={!hasCache} onClick={handleCoverage} />
          </div>
        }>
        <LogBox lines={cov.log} />
        <ErrBox msg={cov.err} />

        {cov.result && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <StatPill label="ERP cached" value={cov.result.erpTotal.toLocaleString()} />
              <StatPill label={cov.result.scoped ? 'DB in scope' : 'DB items'} value={cov.result.dbTotal.toLocaleString()} />
              <StatPill
                label="not in ERP"
                value={cov.result.notInErp.length.toLocaleString()}
                color={cov.result.notInErp.length > 0 ? t.amber : t.green}
              />
            </div>
            {/* A scoped run answers a narrower question than the headline pills
                suggest, so say which brands it covered. */}
            {cov.result.scoped && (
              <div style={{ fontSize: 12, color: t.t4, marginBottom: 10 }}>
                Scoped to {cov.result.brands.join(', ')} — the full ERP cache was still checked.
              </div>
            )}
            {cov.result.notInErp.length > 0 && (
              <button
                onClick={() => downloadXLSX(cov.result.notInErp, `db_not_in_erp_${cov.result.scoped ? cov.result.brands.join('-') + '_' : ''}${today()}.xlsx`, { headers: ITEM_HEADERS })}
                style={{ ...btnG, display: 'flex', alignItems: 'center', gap: 6 }}
              >↓ XLSX ({cov.result.notInErp.length.toLocaleString()} items)</button>
            )}
            {cov.result.notInErp.length === 0 && (
              <div style={{ fontSize: 13, color: t.green }}>
                {cov.result.scoped ? 'All DB items in scope are present in the ERP.' : 'All DB items are present in the ERP.'}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Price Match Report" tight={match.log.length > 0}
        description="DB items not covered by any retail price list — matched against the ERP item cache."
        controls={<RunBtn label="Generate Report" loading={match.loading} disabled={!isConnected || !hasCache} onClick={handlePriceMatch} />}>
        <LogBox lines={match.log} />
        <ErrBox msg={match.err} />

        {match.result && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <StatPill label="DB items" value={match.result.total.toLocaleString()} />
            </div>
            <button
              onClick={() => downloadXLSX(match.result.rows, `unpriced_items_${today()}.xlsx`, { headers: ITEM_HEADERS })}
              style={{ ...btnG, display: 'flex', alignItems: 'center', gap: 6 }}
            >↓ XLSX ({match.result.total.toLocaleString()} items)</button>
          </div>
        )}
      </Section>

    </div>
  );
}
