import { useState } from 'react';
import { t, btnW, btnG, lbl, groupBox, groupHead } from '../../pricing/styles';
import { useAuth } from '../../../lib/AuthContext';
import { fetchItemsByCodes } from '../../../lib/db';
import { fetchPurchaseRequests } from '../../../lib/erpProxy';
import { downloadText } from '../../../lib/csvExport';
import { toNum, round } from '../../../lib/num';
import { prepareRequestLines, requestLineCheck, requestPoCurrency, requestPoCsv, erpDate } from '../../../lib/purchaseOrder';
import ErpConnection from '../ErpConnection';
import { Pill, DefaultDelivery, LineDelivery, todayIso, money } from './shared';

const select = {
  background: t.bg1, border: `1px solid ${t.b2}`, borderRadius: 6, color: t.t1,
  fontSize: 12.5, padding: '6px 8px', fontFamily: 'var(--font-sans)', colorScheme: 'dark',
};
const qtyInput = {
  width: 64, background: t.bg1, border: `1px solid ${t.b2}`, borderRadius: 6, color: t.t1,
  fontSize: 12.5, fontFamily: 'var(--font-mono)', padding: '4px 6px', textAlign: 'right',
};
const fmtQty = (v) => (v == null ? '—' : String(round(v, 4)));
const who = (email) => (email ? String(email).split('@')[0] : '');

export default function FromRequests({ creds, setCreds }) {
  const { isViewer } = useAuth();
  const [rows,        setRows]        = useState(null);   // prepared request lines
  const [state,       setState]       = useState('idle');
  const [err,         setErr]         = useState('');
  const [company,     setCompany]     = useState('');
  const [brand,       setBrand]       = useState('');
  const [search,      setSearch]      = useState('');
  const [hideDrafts,  setHideDrafts]  = useState(true);
  const [defaultDate, setDefaultDate] = useState('');

  const connected = !!(creds.email.trim() && creds.password.trim());

  const load = async () => {
    setState('loading'); setErr('');
    try {
      const lines = await fetchPurchaseRequests(creds);
      const items = await fetchItemsByCodes([...new Set(lines.map(l => String(l.item_code).toUpperCase()))]);
      const prepared = prepareRequestLines(lines, items);
      setRows(prepared);
      // The company with the most open lines, unless the current pick still has some.
      const counts = {};
      for (const l of prepared) counts[l.company] = (counts[l.company] ?? 0) + 1;
      setCompany(c => (c && counts[c] ? c : Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''));
      setState('done');
    } catch (e) {
      setErr(e.message || 'Could not pull purchase requests');
      setState('error');
    }
  };

  const all       = rows ?? [];
  const companies = [...new Set(all.map(r => r.company))].sort();
  const inCompany = all.filter(r => r.company === company);
  const brands    = [...new Set(inCompany.map(r => r.brand || '(no brand)'))].sort();
  const q = search.trim().toLowerCase();
  const visible = inCompany.filter(r =>
    (!brand || (r.brand || '(no brand)') === brand) &&
    (!hideDrafts || !r.draft_pos?.length || r.selected) &&
    (!q || [r.item_code, r.item_name, r.request_id, r.sales_order].some(v => String(v ?? '').toLowerCase().includes(q))));

  const chosen   = inCompany.filter(r => r.selected);
  const currency = requestPoCurrency(chosen);
  const checked  = chosen.map(r => ({ r, ...requestLineCheck(r, currency) }));
  const ready    = checked.filter(c => !c.errors.length);
  const blocked  = checked.filter(c => c.errors.length);
  const warned   = ready.filter(c => c.warnings.length);
  const hidden   = chosen.filter(r => !visible.includes(r)).length;
  const undated  = ready.filter(c => !c.r.date && !defaultDate).length;
  const draftsHidden = inCompany.filter(r => r.draft_pos?.length && !r.selected).length;

  const totalsBy = {};
  for (const { r } of ready) totalsBy[r.currency || '—'] = (totalsBy[r.currency || '—'] ?? 0) + toNum(r.qty) * r.rate;
  const totals = Object.entries(totalsBy);

  const update = (ids, patch) => setRows(rs => rs.map(r => (ids.has(r.line_id) ? { ...r, ...patch(r) } : r)));
  const toggle = (r) => update(new Set([r.line_id]), x => ({ selected: !x.selected }));
  const selectable = visible.filter(r => !requestLineCheck(r, currency).errors.length);
  const allOn = selectable.length > 0 && selectable.every(r => r.selected);
  const toggleAll = () => update(new Set(selectable.map(r => r.line_id)), () => ({ selected: !allOn }));
  const setQty = (r, v) => update(new Set([r.line_id]), () => ({ qty: v }));
  const setLineDate = (r, v) => update(new Set([r.line_id]), () => ({ date: v || null }));
  // This line's date onto every visible line below it.
  const fillDown = (i) => {
    const value = visible[i].date || defaultDate;
    if (value) update(new Set(visible.slice(i).map(r => r.line_id)), () => ({ date: value }));
  };
  // Lines from another company can't share the PO: changing company clears them.
  const pickCompany = (c) => {
    setCompany(c); setBrand('');
    setRows(rs => rs.map(r => (r.company === c ? r : { ...r, selected: false })));
  };

  const canExport = !isViewer && ready.length > 0 && undated === 0;
  const reason = isViewer ? 'View only — building POs is for admins'
    : !chosen.length ? 'Tick the lines to put on the PO'
    : !ready.length ? 'None of the ticked lines can go on a PO yet'
    : undated ? `${undated} line${undated === 1 ? ' has' : 's have'} no expected delivery date — set a default or fill one in`
    : '';

  const download = () => {
    if (!canExport) return;
    const codes = [...new Set(ready.map(({ r }) => r.item?.brand_code).filter(Boolean))];
    const tag = codes.length && codes.length <= 3 ? codes.join('-') : 'MULTI';
    downloadText(requestPoCsv(inCompany, defaultDate), `PO_REQ_${tag}_${todayIso().replace(/-/g, '')}.csv`);
  };

  const th = { padding: '9px 10px', fontSize: 10, color: t.t4, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', background: t.bg3, position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', fontSize: 12.5, fontFamily: 'var(--font-mono)', borderTop: `1px solid ${t.b1}`, color: t.t2, verticalAlign: 'middle' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isViewer && (
        <div style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 8, padding: '10px 16px', color: t.amber, fontSize: 13 }}>
          View only — building POs from purchase requests is for admins.
        </div>
      )}

      <ErpConnection creds={creds} setCreds={setCreds} />

      <div style={groupBox(false)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ ...groupHead, marginBottom: 4 }}>Open purchase requests</div>
            <div style={{ fontSize: 12, color: t.t4, maxWidth: 640 }}>
              Submitted purchase requests with quantity not yet on a submitted PO, pulled live from the ERP. Each line
              in the file keeps its link to the request, so submitting the PO marks the request as ordered.
              Rate is the item's EXW cost here.
            </div>
          </div>
          <button onClick={load} disabled={!connected || isViewer || state === 'loading'}
            style={{ ...btnW, opacity: (!connected || isViewer || state === 'loading') ? 0.4 : 1, cursor: (!connected || isViewer || state === 'loading') ? 'not-allowed' : 'pointer' }}>
            {state === 'loading' ? 'Pulling…' : rows ? 'Pull again' : 'Pull requests'}
          </button>
        </div>
        {!connected && !isViewer && <div style={{ fontSize: 12, color: t.t4, marginTop: 10 }}>Enter your ERP login above to pull requests.</div>}
        {err && (
          <div style={{ marginTop: 12, background: 'rgba(242,100,100,0.08)', border: '1px solid rgba(242,100,100,0.3)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: t.red }}>{err}</div>
        )}

        {rows && (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${t.b1}` }}>
              <span style={{ ...lbl, marginBottom: 0 }}>Company</span>
              <select value={company} onChange={e => pickCompany(e.target.value)} style={select}>
                {companies.map(c => <option key={c} value={c}>{c} ({all.filter(r => r.company === c).length})</option>)}
              </select>
              <span style={{ ...lbl, marginBottom: 0, marginLeft: 8 }}>Brand</span>
              <select value={brand} onChange={e => setBrand(e.target.value)} style={select}>
                <option value="">All brands</option>
                {brands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code, name, request, order"
                style={{ ...select, minWidth: 230, fontFamily: 'var(--font-sans)' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.t3, cursor: 'pointer' }}>
                <input type="checkbox" checked={hideDrafts} onChange={e => setHideDrafts(e.target.checked)} />
                Hide lines already on a draft PO{draftsHidden ? ` (${draftsHidden})` : ''}
              </label>
            </div>
            <DefaultDelivery value={defaultDate} onChange={setDefaultDate} style={{ marginTop: 12 }} />
          </>
        )}
      </div>

      {rows && (
        <div style={groupBox(false)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Pill label="open lines" value={inCompany.length} />
              <Pill label="ticked" value={chosen.length} color={chosen.length ? t.t1 : t.t4} />
              {ready.length > 0 && <Pill label="ready" value={ready.length} color={t.green} />}
              {warned.length > 0 && <Pill label="check" value={warned.length} color={t.amber} />}
              {blocked.length > 0 && <Pill label="can't go" value={blocked.length} color={t.red} />}
              {totals.map(([cur, sum]) => <Pill key={cur} label={`total ${cur}`} value={money(sum)} />)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <button onClick={download} disabled={!canExport}
                style={{ ...btnW, opacity: canExport ? 1 : 0.4, cursor: canExport ? 'pointer' : 'not-allowed' }}>
                Download CSV{ready.length ? ` · ${ready.length}` : ''}
              </button>
              {reason && <span style={{ fontSize: 11.5, color: t.t4 }}>{reason}</span>}
              {hidden > 0 && <span style={{ fontSize: 11.5, color: t.amber }}>{hidden} ticked line{hidden === 1 ? ' is' : 's are'} hidden by the filters and still included</span>}
            </div>
          </div>

          {totals.length > 1 && (
            <div style={{ marginTop: 12, background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: t.amber }}>
              The ticked lines are priced in more than one currency. A PO has one currency, set on the PO in the ERP —
              lines marked below would be billed at the wrong price.
            </div>
          )}

          <div style={{ marginTop: 14, maxHeight: 620, overflow: 'auto', border: `1px solid ${t.b1}`, borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}><input type="checkbox" checked={allOn} onChange={toggleAll} disabled={!selectable.length} title="Tick every line shown that can go on a PO" /></th>
                  <th style={th}>Request</th>
                  <th style={th}>Required by</th>
                  <th style={th}>Item</th>
                  <th style={{ ...th, textAlign: 'right' }}>Open</th>
                  <th style={{ ...th, textAlign: 'right' }}>Order</th>
                  <th style={{ ...th, textAlign: 'right' }}>Rate</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  <th style={th}>Expected delivery</th>
                  <th style={th}>For</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const { errors, warnings } = requestLineCheck(r, currency);
                  const out = errors.length > 0;
                  const qty = toNum(r.qty);
                  const effective = r.date || defaultDate;
                  return (
                    <tr key={r.line_id} style={{ opacity: out ? 0.55 : 1, background: r.selected ? 'rgba(77,159,255,0.05)' : 'transparent' }}>
                      <td style={td}><input type="checkbox" checked={!!r.selected} onChange={() => toggle(r)} disabled={out && !r.selected} /></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }} title={`Raised by ${who(r.owner)} on ${erpDate(r.transaction_date)}`}>
                        <div style={{ color: t.t1 }}>{r.request_id}</div>
                        <div style={{ fontSize: 11, color: t.t4 }}>{who(r.owner)}</div>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{erpDate(r.schedule_date)}</td>
                      <td style={{ ...td, maxWidth: 320 }}>
                        <div style={{ color: t.t1, whiteSpace: 'nowrap' }}>{r.item_code}</div>
                        <div style={{ fontSize: 11.5, color: t.t3, fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.item_name}>{r.item_name}</div>
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtQty(r.outstanding_qty)} <span style={{ color: t.t4, fontSize: 11 }}>{r.uom}</span></td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <input type="text" inputMode="decimal" value={r.qty ?? ''} onChange={e => setQty(r, e.target.value)} style={qtyInput} />
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}
                        title={r.rate != null && r.conversion_factor !== 1 ? `${r.unit_rate} per ${r.stock_uom} × ${r.conversion_factor}` : undefined}>
                        {r.rate != null ? `${r.currency} ${r.rate}` : '—'}
                        {r.rate != null && r.conversion_factor !== 1 && <span style={{ color: t.t4, fontSize: 11 }}> /{r.uom}</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.rate != null && qty != null ? money(qty * r.rate) : '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {!out && <LineDelivery value={effective} isOwn={!!r.date} onChange={v => setLineDate(r, v)} onFillDown={() => fillDown(i)} />}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 11.5 }}>{r.sales_order || <span style={{ color: t.t4 }}>stock</span>}</td>
                      <td style={{ ...td, fontFamily: 'var(--font-sans)', fontSize: 12, whiteSpace: 'nowrap', color: out ? t.red : warnings.length ? t.amber : t.green }}>
                        {out ? errors.join(' · ') : warnings.length ? warnings.join(' · ') : 'ready'}
                      </td>
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: t.t4, padding: 24, fontFamily: 'var(--font-sans)' }}>
                    {inCompany.length ? 'No lines match the filters.' : 'No open purchase requests for this company.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11.5, color: t.t4, marginTop: 10 }}>
            The file uses the ERP's full PO item format. In the ERP, start the PO for this company, open its Items table,
            choose Upload, and pick this file. Prices are left for the ERP to total when the PO is saved.
          </div>
        </div>
      )}
    </div>
  );
}
