import { useState } from 'react';
import { t, btnW, btnG, btnSm, lbl, groupBox, groupHead } from '../pricing/styles';
import { fetchItemsByCodes } from '../../lib/db';
import { downloadText } from '../../lib/csvExport';
import { parsePoInput, buildPoLines, mergeDuplicates, poCsv, erpDate, addDays } from '../../lib/purchaseOrder';

const box = {
  width: '100%', minHeight: 300, resize: 'vertical',
  background: t.bg2, border: `1px solid ${t.b2}`, borderRadius: 8,
  padding: '12px 14px', fontSize: 13, lineHeight: 1.7,
  color: t.t1, fontFamily: 'var(--font-mono)',
  outline: 'none', boxSizing: 'border-box', whiteSpace: 'pre',
};

const dateInput = {
  background: t.bg1, border: `1px solid ${t.b2}`, borderRadius: 6, color: t.t1,
  fontSize: 12.5, fontFamily: 'var(--font-mono)', padding: '5px 8px', colorScheme: 'dark',
};

const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const lineCount = (raw) => raw.replace(/\r/g, '').split('\n').filter(s => s.trim()).length;
const money = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WEEKS = [2, 4, 6, 8, 12];

function Pill({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      background: t.bg3, border: `1px solid ${t.b2}`, borderRadius: 10,
      padding: '10px 18px', minWidth: 84,
    }}>
      <span style={{ fontSize: 18, fontWeight: 500, color: color || t.t1, fontFamily: 'var(--font-mono)' }}>{value}</span>
      <span style={{ fontSize: 10, color: t.t4, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>{label}</span>
    </div>
  );
}

function PasteColumn({ label, hint, value, onChange, placeholder, flex = 1 }) {
  const n = lineCount(value);
  return (
    <div style={{ flex, minWidth: 150 }}>
      <label style={{ ...lbl, marginBottom: 6 }}>
        {label}{n ? ` (${n})` : ''}{hint && <span style={{ color: t.t4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> {hint}</span>}
      </label>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} style={box} />
    </div>
  );
}

export default function PurchaseOrder() {
  const [codes, setCodes] = useState('');
  const [qtys,  setQtys]  = useState('');
  const [dates, setDates] = useState('');
  const [defaultDate, setDefaultDate] = useState('');
  const [po,    setPo]    = useState(null);      // { rows, currency, built: the inputs it was built from }
  const [state, setState] = useState('idle');
  const [err,   setErr]   = useState('');

  const inputKey = `${codes}\u0000${qtys}\u0000${dates}`;
  const stale    = po && po.built !== inputKey;

  const build = async () => {
    const input = parsePoInput(codes, qtys, dates);
    if (!input.length) return;
    setState('loading'); setErr('');
    try {
      const items = await fetchItemsByCodes([...new Set(input.map(l => l.code.toUpperCase()))]);
      setPo({ ...buildPoLines(input, items), built: inputKey });
      setState('done');
    } catch (e) {
      setErr(e.message || 'Could not read the items');
      setState('error');
    }
  };

  const rows  = po?.rows ?? [];
  const ready = rows.filter(r => !r.errors.length);
  const bad   = rows.filter(r => r.errors.length);
  const warn  = ready.filter(r => r.warnings.length);
  const dupes = ready.some(r => r.duplicate);
  const undated = ready.filter(r => !r.date && !defaultDate).length;

  const totalsBy = {};
  for (const r of ready) totalsBy[r.currency || '—'] = (totalsBy[r.currency || '—'] ?? 0) + r.amount;
  const totals = Object.entries(totalsBy);

  const setLineDate = (i, value) => setPo(p => ({ ...p, rows: p.rows.map((r, j) => (j === i ? { ...r, date: value } : r)) }));
  // This line's date onto every line below it — the spreadsheet fill-down.
  const fillDown = (i) => {
    const value = rows[i].date || defaultDate;
    if (!value) return;
    setPo(p => ({ ...p, rows: p.rows.map((r, j) => (j >= i ? { ...r, date: value } : r)) }));
  };
  const clearLineDates = () => setPo(p => ({ ...p, rows: p.rows.map(r => ({ ...r, date: null })) }));
  const anyLineDate = rows.some(r => r.date);

  const canExport = ready.length > 0 && !stale && undated === 0;
  const exportReason = !ready.length ? 'No lines are ready'
    : stale ? 'The pasted lines changed — build again first'
    : undated ? `${undated} line${undated === 1 ? ' has' : 's have'} no expected delivery date — set a default or fill one in`
    : '';

  const download = () => {
    if (!canExport) return;
    const brands = [...new Set(ready.map(r => r.brand).filter(Boolean))];
    const tag = brands.length && brands.length <= 3 ? brands.join('-') : 'MULTI';
    downloadText(poCsv(rows, defaultDate), `PO_${tag}_${todayIso().replace(/-/g, '')}.csv`);
  };

  const th = { padding: '9px 10px', fontSize: 10, color: t.t4, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', background: t.bg3, position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', fontSize: 12.5, fontFamily: 'var(--font-mono)', borderTop: `1px solid ${t.b1}`, color: t.t2, verticalAlign: 'middle' };

  return (
    <div style={{ paddingBottom: 60, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Paste ─────────────────────────────────────────────── */}
      <div style={groupBox(false)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ ...groupHead, marginBottom: 4 }}>PO lines</div>
            <div style={{ fontSize: 12, color: t.t4, maxWidth: 620 }}>
              Paste item codes and quantities, one per line, in the same order. Expected delivery is optional
              per line (17-11-2026); lines without one take the default below. Rate is each item's EXW cost.
            </div>
          </div>
          <button
            onClick={build}
            disabled={!lineCount(codes) || state === 'loading'}
            style={{ ...btnW, opacity: (!lineCount(codes) || state === 'loading') ? 0.4 : 1, cursor: (!lineCount(codes) || state === 'loading') ? 'not-allowed' : 'pointer' }}
          >{state === 'loading' ? 'Building…' : po ? 'Rebuild PO' : 'Build PO'}</button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <PasteColumn label="Item codes" value={codes} onChange={setCodes} placeholder={'WRSA-BM051F\nWRSA-BM051T\nWRSA-BM102T'} flex={1.6} />
          <PasteColumn label="Quantity" value={qtys} onChange={setQtys} placeholder={'28\n18\n14'} />
          <PasteColumn label="Expected delivery" hint="(optional)" value={dates} onChange={setDates} placeholder={'17-11-2026\n\n01-12-2026'} />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${t.b1}` }}>
          <span style={{ ...lbl, marginBottom: 0 }}>Default expected delivery</span>
          <input type="date" value={defaultDate} onChange={e => setDefaultDate(e.target.value)} style={dateInput} />
          {WEEKS.map(w => {
            const v = addDays(todayIso(), w * 7);
            const on = defaultDate === v;
            return (
              <button key={w} onClick={() => setDefaultDate(v)} title={erpDate(v)}
                style={{ ...btnG, ...btnSm, color: on ? t.t1 : t.t3, borderColor: on ? t.b3 : t.b2 }}>+{w} wk</button>
            );
          })}
          {defaultDate && <span style={{ fontSize: 12, color: t.t3, fontFamily: 'var(--font-mono)' }}>{erpDate(defaultDate)}</span>}
        </div>

        {err && (
          <div style={{ marginTop: 12, background: 'rgba(242,100,100,0.08)', border: '1px solid rgba(242,100,100,0.3)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: t.red }}>{err}</div>
        )}
      </div>

      {/* ── Review ────────────────────────────────────────────── */}
      {po && (
        <div style={groupBox(false)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Pill label="lines" value={rows.length} />
              <Pill label="ready" value={ready.length} color={t.green} />
              {warn.length > 0 && <Pill label="check" value={warn.length} color={t.amber} />}
              {bad.length > 0 && <Pill label="left out" value={bad.length} color={t.red} />}
              <Pill label="total qty" value={ready.reduce((s, r) => s + r.qty, 0).toLocaleString()} />
              {totals.map(([cur, sum]) => <Pill key={cur} label={`total ${cur}`} value={money(sum)} />)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {dupes && !stale && (
                  <button onClick={() => setPo(p => ({ ...p, rows: mergeDuplicates(p.rows) }))} style={btnG}>Merge duplicates</button>
                )}
                <button onClick={download} disabled={!canExport}
                  style={{ ...btnW, opacity: canExport ? 1 : 0.4, cursor: canExport ? 'pointer' : 'not-allowed' }}>
                  Download CSV{ready.length ? ` · ${ready.length}` : ''}
                </button>
              </div>
              {exportReason && <span style={{ fontSize: 11.5, color: stale ? t.amber : t.t4 }}>{exportReason}</span>}
            </div>
          </div>

          {po.currency && totals.length > 1 && (
            <div style={{ marginTop: 12, background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: t.amber }}>
              Lines are priced in more than one currency. A PO has one currency, set on the PO in the ERP — the
              lines marked below carry rates in another currency and would be billed at the wrong price.
            </div>
          )}

          <div style={{ marginTop: 14, maxHeight: 560, overflow: 'auto', border: `1px solid ${t.b1}`, borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>Item code</th>
                  <th style={th}>Item name</th>
                  <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...th, textAlign: 'right' }}>Rate</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  <th style={th}>
                    Expected delivery
                    {anyLineDate && (
                      <button onClick={clearLineDates} title="Every line back to the default"
                        style={{ marginLeft: 8, background: 'none', border: 'none', color: t.t3, cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: 0 }}>reset</button>
                    )}
                  </th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const out = r.errors.length > 0;
                  const effective = r.date || defaultDate;
                  return (
                    <tr key={`${r.line}-${i}`} style={{ opacity: out ? 0.55 : 1 }}>
                      <td style={{ ...td, color: t.t4 }}>{r.line}</td>
                      <td style={{ ...td, color: t.t1, whiteSpace: 'nowrap' }}>{r.code}</td>
                      <td style={{ ...td, fontFamily: 'var(--font-sans)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.qty ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{r.rate != null ? `${r.currency} ${r.rate}` : '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.amount != null ? money(r.amount) : '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {!out && (
                          <>
                            <input type="date" value={effective} onChange={e => setLineDate(i, e.target.value)}
                              style={{ ...dateInput, color: r.date ? t.t1 : t.t3 }} title={r.date ? 'Set on this line' : 'The default'} />
                            <button onClick={() => fillDown(i)} disabled={!effective} title="Copy this date to every line below"
                              style={{ ...btnG, ...btnSm, marginLeft: 6, padding: '4px 9px', opacity: effective ? 1 : 0.35, cursor: effective ? 'pointer' : 'not-allowed' }}>↓ fill</button>
                          </>
                        )}
                      </td>
                      <td style={{ ...td, fontFamily: 'var(--font-sans)', fontSize: 12, whiteSpace: 'nowrap', color: out ? t.red : r.warnings.length ? t.amber : t.green }}>
                        {out ? r.errors.join(' · ') : r.warnings.length ? r.warnings.join(' · ') : 'ready'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11.5, color: t.t4, marginTop: 10 }}>
            Lines in red are left out of the CSV. UOM is {`"Nos"`} with a conversion factor of 1. In the ERP, open the
            PO's Items table, choose Upload, and pick this file.
          </div>
        </div>
      )}
    </div>
  );
}
