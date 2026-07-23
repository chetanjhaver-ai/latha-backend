const PREFIX = { Makkal: 'MK', Elac: 'EL', Vijay: 'VJ' };

async function readAll(db) {
  const [complaints, technicians, items, customers] = await Promise.all([
    db.query(`SELECT id, ticket_no, brand, name, contact, address, product, complaint,
                      status, logged_at, assigned_to, assigned_at, resolved_at, created_by
               FROM complaints ORDER BY logged_at`),
    db.query(`SELECT id, name, number, area FROM complaint_technicians ORDER BY name`),
    db.query(`SELECT id, brand, item FROM complaint_items ORDER BY brand, item`),
    db.query(`SELECT id, contact, name, address FROM complaint_customers ORDER BY name`),
  ]);
  return {
    // Field names mirror what the frontend already expects (camelCase,
    // "id" being the human ticket number it displays and searches by).
    complaints: complaints.rows.map(r => ({
      id: r.ticket_no, brand: r.brand, name: r.name, contact: r.contact,
      address: r.address, product: r.product, complaint: r.complaint, status: r.status,
      loggedAt: r.logged_at, assignedTo: r.assigned_to, assignedAt: r.assigned_at,
      resolvedAt: r.resolved_at, createdBy: r.created_by,
    })),
    technicians: technicians.rows.map(r => ({ id: r.id, name: r.name, number: r.number, area: r.area })),
    items: items.rows.map(r => ({ id: r.id, brand: r.brand, item: r.item })),
    customers: customers.rows.map(r => ({ id: r.id, contact: r.contact, name: r.name, address: r.address })),
  };
}

async function nextTicketNo(db, brand) {
  const prefix = PREFIX[brand] || brand.slice(0, 2).toUpperCase();
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM complaints WHERE brand = $1`, [brand]);
  return prefix + '-' + String(rows[0].n + 1).padStart(4, '0');
}

async function upsertCustomer(db, contact, name, address) {
  await db.query(
    `INSERT INTO complaint_customers (contact, name, address) VALUES ($1,$2,$3)
     ON CONFLICT (contact) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address`,
    [contact, name, address]
  );
}

async function addComplaint(db, user, { brand, name, contact, address, product, complaint }) {
  if (!brand || !name || !contact || !complaint) {
    const err = new Error('Brand, name, contact, and complaint are required.'); err.status = 400; throw err;
  }
  const ticketNo = await nextTicketNo(db, brand);
  await db.query(
    `INSERT INTO complaints (ticket_no, brand, name, contact, address, product, complaint, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Open',$8)`,
    [ticketNo, brand, name, contact, address || '', product || '', complaint, user.email]
  );
  await upsertCustomer(db, contact, name, address || '');
  return ticketNo;
}

async function updateStatus(db, ticketNo, newStatus) {
  const { rows } = await db.query(`SELECT status, resolved_at FROM complaints WHERE ticket_no = $1`, [ticketNo]);
  const cur = rows[0];
  if (!cur) { const err = new Error('Complaint not found.'); err.status = 404; throw err; }

  let resolvedAt = cur.resolved_at;
  if (newStatus === 'Resolved') resolvedAt = new Date();
  else if (newStatus === 'Open') resolvedAt = null;

  await db.query(`UPDATE complaints SET status = $2, resolved_at = $3 WHERE ticket_no = $1`, [ticketNo, newStatus, resolvedAt]);
}

async function updateAssignment(db, ticketNo, technicianName) {
  const { rows } = await db.query(`SELECT status, assigned_at FROM complaints WHERE ticket_no = $1`, [ticketNo]);
  const cur = rows[0];
  if (!cur) { const err = new Error('Complaint not found.'); err.status = 404; throw err; }

  let newStatus = cur.status;
  if (technicianName && cur.status === 'Open') newStatus = 'In Progress';
  if (!technicianName && cur.status === 'In Progress') newStatus = 'Open';

  const assignedAt = (technicianName && !cur.assigned_at) ? new Date() : cur.assigned_at;

  await db.query(
    `UPDATE complaints SET assigned_to = $2, status = $3, assigned_at = $4 WHERE ticket_no = $1`,
    [ticketNo, technicianName || '', newStatus, assignedAt]
  );
  return newStatus;
}

async function addTechnician(db, { name, number, area }) {
  if (!name || !number) { const err = new Error('Name and contact number are required.'); err.status = 400; throw err; }
  const { rows } = await db.query(`SELECT 1 FROM complaint_technicians WHERE lower(name) = lower($1)`, [name]);
  if (rows.length) { const err = new Error('That technician is already in the list.'); err.status = 409; throw err; }
  await db.query(`INSERT INTO complaint_technicians (name, number, area) VALUES ($1,$2,$3)`, [name, number, area || '']);
}

async function addItem(db, { brand, item }) {
  if (!brand || !item) { const err = new Error('Brand and item name are required.'); err.status = 400; throw err; }
  const { rows } = await db.query(
    `SELECT 1 FROM complaint_items WHERE brand = $1 AND lower(item) = lower($2)`, [brand, item]
  );
  if (rows.length) { const err = new Error('That item already exists.'); err.status = 409; throw err; }
  await db.query(`INSERT INTO complaint_items (brand, item) VALUES ($1,$2)`, [brand, item]);
}

module.exports = { readAll, addComplaint, updateStatus, updateAssignment, addTechnician, addItem };
