-- GodownBook (new version) — gdb_ tables. Also auto-applied by
-- src/routes/godownbook.js at boot, so running this by hand is optional.

CREATE TABLE IF NOT EXISTS gdb_items (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  segment TEXT NOT NULL DEFAULT '',
  sub_segment TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'PCS',
  opening NUMERIC NOT NULL DEFAULT 0,
  min_level NUMERIC NOT NULL DEFAULT 0,
  seq BIGSERIAL
);
CREATE TABLE IF NOT EXISTS gdb_transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  invoice TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  qty NUMERIC NOT NULL DEFAULT 0,
  party TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  bill_group TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  edited_at TEXT NOT NULL DEFAULT '',
  warehouse TEXT NOT NULL DEFAULT '',
  supplier_invoice TEXT NOT NULL DEFAULT '',
  delivery_ref TEXT NOT NULL DEFAULT '',
  seq BIGSERIAL
);
CREATE INDEX IF NOT EXISTS gdb_transactions_bill_group_idx ON gdb_transactions (bill_group);
CREATE TABLE IF NOT EXISTS gdb_edit_log (
  id TEXT PRIMARY KEY,
  bill_group TEXT NOT NULL DEFAULT '',
  invoice TEXT NOT NULL DEFAULT '',
  edited_by TEXT NOT NULL DEFAULT '',
  edited_at TEXT NOT NULL DEFAULT '',
  changes_json TEXT NOT NULL DEFAULT '',
  original_json TEXT NOT NULL DEFAULT '',
  seq BIGSERIAL
);
CREATE TABLE IF NOT EXISTS gdb_bills (
  id TEXT PRIMARY KEY,
  bill_no TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  qty NUMERIC NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pending',
  dispatched_at TEXT NOT NULL DEFAULT '',
  outward_bill_group TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL DEFAULT '',
  warehouse TEXT NOT NULL DEFAULT '',
  value NUMERIC NOT NULL DEFAULT 0,
  seq BIGSERIAL
);
CREATE UNIQUE INDEX IF NOT EXISTS gdb_bills_billno_unique
  ON gdb_bills ((UPPER(REPLACE(bill_no, ' ', ''))))
  WHERE bill_no <> '';
CREATE TABLE IF NOT EXISTS gdb_customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  warehouse TEXT NOT NULL DEFAULT '',
  seq BIGSERIAL
);
CREATE TABLE IF NOT EXISTS gdb_daily_sheets (
  id TEXT PRIMARY KEY,
  ref_no TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  bill_groups_json TEXT NOT NULL DEFAULT '',
  saved_by TEXT NOT NULL DEFAULT '',
  saved_at TEXT NOT NULL DEFAULT '',
  seq BIGSERIAL
);
CREATE TABLE IF NOT EXISTS gdb_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'godown',
  warehouse TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  seq BIGSERIAL
);
CREATE TABLE IF NOT EXISTS gdb_warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  seq BIGSERIAL
);
CREATE TABLE IF NOT EXISTS gdb_ignored_bills (
  id TEXT PRIMARY KEY,
  prefix TEXT NOT NULL DEFAULT '',
  num NUMERIC NOT NULL DEFAULT 0,
  bill_no TEXT NOT NULL DEFAULT '',
  ignored_by TEXT NOT NULL DEFAULT '',
  ignored_at TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  seq BIGSERIAL
);
