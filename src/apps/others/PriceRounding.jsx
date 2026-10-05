import { useState } from 'react';
import { fetchRates, fetchBrands, fetchAllItemsForRounding, insertPriceHistoryBatch, applyPriceRounding } from '../../lib/db';
import { planRounding, MARKETS } from '../../lib/rounding';
import { t, inp, btnW, btnG, lbl, groupBox, groupHead } from '../pricing/styles';
import { useAuth } from '../../lib/AuthContext';
import { downloadXLSX } from '../../lib/xlsxExport';

const RULE = [
  ['under 3,000',   'round up to 5, near-hundred snap, hundreds become …99 — the 3,000 mark stays 3,000'],
  ['3,000 – 4,999', 'round down to the 50'],
  ['5,000+',        'round down to the 100'],
];

const STATUS_COLS = [
  ['exact',      'Exact',          t.green, 'Re-derived: today\'s inputs reproduce the stored price, so the new price is exactly what a fresh save gives.'],
  ['change',     'Re-rounded',     t.blue,  'Inputs have moved since this was priced, so only the stored price was re-rounded — rates and markups are not reapplied.'],
  ['approx',     'Approximate',    t.amber, 'A UAE price the old rule snapped to a round hundred at 3,000+. Kept at the hundred; about one in twenty of these lands one step high until next edited.'],
  ['ambiguous',  'Left alone',     t.t3,    'Ends in 50 between 3,000 and 4,999 and was saved after the new rule went live — both rules produce it, so it is not touched.'],
  ['overridden', 'Overridden',     t.t3,    'A manual price. Never touched.'],
  ['manual',     'Not rule-made',  t.t3,    'Not a price either rule could have produced, so it was entered by hand. Never touched.'],
];

const toLocalInput = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function PriceRounding() {
  const { user, isViewer } = useAuth();
  const [cutoff,   setCutoff]   = useState('');
  const [plan,     setPlan]     = useState(null);
  const [busy,     setBusy]     = useState(false);
  const [progress, setProgress] = useState('');
  const [err,      setErr]      = useState('');
  const [result,   setResult]   = useState(null);
  const [confirm,  setConfirm]  = useState(false);

  const preview = async () => {
    setBusy(true); setErr(''); setPlan(null); setResult(null); setProgress('Reading the catalogue…');
    try {
      const [rates, brands, items] = await Promise.all([fetchRates(), fetchBrands(), fetchAllItemsForRounding()]);
      const rules = Object.fromEntries(brands.map(b => [b.brand_code, {
        markup:     b.brand_rules?.markup_percentage ?? 10,
        additional: b.brand_rules?.additional_markup_pct ?? null,
      }]));
      setPlan(planRounding(items, { rates, rules, cutoff: new Date(cutoff).toISOString() }));
    } catch (e) {
      setErr(e.message || 'Could not read the catalogue');
    } finally { setBusy(false); setProgress(''); }
  };

  const apply = async () => {
    setConfirm(false); setBusy(true); setErr('');
    const batchId = crypto.randomUUID();
    const planned = plan.changes.length;
    try {
      // The batch row goes first: if anything rejects it, no price has moved.
      setProgress('Recording the Rollback snapshot…');
      await insertPriceHistoryBatch({
        batch_id:       batchId,
        operation_type: 'rounding_rule',
        description:    `Rounding rule — ${planned.toLocaleString()} items re-rounded`,
        applied_by:     user?.email ?? null,
        item_count:     planned,
        brand_count:    new Set(plan.changes.map(c => c.brand_code)).size,
        metadata:       { cutoff: new Date(cutoff).toISOString() },
      });
      const applied = await applyPriceRounding(batchId, plan.changes,
        (done, ok) => setProgress(`Applying… ${done.toLocaleString()} of ${planned.toLocaleString()} (${ok.toLocaleString()} updated)`));
      setResult({ applied, planned });
      setPlan(null);
    } catch (e) {
      const soFar = e.appliedSoFar;
      setErr((e.message || 'Apply failed')
        + (soFar ? ` — ${soFar.toLocaleString()} items were applied before it stopped and can be undone from Rollback.` : ' — no prices were changed.'));
    } finally { setBusy(false); setProgress(''); }
  };

  const exportChanges = () => {
    const rows = plan.changes.flatMap(c => c.lines.map(l => ({
      item_code: c.item_code, item_name: c.item_name, brand_code: c.brand_code,
      market: MARKETS[l.market].label, shelf_before: l.before, shelf_after: l.after,
      change: Math.round((l.after - l.before) * 100) / 100, method: l.status,
    })));
    downloadXLSX(rows, `price_rounding_preview_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const moves = plan ? plan.changes
    .flatMap(c => c.lines.map(l => ({ ...l, code: c.item_code, name: c.item_name })))
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
    .slice(0, 12) : [];

  const cell = { padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', borderBottom: `1px solid ${t.b1}`, whiteSpace: 'nowrap' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={groupBox(false)}>
        <div style={{ ...groupHead, marginBottom: 6 }}>Current rule</div>
        <div style={{ fontSize: 12.5, color: t.t4, marginBottom: 12 }}>
          Applied to each market's shelf price — VAT-inclusive for UAE and KSA. New and edited items already
          follow it. This tool moves prices that were saved under the old rule; rates and markups are not reapplied.
        </div>
        {RULE.map(([band, rule]) => (
          <div key={band} style={{ display: 'flex', gap: 16, padding: '7px 0', borderTop: `1px solid ${t.b1}`, fontSize: 13 }}>
            <span style={{ width: 110, color: t.t2, fontFamily: 'var(--font-mono)' }}>{band}</span>
            <span style={{ color: t.t3 }}>{rule}</span>
          </div>
        ))}
        <div style={{ fontSize: 12, color: t.t4, marginTop: 10 }}>
          A brand's additional markup goes on the unrounded base, so UAE is rounded once; KSA and Qatar
          derive from the rounded UAE price. Project items are not included — they are quotes. Each one
          picks up the rule the next time it is saved.
        </div>
      </div>

      <div style={groupBox(false)}>
        <div style={{ ...groupHead, marginBottom: 6 }}>Re-round the catalogue</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={lbl}>New rule went live at</label>
            <input type="datetime-local" value={cutoff} onChange={e => { setCutoff(e.target.value); setPlan(null); }}
              style={{ ...inp(!!cutoff, false), width: 230 }} />
          </div>
          <button style={{ ...btnG, padding: '9px 14px' }} onClick={() => { setCutoff(toLocalInput(new Date())); setPlan(null); }}>
            Just now
          </button>
          <button style={{ ...btnW, opacity: (!cutoff || busy) ? 0.45 : 1 }} disabled={!cutoff || busy} onClick={preview}>
            {busy && !plan ? 'Reading…' : 'Preview'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: t.t4, marginTop: 8, maxWidth: 700 }}>
          Set this to when you deployed the new rounding. It only decides one narrow case: a price ending in 50
          between 3,000 and 4,999, which both rules can produce. Prices saved before this time are treated as old.
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
            Undo it from Pricing → Rollback under "Rounding Rule". Run a Price Export afterwards so the ERP gets the new prices.
          </div>
        )}

        {plan && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13.5, color: t.t2, marginBottom: 12 }}>
              <strong style={{ color: t.t1 }}>{plan.changes.length.toLocaleString()}</strong> of {plan.scanned.toLocaleString()} items
              have at least one price to move.
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={{ ...cell, textAlign: 'left', color: t.t4, fontSize: 10.5, textTransform: 'uppercase' }}>Market</th>
                    {STATUS_COLS.map(([k, label, , tip]) => (
                      <th key={k} title={tip} style={{ ...cell, textAlign: 'right', color: t.t4, fontSize: 10.5, textTransform: 'uppercase', cursor: 'help' }}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(MARKETS).map(([key, m]) => (
                    <tr key={key}>
                      <td style={{ ...cell, color: t.t2 }}>{m.label}</td>
                      {STATUS_COLS.map(([k, , color]) => {
                        const n = plan.tally[key]?.[k] ?? 0;
                        return <td key={k} style={{ ...cell, textAlign: 'right', color: n ? color : t.t4 }}>{n.toLocaleString()}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11.5, color: t.t4, marginTop: 6 }}>Hover a column for what it means.</div>

            {moves.length > 0 && (
              <>
                <div style={{ ...lbl, marginTop: 18 }}>Largest moves (shelf price)</div>
                <div style={{ border: `1px solid ${t.b1}`, borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {moves.map((mv, i) => (
                        <tr key={i}>
                          <td style={{ ...cell, color: t.t1 }}>{mv.code}</td>
                          <td style={{ ...cell, color: t.t4, fontFamily: 'var(--font-sans)', whiteSpace: 'normal' }}>{mv.name}</td>
                          <td style={{ ...cell, color: t.t3 }}>{MARKETS[mv.market].label}</td>
                          <td style={{ ...cell, textAlign: 'right', color: t.t3 }}>{mv.before.toLocaleString()}</td>
                          <td style={{ ...cell, color: t.t4 }}>→</td>
                          <td style={{ ...cell, textAlign: 'right', color: t.t1 }}>{mv.after.toLocaleString()}</td>
                          <td style={{ ...cell, textAlign: 'right', color: mv.after < mv.before ? t.red : t.green }}>
                            {mv.after - mv.before > 0 ? '+' : ''}{(Math.round((mv.after - mv.before) * 100) / 100).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button style={btnG} disabled={!plan.changes.length} onClick={exportChanges}>Export all changes (.xlsx)</button>
              <button
                style={{ ...btnW, opacity: (!plan.changes.length || isViewer || busy) ? 0.45 : 1 }}
                disabled={!plan.changes.length || isViewer || busy}
                onClick={() => setConfirm(true)}
              >Apply to {plan.changes.length.toLocaleString()} items</button>
            </div>
          </div>
        )}
      </div>

      {confirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
             onClick={() => setConfirm(false)}>
          <div style={{ background: t.bg2, border: `1px solid ${t.b2}`, borderRadius: 16, padding: '26px 30px', maxWidth: 480 }}
               onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 600, color: t.t1, marginBottom: 10 }}>Re-round {plan.changes.length.toLocaleString()} items?</div>
            <div style={{ fontSize: 13.5, color: t.t3, lineHeight: 1.6, marginBottom: 20 }}>
              This changes live prices in all three markets and records one Rollback snapshot, so the whole run can be
              undone. Any item edited since this preview is skipped rather than overwritten.
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
