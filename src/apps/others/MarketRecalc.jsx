import { useState } from 'react';
import { fetchAllItemPrices, insertPriceHistoryBatch, applyPriceChanges } from '../../lib/db';
import { planMarketRecalc } from '../../lib/marketRecalc';
import { MARKET, UAE, shelfOf, recalcLabel } from '../../lib/markets';
import { t, btnW, btnG, lbl, groupBox, groupHead } from '../pricing/styles';
import { useAuth } from '../../lib/AuthContext';
import { downloadXLSX } from '../../lib/xlsxExport';

// Moves every stored price for one derived market (markets.js) onto its current
// rule, derived from the item's stored UAE price — and fills it where there is
// none. One Rollback snapshot, and compare-and-set so an item edited after the
// preview is skipped.
export default function MarketRecalc({ market }) {
  const M = MARKET[market];
  const fmt = (v) => (v == null ? '—' : v.toLocaleString(undefined, M.dp === 3 ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : undefined));
  const { user, isViewer } = useAuth();
  const [items,    setItems]    = useState(null);   // the catalogue as read at preview
  const [include,  setInclude]  = useState(false);  // also move prices out of step with UAE
  const [busy,     setBusy]     = useState(false);
  const [progress, setProgress] = useState('');
  const [err,      setErr]      = useState('');
  const [result,   setResult]   = useState(null);
  const [confirm,  setConfirm]  = useState(false);

  const preview = async () => {
    setBusy(true); setErr(''); setItems(null); setResult(null); setProgress('Reading the catalogue…');
    try {
      setItems(await fetchAllItemPrices());
    } catch (e) {
      setErr(e.message || 'Could not read the catalogue');
    } finally { setBusy(false); setProgress(''); }
  };

  const plan = items ? planMarketRecalc(items, market, { includeOutOfStep: include }) : null;

  const apply = async () => {
    setConfirm(false); setBusy(true); setErr('');
    const batchId = crypto.randomUUID();
    const planned = plan.changes.length;
    try {
      // The batch row goes first: if anything rejects it, no price has moved.
      setProgress('Recording the Rollback snapshot…');
      await insertPriceHistoryBatch({
        batch_id:       batchId,
        operation_type: M.recalcOp,
        description:    `${M.label} recalculated at UAE × ${M.factor} — ${planned.toLocaleString()} items`,
        applied_by:     user?.email ?? null,
        item_count:     planned,
        brand_count:    new Set(plan.changes.map(c => c.brand_code)).size,
        metadata:       { factor: M.factor, include_out_of_step: include },
      });
      const applied = await applyPriceChanges(batchId, plan.changes,
        (done, ok) => setProgress(`Applying… ${done.toLocaleString()} of ${planned.toLocaleString()} (${ok.toLocaleString()} updated)`),
        M.recalcOp);
      setResult({ applied, planned });
      setItems(null);
    } catch (e) {
      const soFar = e.appliedSoFar;
      setErr((e.message || 'Apply failed')
        + (soFar ? ` — ${soFar.toLocaleString()} items were applied before it stopped and can be undone from Rollback.` : ' — no prices were changed.'));
    } finally { setBusy(false); setProgress(''); }
  };

  const moves   = plan ? plan.changes.flatMap(c => c.lines.map(l => ({ ...l, code: c.item_code, name: c.item_name }))) : [];
  const fills   = moves.filter(m => m.before == null);
  const changed = moves.filter(m => m.before != null);
  const largest = [...changed].sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)).slice(0, 10);
  const pct     = changed.map(m => (m.after - m.before) / m.before * 100).filter(Number.isFinite);
  const avgPct  = pct.length ? pct.reduce((s, v) => s + v, 0) / pct.length : 0;
  const shelfMoves = plan ? plan.tally.change + (include ? plan.tally.outOfStep : 0) : 0;

  const exportChanges = () => {
    const status = (c) => c.lines[0]?.status === 'outOfStep' ? 'out of step with UAE: included'
      : c.lines[0]?.before == null && c.lines.length ? 'new price' : c.lines.length ? 'follows UAE' : 'base price only';
    const rows = plan.changes.map(c => ({
      item_code: c.item_code, item_name: c.item_name, brand_code: c.brand_code, status: status(c),
      uae_shelf: shelfOf(UAE, c.expect[UAE.price]),
      shelf_before: c.lines[0]?.before ?? null, shelf_after: c.lines[0]?.after ?? null,
      [`${M.price}_before`]: c.expect[M.price], [`${M.price}_after`]: c.set[M.price] ?? c.expect[M.price],
      [`${M.real}_before`]: c.expect[M.real], [`${M.real}_after`]: c.set[M.real] ?? c.expect[M.real],
    }));
    if (!include) rows.push(...plan.outOfStep.map(o => ({
      item_code: o.code, item_name: o.name, brand_code: null, status: 'out of step with UAE: left alone',
      uae_shelf: o.uae, shelf_before: o.before, shelf_after: o.after,
    })));
    downloadXLSX(rows, `${M.recalcOp}_preview_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const cell = { padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', borderBottom: `1px solid ${t.b1}`, whiteSpace: 'nowrap' };
  const stat = (label, n, color) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 18, fontFamily: 'var(--font-mono)', color: n ? color : t.t4 }}>{n.toLocaleString()}</span>
      <span style={{ fontSize: 10.5, color: t.t4, textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-mono)' }}>{label}</span>
    </div>
  );

  return (
    <div style={groupBox(false)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ ...groupHead, marginBottom: 6 }}>Fill and recalculate {M.label} from UAE</div>
          <div style={{ fontSize: 12.5, color: t.t4, maxWidth: 680 }}>
            Sets every {M.label} price from its stored UAE price at the current rule — {M.rule} — including items with
            no {M.label} price yet. No other market is touched; hand-set {M.label} prices are left alone.
          </div>
        </div>
        <button style={{ ...btnW, opacity: busy ? 0.45 : 1 }} disabled={busy} onClick={preview}>
          {busy && !plan ? 'Reading…' : 'Preview'}
        </button>
      </div>

      {progress && <div style={{ marginTop: 12, fontSize: 12.5, color: t.t3, fontFamily: 'var(--font-mono)' }}>{progress}</div>}
      {err && (
        <div style={{ marginTop: 12, background: 'rgba(242,100,100,0.08)', border: '1px solid rgba(242,100,100,0.3)',
                      borderRadius: 8, padding: '10px 14px', fontSize: 13, color: t.red }}>{err}</div>
      )}
      {result && (
        <div style={{ marginTop: 14, background: 'rgba(62,207,142,0.07)', border: '1px solid rgba(62,207,142,0.25)',
                      borderRadius: 8, padding: '12px 16px', fontSize: 13, color: t.t2, lineHeight: 1.6 }}>
          <strong style={{ color: t.green }}>Applied {result.applied.toLocaleString()} of {result.planned.toLocaleString()} items.</strong>{' '}
          {result.applied < result.planned
            ? `${(result.planned - result.applied).toLocaleString()} were skipped because they changed after the preview — preview again to include them. `
            : ''}
          Undo it from Pricing → Rollback under "{recalcLabel(M)}". Then run ERP → Price Lists → Price Export so the ERP gets the new {M.label} prices.
        </div>
      )}

      {plan && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {fills.length > 0 && stat(`new ${M.label} prices`, fills.length, t.blue)}
            {stat(`${M.label} shelf price moves`, shelfMoves - fills.length, t.blue)}
            {stat('base price only', plan.tally.baseOnly, t.t3)}
            {stat('already right', plan.tally.same, t.green)}
            {stat('out of step with UAE', plan.tally.outOfStep, t.amber)}
            {stat('hand-set, left alone', plan.tally.overridden, t.t3)}
            {stat('no UAE price', plan.tally.noUae, t.t3)}
          </div>
          {changed.length > 0 && (
            <div style={{ fontSize: 12.5, color: t.t3, marginTop: 12 }}>
              Average {M.label} shelf change <strong style={{ color: t.t1 }}>{avgPct > 0 ? '+' : ''}{avgPct.toFixed(2)}%</strong>.
            </div>
          )}

          {plan.outOfStep.length > 0 && (
            <div style={{ marginTop: 16, background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, color: t.t2, lineHeight: 1.6 }}>
                <strong style={{ color: t.amber }}>{plan.outOfStep.length.toLocaleString()} {M.label} prices don't follow their UAE price today</strong> —
                they aren't what UAE × {M.factor} gives. Usually the UAE price was changed by hand after the {M.label} price
                was set, or a Mass Override left {M.label} unchanged on purpose. They're left alone unless you include them;
                including them makes {M.label} follow UAE again, and some go up.
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, color: t.t2, cursor: 'pointer' }}>
                <input type="checkbox" checked={include} onChange={e => setInclude(e.target.checked)} />
                Include them in this run
              </label>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
                <tbody>
                  {plan.outOfStep.slice(0, 8).map((o, i) => (
                    <tr key={i}>
                      <td style={{ ...cell, color: t.t1 }}>{o.code}</td>
                      <td style={{ ...cell, color: t.t4, fontFamily: 'var(--font-sans)', whiteSpace: 'normal' }}>{o.name}</td>
                      <td style={{ ...cell, textAlign: 'right', color: t.t3 }}>UAE {o.uae.toLocaleString()}</td>
                      <td style={{ ...cell, textAlign: 'right', color: t.t3 }}>{M.currency} {fmt(o.before)}</td>
                      <td style={{ ...cell, color: t.t4 }}>→</td>
                      <td style={{ ...cell, textAlign: 'right', color: t.t1 }}>{fmt(o.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.outOfStep.length > 8 && <div style={{ fontSize: 11.5, color: t.t4, marginTop: 6 }}>…and {(plan.outOfStep.length - 8).toLocaleString()} more in the export.</div>}
            </div>
          )}

          {largest.length > 0 && (
            <>
              <div style={{ ...lbl, marginTop: 18 }}>Largest moves ({M.label} shelf price, {M.currency})</div>
              <div style={{ border: `1px solid ${t.b1}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {largest.map((mv, i) => (
                      <tr key={i}>
                        <td style={{ ...cell, color: t.t1 }}>{mv.code}</td>
                        <td style={{ ...cell, color: t.t4, fontFamily: 'var(--font-sans)', whiteSpace: 'normal' }}>{mv.name}</td>
                        <td style={{ ...cell, textAlign: 'right', color: t.t3 }}>{fmt(mv.before)}</td>
                        <td style={{ ...cell, color: t.t4 }}>→</td>
                        <td style={{ ...cell, textAlign: 'right', color: t.t1 }}>{fmt(mv.after)}</td>
                        <td style={{ ...cell, textAlign: 'right', color: mv.after < mv.before ? t.red : t.green }}>
                          {mv.after - mv.before > 0 ? '+' : ''}{fmt(Math.round((mv.after - mv.before) * 1000) / 1000)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button style={btnG} disabled={!plan.changes.length && !plan.outOfStep.length} onClick={exportChanges}>Export preview (.xlsx)</button>
            <button style={{ ...btnW, opacity: (!plan.changes.length || isViewer || busy) ? 0.45 : 1 }}
              disabled={!plan.changes.length || isViewer || busy} onClick={() => setConfirm(true)}>
              {plan.changes.length ? `Apply to ${plan.changes.length.toLocaleString()} items` : 'Nothing to change'}
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
             onClick={() => setConfirm(false)}>
          <div style={{ background: t.bg2, border: `1px solid ${t.b2}`, borderRadius: 16, padding: '26px 30px', maxWidth: 480 }}
               onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 600, color: t.t1, marginBottom: 10 }}>Recalculate {M.label} for {plan.changes.length.toLocaleString()} items?</div>
            <div style={{ fontSize: 13.5, color: t.t3, lineHeight: 1.6, marginBottom: 20 }}>
              This changes live {M.label} prices only, at UAE × {M.factor}, and records one Rollback snapshot so the whole run
              can be undone. Any item edited since this preview is skipped rather than overwritten.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button style={btnG} onClick={() => setConfirm(false)}>Cancel</button>
              <button style={btnW} onClick={apply}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
