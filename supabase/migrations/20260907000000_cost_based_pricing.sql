-- Cost-based pricing: allow price_used = 'cost_based' and store the target margin.
-- Run this in the Supabase SQL editor BEFORE using the new "Cost + margin" option.

-- 1. Widen the price_used check constraint.
--    If your constraint has a different name, find it first with:
--    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'pricing_master'::regclass AND pg_get_constraintdef(oid) ILIKE '%price_used%';
ALTER TABLE pricing_master DROP CONSTRAINT IF EXISTS pricing_master_price_used_check;
ALTER TABLE pricing_master ADD CONSTRAINT pricing_master_price_used_check
  CHECK (price_used IN ('primary_ex_vat','primary_inc_vat','secondary_ex_vat','secondary_inc_vat','cost_based'));

-- 2. Store the enforced margin for cost-based items (null for MSRP-based items).
ALTER TABLE pricing_master ADD COLUMN IF NOT EXISTS target_margin_pct numeric
  CHECK (target_margin_pct IS NULL OR (target_margin_pct > 0 AND target_margin_pct < 100));
