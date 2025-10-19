-- demo_table_6 (independent migration)
CREATE TABLE IF NOT EXISTS demo_table_6 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key STRING NOT NULL,
  name STRING NOT NULL,
  amount DECIMAL(18,4) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT demo_table_6_uniq UNIQUE (tenant_key, name),
  INDEX demo_table_6_tenant_idx (tenant_key),
  INDEX demo_table_6_created_idx (created_at)
);
