-- Promote item_code to PK, drop generated uuid id column
ALTER TABLE project_items DROP CONSTRAINT project_items_pkey;
ALTER TABLE project_items DROP COLUMN id;
ALTER TABLE project_items ADD PRIMARY KEY (item_code);
