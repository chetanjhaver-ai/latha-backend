-- Phase 3: Complaint CRM ("ComplaintBook"), migrated off Google Sheets +
-- client-side OAuth the same way Godown Book was. Table names are prefixed
-- with complaint_ (except complaints itself) to avoid any collision with
-- Godown Book's existing items/customers tables in this shared database.

CREATE TABLE IF NOT EXISTS complaints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no    TEXT UNIQUE NOT NULL,        -- e.g. 'MK-0001', shown to users as the ID
  brand        TEXT NOT NULL,               -- 'Makkal' | 'Elac' | 'Vijay'
  name         TEXT NOT NULL,               -- customer name
  contact      TEXT NOT NULL,
  address      TEXT DEFAULT '',
  product      TEXT DEFAULT '',
  complaint    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'Open', -- 'Open' | 'In Progress' | 'Resolved'
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_to  TEXT DEFAULT '',
  assigned_at  TIMESTAMPTZ,
  resolved_at  TIMESTAMPTZ,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_complaints_brand  ON complaints(brand);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);

CREATE TABLE IF NOT EXISTS complaint_technicians (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name   TEXT NOT NULL,
  number TEXT NOT NULL,
  area   TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS complaint_items (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL,
  item  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS complaint_customers (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact TEXT UNIQUE NOT NULL,
  name    TEXT NOT NULL,
  address TEXT DEFAULT ''
);
