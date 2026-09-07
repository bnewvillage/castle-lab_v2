-- Run in Supabase SQL editor.
--
-- Moves authorization from the browser into the database.
--
-- Until now the email allowlist and the admin/viewer split lived only in
-- REACT_APP_* env vars read by the client, while the one RLS policy in this
-- repo granted every authenticated user full read AND write:
--
--   CREATE POLICY "authenticated write" ON project_items FOR ALL
--     USING (auth.role() = 'authenticated');
--
-- Any Supabase account — allowlisted or not, viewer or admin — could therefore
-- read and rewrite the whole catalogue straight through the REST API with the
-- public anon key. Disabling a button in React does not stop that.
--
-- After this migration the allowlist is a table, and every policy is written
-- against it.

-- ── 1. Who is allowed in, and as what ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_users (
  email      text PRIMARY KEY,
  role       text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Everyone signed in may read the roster (the UI needs their own role);
-- only an admin may change it.
DROP POLICY IF EXISTS "app_users readable" ON app_users;
CREATE POLICY "app_users readable" ON app_users
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "app_users admin write" ON app_users;
CREATE POLICY "app_users admin write" ON app_users
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM app_users a
    WHERE a.email = lower(auth.jwt() ->> 'email') AND a.role = 'admin'
  ));

-- >>> SEED YOUR ACCOUNTS BEFORE RUNNING THE REST <<<
-- Mirror REACT_APP_ADMIN_EMAILS / REACT_APP_VIEWER_EMAILS from .env here.
-- Get this wrong and you lock yourself out of your own database.
--
-- INSERT INTO app_users (email, role) VALUES
--   ('you@example.com',      'admin'),
--   ('colleague@example.com','viewer')
-- ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role;

-- ── 2. Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_app_user() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_users WHERE email = lower(auth.jwt() ->> 'email'));
$$;

CREATE OR REPLACE FUNCTION is_app_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE email = lower(auth.jwt() ->> 'email') AND role = 'admin'
  );
$$;

-- ── 3. Every table: allowlisted users read, admins write ─────────────────────
-- Previously only project_items had policies in version control at all; the
-- rest were configured by hand in the dashboard and could not be reviewed or
-- reproduced. This codifies all of them.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pricing_master', 'project_items', 'brands', 'brand_rules',
    'price_history', 'exchange_rates'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'skipping %, table not present', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- Drop the permissive predecessors by their known names.
    EXECUTE format('DROP POLICY IF EXISTS "authenticated read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated write" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "app read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "app write" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "app read" ON %I FOR SELECT TO authenticated USING (is_app_user())', tbl);
    EXECUTE format(
      'CREATE POLICY "app write" ON %I FOR ALL TO authenticated '
      'USING (is_app_admin()) WITH CHECK (is_app_admin())', tbl);
  END LOOP;
END $$;

-- ── 4. Keep anon out ─────────────────────────────────────────────────────────
-- RLS is not a substitute for grants: revoke so an anon key alone gets nothing.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pricing_master', 'project_items', 'brands', 'brand_rules',
    'price_history', 'exchange_rates', 'app_users'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON %I FROM anon', tbl);
    END IF;
  END LOOP;
END $$;

-- ── 5. After running ─────────────────────────────────────────────────────────
-- Verify with an allowlisted session:
--   SELECT is_app_user(), is_app_admin();
-- Then confirm a non-allowlisted account sees zero rows in pricing_master.
--
-- Also turn OFF self-signup for this project (Authentication → Providers →
-- disable email signups, and restrict the Google provider), otherwise anyone
-- can still obtain an authenticated JWT — they will simply have no rows.
