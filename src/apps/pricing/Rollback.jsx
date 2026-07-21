import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchPriceHistoryBatches, fetchBatchItems, fetchAllBatchItems, rollbackBatch } from '../../lib/db';
import { useAuth } from '../../lib/AuthContext';
import { t, btnW, btnG, groupBox } from './styles';
import { downloadCSV } from '../../lib/csvExport';

const OP_LABELS = {
  global_markup:  'Global Markup',
  single_edit:    'Single Edit',
  bulk_import:    'Bulk Import',
  markup_change:  'Markup Change',
};

const OP_COLORS = {
  global_markup: t.amber,
  single_edit:   t.blue,
  bulk_import:   t.green,
  markup_change: '#c084fc',
};

function fmt(val) {
  if (val == null) return <span style={{ color: t.t4 }}>—</span>;
  return Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function DiffCell({ old: o, new: n }) {
  if (o == null && n == null) return <span style={{ color: t.t4 }}>—</span>;
  const changed = o !== n;
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      <span style={{ color: t.t4 }}>{fmt(o)}</span>
      {changed && <>
        <span style={{ color: t.t4, margin: '0 4px' }}>→</span>
        <span style={{ color: t.amber, fontWeight: 500 }}>{fmt(n)}</span>
      </>}
    </span>
  );
}

function BatchCard({ batch, isViewer, user, onRollbackDone }) {
  const [expanded,     setExpanded]     = useState(false);
  const [items,        setItems]        = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [confirming,   setConfirming]   = useState(false);
  const [rolling,      setRolling]      = useState(false);
  const [done,         setDone]         = useState(false);
  const [error,        setError]        = useState(null);
  const [exporting,    setExporting]    = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllBatchItems(batch.batch_id);
      const today = new Date().toISOString().slice(0, 10);
      downloadCSV(rows, `batch_${batch.batch_id.slice(0, 8)}_${today}.csv`);
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  };

  const opColor = OP_COLORS[batch.operation_type] ?? t.t3;

  const handleExpand = async () => {
    if (!expanded && items.length === 0) {
      setLoadingItems(true);
      try {
        const rows = await fetchBatchItems(batch.batch_id, 20, 0);
        setItems(rows);
      } finally {
        setLoadingItems(false);
      }
    }
    setExpanded(e => !e);
  };

  const handleRollback = async () => {
    setRolling(true);
    setError(null);
    try {
      await rollbackBatch(batch.batch_id, user?.email ?? 'unknown');
      setDone(true);
      setConfirming(false);
      onRollbackDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setRolling(false);
    }
  };

  const appliedAt = new Date(batch.applied_at);
  const dateStr   = appliedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr   = appliedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{
      background: t.bg2, border: `1px solid ${done ? 'rgba(62,207,142,0.3)' : t.b1}`,
      borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.2s',
    }}>
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: opColor, background: `${opColor}18`, border: `1px solid ${opColor}30`, borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap' }}>
          {OP_LABELS[batch.operation_type] ?? batch.operation_type}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: t.t1, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{batch.description}</div>
          <div style={{ fontSize: 11, color: t.t4, fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            {dateStr} {timeStr} · {batch.applied_by} · {batch.item_count.toLocaleString()} items
            {batch.brand_count ? ` · ${batch.brand_count} brands` : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={handleExpand}
            style={{ ...btnG, fontSize: 12, color: t.t3, padding: '5px 12px' }}>
            {loadingItems ? '…' : expanded ? 'Hide preview' : 'Preview'}
          </button>
          <button onClick={handleExport} disabled={exporting}
            style={{ ...btnG, fontSize: 12, color: t.t3, padding: '5px 12px', opacity: exporting ? 0.6 : 1 }}>
            {exporting ? '…' : '↓ Export'}
          </button>
          {!done && !isViewer && (
            <button
              onClick={() => setConfirming(true)}
              style={{ ...btnG, fontSize: 12, color: t.red, borderColor: 'rgba(242,100,100,0.3)', padding: '5px 12px' }}>
              Rollback →
            </button>
          )}
          {done && <span style={{ fontSize: 12, color: t.green, fontFamily: 'var(--font-mono)' }}>✓ Rolled back</span>}
        </div>
      </div>

      {/* Item preview */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}>
            <div style={{ borderTop: `1px solid ${t.b1}`, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Item code', 'Brand', 'AED', 'SAR', 'QAT'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: h === 'Item code' || h === 'Brand' ? 'left' : 'right', fontSize: 10, color: t.t4, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${t.b1}`, background: t.bg3, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 20).map((item, i) => (
                    <tr key={item.item_code} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '7px 14px', color: t.blue, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{item.item_code}</td>
                      <td style={{ padding: '7px 14px', color: t.t3, fontSize: 12 }}>{item.brand_code ?? '—'}</td>
                      <td style={{ padding: '7px 14px', textAlign: 'right' }}><DiffCell old={item.old_msrp_aed} new={item.new_msrp_aed} /></td>
                      <td style={{ padding: '7px 14px', textAlign: 'right' }}><DiffCell old={item.old_msrp_sar} new={item.new_msrp_sar} /></td>
                      <td style={{ padding: '7px 14px', textAlign: 'right' }}><DiffCell old={item.old_msrp_qat} new={item.new_msrp_qat} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {batch.item_count > 20 && (
                <div style={{ padding: '8px 14px', fontSize: 11, color: t.t4, fontFamily: 'var(--font-mono)', borderTop: `1px solid ${t.b1}` }}>
                  Showing 20 of {batch.item_count.toLocaleString()} items
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm rollback */}
      <AnimatePresence>
        {confirming && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}>
            <div style={{ borderTop: `1px solid rgba(242,100,100,0.2)`, background: 'rgba(242,100,100,0.04)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: t.red, fontWeight: 500 }}>Confirm rollback</div>
                <div style={{ fontSize: 12, color: t.t3, marginTop: 2 }}>
                  This will revert {batch.item_count.toLocaleString()} items to their state before this batch. Cannot be undone unless a newer snapshot exists.
                </div>
                {error && <div style={{ fontSize: 12, color: t.red, marginTop: 6 }}>{error}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setConfirming(false); setError(null); }} style={{ ...btnG, fontSize: 12 }}>Cancel</button>
                <button onClick={handleRollback} disabled={rolling}
                  style={{ ...btnG, fontSize: 12, color: t.red, borderColor: 'rgba(242,100,100,0.4)', opacity: rolling ? 0.6 : 1 }}>
                  {rolling ? 'Rolling back...' : 'Yes, rollback'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Rollback({ refreshKey }) {
  const { isViewer, user } = useAuth();
  const [batches,  setBatches]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchPriceHistoryBatches()
      .then(setBatches)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const refreshKeyRef = useRef(false);
  useEffect(() => {
    if (!refreshKeyRef.current) { refreshKeyRef.current = true; return; }
    load();
  }, [refreshKey]);

  // Group by operation_type, sorted by most recent first
  const grouped = batches.reduce((acc, b) => {
    const key = b.operation_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(b);
    return acc;
  }, {});

  if (loading) return (
    <div className="loading-pulse" style={{ fontSize: 12, color: t.t4, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', padding: '40px 0' }}>
      LOADING HISTORY...
    </div>
  );

  if (error) return (
    <div style={{ fontSize: 13, color: t.red, padding: '20px 0' }}>{error}</div>
  );

  const opTypes = Object.keys(grouped);

  if (!opTypes.length) return (
    <div style={{ padding: '48px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: t.t4 }}>No history yet</div>
      <div style={{ fontSize: 12, color: t.t4, marginTop: 6, fontFamily: 'var(--font-mono)' }}>Snapshots appear here after a Global Markup commit or other bulk operation</div>
    </div>
  );

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: t.t4, fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
          Up to 3 snapshots per operation type are retained. Older ones are pruned automatically.
          {isViewer && <span style={{ marginLeft: 8, color: t.amber }}> View only — rollback disabled for your account.</span>}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {opTypes.map(opType => (
          <div key={opType}>
            <div style={{ fontSize: 11, color: OP_COLORS[opType] ?? t.t3, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 10 }}>
              {OP_LABELS[opType] ?? opType} · {grouped[opType].length} snapshot{grouped[opType].length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grouped[opType].map((batch, idx) => (
                <div key={batch.batch_id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {/* Layer indicator */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16, flexShrink: 0 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: idx === 0 ? OP_COLORS[opType] ?? t.blue : t.b3, flexShrink: 0 }} />
                    {idx < grouped[opType].length - 1 && <div style={{ width: 1, height: 20, background: t.b2, margin: '3px 0' }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: t.t4, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                      {idx === 0 ? 'most recent' : `${idx} back`}
                    </div>
                    <BatchCard batch={batch} isViewer={isViewer} user={user} onRollbackDone={load} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
