-- Run in Supabase SQL editor. Supersedes the function in
-- 20260912000000_erp_coverage_rpc.sql (CREATE OR REPLACE, so just run it).
--
-- The first version timed out because of one line:
--
--   'erp_total', (SELECT count(*) FROM erp_items)
--
-- That is a full scan of the ERP cache on every call, and — being independent
-- of p_brands — it ran identically whether the caller scoped to one brand or
-- none. It is also the exact cost erp_sync_meta was created to avoid; see the
-- note above getErpCacheInfo in db.live.js.
--
-- The anti-join itself was never the expensive part: NOT EXISTS does one index
-- lookup per scoped row and never scans erp_items, which is why the ERP side
-- needs no brand filter to stay cheap.

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
    -- Maintained by every sync. Can lag a running sync by one batch; that is
    -- the same figure the ERP ITEM CACHE header already shows, and it is a
    -- display total only — nothing is decided from it.
    'erp_total',  COALESCE((SELECT item_count FROM erp_sync_meta WHERE id = 1), 0),
    'db_total',   (SELECT count(*) FROM scoped),
    'not_in_erp', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM missing m), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION erp_coverage(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION erp_coverage(text[]) TO authenticated;

-- ── Confirm the indexes actually exist ───────────────────────────────────────
-- Without these the NOT EXISTS degrades to a sequential scan of erp_items per
-- scoped row, which will time out no matter how narrow the brand filter is.
-- Creating an index on a large table can itself exceed the editor's timeout,
-- so verify rather than assume:
--
--   SELECT indexname FROM pg_indexes
--   WHERE tablename IN ('erp_items','pricing_master')
--     AND indexname LIKE '%item_code_upper%';
--
-- Expect two rows. If either is missing, create it on its own:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS erp_items_item_code_upper_idx
--     ON erp_items (upper(item_code));
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS pricing_master_item_code_upper_idx
--     ON pricing_master (upper(item_code));
--
-- CONCURRENTLY must be run outside a transaction — one statement at a time, on
-- its own, not as part of a larger script.

-- ── If it still times out ────────────────────────────────────────────────────
--   EXPLAIN ANALYZE SELECT erp_coverage(ARRAY['BKBS']);
-- A "Seq Scan on erp_items" in that plan means the index is missing or unused.
