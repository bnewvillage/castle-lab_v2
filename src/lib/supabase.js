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

// ── ROLE ALLOWLIST ────────────────────────────────────────────
// Real user emails are kept out of source control — supplied at build
// time via REACT_APP_ADMIN_EMAILS / REACT_APP_VIEWER_EMAILS (see
// .env.example). The demo build forces these empty, so the demo bundle
// only ever contains the demo identity. Note: this is a UI/UX gate;
// actual data access is enforced by Supabase RLS.
const parseList = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);

const ROLES = {
  'demo@castillo.lab': 'admin',
  ...Object.fromEntries(parseList(process.env.REACT_APP_ADMIN_EMAILS).map(e => [e, 'admin'])),
  ...Object.fromEntries(parseList(process.env.REACT_APP_VIEWER_EMAILS).map(e => [e, 'viewer'])),
};

export const ALLOWED_EMAILS = Object.keys(ROLES);

export function isAllowed(email) {
  return !!ROLES[email];
}

export function getRole(email) {
  return ROLES[email] ?? 'viewer';
}
