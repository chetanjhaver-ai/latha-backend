-- Phase 2c: warehouses become data, not a hardcoded list, so admin can add
-- more godowns later without a code deploy.

CREATE TABLE IF NOT EXISTS warehouses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with the 3 godowns already in use so existing data lines up.
INSERT INTO warehouses (name) VALUES ('Godown 1'), ('Godown 2'), ('Godown 3')
ON CONFLICT (name) DO NOTHING;
