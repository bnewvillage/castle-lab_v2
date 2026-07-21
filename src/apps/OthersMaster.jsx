import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams } from 'react-router-dom';
import { t } from './pricing/styles';
import { IconDownload } from '../components/icons';
import ERPPriceExport from './others/ERPPriceExport';
import GlobalMarkupExport from './others/GlobalMarkupExport';

const MODULES = {
  'erp-export':    { label: 'ERP Price Export', description: 'Generate ERP-ready price files from the pricing master.' },
  'global-markup': { label: 'Global Markup',    description: 'Apply and export portfolio-wide markup adjustments.' },
};

export default function OthersMaster() {
  const { tab: tabParam } = useParams();
  const tab = MODULES[tabParam] ? tabParam : 'erp-export';
  const [exportActions, setExportActions] = useState([]);

  useEffect(() => { setExportActions([]); }, [tab]);

  const mod = MODULES[tab];

  return (
    <main style={{ minHeight: '100vh', background: t.bg1 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 32px' }}>

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', padding: '30px 0 20px', borderBottom: `1px solid ${t.b1}`, marginBottom: 26 }}>
          <div>
            <p style={{ fontSize: 11, color: t.t4, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>
              Automations
            </p>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: t.t1, lineHeight: 1.2, marginBottom: 5 }}>{mod.label}</h1>
            <p style={{ fontSize: 13, color: t.t3, maxWidth: 560 }}>{mod.description}</p>
          </div>

          {exportActions.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {exportActions.map(({ label, onClick }) => (
                <button key={label} onClick={onClick} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  fontSize: 12.5, padding: '7px 13px', fontWeight: 500,
                  background: 'transparent', border: `1px solid ${t.b2}`,
                  borderRadius: 8, color: t.t3, cursor: 'pointer', lineHeight: 1,
                  fontFamily: 'var(--font-sans)', transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = t.t1; e.currentTarget.style.borderColor = t.b3; }}
                  onMouseLeave={e => { e.currentTarget.style.color = t.t3; e.currentTarget.style.borderColor = t.b2; }}
                ><IconDownload size={13}/>{label}</button>
              ))}
            </div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {tab === 'erp-export' && (
            <motion.div key="erp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <ERPPriceExport />
            </motion.div>
          )}
          {tab === 'global-markup' && (
            <motion.div key="gm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <GlobalMarkupExport setExportActions={setExportActions} />
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </main>
  );
}
