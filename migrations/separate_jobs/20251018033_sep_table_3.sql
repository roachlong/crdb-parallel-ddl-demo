CREATE TABLE IF NOT EXISTS sep_t3 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key STRING NOT NULL,
  name STRING NOT NULL,
  amount DECIMAL(18,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sep_t3_uniq ON sep_t3(tenant_key, name);
CREATE INDEX IF NOT EXISTS sep_t3_tenant_idx ON sep_t3(tenant_key);
CREATE INDEX IF NOT EXISTS sep_t3_created_idx ON sep_t3(created_at);
