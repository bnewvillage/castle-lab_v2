-- Run in Supabase SQL editor, after 20260907000002_role_based_rls.sql.
--
-- That migration covered the six tables the pricing screens use, but the app
-- also reads and writes three more. They were left outside the new regime:
--
--   price_history_batches  — the rollback feature's batch index
--   erp_items              — the cached ERP catalogue
--   erp_sync_meta          — ERP sync cursors
--
-- anon cannot reach any of them today, but a non-allowlisted *authenticated*
-- account still could. Same rule as everywhere else: allowlisted users read,
-- admins write.

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['price_history_batches', 'erp_items', 'erp_sync_meta'] LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'skipping %, table not present', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS "authenticated read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated write" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "app read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "app write" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "app read" ON %I FOR SELECT TO authenticated USING (is_app_user())', tbl);
    EXECUTE format(
      'CREATE POLICY "app write" ON %I FOR ALL TO authenticated '
      'USING (is_app_admin()) WITH CHECK (is_app_admin())', tbl);

    EXECUTE format('REVOKE ALL ON %I FROM anon', tbl);
  END LOOP;
END $$;

-- ── Check the rollback RPC ───────────────────────────────────────────────────
-- rollback_batch is called from the app and rewrites pricing_master. If it was
-- created SECURITY DEFINER it bypasses every policy above, so whoever can call
-- it can rewrite prices regardless of role. Inspect it with:
--
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'rollback_batch';
--
-- If prosecdef is true, add an explicit guard as its first statement:
--   IF NOT is_app_admin() THEN RAISE EXCEPTION 'not authorised'; END IF;
