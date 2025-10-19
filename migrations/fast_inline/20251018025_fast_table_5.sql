CREATE TABLE IF NOT EXISTS fast_t5 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key STRING NOT NULL,
  name STRING NOT NULL,
  amount DECIMAL(18,4) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fast_t5_uniq UNIQUE (tenant_key, name),
  INDEX fast_t5_tenant_idx (tenant_key),
  INDEX fast_t5_created_idx (created_at)
);
