import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import {
  IconGrid, IconTag, IconUpload, IconList, IconBookmark, IconFolder,
  IconHistory, IconFileExport, IconPercent, IconLogout,
} from './icons';

const NAV = [
  {
    group: 'Workspace',
    items: [
      { label: 'Overview', icon: IconGrid, path: '/apps', exact: true },
    ],
  },
  {
    group: 'Pricing',
    items: [
      { label: 'Single SKU',    icon: IconTag,      path: '/apps/pricing-master/single' },
      { label: 'Bulk Import',   icon: IconUpload,   path: '/apps/pricing-master/bulk' },
      { label: 'Item List',     icon: IconList,     path: '/apps/pricing-master/list' },
      { label: 'Brands',        icon: IconBookmark, path: '/apps/pricing-master/brands' },
      { label: 'Project Items', icon: IconFolder,   path: '/apps/pricing-master/project' },
      { label: 'Rollback',      icon: IconHistory,  path: '/apps/pricing-master/rollback' },
    ],
  },
  {
    group: 'Automations',
    items: [
      { label: 'ERP Automation',   icon: IconFileExport, path: '/apps/others/erp-export' },
      { label: 'Global Markup',    icon: IconPercent,    path: '/apps/others/global-markup' },
    ],
  },
];

function NavItem({ item }) {
  const location = useLocation();
  const active = item.exact
    ? location.pathname === item.path
    : location.pathname === item.path;
  const Icon = item.icon;

  return (
    <Link
      to={item.path}
      className="side-item"
      style={{
        color: active ? 'var(--text-1)' : 'var(--text-3)',
        background: active ? 'rgba(77,159,255,0.09)' : 'transparent',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-3)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      title={item.label}
    >
      <span style={{ color: active ? 'var(--accent-blue)' : 'inherit', display: 'flex' }}>
        <Icon size={16} />
      </span>
      <span className="side-label">{item.label}</span>
    </Link>
  );
}

export default function AppShell({ children }) {
  const { user, role, signOut } = useAuth();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">

        {/* Brand */}
        <Link to="/apps" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '18px 22px 14px', borderBottom: '1px solid var(--border-1)' }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #4d9fff 0%, #2d6fd6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 8px rgba(77,159,255,0.25)' }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-sans)' }}>C</span>
          </div>
          <div className="side-brand-text" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>castillo.lab</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>Pricing Platform</div>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="side-nav">
          {NAV.map(section => (
            <div key={section.group}>
              <div className="side-group-label">{section.group}</div>
              {section.items.map(item => <NavItem key={item.path} item={item} />)}
            </div>
          ))}
        </nav>

        {/* User */}
        <div style={{ borderTop: '1px solid var(--border-1)', padding: '12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-3)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', flexShrink: 0 }}>
            {user?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="side-user-meta" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {role}
            </div>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="side-user-meta"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', padding: 6, borderRadius: 6, display: 'flex', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-red)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-4)'}
          >
            <IconLogout size={15} />
          </button>
        </div>

      </aside>

      <div className="app-content">
        {children}
      </div>
    </div>
  );
}
