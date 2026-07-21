// Cross-platform demo dev server. Same env setup as demo-build.js,
// applied before react-scripts reads the environment.
process.env.REACT_APP_DEMO = 'true';
process.env.REACT_APP_SUPABASE_URL = 'https://demo.castillo.lab';
process.env.REACT_APP_SUPABASE_ANON_KEY = 'demo-anon-key';
process.env.REACT_APP_ADMIN_EMAILS = '';
process.env.REACT_APP_VIEWER_EMAILS = '';

require('react-scripts/scripts/start');
