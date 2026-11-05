import { useState, useEffect } from 'react';
import { fetchBrandItems, fetchRates } from '../../lib/db';
import { brandProfile } from '../../lib/brandProfile';
import { t, groupBox, groupHead } from './styles';

// A share to one decimal, dropped when whole: 75%, 12.5%.
const pctLabel = (v) => { const r = Math.round(v * 10) / 10; return `${r % 1 ? r.toFixed(1) : r}%`; };
const marginLabel = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);
const mono = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };
const colHead = { fontSize: 10.5, color: t.t4, textTransform: 'uppercase', letterSpacing: '0.07em', ...mono, marginBottom: 8 };

// Count and share sit in fixed-width columns so they line up row to row.
const countCol = { ...mono, minWidth: 48, textAlign: 'right', color: t.t3 };
const shareCol = { ...mono, minWidth: 52, textAlign: 'right', color: t.t3 };

// One distinct value: its label, count and share, with a bar for the share.
function ShareRow({ label, count, pct }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12.5 }}>
        <span style={{ color: t.t2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={countCol}>{count.toLocaleString()}</span>
        <span style={shareCol}>{pctLabel(pct)}</span>
      </div>
      <div style={{ height: 3, background: t.b1, borderRadius: 2, marginTop: 4 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: t.blue, borderRadius: 2, opacity: 0.7 }} />
      </div>
    </div>
  );
}

// An example SKU, opening its Single SKU view in a new tab so whatever is
// being added here isn't lost.
const SkuLink = ({ sku }) => (
  <a href={`#/apps/pricing-master/single?item=${encodeURIComponent(sku)}`} target="_blank" rel="noopener noreferrer"
    title={`Open ${sku} in Single SKU`} style={{ color: t.blue, textDecoration: 'none' }}>{sku}</a>
);

// One margin's figures as a grid — label · margin · SKUs · share — so every
// column lines up. An example SKU sits on its own line under its row.
function MarginTable({ stats: exw }) {
  const cell  = { ...mono, fontSize: 12.5, textAlign: 'right', padding: '4px 0' };
  const label = { fontSize: 12.5, color: t.t3, padding: '4px 0' };
  const head  = { ...colHead, marginBottom: 2, textAlign: 'right' };
  const note  = { ...mono, gridColumn: '1 / -1', fontSize: 11.5, color: t.t4, textAlign: 'right', marginTop: -2, paddingBottom: 4 };
  const rule  = { gridColumn: '1 / -1', height: 1, background: t.b1, margin: '6px 0' };
  const skus  = (n) => n.toLocaleString();
  const row = (name, margin, x, sub) => [
    <span key={name + 'l'} style={label}>{name}</span>,
    <span key={name + 'm'} style={{ ...cell, color: t.t1, fontWeight: 500 }}>{margin}</span>,
    <span key={name + 'c'} style={{ ...cell, color: t.t3 }}>{x ? skus(x.count) : ''}</span>,
    <span key={name + 'p'} style={{ ...cell, color: t.t3 }}>{x ? pctLabel(x.pct) : ''}</span>,
    sub && <span key={name + 's'} style={note}>{sub}</span>,
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', columnGap: 18, alignItems: 'baseline' }}>
      <span />
      <span style={head}>margin</span>
      <span style={head}>SKUs</span>
      <span style={head}>share</span>
      {row('Median', marginLabel(exw.median))}
      {row('Mean', marginLabel(exw.mean))}
      {row('Mode', exw.mode ? marginLabel(exw.mode.value) : 'none', exw.mode, exw.mode ? null : 'no value repeats')}
      <span style={rule} />
      {row('Min', marginLabel(exw.min.value), exw.min, <>e.g. <SkuLink sku={exw.min.sku} /></>)}
      {row('Max', marginLabel(exw.max.value), exw.max, <>e.g. <SkuLink sku={exw.max.sku} /></>)}
    </div>
  );
}

// The SKUs a margin leaves out, by reason: "2 priced from cost, so no vendor MSRP".
const gapLine = (gaps) => gaps.map(g => `${g.count.toLocaleString()} ${g.reason}`).join(' · ');

// One margin across the brand: its figures, or why there are none, and how
// many SKUs it leaves out and why.
function MarginSection({ title, basis, stats }) {
  return (
    <div>
      {/* The basis on its own line, so both margin tables start at the same height. */}
      <div style={{ ...colHead, marginBottom: 0 }}>{title}</div>
      <div style={{ ...colHead, textTransform: 'none', letterSpacing: 0 }}>{basis}</div>
      {stats.n === 0 ? (
        <div style={{ fontSize: 12.5, color: t.t4, lineHeight: 1.5 }}>None for any SKU: {gapLine(stats.gaps)}.</div>
      ) : (
        <>
          <MarginTable stats={stats} />
          {stats.missing > 0 && (
            <div style={{ fontSize: 11.5, color: t.t4, marginTop: 8 }}>
              From {stats.n.toLocaleString()} SKU{stats.n === 1 ? '' : 's'}. Left out: {gapLine(stats.gaps)}.
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * How a brand's catalogue is set up today, shown while adding items to it:
 * SKU count, price bases, currencies, and the spread of EXW and landed margins
 * — four sections, two by two where the page is narrow. Fetches its
 * own rows (and rates, when the screen hasn't loaded them).
 */
export default function BrandProfile({ brandCode, rates: givenRates }) {
  const [data, setData] = useState(null);   // { code, profile } | { code, error }

  useEffect(() => {
    if (!brandCode) { setData(null); return; }
    let live = true;
    setData({ code: brandCode, loading: true });
    const rates = givenRates && Object.keys(givenRates).length ? Promise.resolve(givenRates) : fetchRates();
    Promise.all([fetchBrandItems(brandCode), rates])
      .then(([items, r]) => live && setData({ code: brandCode, profile: brandProfile(items, r) }))
      .catch(e => live && setData({ code: brandCode, error: e.message || 'Could not read the brand' }));
    return () => { live = false; };
  }, [brandCode, givenRates]);

  if (!brandCode || !data) return null;
  const p = data.profile;

  return (
    <div style={{ ...groupBox(false), marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: p?.count ? 14 : 0 }}>
        <div style={{ ...groupHead, marginBottom: 0 }}>{brandCode} in the catalogue</div>
        <span style={{ fontSize: 12.5, color: t.t3, ...mono }}>
          {data.loading ? 'Reading…' : data.error ? '' : `${p.count.toLocaleString()} SKU${p.count === 1 ? '' : 's'}`}
        </span>
      </div>
      {data.error && <div style={{ fontSize: 12.5, color: t.red }}>{data.error}</div>}
      {p && p.count === 0 && <div style={{ fontSize: 12.5, color: t.t4, marginTop: 6 }}>No SKUs yet — this will be the brand's first.</div>}

      {p?.count > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
          <div>
            <div style={colHead}>Price basis</div>
            {p.bases.map(b => <ShareRow key={b.label} {...b} />)}
          </div>

          <div>
            <div style={colHead}>Cost currency</div>
            {p.costCurrencies.map(c => <ShareRow key={c.label} {...c} />)}
            {p.msrpCurrencies.length > 0 && (
              <>
                <div style={{ ...colHead, marginTop: 12 }}>MSRP currency <span style={{ textTransform: 'none', letterSpacing: 0 }}>· of MSRP-priced SKUs</span></div>
                {p.msrpCurrencies.map(c => <ShareRow key={c.label} {...c} />)}
              </>
            )}
          </div>

          <MarginSection title="EXW margin" basis="vendor MSRP vs EXW cost" stats={p.exw} />

          <MarginSection title="Landed margin" basis="UAE price vs landed cost" stats={p.landed} />
        </div>
      )}
    </div>
  );
}
