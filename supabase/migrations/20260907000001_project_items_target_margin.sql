-- Run in Supabase SQL editor
-- Per-item target gross margin for project items. Existing rows were all
-- priced at the previously hard-coded 25%, so backfill them to that value.
ALTER TABLE project_items
  ADD COLUMN IF NOT EXISTS target_margin_pct numeric NOT NULL DEFAULT 25;

ALTER TABLE project_items
  DROP CONSTRAINT IF EXISTS project_items_target_margin_pct_check;

ALTER TABLE project_items
  ADD CONSTRAINT project_items_target_margin_pct_check
  CHECK (target_margin_pct > 0 AND target_margin_pct < 100);
