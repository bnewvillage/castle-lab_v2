import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext';

// Marketing navigation — shown on the public landing page only.
// Inside the app, navigation lives in the AppShell sidebar.
export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        zIndex: 100,
        height: 'var(--nav-height)',
        background: scrolled ? 'rgba(10,12,16,0.9)' : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: scrolled ? '1px solid var(--border-1)' : '1px solid transparent',
        transition: 'all 0.25s ease',
      }}
    >
      <div className="container" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #4d9fff 0%, #2d6fd6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(77,159,255,0.25)' }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>C</span>
          </div>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
            castillo<span style={{ color: 'var(--text-3)' }}>.lab</span>
          </span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {user ? (
            <Link to="/apps" className="btn btn-primary" style={{ fontSize: 12.5, padding: '8px 16px' }}>Open dashboard</Link>
          ) : (
            <Link to="/login" className="btn btn-ghost" style={{ fontSize: 12.5, padding: '7px 16px' }}>Sign in</Link>
          )}
        </div>

      </div>
    </motion.header>
  );
}
