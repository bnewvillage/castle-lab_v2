-- Run in Supabase SQL editor.
--
-- Bulk rename of item codes (the BRAND-SKU part number).
--
-- item_code is the primary key of pricing_master, and nothing in this schema
-- declares a foreign key against it — price_history and erp_items match on the
-- string at query time. So a bare UPDATE would rename the row and silently
-- leave every reference pointing at a code that no longer exists: the item
-- would appear to lose its entire price history.
--
-- Three writes therefore have to happen together, or none of them:
--   1. pricing_master.item_code   — the rename itself
--   2. pricing_master.brand_code  — when the BRAND- prefix changed, otherwise
--                                   the code says KLIM while brand_code still
--                                   says ALPN and every brand filter, markup
--                                   rule and brand report disagrees with the
--                                   code on screen
--   3. price_history.item_code    — so the item keeps its past
--
-- A function gives us that transaction. It also lets the collision check run
-- against the same snapshot as the writes, which a client-side pre-check
-- cannot promise.

CREATE OR REPLACE FUNCTION rename_item_codes(p_pairs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email    text := lower(auth.jwt() ->> 'email');
  v_renamed  int  := 0;
  v_history  int  := 0;
  v_conflict text;
  v_missing  text;
BEGIN
  -- Renaming rewrites primary keys, so this is admin-only regardless of the
  -- policies SECURITY DEFINER is bypassing.
  IF NOT is_app_admin() THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;

  CREATE TEMP TABLE _pairs ON COMMIT DROP AS
  SELECT DISTINCT
         upper(trim(p ->> 'old')) AS old_code,
         upper(trim(p ->> 'new')) AS new_code
  FROM jsonb_array_elements(p_pairs) AS p;

  DELETE FROM _pairs WHERE old_code IS NULL OR new_code IS NULL
                        OR old_code = '' OR new_code = '' OR old_code = new_code;

  -- One source code may not map to two targets.
  SELECT string_agg(old_code, ', ') INTO v_conflict
  FROM (SELECT old_code FROM _pairs GROUP BY old_code HAVING count(*) > 1) d;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'item code listed twice with different targets: %', v_conflict;
  END IF;

  -- Every source must exist, or the caller is renaming something they think
  -- they have and will get a silent partial result.
  SELECT string_agg(pr.old_code, ', ') INTO v_missing
  FROM _pairs pr
  WHERE NOT EXISTS (SELECT 1 FROM pricing_master m WHERE m.item_code = pr.old_code);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'item code not found: %', v_missing;
  END IF;

  -- A target may only collide with a row that is itself being renamed away,
  -- which makes swaps and chained renames legal but real collisions an error.
  SELECT string_agg(pr.new_code, ', ') INTO v_conflict
  FROM _pairs pr
  JOIN pricing_master m ON m.item_code = pr.new_code
  WHERE NOT EXISTS (SELECT 1 FROM _pairs x WHERE x.old_code = m.item_code);
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'target item code already in use: %', v_conflict;
  END IF;

  -- pricing_master first: if a foreign key with ON UPDATE CASCADE is ever
  -- added, it will carry price_history along and the second statement simply
  -- matches nothing.
  UPDATE pricing_master m
  SET item_code  = pr.new_code,
      -- Only adopt the new prefix when it is a brand that actually exists;
      -- an unrecognised prefix leaves brand_code as it was.
      brand_code = COALESCE(
        (SELECT b.brand_code FROM brands b
         WHERE b.brand_code = split_part(pr.new_code, '-', 1)),
        m.brand_code),
      updated_at = now(),
      updated_by = v_email
  FROM _pairs pr
  WHERE m.item_code = pr.old_code;
  GET DIAGNOSTICS v_renamed = ROW_COUNT;

  UPDATE price_history h
  SET item_code = pr.new_code
  FROM _pairs pr
  WHERE h.item_code = pr.old_code;
  GET DIAGNOSTICS v_history = ROW_COUNT;

  RETURN jsonb_build_object('renamed', v_renamed, 'history_rows', v_history);
END $$;

REVOKE ALL ON FUNCTION rename_item_codes(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION rename_item_codes(jsonb) TO authenticated;

-- Note: the ERP cache is deliberately not touched. erp_items mirrors the ERP,
-- so rewriting it here would make the mirror disagree with the system it
-- mirrors. Renamed items will read as "not in ERP" in Item Coverage until the
-- ERP is renamed too and resynced — which is the honest answer.
