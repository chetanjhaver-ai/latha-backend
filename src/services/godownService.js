// Godown Book's data operations — real Postgres tables, real sessions, and
// (as of Phase 2b) every row scoped to a warehouse so godown1/godown2/godown3
// staff each only ever see and write their own warehouse's data. Admin has
// no warehouse restriction and can view/filter across all of them.

// warehouse === null/undefined means "no restriction" (admin viewing "All").
async function readAll(db, warehouse) {
  const w = warehouse || null;
  const [items, txns, log, bills, customers] = await Promise.all([
    db.query(
      `SELECT id, code, name, brand, segment, subsegment, unit, opening, min_level, warehouse
       FROM items WHERE ($1::text IS NULL OR warehouse = $1) ORDER BY created_at`, [w]),
    db.query(
      `SELECT id, type, date, invoice, item_id, qty, party, remarks, bill_group, created_by, edited_at, warehouse
       FROM gb_transactions WHERE ($1::text IS NULL OR warehouse = $1) ORDER BY created_at`, [w]),
    db.query(
      `SELECT id, bill_group, invoice, edited_by, edited_at, changes, original
       FROM gb_edit_log
       WHERE ($1::text IS NULL OR bill_group IN (SELECT DISTINCT bill_group FROM gb_transactions WHERE warehouse = $1))
       ORDER BY edited_at`, [w]),
    db.query(
      `SELECT id, bill_no, customer_name, qty, received_at, status, dispatched_at, outward_bill_group, warehouse
       FROM gb_bills WHERE ($1::text IS NULL OR warehouse = $1) ORDER BY received_at`, [w]),
    db.query(
      `SELECT id, name, phone, area, type, warehouse
       FROM gb_customers WHERE ($1::text IS NULL OR warehouse = $1) ORDER BY name`, [w]),
  ]);
  return {
    items: items.rows.map(r => ({
      id: r.id, code: r.code, name: r.name, brand: r.brand, segment: r.segment,
      subsegment: r.subsegment, unit: r.unit, opening: Number(r.opening), minLevel: Number(r.min_level),
      warehouse: r.warehouse,
    })),
    transactions: txns.rows.map(r => ({
      id: r.id, type: r.type, date: r.date.toISOString().slice(0, 10), invoice: r.invoice,
      itemId: r.item_id, qty: Number(r.qty), party: r.party, remarks: r.remarks,
      billGroup: r.bill_group, createdBy: r.created_by, editedAt: r.edited_at, warehouse: r.warehouse,
    })),
    editLog: log.rows.map(r => ({
      id: r.id, billGroup: r.bill_group, invoice: r.invoice, editedBy: r.edited_by,
      editedAt: r.edited_at, changes: JSON.stringify(r.changes), original: JSON.stringify(r.original),
    })),
    bills: bills.rows.map(r => ({
      id: r.id, billNo: r.bill_no, customerName: r.customer_name, qty: Number(r.qty),
      receivedAt: r.received_at, status: r.status, dispatchedAt: r.dispatched_at,
      outwardBillGroup: r.outward_bill_group, warehouse: r.warehouse,
    })),
    customers: customers.rows.map(r => ({
      id: r.id, name: r.name, phone: r.phone, area: r.area, type: r.type, warehouse: r.warehouse,
    })),
  };
}

// ---- Items (admin-only writes, enforced by requireAdmin middleware in the route) ----
async function addItem(db, item) {
  const { rows } = await db.query(
    `INSERT INTO items (code, name, brand, segment, subsegment, unit, opening, min_level, warehouse)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [item.code, item.name, item.brand, item.segment, item.subsegment, item.unit, item.opening, item.minLevel, item.warehouse]
  );
  return rows[0].id;
}
async function addItemsBulk(db, items, warehouse) {
  for (const item of items) {
    const withWarehouse = { ...item, warehouse: item.warehouse || warehouse };
    // Match for upsert is scoped to the SAME warehouse — the same Code can
    // legitimately exist as a different item in a different godown.
    const { rows } = await db.query(
      `SELECT id FROM items WHERE lower(code) = lower($1) AND warehouse = $2 LIMIT 1`,
      [withWarehouse.code, withWarehouse.warehouse]
    );
    if (rows.length) await editItem(db, rows[0].id, withWarehouse);
    else await addItem(db, withWarehouse);
  }
}
async function editItem(db, id, item) {
  // Warehouse is intentionally not editable here — an item doesn't move
  // between godowns via a data edit.
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

async function createBill(db, user, { type, date, invoice, party, remarks, rows, warehouse }) {
  const billGroup = cryptoRandom();
  for (const r of rows) {
    await db.query(
      `INSERT INTO gb_transactions (type, date, invoice, item_id, qty, party, remarks, bill_group, created_by, warehouse)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [type, date, invoice, r.itemId, r.qty, party, remarks, billGroup, user.email, warehouse]
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
  const warehouse = oldRows[0]?.warehouse; // a bill never changes warehouse via edit
  await db.query(`DELETE FROM gb_transactions WHERE bill_group = $1`, [billGroup]);
  for (const r of rows) {
    await db.query(
      `INSERT INTO gb_transactions (type, date, invoice, item_id, qty, party, remarks, bill_group, created_by, edited_at, warehouse)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10)`,
      [oldRows[0]?.type || 'IN', date, invoice, r.itemId, r.qty, party, remarks, billGroup, createdBy, warehouse]
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
async function addReceivedBills(db, billRows, warehouse) {
  const ids = [];
  for (const r of billRows) {
    const { rows } = await db.query(
      `INSERT INTO gb_bills (bill_no, customer_name, qty, status, warehouse) VALUES ($1,$2,$3,'Pending',$4) RETURNING id`,
      [r.billNo, r.customer, r.qty, r.warehouse || warehouse]
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

// ---- Customers ----
async function addCustomer(db, c) {
  const { rows } = await db.query(
    `INSERT INTO gb_customers (name, phone, area, type, warehouse) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [c.name, c.phone || '', c.area || '', c.type || '', c.warehouse]
  );
  return rows[0].id;
}
async function addCustomersBulk(db, customers, warehouse) {
  for (const c of customers) {
    const withWarehouse = { ...c, warehouse: c.warehouse || warehouse };
    // Same-name customers in different godowns are different customers —
    // match for upsert is scoped to the same warehouse.
    const { rows } = await db.query(
      `SELECT id FROM gb_customers WHERE lower(name) = lower($1) AND warehouse = $2 LIMIT 1`,
      [withWarehouse.name, withWarehouse.warehouse]
    );
    if (rows.length) await editCustomer(db, rows[0].id, withWarehouse);
    else await addCustomer(db, withWarehouse);
  }
}
async function editCustomer(db, id, c) {
  await db.query(
    `UPDATE gb_customers SET name=$2, phone=$3, area=$4, type=$5 WHERE id=$1`,
    [id, c.name, c.phone || '', c.area || '', c.type || '']
  );
}
async function deleteCustomer(db, id) {
  await db.query(`DELETE FROM gb_customers WHERE id = $1`, [id]);
}

function cryptoRandom() {
  return require('crypto').randomUUID();
}

module.exports = {
  readAll, addItem, addItemsBulk, editItem,
  createBill, editBill, deleteBill, getBillRows, assertCanEditBill,
  addReceivedBills, markBillDispatched, deleteReceivedBill,
  addCustomer, editCustomer, deleteCustomer, addCustomersBulk,
};
