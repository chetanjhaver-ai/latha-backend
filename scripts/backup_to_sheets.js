// GODOWNBOOK — nightly mirror of the database into the backup Google Sheet.
// Runs inside the GitHub "Nightly database backup" workflow, right after the
// .dump snapshot. Reads every gdb_ table from Postgres and writes it into
// the backup spreadsheet (via the BackupSheet.gs web app), tab by tab, in
// chunks. Save this file in the repo at:  scripts/backup_to_sheets.js
//
// Needs env vars (the workflow provides them from GitHub secrets):
//   DATABASE_URL, GAS_BACKUP_URL, GAS_BACKUP_KEY

const { Pool } = require('pg');

const TABLES = [
  { tab: 'Items',        table: 'gdb_items',         headers: ['ID','Code','Name','Brand','Segment','SubSegment','Unit','Opening','MinLevel'],
    cols: ['id','code','name','brand','segment','sub_segment','unit','opening','min_level'] },
  { tab: 'Transactions', table: 'gdb_transactions',  headers: ['ID','Type','Date','Invoice','ItemID','Qty','Party','Remarks','BillGroup','CreatedBy','EditedAt','Warehouse','SupplierInvoice','DeliveryRef'],
    cols: ['id','type','date','invoice','item_id','qty','party','remarks','bill_group','created_by','edited_at','warehouse','supplier_invoice','delivery_ref'] },
  { tab: 'EditLog',      table: 'gdb_edit_log',      headers: ['ID','BillGroup','Invoice','EditedBy','EditedAt','ChangesJSON','OriginalJSON'],
    cols: ['id','bill_group','invoice','edited_by','edited_at','changes_json','original_json'] },
  { tab: 'Bills',        table: 'gdb_bills',         headers: ['ID','BillNo','CustomerName','Qty','ReceivedAt','Status','DispatchedAt','OutwardBillGroup','ItemsJSON','Warehouse','Value'],
    cols: ['id','bill_no','customer_name','qty','received_at','status','dispatched_at','outward_bill_group','items_json','warehouse','value'] },
  { tab: 'Customers',    table: 'gdb_customers',     headers: ['ID','Name','Phone','Area','Type','Warehouse'],
    cols: ['id','name','phone','area','type','warehouse'] },
  { tab: 'DailySheets',  table: 'gdb_daily_sheets',  headers: ['ID','RefNo','Date','BillGroupsJSON','SavedBy','SavedAt'],
    cols: ['id','ref_no','date','bill_groups_json','saved_by','saved_at'] },
  { tab: 'Users',        table: 'gdb_users',         headers: ['ID','Username','Password','Name','Email','Role','Warehouse','Active'],
    cols: ['id','username','password','name','email','role','warehouse','active'] },
  { tab: 'Warehouses',   table: 'gdb_warehouses',    headers: ['ID','Name'],
    cols: ['id','name'] },
  { tab: 'IgnoredBills', table: 'gdb_ignored_bills', headers: ['ID','Prefix','Num','BillNo','IgnoredBy','IgnoredAt','Reason'],
    cols: ['id','prefix','num','bill_no','ignored_by','ignored_at','reason'] },
];

const CHUNK = 2000;

async function pushChunk(gasUrl, gasKey, tab, headers, rows, mode) {
  const res = await fetch(gasUrl, {
    method: 'POST',
    body: JSON.stringify({ key: gasKey, op: 'replaceSheet', sheet: tab, headers, rows, mode }),
    redirect: 'follow',
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`${tab}: ${j.error || 'unknown error from backup sheet'}`);
  return j.written;
}

async function main() {
  const { DATABASE_URL, GAS_BACKUP_URL, GAS_BACKUP_KEY } = process.env;
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!GAS_BACKUP_URL || !GAS_BACKUP_KEY) throw new Error('GAS_BACKUP_URL / GAS_BACKUP_KEY secrets are not set');

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  });

  const counts = {};
  for (const t of TABLES) {
    const res = await pool.query(`SELECT ${t.cols.map(c => `"${c}"`).join(',')} FROM "${t.table}" ORDER BY seq`);
    const rows = res.rows.map(r => t.cols.map(c => {
      const v = r[c];
      return v === null || v === undefined ? '' : v;
    }));
    if (!rows.length) {
      await pushChunk(GAS_BACKUP_URL, GAS_BACKUP_KEY, t.tab, t.headers, [], 'replace');
    } else {
      for (let i = 0; i < rows.length; i += CHUNK) {
        await pushChunk(GAS_BACKUP_URL, GAS_BACKUP_KEY, t.tab, t.headers, rows.slice(i, i + CHUNK), i === 0 ? 'replace' : 'append');
      }
    }
    counts[t.tab] = rows.length;
    console.log(`  ${t.tab}: ${rows.length} row(s) mirrored`);
  }
  await pool.end();

  // Stamp the BackupInfo tab with an IST timestamp + per-tab counts.
  const ist = new Date(Date.now() + (5.5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').slice(0, 19);
  const res = await fetch(GAS_BACKUP_URL, {
    method: 'POST',
    body: JSON.stringify({ key: GAS_BACKUP_KEY, op: 'stamp', timestamp: ist + ' IST', counts }),
    redirect: 'follow',
  });
  const j = await res.json();
  if (!j.ok) throw new Error('stamp failed: ' + (j.error || '?'));
  console.log('Google Sheets mirror complete at', ist, 'IST');
}

main().catch(err => { console.error('Sheets mirror FAILED:', err.message); process.exit(1); });
