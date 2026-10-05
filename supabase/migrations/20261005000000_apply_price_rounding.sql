-- Run in Supabase SQL editor before using Automations → Price Rounding.
--
-- Applies a re-round of stored prices (see src/lib/rounding.js) and records it
-- for Rollback, in one transaction per call.
--
-- Two properties the existing bulk_update_markup_prices RPC lacks:
--
--   Compare-and-set.  Each change carries the exact prices the preview read.
--                     A row is updated only while all six still match, so an
--                     item edited between preview and apply is skipped rather
--                     than overwritten. The return value says how many applied.
--
--   History in the same transaction.  The price_history rows Rollback reads
--                     are written by the same statement that changes the
--                     prices, and only for rows that actually changed. Prices
--                     can never move without a record, and no record can claim
--                     a change that was skipped.
--
-- It also writes real_msrp_* (the base prices before additional brand markup),
-- which bulk_update_markup_prices silently ignores.
--
-- Rollback restores msrp_aed / msrp_sar / msrp_qat from history, as it does
-- for Global Markup. real_msrp_* are not part of price history, so they keep
-- the new rounding after a rollback — harmless, since they are recomputed
-- whenever a price is next derived.

CREATE OR REPLACE FUNCTION apply_price_rounding(p_batch_id uuid, p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email   text        := lower(auth.jwt() ->> 'email');
  v_now     timestamptz := now();
  v_applied int;
BEGIN
  IF NOT is_app_admin() THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;

  WITH c AS (
    SELECT upper(x ->> 'item_code') AS item_code, x -> 'set' AS s, x -> 'expect' AS e
    FROM jsonb_array_elements(p_changes) AS x
  ),
  upd AS (
    UPDATE pricing_master pm
    SET msrp_aed      = CASE WHEN c.s ? 'msrp_aed'      THEN (c.s ->> 'msrp_aed')::numeric      ELSE pm.msrp_aed      END,
        msrp_sar      = CASE WHEN c.s ? 'msrp_sar'      THEN (c.s ->> 'msrp_sar')::numeric      ELSE pm.msrp_sar      END,
        msrp_qat      = CASE WHEN c.s ? 'msrp_qat'      THEN (c.s ->> 'msrp_qat')::numeric      ELSE pm.msrp_qat      END,
        real_msrp_aed = CASE WHEN c.s ? 'real_msrp_aed' THEN (c.s ->> 'real_msrp_aed')::numeric ELSE pm.real_msrp_aed END,
        real_msrp_sar = CASE WHEN c.s ? 'real_msrp_sar' THEN (c.s ->> 'real_msrp_sar')::numeric ELSE pm.real_msrp_sar END,
        real_msrp_qat = CASE WHEN c.s ? 'real_msrp_qat' THEN (c.s ->> 'real_msrp_qat')::numeric ELSE pm.real_msrp_qat END,
        updated_at    = v_now,
        updated_by    = v_email
    FROM c
    WHERE pm.item_code = c.item_code
      AND pm.msrp_aed      IS NOT DISTINCT FROM (c.e ->> 'msrp_aed')::numeric
      AND pm.msrp_sar      IS NOT DISTINCT FROM (c.e ->> 'msrp_sar')::numeric
      AND pm.msrp_qat      IS NOT DISTINCT FROM (c.e ->> 'msrp_qat')::numeric
      AND pm.real_msrp_aed IS NOT DISTINCT FROM (c.e ->> 'real_msrp_aed')::numeric
      AND pm.real_msrp_sar IS NOT DISTINCT FROM (c.e ->> 'real_msrp_sar')::numeric
      AND pm.real_msrp_qat IS NOT DISTINCT FROM (c.e ->> 'real_msrp_qat')::numeric
    RETURNING pm.item_code, pm.brand_code, pm.msrp_aed, pm.msrp_sar, pm.msrp_qat, c.s, c.e
  )
  INSERT INTO price_history (
    item_code, brand_code, batch_id, operation_type, changed_at, changed_by,
    old_msrp_aed, new_msrp_aed, old_msrp_sar, new_msrp_sar, old_msrp_qat, new_msrp_qat
  )
  SELECT u.item_code, u.brand_code, p_batch_id, 'rounding_rule', v_now, v_email,
         (u.e ->> 'msrp_aed')::numeric, CASE WHEN u.s ? 'msrp_aed' THEN u.msrp_aed END,
         (u.e ->> 'msrp_sar')::numeric, CASE WHEN u.s ? 'msrp_sar' THEN u.msrp_sar END,
         (u.e ->> 'msrp_qat')::numeric, CASE WHEN u.s ? 'msrp_qat' THEN u.msrp_qat END
  FROM upd u;

  GET DIAGNOSTICS v_applied = ROW_COUNT;
  RETURN jsonb_build_object('applied', v_applied);
END $$;

REVOKE ALL ON FUNCTION apply_price_rounding(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION apply_price_rounding(uuid, jsonb) TO authenticated;

-- If either history table restricts operation_type with a CHECK constraint,
-- 'rounding_rule' must be allowed. The app writes the batch row first, so a
-- rejection there fails before any price changes. To see any such constraint:
--   SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid IN ('price_history'::regclass, 'price_history_batches'::regclass)
--     AND contype = 'c';
