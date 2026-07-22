-- Phase 2: Godown Book's data, now as real relational tables instead of
-- Google Sheets rows.

CREATE TABLE IF NOT EXISTS items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  brand      TEXT DEFAULT '',
  segment    TEXT DEFAULT '',
  subsegment TEXT DEFAULT '',
  unit       TEXT DEFAULT 'PCS',
  opening    NUMERIC NOT NULL DEFAULT 0,
  min_level  NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gb_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,             -- 'IN' | 'OUT'
  date        DATE NOT NULL,
  invoice     TEXT DEFAULT '',
  item_id     UUID REFERENCES items(id),
  qty         NUMERIC NOT NULL,
  party       TEXT DEFAULT '',
  remarks     TEXT DEFAULT '',
  bill_group  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  edited_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gb_transactions_billgroup ON gb_transactions(bill_group);

CREATE TABLE IF NOT EXISTS gb_edit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_group TEXT,
  invoice    TEXT,
  edited_by  TEXT NOT NULL,
  edited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changes    JSONB,
  original   JSONB
);

CREATE TABLE IF NOT EXISTS gb_bills (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no             TEXT DEFAULT '',
  customer_name       TEXT DEFAULT '',
  qty                 NUMERIC NOT NULL DEFAULT 0,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              TEXT NOT NULL DEFAULT 'Pending',   -- 'Pending' | 'Dispatched'
  dispatched_at       TIMESTAMPTZ,
  outward_bill_group  TEXT
);

CREATE TABLE IF NOT EXISTS gb_customers (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL,
  phone TEXT DEFAULT '',
  area  TEXT DEFAULT '',
  type  TEXT DEFAULT ''
);
