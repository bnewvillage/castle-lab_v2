import { useState } from 'react';
import { fetchItemsByCodes, bulkDeleteItems, renameItemCodes } from '../../lib/db';
import { t, inp, btnW, btnG, lbl, groupBox, groupHead } from './styles';

// Delete and rename share one screen because they are the same shape: paste
// codes, see exactly what will happen, then commit. Both rewrite or remove
// primary keys, so neither runs without a preview the user has looked at.
const MODES = {
  delete: {
    title:   'Bulk delete',
    blurb:   'Paste item codes, one per line. Matching items are removed from the pricing master; their price history is kept.',
    columns: [{ k: 'code', label: 'Item codes', ph: 'ALPN-ABC123\nKLIM-1000' }],
    verb:    'Delete',
  },
  rename: {
    title:   'Bulk rename',
    blurb:   'Paste the current codes and their replacements, one per line, lined up by row. The brand prefix and price history follow the rename.',
    columns: [
      { k: 'old', label: 'Current code', ph: 'ALPN-ABC123\nALPN-DEF456' },
      { k: 'new', label: 'New code',     ph: 'KLIM-XYZ789\nALPN-DEF457' },
    ],
    verb: 'Rename',
  },
};

const lines = (s) => String(s || '').split('\n').map(x => x.trim().toUpperCase()).filter(Boolean);

const boxStyle = {
  width: '100%', minHeight: 150, background: t.bg2, border: `1px solid ${t.b2}`,
  borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: t.t1,
  fontFamily: 'var(--font-mono)', outline: 'none', resize: 'vertical', lineHeight: 1.7,
};

export default function BulkCodeOps({ mode, onToast, isViewer }) {
  const cfg = MODES[mode];
  const [text,    setText]    = useState({ code: '', old: '', new: '' });
  const [plan,    setPlan]    = useState(null);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');

  const set = (k, v) => { setText(s => ({ ...s, [k]: v })); setPlan(null); setErr(''); };

  const counts = cfg.columns.map(c => lines(text[c.k]).length);
  const rowCount = mode === 'delete' ? counts[0] : Math.max(counts[0], counts[1]);
  // Rename pairs by row, so mismatched column lengths would silently drop or
  // misalign renames. Say so rather than guessing an alignment.
  const mismatch = mode === 'rename' && counts[0] !== counts[1] && rowCount > 0;

  const buildPlan = async () => {
    setBusy(true); setErr(''); setPlan(null);
    try {
      if (mode === 'delete') {
        const codes = [...new Set(lines(text.code))];
        const found = await fetchItemsByCodes(codes);
        const byCode = new Map(Object.entries(found || {}).map(([k, v]) => [k.toUpperCase(), v]));
        setPlan({
          hits:   codes.filter(c => byCode.has(c)).map(c => ({ code: c, name: byCode.get(c)?.item_name || '' })),
          misses: codes.filter(c => !byCode.has(c)),
        });
      } else {
        const olds = lines(text.old), news = lines(text.new);
        const pairs = olds.map((o, i) => ({ old: o, new: news[i] ?? '' })).filter(p => p.new);
        const found = await fetchItemsByCodes([...new Set([...pairs.map(p => p.old), ...pairs.map(p => p.new)])]);
        const byCode = new Map(Object.entries(found || {}).map(([k, v]) => [k.toUpperCase(), v]));
        const renaming = new Set(pairs.map(p => p.old));
        setPlan({
          rows: pairs.map(p => ({
            ...p,
            missing:       !byCode.has(p.old),
            // Colliding with a row that is itself being renamed away is fine.
            taken:         byCode.has(p.new) && !renaming.has(p.new),
            brandChanged:  p.old.split('-')[0] !== p.new.split('-')[0],
            sameCode:      p.old === p.new,
          })),
        });
      }
    } catch (e) {
      setErr(e.message || 'Could not read the current items');
    } finally { setBusy(false); }
  };

  const blockers = plan && (mode === 'delete'
    ? 0
    : plan.rows.filter(r => r.missing || r.taken || r.sameCode).length);
  const applicable = plan && (mode === 'delete' ? plan.hits.length : plan.rows.length - blockers);

  const commit = async () => {
    if (busy || !applicable) return;
    setBusy(true); setErr('');
    try {
      if (mode === 'delete') {
        const n = await bulkDeleteItems(plan.hits.map(h => h.code));
        onToast?.(`Deleted ${n} item${n === 1 ? '' : 's'}`);
      } else {
        const res = await renameItemCodes(plan.rows.filter(r => !r.missing && !r.taken && !r.sameCode));
        onToast?.(`Renamed ${res.renamed} item${res.renamed === 1 ? '' : 's'}`
          + (res.historyRows ? ` · ${res.historyRows} history rows moved` : ''));
      }
      setText({ code: '', old: '', new: '' });
      setPlan(null);
    } catch (e) {
      setErr(e.message || `${cfg.verb} failed`);
    } finally { setBusy(false); }
  };

  const Pill = ({ label, value, color }) => (
    <span style={{ fontSize: 11.5, padding: '4px 11px', borderRadius: 100, fontFamily: 'var(--font-mono)',
                   background: t.bg3, border: `1px solid ${t.b2}`, color: color || t.t3 }}>
      {value} {label}
    </span>
  );

  const cellSt = { padding: '7px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' };

  return (
    <div style={groupBox(false)}>
      <div style={{ ...groupHead, marginBottom: 4 }}>{cfg.title}</div>
      <div style={{ fontSize: 12.5, color: t.t4, marginBottom: 16 }}>{cfg.blurb}</div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cfg.columns.length}, 1fr)`, gap: 14 }}>
        {cfg.columns.map(c => (
          <div key={c.k}>
            <label style={lbl}>{c.label}</label>
            <textarea style={boxStyle} placeholder={c.ph}
              value={text[c.k]} onChange={e => set(c.k, e.target.value)} />
          </div>
        ))}
      </div>

      {mismatch && (
        <div style={{ marginTop: 12, background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.25)',
                      borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: t.amber }}>
          {counts[0]} current code{counts[0] === 1 ? '' : 's'} against {counts[1]} replacement{counts[1] === 1 ? '' : 's'} —
          the columns pair up line by line, so these must match.
        </div>
      )}

      {err && (
        <div style={{ marginTop: 12, background: 'rgba(242,100,100,0.08)', border: '1px solid rgba(242,100,100,0.25)',
                      borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: t.red }}>{err}</div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
        <button style={{ ...btnG, opacity: (!rowCount || mismatch || busy || isViewer) ? 0.45 : 1 }}
          disabled={!rowCount || mismatch || busy || isViewer}
          onClick={buildPlan}>
          {busy && !plan ? 'Checking…' : `Preview ${rowCount || ''} row${rowCount === 1 ? '' : 's'}`}
        </button>
        {plan && (
          <button
            style={{ ...btnW, background: mode === 'delete' ? t.red : t.t1, color: mode === 'delete' ? '#fff' : t.bg0,
                     opacity: (!applicable || busy) ? 0.5 : 1, cursor: (!applicable || busy) ? 'default' : 'pointer' }}
            disabled={!applicable || busy}
            onClick={commit}>
            {busy ? `${cfg.verb.replace(/e$/, '')}ing…` : `${cfg.verb} ${applicable} item${applicable === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {plan && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {mode === 'delete' ? (
              <>
                <Pill label="will be deleted" value={plan.hits.length} color={plan.hits.length ? t.red : t.t3} />
                {plan.misses.length > 0 && <Pill label="not found" value={plan.misses.length} color={t.amber} />}
              </>
            ) : (
              <>
                <Pill label="will be renamed" value={applicable} color={applicable ? t.green : t.t3} />
                {blockers > 0 && <Pill label="blocked" value={blockers} color={t.red} />}
                {plan.rows.filter(r => r.brandChanged && !r.missing && !r.taken).length > 0 && (
                  <Pill label="change brand" value={plan.rows.filter(r => r.brandChanged && !r.missing && !r.taken).length} color={t.amber} />
                )}
              </>
            )}
          </div>

          <div style={{ maxHeight: 280, overflowY: 'auto', border: `1px solid ${t.b1}`, borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {mode === 'delete' ? (
                  <>
                    {plan.hits.map(h => (
                      <tr key={h.code} style={{ borderBottom: `1px solid ${t.b1}` }}>
                        <td style={{ ...cellSt, color: t.t1 }}>{h.code}</td>
                        <td style={{ ...cellSt, color: t.t4, fontFamily: 'var(--font-sans)', whiteSpace: 'normal' }}>{h.name}</td>
                        <td style={{ ...cellSt, color: t.red, textAlign: 'right' }}>will be deleted</td>
                      </tr>
                    ))}
                    {plan.misses.map(c => (
                      <tr key={c} style={{ borderBottom: `1px solid ${t.b1}` }}>
                        <td style={{ ...cellSt, color: t.t4 }}>{c}</td>
                        <td style={cellSt} />
                        <td style={{ ...cellSt, color: t.amber, textAlign: 'right' }}>not found — skipped</td>
                      </tr>
                    ))}
                  </>
                ) : plan.rows.map((r, i) => {
                  const problem = r.sameCode ? 'unchanged' : r.missing ? 'not found' : r.taken ? 'target already in use' : null;
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${t.b1}` }}>
                      <td style={{ ...cellSt, color: problem ? t.t4 : t.t2 }}>{r.old}</td>
                      <td style={{ ...cellSt, color: t.t4 }}>→</td>
                      <td style={{ ...cellSt, color: problem ? t.t4 : t.t1 }}>{r.new}</td>
                      <td style={{ ...cellSt, textAlign: 'right', color: problem ? t.red : r.brandChanged ? t.amber : t.green }}>
                        {problem || (r.brandChanged ? `brand → ${r.new.split('-')[0]}` : 'ok')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {mode === 'rename' && blockers > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: t.t4 }}>
              Blocked rows are skipped; the rest still apply. A target that is in use by an item you are
              also renaming away is fine — only real collisions block.
            </div>
          )}
          {mode === 'rename' && (
            <div style={{ marginTop: 8, fontSize: 12, color: t.t4 }}>
              The ERP cache is not rewritten, so renamed items read as missing in Item Coverage until the
              ERP is renamed and resynced.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
