# castillo.lab — Commercial Pricing Platform

Turn vendor costs into market-ready retail prices. **castillo.lab** is an
internal web app that models multi-currency landed costs, enforces target
margins, and produces ERP-ready price files across the UAE, KSA and Qatar
markets — replacing a sprawl of spreadsheets with one auditable pricing engine.

**▶ Live demo:** https://bnewvillage.github.io/castle-lab_v2/
_(runs on synthetic data — no login or credentials required; see [Demo mode](#demo-mode))_

---

## What it does

A pricing decision used to mean juggling vendor cost sheets, FX rates, market
markups, VAT and rounding rules by hand. castillo.lab centralises all of it:

- **Landed cost engine** — EXW vendor cost → shipping → FX conversion to AED →
  customs duty, per item, in any supported currency.
- **Margin control** — brand-level base markup with an optional second markup
  pass, enforced target margins, and live UAE / KSA / QAT margins on every SKU.
- **Market rounding** — psychological price "prettification" (VAT, 5-step ceil,
  MOD removal) so outputs are shelf-ready, not raw decimals.
- **ERP-ready output** — validated bulk imports and clean price exports that
  reconcile against live ERP reports by item code or barcode.
- **Full audit trail** — every bulk change is snapshotted and can be rolled back
  to a point in time.

## Features

**Pricing Master**
| Module | Purpose |
| --- | --- |
| Single SKU | Create/edit items with live margins across all three markets |
| Bulk Import | Excel import with validation, duplicate handling and pre-commit diffs |
| Item List | Browse, filter and export the pricing master with computed margins |
| Brands | Brand markup rules and portfolio analytics (fill rates, margin stats) |
| Project Items | Cost-driven pricing for one-off project quotations |
| Rollback | Price history with point-in-time reversal of any batch |

**Automations**
| Module | Purpose |
| --- | --- |
| ERP Price Export | Generate ERP-ready price files, matched against live ERP reports |
| Global Markup | Apply and export portfolio-wide markup adjustments |

## Tech stack

- **Frontend:** React 18, React Router 7, Framer Motion
- **Data / auth:** Supabase (PostgreSQL, Row-Level Security, Google OAuth)
- **Serverless:** Supabase Edge Function (Deno) proxying ERP report fetches
- **Spreadsheets:** SheetJS (`xlsx`) for import/export
- **Tooling:** Create React App (react-scripts)
- **Hosting:** Firebase Hosting (production) · GitHub Pages (public demo)

## Architecture

The UI is backend-agnostic. A single build-time flag (`REACT_APP_DEMO`) routes
every data and auth call to either the live Supabase layer or a self-contained
in-memory demo layer — the components never know the difference.

```
components ─► src/lib/db.js (router) ─┬─► src/lib/db.live.js  → Supabase (live)
                                      └─► src/demo/db.demo.js → in-memory (demo)
```

All pricing math lives in one pure, side-effect-free module
(`src/lib/pricing.js`) so every margin, preview and export is computed the same
way and is easy to audit.

## Getting started

### Prerequisites
- Node.js 18+
- A Supabase project (for the live build only)

### Install
```bash
npm install
```

### Environment
Copy `.env.example` to `.env` and fill in your values (`.env` is gitignored):

| Variable | Purpose |
| --- | --- |
| `REACT_APP_SUPABASE_URL` | Supabase project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Publishable/anon key (client-safe with RLS) |
| `REACT_APP_ADMIN_EMAILS` | Comma-separated admin allowlist |
| `REACT_APP_VIEWER_EMAILS` | Comma-separated viewer allowlist |

The role allowlists are a UI/UX gate — actual data access is enforced by
Supabase Row-Level Security.

### Run
```bash
npm start          # live dev server (needs .env)
npm run build      # production build → build/

npm run start:demo # demo dev server (no backend, no .env needed)
npm run build:demo # demo production build → build/
```

## Demo mode

A credential-free build backed entirely by a synthetic dataset (8 brands,
~60 SKUs, project items and price-history snapshots) priced with the real
engine, so every screen is coherent. Sign in with one click as a demo user;
no data leaves the browser. Demo-only code is isolated under `src/demo/`.

```bash
npm run deploy:demo   # build + publish to the gh-pages branch
```

Full details, including how the seam works and how to keep the live/demo data
layers in lockstep, are in **[docs/DEMO.md](docs/DEMO.md)**.

## Project structure

```
src/
├── apps/            # feature modules
│   ├── pricing/     # Single SKU, Bulk Import, Item List, Brands, Project, Rollback
│   └── others/      # ERP Price Export, Global Markup
├── components/      # AppShell, Navbar, ProtectedRoute, icons
├── demo/            # demo-only code (config, seed data, in-memory db, ERP stub)
├── lib/             # db router + live layer, supabase client, auth, pricing engine
├── pages/           # Home, Login, Apps (workspace overview)
└── styles/          # global.css
scripts/             # cross-platform demo build/start wrappers
supabase/            # config, edge function (erp-proxy), migrations
docs/                # documentation
```

## Deployment

- **Production** — `npm run build`, deployed to Firebase Hosting.
- **Public demo** — `npm run deploy:demo` publishes the demo build to the
  `gh-pages` branch, served at the link above. `PUBLIC_URL` and `HashRouter`
  are configured so deep links work under the GitHub Pages subpath.

## License

Private project. All rights reserved.
