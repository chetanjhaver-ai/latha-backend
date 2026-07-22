// Godown Book's data operations — same rules as the Apps Script version
// (v2), just backed by real Postgres tables and real sessions instead of
// a shared key.

async function readAll(db) {
  const [items, txns, log, bills, customers] = await Promise.all([
    db.query(`SELECT id, code, name, brand, segment, subsegment, unit, opening, min_level FROM items ORDER BY created_at`),
    db.query(`SELECT id, type, date, invoice, item_id, qty, party, remarks, bill_group, created_by, edited_at FROM gb_transactions ORDER BY created_at`),
    db.query(`SELECT id, bill_group, invoice, edited_by, edited_at, changes, original FROM gb_edit_log ORDER BY edited_at`),
    db.query(`SELECT id, bill_no, customer_name, qty, received_at, status, dispatched_at, outward_bill_group FROM gb_bills ORDER BY received_at`),
    db.query(`SELECT id, name, phone, area, type FROM gb_customers ORDER BY name`),
  ]);
  return {
    items: items.rows.map(r => ({
      id: r.id, code: r.code, name: r.name, brand: r.brand, segment: r.segment,
      subsegment: r.subsegment, unit: r.unit, opening: Number(r.opening), minLevel: Number(r.min_level),
    })),
    transactions: txns.rows.map(r => ({
      id: r.id, type: r.type, date: r.date.toISOString().slice(0, 10), invoice: r.invoice,
      itemId: r.item_id, qty: Number(r.qty), party: r.party, remarks: r.remarks,
      billGroup: r.bill_group, createdBy: r.created_by, editedAt: r.edited_at,
    })),
    editLog: log.rows.map(r => ({
      id: r.id, billGroup: r.bill_group, invoice: r.invoice, editedBy: r.edited_by,
      editedAt: r.edited_at, changes: JSON.stringify(r.changes), original: JSON.stringify(r.original),
    })),
    bills: bills.rows.map(r => ({
      id: r.id, billNo: r.bill_no, customerName: r.customer_name, qty: Number(r.qty),
      receivedAt: r.received_at, status: r.status, dispatchedAt: r.dispatched_at, outwardBillGroup: r.outward_bill_group,
    })),
    customers: customers.rows.map(r => ({ id: r.id, name: r.name, phone: r.phone, area: r.area, type: r.type })),
  };
}

// ---- Items (admin-only writes, enforced by requireAdmin middleware in the route) ----
async function addItem(db, item) {
  const { rows } = await db.query(
    `INSERT INTO items (code, name, brand, segment, subsegment, unit, opening, min_level)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [item.code, item.name, item.brand, item.segment, item.subsegment, item.unit, item.opening, item.minLevel]
  );
  return rows[0].id;
}
async function addItemsBulk(db, items) {
  for (const item of items) await addItem(db, item);
}
async function editItem(db, id, item) {
  await db.query(
    `UPDATE items SET name=$2, brand=$3, segment=$4, subsegment=$5, unit=$6, opening=$7, min_level=$8 WHERE id=$1`,
    [id, item.name, item.brand, item.segment, item.subsegment, item.unit, item.opening, item.minLevel]
  );
}

// ---- Bills (ledger-style, IN/OUT transactions grouped by billGroup) ----
async function getBillRows(db, billGroup) {
  const { rows } = await db.query(`SELECT * FROM gb_transactions WHERE bill_group = $1`, [billGroup]);
  return rows;
}

// Ownership rule, same as before: admin can touch anything; anyone else
// only their own bills (or bills with no creator recorded, e.g. legacy data).
function assertCanEditBill(user, rows) {
  if (user.role === 'admin') return;
  if (!rows.length) return; // nothing to protect
  const creator = rows[0].created_by;
  if (creator && creator !== user.email) {
    const err = new Error('You can only edit or delete bills you created');
    err.status = 403;
    throw err;
  }
}

async function createBill(db, user, { type, date, invoice, party, remarks, rows }) {
  const billGroup = cryptoRandom();
  const now = new Date();
  for (const r of rows) {
    await db.query(
      `INSERT INTO gb_transactions (type, date, invoice, item_id, qty, party, remarks, bill_group, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [type, date, invoice, r.itemId, r.qty, party, remarks, billGroup, user.email]
    );
  }
  return billGroup;
}

async function editBill(db, user, billGroup, { date, invoice, party, remarks, rows }) {
  const oldRows = await getBillRows(db, billGroup);
  assertCanEditBill(user, oldRows);

  const changes = buildChangeSummary(oldRows, { date, invoice, party, rows });
  await db.query(
    `INSERT INTO gb_edit_log (bill_group, invoice, edited_by, changes, original)
     VALUES ($1,$2,$3,$4,$5)`,
    [billGroup, oldRows[0]?.invoice || invoice, user.email, JSON.stringify(changes), JSON.stringify(oldRows)]
  );

  const createdBy = oldRows[0]?.created_by || user.email;
  await db.query(`DELETE FROM gb_transactions WHERE bill_group = $1`, [billGroup]);
  for (const r of rows) {
    await db.query(
      `INSERT INTO gb_transactions (type, date, invoice, item_id, qty, party, remarks, bill_group, created_by, edited_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
      [oldRows[0]?.type || 'IN', date, invoice, r.itemId, r.qty, party, remarks, billGroup, createdBy]
    );
  }
}

async function deleteBill(db, user, billGroup) {
  const oldRows = await getBillRows(db, billGroup);
  assertCanEditBill(user, oldRows);
  const invoice = oldRows[0]?.invoice || '';
  await db.query(
    `INSERT INTO gb_edit_log (bill_group, invoice, edited_by, changes, original)
     VALUES ($1,$2,$3,$4,$5)`,
    [billGroup, invoice, user.email, JSON.stringify({ deleted: true }), JSON.stringify(oldRows)]
  );
  await db.query(`DELETE FROM gb_transactions WHERE bill_group = $1`, [billGroup]);
}

function buildChangeSummary(oldRows, next) {
  const changes = {};
  const old0 = oldRows[0] || {};
  if (next.date && String(next.date) !== String(old0.date)) changes.date = { from: old0.date, to: next.date };
  if (next.invoice !== undefined && next.invoice !== old0.invoice) changes.invoice = { from: old0.invoice, to: next.invoice };
  if (next.party !== undefined && next.party !== old0.party) changes.party = { from: old0.party, to: next.party };
  return changes;
}

// ---- Bills Received / Pending / Dispatched ----
async function addReceivedBills(db, billRows) {
  const ids = [];
  for (const r of billRows) {
    const { rows } = await db.query(
      `INSERT INTO gb_bills (bill_no, customer_name, qty, status) VALUES ($1,$2,$3,'Pending') RETURNING id`,
      [r.billNo, r.customer, r.qty]
    );
    ids.push(rows[0].id);
  }
  return ids;
}
async function markBillDispatched(db, billId, outwardBillGroup) {
  await db.query(
    `UPDATE gb_bills SET status='Dispatched', dispatched_at=now(), outward_bill_group=$2 WHERE id=$1`,
    [billId, outwardBillGroup]
  );
}
async function deleteReceivedBill(db, billId) {
  await db.query(`DELETE FROM gb_bills WHERE id = $1`, [billId]);
}

function cryptoRandom() {
  return require('crypto').randomUUID();
}

module.exports = {
  readAll, addItem, addItemsBulk, editItem,
  createBill, editBill, deleteBill, getBillRows, assertCanEditBill,
  addReceivedBills, markBillDispatched, deleteReceivedBill,
};
