import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchRates, fetchBrands } from '../lib/db';
import { t } from './pricing/styles';
import { IconRefresh, IconMaximize, IconMinimize, IconDownload } from '../components/icons';
import Toast        from './pricing/Toast';
import SingleSKU    from './pricing/SingleSKU';
import BulkUpload   from './pricing/BulkUpload';
import ItemList     from './pricing/ItemList';
import Brands       from './pricing/Brands';
import Rollback     from './pricing/Rollback';
import ProjectItems from './pricing/ProjectItems';

const MODULES = {
  single:   { label: 'Single SKU',    description: 'Create and edit items with live margin calculations across UAE, KSA and Qatar.' },
  bulk:     { label: 'Bulk Import',   description: 'Import items from Excel with validation, duplicate handling and change previews.' },
  list:     { label: 'Item List',     description: 'Browse, filter and export the pricing master with computed margins.' },
  brands:   { label: 'Brands',        description: 'Brand markup rules and portfolio analytics.' },
  project:  { label: 'Project Items', description: 'Cost-driven pricing for project quotations.' },
  rollback: { label: 'Rollback',      description: 'Price history with point-in-time change reversal.' },
};

const actionBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  background: 'transparent', border: `1px solid ${t.b2}`, borderRadius: 8,
  color: t.t3, cursor: 'pointer', padding: '7px 13px', fontSize: 12.5,
  lineHeight: 1, transition: 'all 0.15s', fontFamily: 'var(--font-sans)', fontWeight: 500,
  whiteSpace: 'nowrap',
};

export default function PricingMaster() {
  const { tab: tabParam } = useParams();
  const navigate = useNavigate();
  const tab = MODULES[tabParam] ? tabParam : 'single';

  const [visited,       setVisited]       = useState(() => new Set([tab]));
  const [rates,         setRates]         = useState({});
  const [brands,        setBrands]        = useState([]);
  const [ready,         setReady]         = useState(false);
  const [editTarget,    setEditTarget]    = useState(null);
  const [maximized,     setMaximized]     = useState(false);
  const [exportActions, setExportActions] = useState([]);
  const [toast,         setToast]         = useState(null);
  const [refreshKey,    setRefreshKey]    = useState(0);
  const [refreshing,    setRefreshing]    = useState(false);

  const showToast = (msg, ok = true) => setToast({ message: msg, ok });

  useEffect(() => {
    setVisited(v => (v.has(tab) ? v : new Set([...v, tab])));
    setExportActions([]);
  }, [tab]);

  const handleRefreshData = async () => {
    setRefreshing(true);
    try {
      const [r, b] = await Promise.all([fetchRates(), fetchBrands()]);
      setRates(r); setBrands(b);
      setRefreshKey(k => k + 1);
      showToast('Data refreshed');
    } catch(e) {
      showToast(e.message || 'Refresh failed — check your connection', false);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    Promise.all([fetchRates(), fetchBrands()])
      .then(([r, b]) => { setRates(r); setBrands(b); setReady(true); })
      .catch(console.error);
  }, []);

  const handleEditItem = (item) => { setEditTarget(item); navigate('/apps/pricing-master/single'); };
  const clearEditTarget = () => setEditTarget(null);

  if (!ready) return (
    <main style={{ minHeight:'100vh', display:'flex', flexDirection:'column', gap:14, alignItems:'center', justifyContent:'center' }}>
      <div className="spinner" />
      <div style={{ color:t.t4, fontSize:12.5 }}>Loading pricing data…</div>
    </main>
  );

  const containerStyle = maximized
    ? { maxWidth:'calc(100vw - var(--sidebar-w) - 48px)', margin:'0 auto', padding:'0 24px' }
    : { maxWidth:1400, margin:'0 auto', padding:'0 32px' };

  const mod = MODULES[tab];

  return (
    <main style={{ minHeight:'100vh', background:t.bg1 }}>
      <div style={containerStyle}>

        {/* Page header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', gap:16, flexWrap:'wrap', padding:'30px 0 20px', borderBottom:`1px solid ${t.b1}`, marginBottom:26 }}>
          <div>
            <p style={{ fontSize:11, color:t.t4, fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:7 }}>
              Pricing
            </p>
            <h1 style={{ fontSize:22, fontWeight:600, letterSpacing:'-0.02em', color:t.t1, lineHeight:1.2, marginBottom:5 }}>{mod.label}</h1>
            <p style={{ fontSize:13, color:t.t3, maxWidth:560 }}>{mod.description}</p>
          </div>

          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {exportActions.map(({ label, onClick }) => (
              <button key={label} onClick={onClick} style={actionBtn}
                onMouseEnter={e=>{ e.currentTarget.style.color=t.t1; e.currentTarget.style.borderColor=t.b3; }}
                onMouseLeave={e=>{ e.currentTarget.style.color=t.t3; e.currentTarget.style.borderColor=t.b2; }}
              ><IconDownload size={13}/>{label}</button>
            ))}

            <button
              onClick={handleRefreshData}
              disabled={refreshing}
              title="Refresh all data and calculations"
              style={{ ...actionBtn, opacity: refreshing ? 0.6 : 1, cursor: refreshing ? 'default' : 'pointer' }}
              onMouseEnter={e=>{ if (!refreshing) { e.currentTarget.style.borderColor=t.b3; e.currentTarget.style.color=t.t1; } }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor=t.b2; e.currentTarget.style.color=t.t3; }}
            ><IconRefresh size={13}/>{refreshing ? 'Refreshing…' : 'Refresh'}</button>

            <button
              onClick={() => setMaximized(m => !m)}
              title={maximized ? 'Restore width' : 'Maximize width'}
              style={{ ...actionBtn, padding:'7px 10px' }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor=t.b3; e.currentTarget.style.color=t.t1; }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor=t.b2; e.currentTarget.style.color=t.t3; }}
            >
              {maximized ? <IconMinimize size={14}/> : <IconMaximize size={14}/>}
            </button>
          </div>
        </div>

        {/* Modules — lazy mount, kept alive once visited */}
        <div>
          {visited.has('single') && <div style={{ display: tab==='single' ? 'block' : 'none' }}>
            <SingleSKU rates={rates} brands={brands} editTarget={editTarget} onEditTargetConsumed={clearEditTarget} maximized={maximized} onToast={showToast}/>
          </div>}
          {visited.has('bulk') && <div style={{ display: tab==='bulk' ? 'block' : 'none' }}>
            <BulkUpload onToast={showToast}/>
          </div>}
          {visited.has('list') && <div style={{ display: tab==='list' ? 'block' : 'none' }}>
            <ItemList rates={rates} brands={brands} onEditItem={handleEditItem} maximized={maximized} setExportActions={setExportActions} isActive={tab==='list'} refreshKey={refreshKey}/>
          </div>}
          {visited.has('brands') && <div style={{ display: tab==='brands' ? 'block' : 'none' }}>
            <Brands rates={rates} onToast={showToast} refreshKey={refreshKey}/>
          </div>}
          {visited.has('project') && <div style={{ display: tab==='project' ? 'block' : 'none' }}>
            <ProjectItems rates={rates} setExportActions={setExportActions} onToast={showToast} isActive={tab==='project'} refreshKey={refreshKey}/>
          </div>}
          {visited.has('rollback') && <div style={{ display: tab==='rollback' ? 'block' : 'none' }}>
            <Rollback refreshKey={refreshKey}/>
          </div>}
        </div>

        <AnimatePresence>
          {toast && <Toast key="toast" message={toast.message} ok={toast.ok} onDone={() => setToast(null)}/>}
        </AnimatePresence>
      </div>
    </main>
  );
}
