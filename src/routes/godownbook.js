/**
 * GODOWNBOOK — drop-in route module for the existing latha-backend server.
 *
 * Adds GodownBook as a third app alongside complaints and WMS, on the SAME
 * server and SAME database — no new Render services, no new cost. All its
 * tables are prefixed gdb_ so nothing here can ever touch the complaints
 * tables, the WMS tables (items / gb_transactions / gb_bills / ...), or
 * the shared users table. GodownBook keeps its own users inside gdb_users,
 * exactly as they exist in the Google Sheet today.
 *
 * INSTALL — two steps:
 *   1. Save this file as  src/routes/godownbook.js  (next to godown.js).
 *   2. In src/index.js add one line with the other app.use lines:
 *        app.use('/api/gbook', require('./routes/godownbook')(db));
 *   Commit & push — Render redeploys automatically. Tables create
 *   themselves on the first request; no migration files needed.
 *
 * The GodownBook screen (index.html on Netlify) then points at:
 *   https://<your-render-service>.onrender.com/api/gbook
 *
 * Optional env var: GODOWNBOOK_KEY overrides the shared key
 * (default 'godown-book-2026' — must match GAS_KEY in index.html).
 *
 * Duplicate-bill protection (the reason this rebuild exists) is enforced at
 * three layers, strongest last: the screen checks before saving; this module
 * re-checks inside a transaction serialized by a Postgres advisory lock; and
 * finally gdb_bills has a UNIQUE index on the normalized bill number —
 * UPPER(REPLACE(bill_no,' ','')) — so the database itself refuses a second
 * ELFAN462/26-27 no matter what races, retries, or devices are involved.
 */

const express = require('express');
const { Pool } = require('pg');

const API_KEY = process.env.GODOWNBOOK_KEY || 'godown-book-2026';
const WRITE_LOCK_KEY = 764292027; // advisory-lock id unique to GodownBook

const SCHEMA = `
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
`;

// Sheet-name → table mapping; column order matches the old Google Sheet
// headers EXACTLY, because the app screen addresses columns by index.
const SHEETS = {
  Items:        { table: 'gdb_items',         cols: ['id','code','name','brand','segment','sub_segment','unit','opening','min_level'] },
  Transactions: { table: 'gdb_transactions',  cols: ['id','type','date','invoice','item_id','qty','party','remarks','bill_group','created_by','edited_at','warehouse','supplier_invoice','delivery_ref'] },
  EditLog:      { table: 'gdb_edit_log',      cols: ['id','bill_group','invoice','edited_by','edited_at','changes_json','original_json'] },
  Bills:        { table: 'gdb_bills',         cols: ['id','bill_no','customer_name','qty','received_at','status','dispatched_at','outward_bill_group','items_json','warehouse','value'] },
  Customers:    { table: 'gdb_customers',     cols: ['id','name','phone','area','type','warehouse'] },
  DailySheets:  { table: 'gdb_daily_sheets',  cols: ['id','ref_no','date','bill_groups_json','saved_by','saved_at'] },
  Users:        { table: 'gdb_users',         cols: ['id','username','password','name','email','role','warehouse','active'] },
  Warehouses:   { table: 'gdb_warehouses',    cols: ['id','name'] },
  IgnoredBills: { table: 'gdb_ignored_bills', cols: ['id','prefix','num','bill_no','ignored_by','ignored_at','reason'] },
};

const NUMERIC_COLS = new Set(['qty','opening','min_level','value','num']);
const BOOLEAN_COLS = new Set(['active']);

function coerce(col, v) {
  if (NUMERIC_COLS.has(col)) return Number(v) || 0;
  if (BOOLEAN_COLS.has(col)) return !(v === false || String(v).toLowerCase() === 'false');
  return v == null ? '' : String(v);
}

function rowToArray(def, row) {
  return def.cols.map(c => (NUMERIC_COLS.has(c) ? Number(row[c]) : row[c]));
}

function normKey(v) {
  return String(v == null ? '' : v).toUpperCase().replace(/\s+/g, '');
}

module.exports = function godownbookRoutes(db) {
  // src/db.js exports { query, pool } — use the shared Pool (needed for
  // transactions). Falls back gracefully if db.js ever changes shape.
  const pool = (db && db.pool) ? db.pool
    : (db && typeof db.connect === 'function') ? db
    : new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
      });

  // Create the gdb_ tables once at startup (IF NOT EXISTS — safe every boot).
  let schemaReady = pool.query(SCHEMA).then(
    () => console.log('GodownBook: gdb_ tables ready'),
    (e) => { console.error('GodownBook schema error:', e.message); throw e; }
  );

  async function readSheetRows(client, sheetName) {
    const def = SHEETS[sheetName];
    const res = await client.query(`SELECT ${def.cols.map(c => `"${c}"`).join(',')} FROM "${def.table}" ORDER BY seq`);
    return res.rows.map(r => rowToArray(def, r));
  }

  // One writer at a time — same job Apps Script's LockService did, but held
  // by Postgres and auto-released on commit/rollback/crash.
  async function withWriteLock(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK_KEY]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async function insertRow(client, sheetName, rowArr) {
    const def = SHEETS[sheetName];
    const vals = def.cols.map((c, i) => coerce(c, rowArr[i]));
    const placeholders = def.cols.map((_, i) => `$${i + 1}`).join(',');
    await client.query(
      `INSERT INTO "${def.table}" (${def.cols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`,
      vals
    );
  }

  // SAVEPOINT-wrapped insert: if one row fails (e.g. the unique bill-number
  // index fires), only that row rolls back — the batch keeps going.
  async function insertRowSafe(client, sheetName, rowArr) {
    await client.query('SAVEPOINT sp_ins');
    try {
      await insertRow(client, sheetName, rowArr);
      await client.query('RELEASE SAVEPOINT sp_ins');
      return { ok: true };
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT sp_ins');
      return { ok: false, code: e.code, message: e.message };
    }
  }

  // ─────────── op handlers (same protocol as the Apps Script backend) ───────────

  async function opReadAll() {
    const client = await pool.connect();
    try {
      return {
        items: await readSheetRows(client, 'Items'),
        transactions: await readSheetRows(client, 'Transactions'),
        bills: await readSheetRows(client, 'Bills'),
        customers: await readSheetRows(client, 'Customers'),
        dailySheets: await readSheetRows(client, 'DailySheets'),
        users: await readSheetRows(client, 'Users'),
        warehouses: await readSheetRows(client, 'Warehouses'),
        ignoredBills: await readSheetRows(client, 'IgnoredBills'),
      };
    } finally {
      client.release();
    }
  }

  async function opAppend(body) {
    const def = SHEETS[body.sheet];
    if (!def) return { error: 'unknown sheet: ' + body.sheet };
    const rows = body.rows || [];
    const dedupeCol = typeof body.dedupeCol === 'number' ? body.dedupeCol : null;
    return withWriteLock(async (client) => {
      let added = 0, skipped = 0;
      for (const row of rows) {
        const idExists = await client.query(`SELECT 1 FROM "${def.table}" WHERE id = $1`, [String(row[0])]);
        if (idExists.rowCount) { skipped++; continue; }
        if (dedupeCol !== null) {
          const colName = def.cols[dedupeCol];
          const key = normKey(row[dedupeCol]);
          if (key) {
            const keyExists = await client.query(
              `SELECT 1 FROM "${def.table}" WHERE UPPER(REPLACE("${colName}"::text, ' ', '')) = $1`, [key]
            );
            if (keyExists.rowCount) { skipped++; continue; }
          }
        }
        const ins = await insertRowSafe(client, body.sheet, row);
        if (ins.ok) added++;
        else if (ins.code === '23505') skipped++; // unique_violation — DB-level bill-number guard
        else throw new Error(ins.message);
      }
      return { ok: true, added, skippedDuplicates: skipped };
    });
  }

  async function opDispatchOutward(body) {
    return withWriteLock(async (client) => {
      if (body.outwardBillGroup) {
        const bg = await client.query('SELECT 1 FROM gdb_transactions WHERE bill_group = $1 LIMIT 1', [String(body.outwardBillGroup)]);
        if (bg.rowCount) return { ok: true, alreadyProcessed: true, dispatchedCount: 0, transactionsAdded: 0 };
      }
      const billIds = body.billIds || [];
      const alreadyDispatched = [];
      for (const id of billIds) {
        const r = await client.query('SELECT status FROM gdb_bills WHERE id = $1', [String(id)]);
        if (r.rowCount && r.rows[0].status === 'Dispatched') alreadyDispatched.push(id);
      }
      if (alreadyDispatched.length) {
        return { ok: false, reason: 'already_dispatched', billIds: alreadyDispatched };
      }
      const txnRows = body.transactionRows || [];
      for (const row of txnRows) await insertRow(client, 'Transactions', row);
      const now = body.now || new Date().toISOString();
      for (const id of billIds) {
        await client.query(
          `UPDATE gdb_bills SET status = 'Dispatched', dispatched_at = $1, outward_bill_group = $2 WHERE id = $3`,
          [now, String(body.outwardBillGroup || ''), String(id)]
        );
      }
      return { ok: true, dispatchedCount: billIds.length, transactionsAdded: txnRows.length };
    });
  }

  async function opSaveNewInward(body) {
    return withWriteLock(async (client) => {
      if (body.billGroup) {
        const bg = await client.query('SELECT 1 FROM gdb_transactions WHERE bill_group = $1 LIMIT 1', [String(body.billGroup)]);
        if (bg.rowCount) return { ok: true, alreadyProcessed: true, transactionsAdded: 0 };
      }
      const rows = body.transactionRows || [];
      for (const row of rows) await insertRow(client, 'Transactions', row);
      return { ok: true, transactionsAdded: rows.length };
    });
  }

  async function opSaveEditedDelivery(body) {
    const attemptId = body.attemptId;
    if (!attemptId) return { error: 'attemptId is required' };
    return withWriteLock(async (client) => {
      const done = await client.query('SELECT 1 FROM gdb_edit_log WHERE id = $1', [String(attemptId)]);
      if (done.rowCount) return { ok: true, alreadyProcessed: true };

      await insertRow(client, 'EditLog', body.logRow);
      const del = await client.query('DELETE FROM gdb_transactions WHERE bill_group = $1', [String(body.editingBillGroup)]);
      const newRows = body.transactionRows || [];
      for (const row of newRows) await insertRow(client, 'Transactions', row);

      const newlyAdded = body.newlyAddedBillIds || [];
      const now = body.now || new Date().toISOString();
      let marked = 0;
      for (const id of newlyAdded) {
        const r = await client.query(
          `UPDATE gdb_bills SET status = 'Dispatched', dispatched_at = $1, outward_bill_group = $2
           WHERE id = $3 AND status <> 'Dispatched'`,
          [now, String(body.editingBillGroup || ''), String(id)]
        );
        marked += r.rowCount;
      }
      return { ok: true, clearedCount: del.rowCount, transactionsAdded: newRows.length, billsMarked: marked };
    });
  }

  async function opUpdateRange(body) {
    const def = SHEETS[body.sheet];
    if (!def) return { error: 'unknown sheet: ' + body.sheet };
    const vals = (body.values && body.values[0]) || [];
    const startCol = body.startCol;
    return withWriteLock(async (client) => {
      const exists = await client.query(`SELECT 1 FROM "${def.table}" WHERE id = $1`, [String(body.id)]);
      if (!exists.rowCount) return { error: 'not found' };
      const sets = [];
      const params = [];
      vals.forEach((v, i) => {
        const col = def.cols[startCol + i];
        if (!col) return;
        params.push(coerce(col, v));
        sets.push(`"${col}" = $${params.length}`);
      });
      if (!sets.length) return { ok: true };
      params.push(String(body.id));
      await client.query(`UPDATE "${def.table}" SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      return { ok: true };
    });
  }

  async function opClearWhere(body) {
    const def = SHEETS[body.sheet];
    if (!def) return { error: 'unknown sheet: ' + body.sheet };
    const col = def.cols[body.matchCol];
    if (!col) return { error: 'bad matchCol' };
    return withWriteLock(async (client) => {
      const r = await client.query(`DELETE FROM "${def.table}" WHERE "${col}"::text = $1`, [String(body.matchValue)]);
      return { ok: true, cleared: r.rowCount };
    });
  }

  async function opClearAllRows(body) {
    const def = SHEETS[body.sheet];
    if (!def) return { error: 'unknown sheet: ' + body.sheet };
    return withWriteLock(async (client) => {
      await client.query(`DELETE FROM "${def.table}"`);
      return { ok: true };
    });
  }

  // One-time import from the live Google Apps Script backend. Re-runnable:
  // rows whose ID already exists are skipped; duplicate bill numbers are
  // skipped and reported by name in duplicateBillsSkipped.
  async function opMigrateFromSheets(body) {
    const gasUrl = body.gasUrl;
    const gasKey = body.gasKey || '';
    if (!gasUrl) return { error: 'gasUrl is required' };

    const fetchJson = async (params) => {
      const url = gasUrl + '?key=' + encodeURIComponent(gasKey) + '&' + params;
      const res = await fetch(url, { redirect: 'follow' });
      const j = await res.json();
      if (j.error) throw new Error('Apps Script: ' + j.error);
      return j;
    };

    const all = await fetchJson('op=readAll');
    let editLog = [];
    try { editLog = (await fetchJson('op=readSheet&book=data&sheet=EditLog')).rows || []; } catch (e) {}
    let dailySheets = all.dailySheets || [];
    if (!dailySheets.length) {
      try { dailySheets = (await fetchJson('op=readSheet&book=data&sheet=DailySheets')).rows || []; } catch (e) {}
    }

    const jobs = [
      ['Warehouses', all.warehouses || []],
      ['Users', all.users || []],
      ['Items', all.items || []],
      ['Customers', all.customers || []],
      ['Bills', all.bills || []],
      ['Transactions', all.transactions || []],
      ['EditLog', editLog],
      ['DailySheets', dailySheets],
      ['IgnoredBills', all.ignoredBills || []],
    ];

    const report = {};
    const duplicateBillsSkipped = [];
    await withWriteLock(async (client) => {
      for (const [sheetName, rows] of jobs) {
        const def = SHEETS[sheetName];
        let added = 0, skipped = 0;
        for (const row of rows) {
          if (!row || row[0] === '' || row[0] == null) continue;
          const idExists = await client.query(`SELECT 1 FROM "${def.table}" WHERE id = $1`, [String(row[0])]);
          if (idExists.rowCount) { skipped++; continue; }
          const ins = await insertRowSafe(client, sheetName, row);
          if (ins.ok) added++;
          else if (ins.code === '23505') {
            skipped++;
            if (sheetName === 'Bills') duplicateBillsSkipped.push(String(row[1]));
          } else {
            throw new Error(sheetName + ' row ' + String(row[0]) + ': ' + ins.message);
          }
        }
        report[sheetName] = { imported: added, skipped };
      }
    });
    return { ok: true, report, duplicateBillsSkipped };
  }

  // ─────────── router ───────────

  const router = express.Router();

  // The app screen posts JSON; also tolerate a missing/odd Content-Type
  // (the old screen posted as text/plain to dodge Apps Script CORS rules).
  router.use((req, res, next) => {
    if (req.method !== 'POST' || (req.body && Object.keys(req.body).length)) return next();
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (raw) { try { req.body = JSON.parse(raw); } catch (e) { req.body = {}; } }
      next();
    });
  });

  router.get('/', async (req, res) => {
    try {
      await schemaReady;
      if ((req.query.key || '') !== API_KEY) return res.json({ error: 'unauthorized' });
      if (req.query.op === 'readAll') return res.json(await opReadAll());
      if (req.query.op === 'readSheet') {
        const sheetName = req.query.sheet;
        if (!sheetName || !SHEETS[sheetName]) return res.json({ error: 'unknown sheet: ' + sheetName });
        const client = await pool.connect();
        try { return res.json({ rows: await readSheetRows(client, sheetName) }); }
        finally { client.release(); }
      }
      return res.json({ error: 'unknown GET op' });
    } catch (err) {
      return res.json({ error: String(err) });
    }
  });

  router.post('/', async (req, res) => {
    try {
      await schemaReady;
      const body = req.body || {};
      if ((body.key || '') !== API_KEY) return res.json({ error: 'unauthorized' });
      switch (body.op) {
        case 'append': return res.json(await opAppend(body));
        case 'dispatchOutward': return res.json(await opDispatchOutward(body));
        case 'saveNewInward': return res.json(await opSaveNewInward(body));
        case 'saveEditedDelivery': return res.json(await opSaveEditedDelivery(body));
        case 'updateRange': return res.json(await opUpdateRange(body));
        case 'clearWhere': return res.json(await opClearWhere(body));
        case 'clearAllRows': return res.json(await opClearAllRows(body));
        case 'migrateFromSheets': return res.json(await opMigrateFromSheets(body));
        default: return res.json({ error: 'unknown op: ' + body.op });
      }
    } catch (err) {
      return res.json({ error: String(err) });
    }
  });

  return router;
};
