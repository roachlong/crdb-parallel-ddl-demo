CREATE TABLE IF NOT EXISTS sep_t8 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key STRING NOT NULL,
  name STRING NOT NULL,
  amount DECIMAL(18,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sep_t8_uniq ON sep_t8(tenant_key, name);
CREATE INDEX IF NOT EXISTS sep_t8_tenant_idx ON sep_t8(tenant_key);
CREATE INDEX IF NOT EXISTS sep_t8_created_idx ON sep_t8(created_at);
