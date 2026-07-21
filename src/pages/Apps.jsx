import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import {
  IconTag, IconUpload, IconList, IconBookmark, IconFolder, IconHistory,
  IconFileExport, IconPercent, IconArrowRight, IconLayers, IconZap,
} from '../components/icons';

const SUITES = [
  {
    id: 'pricing',
    name: 'Pricing Master',
    icon: IconLayers,
    accent: '#4d9fff',
    description: 'Multi-currency landed cost modelling, margin control and market pricing across UAE, KSA and Qatar.',
    modules: [
      { label: 'Single SKU',    icon: IconTag,      path: '/apps/pricing-master/single' },
      { label: 'Bulk Import',   icon: IconUpload,   path: '/apps/pricing-master/bulk' },
      { label: 'Item List',     icon: IconList,     path: '/apps/pricing-master/list' },
      { label: 'Brands',        icon: IconBookmark, path: '/apps/pricing-master/brands' },
      { label: 'Project Items', icon: IconFolder,   path: '/apps/pricing-master/project' },
      { label: 'Rollback',      icon: IconHistory,  path: '/apps/pricing-master/rollback' },
    ],
  },
  {
    id: 'automations',
    name: 'Automations',
    icon: IconZap,
    accent: '#3ecf8e',
    description: 'Scheduled and on-demand data operations — ERP synchronisation and portfolio-wide exports.',
    modules: [
      { label: 'ERP Price Export', icon: IconFileExport, path: '/apps/others/erp-export' },
      { label: 'Global Markup',    icon: IconPercent,    path: '/apps/others/global-markup' },
    ],
  },
];

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay, ease: 'easeOut' },
});

export default function Apps() {
  const { user } = useAuth();
  const firstName = user?.email?.split('@')[0] || '';

  return (
    <main style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '36px 32px' }}>

        <motion.div {...fadeUp(0.05)} style={{ marginBottom: 32, paddingBottom: 20, borderBottom: '1px solid var(--border-1)' }}>
          <p className="section-label">Workspace</p>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text-1)', marginBottom: 6 }}>
            Overview
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
            Welcome back, <span style={{ color: 'var(--text-2)' }}>{firstName}</span>. Pick a module to get started.
          </p>
        </motion.div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {SUITES.map((suite, i) => (
            <SuiteCard key={suite.id} suite={suite} delay={0.1 + i * 0.08} />
          ))}
        </div>

      </div>
    </main>
  );
}

function SuiteCard({ suite, delay }) {
  const Icon = suite.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      {/* Suite header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '22px 24px 18px' }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: `${suite.accent}18`, border: `1px solid ${suite.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: suite.accent, flexShrink: 0 }}>
          <Icon size={17} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.01em', marginBottom: 3 }}>{suite.name}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, maxWidth: 640 }}>{suite.description}</p>
        </div>
      </div>

      {/* Module grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 1, background: 'var(--border-1)', borderTop: '1px solid var(--border-1)' }}>
        {suite.modules.map(({ label, icon: MIcon, path }) => (
          <Link
            key={path}
            to={path}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 18px',
              background: 'var(--bg-2)',
              color: 'var(--text-2)',
              fontSize: 13, fontWeight: 500,
              textDecoration: 'none',
              transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text-1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--text-2)'; }}
          >
            <span style={{ color: 'var(--text-4)', display: 'flex' }}><MIcon size={15} /></span>
            <span style={{ flex: 1 }}>{label}</span>
            <span style={{ color: 'var(--text-4)', display: 'flex' }}><IconArrowRight size={13} /></span>
          </Link>
        ))}
      </div>
    </motion.div>
  );
}
