CREATE TABLE IF NOT EXISTS sep_t6 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key STRING NOT NULL,
  name STRING NOT NULL,
  amount DECIMAL(18,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sep_t6_uniq ON sep_t6(tenant_key, name);
CREATE INDEX IF NOT EXISTS sep_t6_tenant_idx ON sep_t6(tenant_key);
CREATE INDEX IF NOT EXISTS sep_t6_created_idx ON sep_t6(created_at);
