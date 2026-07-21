// ─────────────────────────────────────────────────────────────
// DEMO MODE FLAG
// When REACT_APP_DEMO === 'true' the whole app runs against an
// in-memory fake dataset (see demoData.js / db.demo.js) with a
// mock auth session — no Supabase, no ERP, no real credentials.
// Build with:  npm run build:demo   ·   Dev:  npm run start:demo
// ─────────────────────────────────────────────────────────────
export const DEMO = process.env.REACT_APP_DEMO === 'true';

// The signed-in identity used throughout the demo.
export const DEMO_USER = { id: 'demo-user', email: 'demo@castillo.lab' };
