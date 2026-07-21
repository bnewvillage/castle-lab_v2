// Cross-platform demo build. Sets the demo flag (and dummy Supabase
// vars so no real backend credentials are ever baked into the public
// demo bundle) BEFORE react-scripts snapshots the environment.
process.env.REACT_APP_DEMO = 'true';
process.env.REACT_APP_SUPABASE_URL = 'https://demo.castillo.lab';
process.env.REACT_APP_SUPABASE_ANON_KEY = 'demo-anon-key';
// Force the role allowlists empty so no real emails from a local .env
// can be inlined into the public demo bundle.
process.env.REACT_APP_ADMIN_EMAILS = '';
process.env.REACT_APP_VIEWER_EMAILS = '';

// Served from https://bnewvillage.github.io/castle-lab_v2/ — assets must
// resolve under that subpath. Overridable for a different host/repo.
process.env.PUBLIC_URL = process.env.PUBLIC_URL || '/castle-lab_v2';

require('react-scripts/scripts/build');
