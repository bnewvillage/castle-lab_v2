// Cross-platform demo dev server. Same env setup as demo-build.js,
// applied before react-scripts reads the environment.
process.env.REACT_APP_DEMO = 'true';
process.env.REACT_APP_SUPABASE_URL = 'https://demo.castillo.lab';
process.env.REACT_APP_SUPABASE_ANON_KEY = 'demo-anon-key';

require('react-scripts/scripts/start');
