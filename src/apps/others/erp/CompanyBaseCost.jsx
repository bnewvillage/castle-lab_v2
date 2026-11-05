import { useState } from 'react';
import { fetchAllItemPrices } from '../../../lib/db';
import { MARKETS } from '../../../lib/markets';
import { downloadXLSX } from '../../../lib/xlsxExport';
import { today, useJob, useBrandList, BrandMultiSelect, LogBox, ErrBox, RunBtn, Section } from './shared';

const EXPORT_HEADERS = ['item_code', 'item_name', 'brand_code', 'exw_cost', 'cost_currency', ...MARKETS.map(m => m.baseCost)];

// Company base cost: each item's EXW cost converted at the stored rates into
// every market's currency — what the group's companies bill each other. Stored
// with the item and worked out again whenever its cost or currency is saved;
// this exports it, for every brand or a selection.
export default function CompanyBaseCost() {
  const brandList = useBrandList();
  const [brands, setBrands] = useState([]);   // empty = every brand
  const exp = useJob();
  const scopeLabel = brands.length ? `${brands.length} brand${brands.length === 1 ? '' : 's'}` : 'every brand';

  const runExport = () => exp.run(async (log) => {
    log(`Reading the catalogue for ${scopeLabel}…`);
    const all   = await fetchAllItemPrices();
    const items = brands.length ? all.filter(i => brands.includes(i.brand_code)) : all;
    const rows  = items.map(i => Object.fromEntries(EXPORT_HEADERS.map(h => [h, i[h] ?? ''])));
    downloadXLSX(rows, `company_base_cost_${brands.length ? brands.join('-') + '_' : ''}${today()}.xlsx`, { headers: EXPORT_HEADERS });
    log(`${rows.length.toLocaleString()} SKUs exported.`);
    return rows.length;
  });

  return (
    <div style={{ maxWidth: 760, paddingBottom: 60 }}>
      <Section title="Company base cost" tight={exp.log.length > 0}
        description={`Each SKU's EXW cost converted at the stored rates into ${MARKETS.map(m => m.currency).join(', ')} — what the group's companies bill each other — with its EXW cost and currency.`}
        controls={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 16 }}>
            <BrandMultiSelect brands={brandList} selected={brands} onChange={setBrands} />
            <RunBtn label="Export (.xlsx)" loading={exp.loading} onClick={runExport} />
          </div>
        }>
        <LogBox lines={exp.log} />
        <ErrBox msg={exp.err} />
      </Section>
    </div>
  );
}
