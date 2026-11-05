import { useState, useEffect } from 'react';
import { fetchBrandItems, fetchRates } from '../../lib/db';
import { brandProfile } from '../../lib/brandProfile';
import { t, groupBox, groupHead } from './styles';

// A share to one decimal, dropped when whole: 75%, 12.5%.
const pctLabel = (v) => { const r = Math.round(v * 10) / 10; return `${r % 1 ? r.toFixed(1) : r}%`; };
const marginLabel = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);
const mono = { fontFamily: 'var(--font-mono)' };
const colHead = { fontSize: 10.5, color: t.t4, textTransform: 'uppercase', letterSpacing: '0.07em', ...mono, marginBottom: 8 };

// One distinct value: its label, count and share, with a bar for the share.
function ShareRow({ label, count, pct }) {
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
        <span style={{ color: t.t2 }}>{label}</span>
        <span style={{ color: t.t3, ...mono, whiteSpace: 'nowrap' }}>{count.toLocaleString()} · {pctLabel(pct)}</span>
      </div>
      <div style={{ height: 3, background: t.b1, borderRadius: 2, marginTop: 3 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: t.blue, borderRadius: 2, opacity: 0.7 }} />
      </div>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '3px 0' }}>
      <span style={{ color: t.t3 }}>{label}</span>
      <span style={{ color: t.t1, ...mono, textAlign: 'right' }}>
        {value}{note && <span style={{ color: t.t4 }}> · {note}</span>}
      </span>
    </div>
  );
}

/**
 * How a brand's catalogue is set up today, shown while adding items to it:
 * SKU count, price bases, currencies and the spread of EXW margins. Fetches its
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 24 }}>
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

          <div>
            <div style={colHead}>EXW margin <span style={{ textTransform: 'none', letterSpacing: 0 }}>· basis price vs EXW cost</span></div>
            {p.exw.n === 0 ? (
              <div style={{ fontSize: 12.5, color: t.t4 }}>No SKU has both a basis price and an EXW cost.</div>
            ) : (
              <>
                <Stat label="Median" value={marginLabel(p.exw.median)} />
                <Stat label="Mean"   value={marginLabel(p.exw.mean)} />
                <Stat label="Mode"   value={p.exw.mode ? marginLabel(p.exw.mode.value) : 'none'}
                  note={p.exw.mode ? `${p.exw.mode.count.toLocaleString()} SKUs · ${pctLabel(p.exw.mode.pct)}` : 'no value repeats'} />
                <div style={{ height: 1, background: t.b1, margin: '7px 0' }} />
                {[['Min', p.exw.min], ['Max', p.exw.max]].map(([label, x]) => (
                  <div key={label} style={{ padding: '3px 0' }}>
                    <Stat label={label} value={marginLabel(x.value)} note={`${x.count.toLocaleString()} SKU${x.count === 1 ? '' : 's'} · ${pctLabel(x.pct)}`} />
                    <div style={{ fontSize: 11.5, color: t.t4, ...mono, textAlign: 'right' }}>e.g. {x.sku}</div>
                  </div>
                ))}
                {p.exw.missing > 0 && (
                  <div style={{ fontSize: 11.5, color: t.t4, marginTop: 6 }}>
                    From {p.exw.n.toLocaleString()} SKU{p.exw.n === 1 ? '' : 's'}; {p.exw.missing.toLocaleString()} {p.exw.missing === 1 ? 'has' : 'have'} no EXW margin (cost-priced, or no cost data).
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
