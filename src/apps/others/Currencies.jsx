import { useEffect, useState } from 'react';
import { fetchCurrencies, updateRate, addCurrency } from '../../lib/db';
import { reloadCurrencies, newCurrencyProblem, rateProblem, rateChangePct } from '../../lib/currencies';
import { useAuth } from '../../lib/AuthContext';
import { toNum } from '../../lib/num';
import { t, inp, btnW, btnG, btnSm, lbl } from '../pricing/styles';
import { ErrBox, Section } from './erp/shared';

// A rate or its inverse, to 6 significant figures: 11.904762, 0.084.
const fmtRate = (n) => (n > 0 ? String(Number(n.toPrecision(6))) : '—');
const pctText = (p) => `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
// A change this big is more often a typo or a rate entered the wrong way round.
const LARGE_CHANGE_PCT = 10;

const cell = { padding: '10px 12px', borderBottom: `1px solid ${t.b1}`, fontSize: 13, color: t.t2, verticalAlign: 'middle' };
const head = { ...cell, fontSize: 10.5, color: t.t4, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 };
const mono = { fontFamily: 'var(--font-mono)' };

// The exchange_rates table: what one unit of each currency is worth in AED.
// Adding a currency here is all it takes for the currency dropdowns to offer it.
export default function Currencies() {
  const { isViewer } = useAuth();
  const [rows,   setRows]   = useState(null);
  const [drafts, setDrafts] = useState({});   // currency → the rate being typed
  const [busy,   setBusy]   = useState(null); // the currency being saved, or 'add'
  const [err,    setErr]    = useState('');
  const [done,   setDone]   = useState('');
  const [code,   setCode]   = useState('');
  const [rate,   setRate]   = useState('');

  const load = () => fetchCurrencies().then(setRows).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const run = async (key, action, message) => {
    setBusy(key); setErr(''); setDone('');
    try {
      await action();
      await Promise.all([load(), reloadCurrencies()]);
      setDone(message);
      return true;
    } catch (e) { setErr(e.message); return false; }
    finally { setBusy(null); }
  };

  const saveRate = async (cur) => {
    const next = toNum(drafts[cur]);
    if (await run(cur, () => updateRate(cur, next), `${cur} saved: 1 ${cur} = ${fmtRate(next)} AED.`))
      setDrafts(d => { const { [cur]: _, ...rest } = d; return rest; });
  };

  const existing = rows?.map(r => r.currency) ?? [];
  const newCode  = code.trim().toUpperCase();
  const newRate  = toNum(rate);
  const addProblem = (code || rate) ? newCurrencyProblem(newCode, rate, existing) : null;
  const add = async () => {
    if (await run('add', () => addCurrency(newCode, newRate), `${newCode} added at 1 ${newCode} = ${fmtRate(newRate)} AED. It's in the currency dropdowns now.`)) {
      setCode(''); setRate('');
    }
  };

  return (
    <div style={{ maxWidth: 820, paddingBottom: 60 }}>
      <Section title="Exchange rates"
        description="How many AED one unit of each currency is worth. Margins use a new rate straight away. Saved prices and company base costs don't move on their own: an item takes the new rate the next time it's saved, or when its brand's markup is applied in Brands.">
        <p style={{ fontSize: 12, color: t.t4, marginTop: 6 }}>
          KSA, Qatar and Kuwait prices don't use these rates: they come from the UAE price by the fixed factors in Price Rules. SAR, QAR and KWD here are for margins and company base cost.
        </p>
        {isViewer && <p style={{ fontSize: 12, color: t.amber, marginTop: 10 }}>View only: changing rates is for admins.</p>}

        {!rows ? <p style={{ fontSize: 13, color: t.t4, marginTop: 16 }}>{err ? '' : 'Loading…'}</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
            <thead>
              <tr>
                <th style={{ ...head, textAlign: 'left' }}>Currency</th>
                <th style={{ ...head, textAlign: 'left' }}>1 unit in AED</th>
                <th style={{ ...head, textAlign: 'right', whiteSpace: 'nowrap' }}>1 AED in it</th>
                <th style={{ ...head, textAlign: 'right', whiteSpace: 'nowrap' }}>Updated</th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                if (r.currency === 'AED') return (
                  <tr key="AED">
                    <td style={{ ...cell, ...mono, color: t.t1, fontWeight: 600 }}>AED</td>
                    <td style={{ ...cell, color: t.t4 }} colSpan={4}>The base currency: always 1.</td>
                  </tr>
                );
                const draft   = drafts[r.currency];
                const edited  = draft != null && toNum(draft) !== r.rate;
                const problem = edited ? rateProblem(draft) : null;
                const change  = edited && !problem ? rateChangePct(r.rate, draft) : null;
                const shown   = edited && !problem ? toNum(draft) : r.rate;
                return (
                  <tr key={r.currency}>
                    <td style={{ ...cell, ...mono, color: t.t1, fontWeight: 600 }}>{r.currency}</td>
                    <td style={cell}>
                      <input value={draft ?? String(r.rate)} disabled={isViewer} inputMode="decimal"
                        onChange={e => setDrafts(d => ({ ...d, [r.currency]: e.target.value }))}
                        style={{ ...inp(true, !!problem), ...mono, width: 130, padding: '6px 10px', fontSize: 13 }} />
                      {change != null && (
                        <div style={{ ...mono, fontSize: 11.5, marginTop: 5, whiteSpace: 'nowrap', color: Math.abs(change) > LARGE_CHANGE_PCT ? t.amber : t.t3 }}>
                          {pctText(change)}{Math.abs(change) > LARGE_CHANGE_PCT && ' · the wrong way round?'}
                        </div>
                      )}
                    </td>
                    <td style={{ ...cell, ...mono, textAlign: 'right', color: t.t3 }}>{fmtRate(1 / shown)}</td>
                    <td style={{ ...cell, ...mono, textAlign: 'right', color: t.t4, fontSize: 12, whiteSpace: 'nowrap' }}>{r.updated_at ? r.updated_at.slice(0, 10) : '—'}</td>
                    <td style={{ ...cell, textAlign: 'right', width: 150 }}>
                      {edited && (
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button style={{ ...btnG, ...btnSm }} disabled={busy === r.currency}
                            onClick={() => setDrafts(d => { const { [r.currency]: _, ...rest } = d; return rest; })}>Undo</button>
                          <button style={{ ...btnW, ...btnSm, opacity: problem || busy ? 0.45 : 1 }} disabled={!!problem || !!busy}
                            onClick={() => saveRate(r.currency)}>{busy === r.currency ? 'Saving…' : 'Save'}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Add a currency"
        description="Its three-letter code and what one unit is worth in AED. Once added, it can be picked as an item's cost or MSRP currency.">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <div>
            <label style={lbl}>Code</label>
            <input value={code} maxLength={3} placeholder="SGD" disabled={isViewer}
              onChange={e => setCode(e.target.value.toUpperCase())}
              style={{ ...inp(!!code, false), ...mono, width: 90 }} />
          </div>
          <div>
            <label style={lbl}>1 unit in AED</label>
            <input value={rate} placeholder="2.83" inputMode="decimal" disabled={isViewer}
              onChange={e => setRate(e.target.value)}
              style={{ ...inp(!!rate, false), ...mono, width: 140 }} />
          </div>
          <button style={{ ...btnW, opacity: !code || !rate || addProblem || busy || isViewer ? 0.45 : 1 }}
            disabled={!code || !rate || !!addProblem || !!busy || isViewer} onClick={add}>
            {busy === 'add' ? 'Adding…' : 'Add currency'}
          </button>
        </div>
        {code && rate && !addProblem && (
          <p style={{ ...mono, fontSize: 12, color: t.t3, marginTop: 10 }}>
            1 {newCode} = {fmtRate(newRate)} AED · 1 AED = {fmtRate(1 / newRate)} {newCode}
          </p>
        )}
        {addProblem && newCode.length === 3 && rate && <p style={{ fontSize: 12, color: t.amber, marginTop: 10 }}>{addProblem}</p>}
      </Section>

      {done && <div style={{ marginTop: 12, fontSize: 13, color: t.green }}>{done}</div>}
      <ErrBox msg={err} />
    </div>
  );
}
