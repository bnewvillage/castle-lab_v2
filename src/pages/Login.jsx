import { motion } from 'framer-motion';
import { useAuth } from '../lib/AuthContext';
import { Navigate, Link } from 'react-router-dom';
import { DEMO } from '../demo/demoConfig';

export default function Login() {
  const { user, loading, denied, signInWithGoogle } = useAuth();

  if (loading) return null;
  if (user) return <Navigate to="/apps" replace />;

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-0)', padding: 24, position: 'relative', overflow: 'hidden' }}>

      {/* Ambient glow */}
      <div style={{
        position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 600, height: 600,
        background: 'radial-gradient(circle, rgba(77,159,255,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{
          width: '100%', maxWidth: 380,
          background: 'var(--bg-2)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--radius-xl)',
          padding: '40px 36px',
          textAlign: 'center',
          boxShadow: 'var(--shadow-lg)',
          position: 'relative',
        }}
      >
        <div style={{ width: 44, height: 44, borderRadius: 11, background: 'linear-gradient(135deg, #4d9fff 0%, #2d6fd6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', boxShadow: '0 4px 16px rgba(77,159,255,0.3)' }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 18, fontFamily: 'var(--font-sans)' }}>C</span>
        </div>

        <h1 style={{ fontSize: 19, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6, letterSpacing: '-0.02em' }}>
          Sign in to castillo.lab
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 30, lineHeight: 1.5 }}>
          Commercial pricing platform
        </p>

        <button
          onClick={signInWithGoogle}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '12px 20px',
            background: 'var(--bg-3)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-1)',
            fontSize: 13.5, fontWeight: 500,
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
            fontFamily: 'var(--font-sans)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.borderColor = 'var(--border-3)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.borderColor = 'var(--border-2)'; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        {DEMO && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(77,159,255,0.06)', border: '1px solid rgba(77,159,255,0.2)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, textAlign: 'left' }}>
            <strong style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>Demo mode.</strong> No account needed — just click <em>Continue with Google</em> to explore the workspace with sample data.
          </div>
        )}

        {denied && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(242,100,100,0.08)', border: '1px solid rgba(242,100,100,0.2)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--accent-red)', lineHeight: 1.5, textAlign: 'left' }}
          >
            This account is not authorised for this workspace. Contact your administrator to request access.
          </motion.div>
        )}

        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border-1)' }}>
          <p style={{ fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.6 }}>
            Access is provisioned by your administrator.<br />
            <Link to="/" style={{ color: 'var(--text-3)', fontSize: 11.5 }}>← Back to castillo.lab</Link>
          </p>
        </div>
      </motion.div>

    </main>
  );
}
