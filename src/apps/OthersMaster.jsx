import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams } from 'react-router-dom';
import { t } from './pricing/styles';
import { IconDownload } from '../components/icons';
import { groupOf } from '../components/navConfig';
import { DEMO } from '../demo/demoConfig';
import ERPAutomation from './others/ERPAutomation';
import CostLookup from './others/CostLookup';
import GlobalMarkupExport from './others/GlobalMarkupExport';
import PriceRounding from './others/PriceRounding';
import PurchaseOrder from './others/PurchaseOrder';

const MODULES = {
  'erp-export':    { label: 'Price Lists',      description: 'Upload-ready price list files for the ERP, and prices for stock the ERP holds without one.' },
  'erp-checks':    { label: 'Catalogue Checks', description: 'The catalogue against the ERP: items missing on either side, and items no price list covers.' },
  'cost-lookup':   { label: 'Cost Lookup',    description: 'Paste a list of item codes and get their EXW costs back.' },
  'global-markup': { label: 'Global Markup',  description: 'Apply and export portfolio-wide markup adjustments.' },
  'rounding':      { label: 'Price Rounding', description: 'Move stored prices onto the current rounding rule, with a preview and one-step rollback.' },
  'purchase-order': { label: 'Purchase Order', description: "Build a PO from the ERP's open purchase requests or from pasted item codes, and download the items file to upload to the ERP." },
};

export default function OthersMaster() {
  const { tab: tabParam } = useParams();
  const tab = MODULES[tabParam] ? tabParam : 'erp-export';
  const [exportActions, setExportActions] = useState([]);
  // The ERP login, kept here so it carries between the ERP pages. Never stored.
  const [erpCreds, setErpCreds] = useState(DEMO ? { email: 'demo@castillo.lab', password: 'demo-access' } : { email: '', password: '' });

  useEffect(() => { setExportActions([]); }, [tab]);

  const mod = MODULES[tab];

  return (
    <main style={{ minHeight: '100vh', background: t.bg1 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 32px' }}>

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', padding: '30px 0 20px', borderBottom: `1px solid ${t.b1}`, marginBottom: 26 }}>
          <div>
            <p style={{ fontSize: 11, color: t.t4, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>
              {groupOf(`/apps/others/${tab}`)}
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
              <ERPAutomation view="prices" creds={erpCreds} setCreds={setErpCreds} />
            </motion.div>
          )}
          {tab === 'erp-checks' && (
            <motion.div key="erpc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <ERPAutomation view="checks" creds={erpCreds} setCreds={setErpCreds} />
            </motion.div>
          )}
          {tab === 'cost-lookup' && (
            <motion.div key="cl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <CostLookup />
            </motion.div>
          )}
          {tab === 'global-markup' && (
            <motion.div key="gm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <GlobalMarkupExport setExportActions={setExportActions} />
            </motion.div>
          )}
          {tab === 'purchase-order' && (
            <motion.div key="po" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <PurchaseOrder creds={erpCreds} setCreds={setErpCreds} />
            </motion.div>
          )}
          {tab === 'rounding' && (
            <motion.div key="rnd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <PriceRounding />
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </main>
  );
}
