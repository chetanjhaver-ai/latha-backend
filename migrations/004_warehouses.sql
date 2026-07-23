-- Phase 2b: multi-warehouse support. Each godown user is now tied to exactly
-- one warehouse and only ever sees/writes that warehouse's data. Admin has
-- warehouse = NULL, meaning "not restricted" — sees everything, and must
-- explicitly pick a warehouse (via the frontend filter) when creating data.

ALTER TABLE users           ADD COLUMN IF NOT EXISTS warehouse TEXT;
ALTER TABLE items           ADD COLUMN IF NOT EXISTS warehouse TEXT NOT NULL DEFAULT 'Godown 1';
ALTER TABLE gb_transactions ADD COLUMN IF NOT EXISTS warehouse TEXT NOT NULL DEFAULT 'Godown 1';
ALTER TABLE gb_bills        ADD COLUMN IF NOT EXISTS warehouse TEXT NOT NULL DEFAULT 'Godown 1';
ALTER TABLE gb_customers    ADD COLUMN IF NOT EXISTS warehouse TEXT NOT NULL DEFAULT 'Godown 1';

CREATE INDEX IF NOT EXISTS idx_items_warehouse           ON items(warehouse);
CREATE INDEX IF NOT EXISTS idx_gb_transactions_warehouse ON gb_transactions(warehouse);
CREATE INDEX IF NOT EXISTS idx_gb_bills_warehouse         ON gb_bills(warehouse);
CREATE INDEX IF NOT EXISTS idx_gb_customers_warehouse     ON gb_customers(warehouse);
