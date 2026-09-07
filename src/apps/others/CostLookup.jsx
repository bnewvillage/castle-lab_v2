import { useState } from 'react';
import { t, btnW, btnG, lbl, groupBox, groupHead } from '../pricing/styles';
import { fetchItemsByCodes, bulkUpdateExwCost } from '../../lib/db';

// One code per line, split on newlines only. Item codes can legitimately contain
// commas (e.g. "TSTI-10204,HMA-FE2,15FZ07CO2"), so splitting on them would shred
// a single code into several and — worse — shift every later row out of step with
// the correction column, which joins by line index.
const parseCodes = (raw) => raw.split('\n').map(s => s.trim()).filter(Boolean);

const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

const box = {
  width: '100%', minHeight: 380, resize: 'vertical',
  background: t.bg2, border: `1px solid ${t.b2}`, borderRadius: 8,
  padding: '12px 14px', fontSize: 13, lineHeight: 1.7,
  color: t.t1, fontFamily: 'var(--font-mono)',
  outline: 'none', boxSizing: 'border-box', whiteSpace: 'pre',
};

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

// Read-only output column with its own copy control, so each column can be
// pasted into a spreadsheet independently.
function OutColumn({ label, value, onCopy, copied }) {
  return (
    <div style={{ flex: 1, minWidth: 175 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <label style={{ ...lbl, marginBottom: 6 }}>{label}</label>
        {value && (
          <button
            onClick={onCopy}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 6px',
              fontSize: 10, color: copied ? t.green : t.t4, fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase', letterSpacing: '0.07em',
            }}
          >{copied ? '✓ copied' : 'copy'}</button>
        )}
      </div>
      <textarea
        value={value} readOnly placeholder="—" spellCheck={false}
        style={{ ...box, background: t.bg1, color: value ? t.t1 : t.t4 }}
      />
    </div>
  );
}

export default function CostLookup() {
  const [input,  setInput]  = useState('');
  const [detail, setDetail] = useState(null);   // [{ code, exists, cost, currency }]
  const [stats,  setStats]  = useState(null);
  const [state,  setState]  = useState('idle');
  const [err,    setErr]    = useState('');
  const [copied, setCopied] = useState('');

  // ── Correction flow ──────────────────────────────────────────
  const [correcting, setCorrecting] = useState(false);
  const [newInput,   setNewInput]   = useState('');
  const [preview,    setPreview]    = useState(null); // { changes, skipped }
  const [pushState,  setPushState]  = useState('idle');
  const [pushMsg,    setPushMsg]    = useState('');

  const resetCorrection = () => { setPreview(null); setPushState('idle'); setPushMsg(''); };

  // Re-reads the current DB values for whatever is in the codes box. Kept
  // separate from handleLookup so a post-push refresh doesn't wipe the
  // "n items updated" confirmation.
  const runLookup = async () => {
    const codes = parseCodes(input);
    if (!codes.length) return;
    setState('loading'); setErr(''); setDetail(null); setStats(null); setCopied('');
    try {
      const map = await fetchItemsByCodes(codes);
      const rows = codes.map(code => {
        const row = map[code.toUpperCase()];
        return {
          code,
          exists:   !!row,
          cost:     row ? (row.exw_cost ?? null) : null,
          currency: row?.cost_currency ?? '',
        };
      });
      setDetail(rows);
      setStats({
        total:   rows.length,
        found:   rows.filter(r => r.exists && r.cost !== null).length,
        noCost:  rows.filter(r => r.exists && r.cost === null).length,
        missing: rows.filter(r => !r.exists).length,
      });
      setState('done');
    } catch (e) {
      setErr(e.message || 'Lookup failed');
      setState('error');
    }
  };

  const handleLookup = async () => {
    if (state === 'loading') return;
    resetCorrection();
    await runLookup();
  };

  // Line index is the join key, so the new-values box is split on newlines only
  // — filtering blanks would shift every row below them onto the wrong item.
  const handlePreview = () => {
    if (!detail) return;
    const vals = newInput.split('\n').map(s => s.trim());
    const changes = [];
    const skipped = { blank: 0, same: 0, missing: 0, invalid: 0 };
    detail.forEach((d, i) => {
      const raw = vals[i] ?? '';
      if (!raw)      { skipped.blank++;   return; }
      if (!d.exists) { skipped.missing++; return; }
      const next = Number(raw.replace(/,/g, ''));
      if (!isFinite(next)) { skipped.invalid++; return; }
      const cur = d.cost === null ? null : Number(d.cost);
      if (cur !== null && Math.abs(cur - next) < 1e-9) { skipped.same++; return; }
      changes.push({ code: d.code, from: d.cost, to: next, currency: d.currency });
    });
    setPreview({ changes, skipped });
    setPushState('idle'); setPushMsg('');
  };

  const handlePush = async () => {
    if (!preview?.changes.length || pushState === 'loading') return;
    setPushState('loading'); setPushMsg(''); setErr('');
    try {
      await bulkUpdateExwCost(preview.changes.map(c => ({ item_code: c.code, exw_cost: c.to })));
      const n = preview.changes.length;
      setPreview(null);
      setNewInput('');
      await runLookup(); // re-read so the columns reflect what's now stored
      setPushState('done');
      setPushMsg(`${n} item${n === 1 ? '' : 's'} updated.`);
    } catch (e) {
      setErr(e.message || 'Update failed');
      setPushState('error');
    }
  };

  const copy = async (which, text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      setErr('Clipboard blocked — select the text and copy manually.');
    }
  };

  const codeCount = parseCodes(input).length;
  const costOut = detail ? detail.map(d => (!d.exists ? 'NOT FOUND' : d.cost === null ? 'NO COST' : String(d.cost))).join('\n') : '';
  const currOut = detail ? detail.map(d => d.currency).join('\n') : '';

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={groupBox(false)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ ...groupHead, marginBottom: 4 }}>EXW Cost Lookup</div>
            <div style={{ fontSize: 12, color: t.t4 }}>
              Paste item codes on the left — one per line. Every column stays in the same order.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, marginLeft: 16 }}>
            {detail && (
              <button
                onClick={() => { setCorrecting(c => !c); resetCorrection(); }}
                style={{ ...btnG, borderColor: correcting ? t.b3 : t.b2, color: correcting ? t.t1 : t.t2 }}
              >{correcting ? 'Cancel correction' : 'Correct the DB'}</button>
            )}
            <button
              onClick={handleLookup}
              disabled={!codeCount || state === 'loading'}
              style={{
                ...btnW,
                opacity: (!codeCount || state === 'loading') ? 0.4 : 1,
                cursor:  (!codeCount || state === 'loading') ? 'not-allowed' : 'pointer',
              }}
            >{state === 'loading' ? 'Looking up...' : 'Get Costs'}</button>
          </div>
        </div>

        {err && (
          <div style={{ marginTop: 12, background: 'rgba(242,100,100,0.08)', border: '1px solid rgba(242,100,100,0.3)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: t.red }}>
            {err}
          </div>
        )}

        {pushMsg && (
          <div style={{ marginTop: 12, background: 'rgba(62,207,142,0.08)', border: '1px solid rgba(62,207,142,0.3)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: t.green }}>
            {pushMsg}
          </div>
        )}

        {stats && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <Pill label="codes"     value={stats.total} />
            <Pill label="found"     value={stats.found}   color={t.green} />
            {stats.noCost  > 0 && <Pill label="no cost"   value={stats.noCost}  color={t.amber} />}
            {stats.missing > 0 && <Pill label="not found" value={stats.missing} color={t.red} />}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 175 }}>
            <label style={{ ...lbl, marginBottom: 6 }}>
              Item codes{codeCount ? ` (${codeCount})` : ''}
            </label>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={'ALPN-ABC123\nALPN-DEF456\nALPN-GHI789'}
              spellCheck={false}
              style={box}
            />
          </div>

          <OutColumn label="EXW cost" value={costOut} copied={copied === 'cost'} onCopy={() => copy('cost', costOut)} />
          <OutColumn label="Currency" value={currOut} copied={copied === 'curr'} onCopy={() => copy('curr', currOut)} />

          {correcting && (
            <div style={{ flex: 1, minWidth: 175 }}>
              <label style={{ ...lbl, marginBottom: 6, color: t.amber }}>New EXW cost</label>
              <textarea
                value={newInput}
                onChange={e => { setNewInput(e.target.value); resetCorrection(); }}
                placeholder={'Leave a line blank\nto skip that item'}
                spellCheck={false}
                style={{ ...box, borderColor: 'rgba(245,166,35,0.35)' }}
              />
            </div>
          )}
        </div>

        {/* ── Correction actions ──────────────────────────────────── */}
        {correcting && (
          <div style={{ marginTop: 16, borderTop: `1px solid ${t.b1}`, paddingTop: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={handlePreview}
                disabled={!newInput.trim()}
                style={{ ...btnG, opacity: newInput.trim() ? 1 : 0.4, cursor: newInput.trim() ? 'pointer' : 'not-allowed' }}
              >Preview changes</button>

              {preview?.changes.length > 0 && (
                <button
                  onClick={handlePush}
                  disabled={pushState === 'loading'}
                  style={{
                    ...btnW, background: t.amber, color: t.bg0,
                    opacity: pushState === 'loading' ? 0.4 : 1,
                    cursor:  pushState === 'loading' ? 'not-allowed' : 'pointer',
                  }}
                >{pushState === 'loading' ? 'Pushing...' : `Push ${preview.changes.length} change${preview.changes.length === 1 ? '' : 's'}`}</button>
              )}
            </div>

            {preview && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: t.t3, fontFamily: 'var(--font-mono)', marginBottom: 10 }}>
                  {preview.changes.length} to change
                  {preview.skipped.same    > 0 && ` · ${preview.skipped.same} identical`}
                  {preview.skipped.blank   > 0 && ` · ${preview.skipped.blank} blank`}
                  {preview.skipped.missing > 0 && ` · ${preview.skipped.missing} not in DB`}
                  {preview.skipped.invalid > 0 && ` · ${preview.skipped.invalid} not a number`}
                </div>

                {preview.changes.length === 0 ? (
                  <div style={{ fontSize: 13, color: t.t4 }}>Nothing to update — every value matches what's already stored.</div>
                ) : (
                  <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${t.b1}`, borderRadius: 8 }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 0.6fr', gap: 8,
                      padding: '9px 14px', background: t.bg3, position: 'sticky', top: 0,
                      fontSize: 10, color: t.t4, fontFamily: 'var(--font-mono)',
                      textTransform: 'uppercase', letterSpacing: '0.07em',
                    }}>
                      <span>Item code</span><span>Before</span><span>After</span><span>Cur</span>
                    </div>
                    {preview.changes.map(c => (
                      <div key={c.code} style={{
                        display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 0.6fr', gap: 8,
                        padding: '8px 14px', borderTop: `1px solid ${t.b1}`,
                        fontSize: 12.5, fontFamily: 'var(--font-mono)', color: t.t2,
                      }}>
                        <span style={{ color: t.t1 }}>{c.code}</span>
                        <span style={{ color: t.t4, textDecoration: 'line-through' }}>{fmt(c.from)}</span>
                        <span style={{ color: t.green }}>{c.to}</span>
                        <span style={{ color: t.t4 }}>{c.currency || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
