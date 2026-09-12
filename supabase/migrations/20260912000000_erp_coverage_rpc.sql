-- Run in Supabase SQL editor.
--
-- Item Coverage used to answer "which pricing-master items are missing from the
-- ERP?" by downloading both tables to the browser and doing the set difference
-- in JavaScript. Two full table walks, paginated 1000 rows at a time (PostgREST
-- caps there regardless of the requested page size), each page paying a deep
-- OFFSET scan — so the work grew quadratically and took minutes.
--
-- Postgres does anti-joins for a living. This moves the whole question into one
-- round trip that returns only the answer.

-- ── Indexes the anti-join needs ──────────────────────────────────────────────
-- Codes are compared case-insensitively, so the indexes must be on upper(),
-- otherwise the planner falls back to a sequential scan of erp_items.
CREATE INDEX IF NOT EXISTS erp_items_item_code_upper_idx
  ON erp_items (upper(item_code));

CREATE INDEX IF NOT EXISTS pricing_master_item_code_upper_idx
  ON pricing_master (upper(item_code));

-- ── Coverage in one call ─────────────────────────────────────────────────────
-- Returns a single jsonb row: counts plus the missing items. Returning one row
-- rather than a result set also sidesteps PostgREST's max_rows cap, which would
-- otherwise silently truncate the missing list at 1000.
--
-- p_brands scopes the pricing-master side only. The ERP side is deliberately
-- never filtered: erp_items.brand holds the ERP's own brand string, which does
-- not line up with brand_code, and narrowing by code prefix would miss any item
-- whose ERP code does not carry the prefix. Scoping the question is fine;
-- scoping what we check it against would produce false "missing" rows.
--
-- SECURITY INVOKER so the caller's RLS still applies — an account outside
-- app_users sees nothing, exactly as with a direct select.
CREATE OR REPLACE FUNCTION erp_coverage(p_brands text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    'erp_total',  (SELECT count(*) FROM erp_items),
    'db_total',   (SELECT count(*) FROM scoped),
    'not_in_erp', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM missing m), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION erp_coverage(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION erp_coverage(text[]) TO authenticated;

-- Sanity check after running:
--   SELECT erp_coverage() -> 'erp_total',
--          erp_coverage() -> 'db_total',
--          jsonb_array_length(erp_coverage() -> 'not_in_erp');
