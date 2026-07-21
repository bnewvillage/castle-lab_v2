import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { IconLayers, IconPercent, IconFileExport } from '../components/icons';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: [0.25, 0.46, 0.45, 0.94] },
});

const FEATURES = [
  {
    icon: IconLayers,
    title: 'Landed cost engine',
    text: 'Multi-currency EXW to fully landed costs — shipping, customs and FX handled per item.',
  },
  {
    icon: IconPercent,
    title: 'Margin control',
    text: 'Enforced target margins, brand markup rules and live margin visibility across UAE, KSA and Qatar.',
  },
  {
    icon: IconFileExport,
    title: 'ERP-ready output',
    text: 'Validated bulk imports and clean price exports that drop straight into your ERP.',
  },
];

export default function Home() {
  const { user } = useAuth();

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 'var(--nav-height)', position: 'relative', overflow: 'hidden' }}>

      {/* Background grid */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(var(--border-1) 1px, transparent 1px), linear-gradient(90deg, var(--border-1) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
      }} />

      {/* Glow */}
      <div style={{
        position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)',
        width: 700, height: 700,
        background: 'radial-gradient(circle, rgba(77,159,255,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div className="container" style={{ maxWidth: 860, position: 'relative', padding: '64px 24px' }}>

        <motion.div {...fadeUp(0.05)} style={{ marginBottom: 22 }}>
          <span className="tag tag-accent" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em' }}>
            Commercial pricing platform
          </span>
        </motion.div>

        <motion.h1 {...fadeUp(0.1)} style={{ fontSize: 'clamp(36px, 5.5vw, 58px)', fontWeight: 600, lineHeight: 1.08, letterSpacing: '-0.035em', color: 'var(--text-1)', marginBottom: 20, maxWidth: 640 }}>
          Retail pricing,<br />
          <span style={{ color: 'var(--text-3)' }}>engineered end to end.</span>
        </motion.h1>

        <motion.p {...fadeUp(0.18)} style={{ fontSize: 16, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 36, maxWidth: 540 }}>
          castillo.lab turns vendor costs into market-ready prices — landed cost modelling,
          enforced margins and ERP-ready exports across every market you sell in.
        </motion.p>

        <motion.div {...fadeUp(0.26)} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 72 }}>
          {user ? (
            <Link to="/apps" className="btn btn-primary">Open dashboard →</Link>
          ) : (
            <Link to="/login" className="btn btn-primary">Sign in →</Link>
          )}
        </motion.div>

        <motion.div {...fadeUp(0.34)} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} style={{ background: 'rgba(18,21,28,0.7)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius-lg)', padding: '20px 22px' }}>
              <div style={{ color: 'var(--accent-blue)', marginBottom: 12, display: 'flex' }}><Icon size={18} /></div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6, letterSpacing: '-0.01em' }}>{title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6 }}>{text}</div>
            </div>
          ))}
        </motion.div>

      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
        <div style={{ height: 120, background: 'linear-gradient(transparent, var(--bg-0))', pointerEvents: 'none' }} />
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderTop: '1px solid var(--border-1)', position: 'relative' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>© {new Date().getFullYear()} castillo.lab — All rights reserved.</span>
          <span style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>UAE · KSA · QAT</span>
        </div>
      </div>

    </main>
  );
}
