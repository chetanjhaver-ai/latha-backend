/**
 * GODOWNBOOK — BACKUP SPREADSHEET RECEIVER (Apps Script)
 *
 * Lives on a NEW, dedicated Google Spreadsheet whose only job is to hold
 * last night's copy of the database in readable tabs (Items, Bills,
 * Transactions, ...). The nightly GitHub job pushes data here after taking
 * the .dump backup. Google's own File → Version history on this sheet
 * gives you extra older restore points for free.
 *
 * RESTORE, if ever needed: this script also serves the data back in the
 * exact format GodownBook's migrateFromSheets expects — so restoring into
 * a fresh database is the same one migration command you used at cutover,
 * just pointed at THIS deployment's URL.
 *
 * ── SETUP (one time, ~5 minutes) ──
 * 1. Create a new Google Spreadsheet, name it e.g. "GodownBook BACKUP".
 * 2. Copy its ID from the address bar — the long code between /d/ and
 *    /edit in the URL — and paste it into SHEET_ID below.
 * 3. In the spreadsheet: Extensions → Apps Script → delete any code there
 *    → paste this whole file → Save.
 * 4. Deploy → New deployment → type: Web app →
 *      Execute as: Me   |   Who has access: Anyone
 *    → Deploy → copy the Web app URL.
 * 5. In GitHub (latha-backend repo → Settings → Secrets and variables →
 *    Actions) add two secrets:
 *      GAS_BACKUP_URL = the Web app URL you just copied
 *      GAS_BACKUP_KEY = godown-backup-2026   (or change SHARED_KEY below
 *                       to your own value and use that)
 */

var SHEET_ID = '1bucCaenU0cBpDrItE1t32zEyl3y8FpkMM1tLoLesxwo';
var SHARED_KEY = 'godown-backup-2026';

// Tab name -> key used by GodownBook's restore (migrateFromSheets) format.
var READALL_KEYS = {
  items: 'Items', transactions: 'Transactions', bills: 'Bills',
  customers: 'Customers', dailySheets: 'DailySheets', users: 'Users',
  warehouses: 'Warehouses', ignoredBills: 'IgnoredBills'
};

function doGet(e) {
  try {
    if ((e.parameter.key || '') !== SHARED_KEY) return jsonOut({ error: 'unauthorized' });
    var ss = SpreadsheetApp.openById(SHEET_ID);
    if (e.parameter.op === 'readAll') {
      var out = {};
      for (var k in READALL_KEYS) out[k] = readTab_(ss, READALL_KEYS[k]);
      return jsonOut(out);
    }
    if (e.parameter.op === 'readSheet') {
      return jsonOut({ rows: readTab_(ss, e.parameter.sheet) });
    }
    return jsonOut({ error: 'unknown GET op' });
  } catch (err) {
    return jsonOut({ error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var body = JSON.parse(e.postData.contents);
    if ((body.key || '') !== SHARED_KEY) return jsonOut({ error: 'unauthorized' });
    var ss = SpreadsheetApp.openById(SHEET_ID);

    // Writes one chunk of one tab. mode 'replace' clears the tab first
    // (start of that tab's backup); 'append' adds the next chunk.
    if (body.op === 'replaceSheet') {
      var sh = ss.getSheetByName(body.sheet);
      if (!sh) sh = ss.insertSheet(body.sheet);
      if (body.mode === 'replace') {
        sh.clearContents();
        sh.getRange(1, 1, 1, body.headers.length).setValues([body.headers]);
      }
      var rows = body.rows || [];
      if (rows.length) {
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, body.headers.length).setValues(rows);
      }
      return jsonOut({ ok: true, written: rows.length });
    }

    // Final stamp — writes a BackupInfo tab so anyone opening the sheet can
    // see at a glance when the last backup ran and how many rows each tab has.
    if (body.op === 'stamp') {
      var info = ss.getSheetByName('BackupInfo');
      if (!info) info = ss.insertSheet('BackupInfo', 0);
      info.clearContents();
      var lines = [['GODOWNBOOK NIGHTLY BACKUP'], ['Last backup completed (IST):', body.timestamp || ''], ['']];
      lines.push(['Tab', 'Rows']);
      var counts = body.counts || {};
      for (var name in counts) lines.push([name, counts[name]]);
      info.getRange(1, 1, lines.length, 2).setValues(lines.map(function (l) { return [l[0] || '', l[1] === undefined ? '' : l[1]]; }));
      return jsonOut({ ok: true });
    }

    return jsonOut({ error: 'unknown op: ' + body.op });
  } catch (err) {
    return jsonOut({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function readTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  return data.slice(1).filter(function (r) { return r[0] !== '' && r[0] !== null; });
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
