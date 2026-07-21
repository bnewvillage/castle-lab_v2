import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isAllowed, getRole } from '../lib/supabase';
import { DEMO, DEMO_USER } from '../demo/demoConfig';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [role, setRole]       = useState('viewer');
  const [loading, setLoading] = useState(true);
  const [denied, setDenied]   = useState(false);

  useEffect(() => {
    // Demo mode: no real session. Start signed out so the landing +
    // login flow is visible; "Continue with Google" signs in instantly.
    if (DEMO) { setLoading(false); return; }

    // Check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  function handleSession(session) {
    if (!session) { setUser(null); setDenied(false); return; }
    const email = session.user?.email;
    if (!isAllowed(email)) {
      supabase.auth.signOut();
      setUser(null);
      setDenied(true);
      return;
    }
    setUser(session.user);
    setRole(getRole(email));
    setDenied(false);
  }

  async function signInWithGoogle() {
    setDenied(false);
    if (DEMO) {
      // Instant mock sign-in — no OAuth round-trip, no real account.
      setUser(DEMO_USER);
      setRole(getRole(DEMO_USER.email));
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
    <AuthContext.Provider value={{ user, role, isViewer, loading, denied, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
