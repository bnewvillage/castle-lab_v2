-- Run in Supabase SQL editor
CREATE TABLE IF NOT EXISTS project_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code         text        NOT NULL UNIQUE,
  project_item_name text,
  cost              numeric     NOT NULL,
  cost_currency     text        NOT NULL,
  shipping_rate     numeric     NOT NULL DEFAULT 0,
  customs_duty_rate numeric     NOT NULL DEFAULT 5.5,
  msrp_aed_inc_vat  numeric,
  msrp_aed_ex_vat   numeric,
  uae_overridden    boolean     NOT NULL DEFAULT false,
  created_by        text,
  updated_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read"  ON project_items FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated write" ON project_items FOR ALL    USING (auth.role() = 'authenticated');
