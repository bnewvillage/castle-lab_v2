-- Run in Supabase SQL editor.
--
-- Two fixes for the item-coverage timeout, both about how RLS is evaluated.
--
-- 1. The policies added in 20260907000002 read USING (is_app_user()). Postgres
--    evaluates a function in an RLS predicate ONCE PER ROW, and is_app_user()
--    runs a subquery against app_users each time. On a large erp_items that is
--    millions of subqueries before the real work starts, and it also stops the
--    planner using the upper(item_code) index.
--
--    Wrapping the call in a scalar subquery — USING ((SELECT is_app_user())) —
--    makes it an InitPlan: evaluated once per statement, then treated as a
--    constant. This is the documented Supabase pattern and it applies to every
--    table, not just the ERP cache, so this speeds the whole app up.
--
-- 2. erp_coverage becomes SECURITY DEFINER with one explicit authorization
--    check at the top. Authorization is unchanged — a caller outside app_users
--    still gets nothing — but the scan inside the function no longer re-checks
--    the policy for every row it touches.

-- ── 1. Re-issue every policy with the call wrapped ───────────────────────────
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pricing_master', 'project_items', 'brands', 'brand_rules',
    'price_history', 'exchange_rates',
    'price_history_batches', 'erp_items', 'erp_sync_meta'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'skipping %, table not present', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS "app read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "app write" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "app read" ON %I FOR SELECT TO authenticated '
      'USING ((SELECT is_app_user()))', tbl);
    EXECUTE format(
      'CREATE POLICY "app write" ON %I FOR ALL TO authenticated '
      'USING ((SELECT is_app_admin())) WITH CHECK ((SELECT is_app_admin()))', tbl);
  END LOOP;
END $$;

-- app_users itself carries the same per-row cost on its admin policy.
DROP POLICY IF EXISTS "app_users admin write" ON app_users;
CREATE POLICY "app_users admin write" ON app_users
  FOR ALL TO authenticated
  USING ((SELECT is_app_admin()));

-- ── 2. Take the hot path out of per-row RLS entirely ─────────────────────────
CREATE OR REPLACE FUNCTION erp_coverage(p_brands text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- The authorization the policies would have applied, done once.
  IF NOT is_app_user() THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;

  WITH scoped AS (
    SELECT p.item_code, p.item_name, p.brand_code, p.barcode,
           p.msrp_aed, p.msrp_sar, p.msrp_qat
    FROM pricing_master p
    WHERE p.item_code IS NOT NULL
      AND (p_brands IS NULL OR array_length(p_brands, 1) IS NULL
           OR p.brand_code = ANY (p_brands))
  ),
  missing AS (
    SELECT s.*
    FROM scoped s
    WHERE NOT EXISTS (
      SELECT 1 FROM erp_items e
      WHERE upper(e.item_code) = upper(s.item_code)
    )
    ORDER BY s.item_code
  )
  SELECT jsonb_build_object(
    'erp_total',  COALESCE((SELECT item_count FROM erp_sync_meta WHERE id = 1), 0),
    'db_total',   (SELECT count(*) FROM scoped),
    'not_in_erp', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM missing m), '[]'::jsonb)
  )
  INTO result;

  RETURN result;
END $$;

REVOKE ALL ON FUNCTION erp_coverage(text[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION erp_coverage(text[]) TO authenticated;
