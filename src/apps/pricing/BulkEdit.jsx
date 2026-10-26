import { useState } from 'react';
import { t, btnG, btnSm } from './styles';
import { useAuth } from '../../lib/AuthContext';
import MassOverride from './MassOverride';
import BulkCodeOps from './BulkCodeOps';

// Changes to items that already exist, by pasted item code. Creating or
// updating items from a sheet lives in Bulk Import.
const MODES = [
  { k: 'override', label: 'Mass Override', hint: 'Pin market prices as manual overrides.' },
  { k: 'rename',   label: 'Rename codes',  hint: 'Change item codes, keeping their prices and history.' },
  { k: 'delete',   label: 'Delete items',  hint: 'Remove items from the pricing master.' },
];

export default function BulkEdit({ onToast }) {
  const { isViewer } = useAuth();
  const [mode, setMode] = useState('override');
  const current = MODES.find(m => m.k === mode);

  return (
    <div>
      {isViewer && (
        <div style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 8, padding: '10px 16px', color: t.amber, fontSize: 13, marginBottom: 16 }}>
          View only — bulk edits are disabled for your account.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {MODES.map(({ k, label }) => (
          <button key={k} onClick={() => setMode(k)}
            style={{ ...btnG, ...btnSm, padding: '8px 16px',
              background:  mode === k ? 'rgba(77,159,255,0.09)' : 'transparent',
              borderColor: mode === k ? (k === 'delete' ? 'rgba(242,100,100,0.35)' : 'rgba(77,159,255,0.3)') : t.b2,
              color:       mode === k ? (k === 'delete' ? t.red : t.blue) : t.t3 }}>
            {label}
          </button>
        ))}
        <span style={{ fontSize: 12, color: t.t4, marginLeft: 6 }}>{current.hint}</span>
      </div>

      {mode === 'override' && <MassOverride onToast={onToast} isViewer={isViewer} />}
      {mode === 'rename'   && <BulkCodeOps mode="rename" onToast={onToast} isViewer={isViewer} />}
      {mode === 'delete'   && <BulkCodeOps mode="delete" onToast={onToast} isViewer={isViewer} />}
    </div>
  );
}
