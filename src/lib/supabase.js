import { createClient } from '@supabase/supabase-js';
import { DEMO, DEMO_USER } from '../demo/demoConfig';

export const supabaseUrl     = process.env.REACT_APP_SUPABASE_URL;
export const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// In demo mode there is no backend. Export a harmless stub so any
// stray `supabase.*` call (e.g. SingleSKU's brand-hint query, ERP
// helpers) resolves to empty data instead of hitting the network.
function makeDemoClient() {
  const query = () => {
    const result = { data: [], error: null, count: 0 };
    const q = {};
    ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'gt', 'lt',
     'or', 'ilike', 'like', 'in', 'is', 'not', 'order', 'limit', 'range',
     'single', 'maybeSingle'].forEach(m => { q[m] = () => q; });
    q.then = (resolve) => resolve(result);
    q.catch = () => q;
    return q;
  };
  return {
    from: () => query(),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: DEMO_USER } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    },
  };
}

export const supabase = DEMO
  ? makeDemoClient()
  : createClient(supabaseUrl, supabaseAnonKey);

// ── ACCESS ────────────────────────────────────────────────────
// Who may use the app, and as what, is the app_users roster in the database —
// the same one RLS enforces on every table. Asked of the database after
// sign-in, so no list of team emails is ever shipped in the app's code.
//
// @returns 'admin' | 'viewer' | null (not on the roster). Throws if the
//          database can't be reached, so a network failure is never read as
//          "not authorised".
export async function fetchAppRole() {
  if (DEMO) return 'admin';
  const [onRoster, admin] = await Promise.all([supabase.rpc('is_app_user'), supabase.rpc('is_app_admin')]);
  if (onRoster.error || admin.error) throw onRoster.error || admin.error;
  if (!onRoster.data) return null;
  return admin.data ? 'admin' : 'viewer';
}
