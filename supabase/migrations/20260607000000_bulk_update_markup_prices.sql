-- Single UPDATE join against a jsonb array — one round trip for any brand size.

CREATE OR REPLACE FUNCTION bulk_update_markup_prices(
  updates       jsonb,
  p_updated_by  text,
  p_updated_at  timestamptz
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE pricing_master pm
  SET
    msrp_aed   = (u->>'msrp_aed')::numeric,
    msrp_sar   = (u->>'msrp_sar')::numeric,
    msrp_qat   = (u->>'msrp_qat')::numeric,
    updated_at = p_updated_at,
    updated_by = p_updated_by
  FROM jsonb_array_elements(updates) AS u
  WHERE pm.item_code = u->>'item_code';
END;
$$;
