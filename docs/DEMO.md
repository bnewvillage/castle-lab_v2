# Demo mode

A self-contained, credential-free build of castillo.lab that runs entirely
against a synthetic in-memory dataset — no Supabase, no ERP, no login required.
Built for the public portfolio "View demo" link and hosted on GitHub Pages.

## Run it

```bash
npm install
npm run start:demo      # dev server in demo mode
npm run build:demo      # production demo bundle → build/
npm run deploy:demo     # build + publish to the gh-pages branch
```

The demo flag is `REACT_APP_DEMO=true`, set by the wrapper scripts in
`scripts/demo-build.js` / `scripts/demo-start.js` (cross-platform, no extra
deps). Those wrappers also:

- force **dummy** Supabase env vars, so no real backend credentials are ever
  included in the demo bundle, and
- set `PUBLIC_URL=/castle-lab_v2` so assets resolve under the GitHub Pages subpath
  (`https://bnewvillage.github.io/castle-lab_v2/`).

## Where the demo code lives

All demo-only code is isolated under **`src/demo/`** so it never mixes with the
production data layer:

```
src/demo/
  demoConfig.js   # the DEMO flag + demo identity
  demoData.js     # synthetic seed catalogue (brands, SKUs, history, projects)
  db.demo.js      # in-memory implementation of the db API
  demoErp.js      # synthetic ERP report rows
```

The production code stays in `src/lib/` (`db.live.js` is the real Supabase
layer). A single router picks the backend at build time:

| Concern            | Live                            | Demo                                     |
| ------------------ | ------------------------------- | ---------------------------------------- |
| Data access        | `src/lib/db.live.js` (Supabase) | `src/demo/db.demo.js` (in-memory store)  |
| Router             | `src/lib/db.js` picks one from the `DEMO` flag |                           |
| Seed data          | —                               | `src/demo/demoData.js`                   |
| Auth               | Google OAuth                    | instant mock sign-in (`AuthContext`)     |
| Supabase client    | real                            | stub (`src/lib/supabase.js`)             |
| ERP proxy          | Edge function                   | `src/demo/demoErp.js` synthetic reports  |
| Router type        | `BrowserRouter`                 | `HashRouter` (GitHub Pages deep links)   |

Nothing in the UI changes between the two; the seam files in `src/lib/`
(`db.js`, `supabase.js`, `AuthContext.jsx`, `csvExport.js`) and the `App.js`
router import the `DEMO` flag and branch on it.

## Behaviour

- 8 fake brands, ~60 SKUs, project items and price-history snapshots, all priced
  with the real pricing engine (`src/lib/pricing.js`) so margins and previews
  are coherent.
- Edits, bulk imports, markup commits and rollbacks mutate the store and persist
  for the session. A page reload reseeds.
- Sign in with the "Continue with Google" button — it signs in instantly as
  `demo@castillo.lab` (admin). No credentials are collected.
- Real user emails and the internal ERP domain are gated on the build flag and
  stripped from the demo bundle.

## Environment variables (live build only)

The live build reads config from `.env` (gitignored — see `.env.example`):

| Var                         | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `REACT_APP_SUPABASE_URL`    | Supabase project URL                           |
| `REACT_APP_SUPABASE_ANON_KEY` | Publishable/anon key (client-safe with RLS)  |
| `REACT_APP_ADMIN_EMAILS`    | Comma-separated admin allowlist                |
| `REACT_APP_VIEWER_EMAILS`   | Comma-separated viewer allowlist               |

The demo wrappers force all of these to dummy/empty values, so no real
Supabase credentials or user emails ever reach the public demo bundle.

## Adding new data functions

If `src/lib/db.live.js` gains an exported function, add a matching
implementation in `src/demo/db.demo.js` and a pass-through line in
`src/lib/db.js`. The three stay in lockstep.
