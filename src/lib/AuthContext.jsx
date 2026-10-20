import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase, fetchAppRole } from '../lib/supabase';
import { DEMO, DEMO_USER } from '../demo/demoConfig';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
  const [role, setRole]           = useState('viewer');
  const [loading, setLoading]     = useState(true);
  const [denied, setDenied]       = useState(false);
  const [authError, setAuthError] = useState('');
  const verified = useRef(null);   // the email whose access is already confirmed
  const latest   = useRef(0);      // a slower check never overwrites a newer one

  useEffect(() => {
    // Demo mode: no real session. Start signed out so the landing +
    // login flow is visible; "Continue with Google" signs in instantly.
    if (DEMO) { setLoading(false); return; }

    async function check(session) {
      const run = ++latest.current;
      if (!session) {
        // Leave `denied` alone: signing an unauthorised account out lands here too.
        verified.current = null;
        setUser(null);
        setLoading(false);
        return;
      }
      const email = session.user?.email;
      if (email && email === verified.current) { setUser(session.user); return; }   // token refresh
      try {
        const r = await fetchAppRole();
        if (run !== latest.current) return;
        if (!r) {
          verified.current = null;
          setUser(null);
          setDenied(true);
          await supabase.auth.signOut();
        } else {
          verified.current = email;
          setRole(r);
          setUser(session.user);
          setDenied(false);
          setAuthError('');
        }
      } catch {
        if (run !== latest.current) return;
        setUser(null);
        setAuthError('Could not confirm your access — check your connection and reload the page.');
      } finally {
        if (run === latest.current) setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => check(session));

    // Supabase runs this callback while holding its auth lock, and calling
    // back into Supabase from inside it can deadlock — so check on the next tick.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => check(session), 0);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signInWithGoogle() {
    setDenied(false);
    setAuthError('');
    if (DEMO) {
      // Instant mock sign-in — no OAuth round-trip, no real account.
      setUser(DEMO_USER);
      setRole('admin');
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/apps' },
    });
    if (error) console.error('Sign in error:', error);
  }

  async function signOut() {
    if (DEMO) { setUser(null); return; }
    await supabase.auth.signOut();
    setUser(null);
  }

  const isViewer = role === 'viewer';

  return (
    <AuthContext.Provider value={{ user, role, isViewer, loading, denied, authError, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
