const { hashPassword } = require('../crypto');

// ---- Warehouses ----
async function listWarehouses(db) {
  const { rows } = await db.query(`SELECT id, name FROM warehouses ORDER BY name`);
  return rows;
}

async function addWarehouse(db, name) {
  const clean = (name || '').trim();
  if (!clean) { const err = new Error('Warehouse name is required.'); err.status = 400; throw err; }
  const { rows } = await db.query(
    `INSERT INTO warehouses (name) VALUES ($1)
     ON CONFLICT (name) DO NOTHING RETURNING id, name`,
    [clean]
  );
  if (!rows.length) { const err = new Error('A warehouse with this name already exists.'); err.status = 409; throw err; }
  return rows[0];
}

async function deleteWarehouse(db, id) {
  // Refuse if any user or data row still references this warehouse — avoids
  // silently orphaning someone's login or stock history.
  const { rows: wRows } = await db.query(`SELECT name FROM warehouses WHERE id = $1`, [id]);
  const name = wRows[0]?.name;
  if (!name) { const err = new Error('Warehouse not found.'); err.status = 404; throw err; }

  const { rows: userRows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE warehouse = $1`, [name]);
  if (userRows[0].n > 0) {
    const err = new Error(`Can't delete "${name}" — ${userRows[0].n} user(s) are still assigned to it. Reassign or remove them first.`);
    err.status = 409;
    throw err;
  }
  const { rows: itemRows } = await db.query(`SELECT count(*)::int AS n FROM items WHERE warehouse = $1`, [name]);
  if (itemRows[0].n > 0) {
    const err = new Error(`Can't delete "${name}" — it still has ${itemRows[0].n} item(s) and possibly transaction history. This is a safety check, not a technical limit.`);
    err.status = 409;
    throw err;
  }
  await db.query(`DELETE FROM warehouses WHERE id = $1`, [id]);
}

// ---- Users ----
// Never return password_hash / password_salt to the client.
async function listUsers(db) {
  const { rows } = await db.query(
    `SELECT id, username, name, email, role, warehouse, active, created_at
     FROM users ORDER BY created_at`
  );
  return rows;
}

async function createUser(db, { username, password, name, email, role, warehouse }) {
  const u = (username || '').trim().toLowerCase();
  if (!u || !password || !name) { const err = new Error('Username, password, and name are required.'); err.status = 400; throw err; }
  if (role !== 'admin' && !warehouse) { const err = new Error('Non-admin users must be assigned a warehouse.'); err.status = 400; throw err; }

  const { hash, salt } = hashPassword(password);
  try {
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, password_salt, name, email, role, warehouse)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [u, hash, salt, name, email || '', role || 'user', role === 'admin' ? null : warehouse]
    );
    return rows[0].id;
  } catch (e) {
    if (e.code === '23505') { const err = new Error('That username is already taken.'); err.status = 409; throw err; }
    throw e;
  }
}

async function updateUser(db, id, { name, email, role, warehouse, active, password }) {
  if (role && role !== 'admin' && !warehouse) {
    const err = new Error('Non-admin users must be assigned a warehouse.'); err.status = 400; throw err;
  }
  await db.query(
    `UPDATE users SET name=$2, email=$3, role=$4, warehouse=$5, active=$6 WHERE id=$1`,
    [id, name, email || '', role, role === 'admin' ? null : warehouse, active !== false]
  );
  if (password) {
    const { hash, salt } = hashPassword(password);
    await db.query(`UPDATE users SET password_hash=$2, password_salt=$3 WHERE id=$1`, [id, hash, salt]);
  }
}

async function setUserActive(db, id, active) {
  await db.query(`UPDATE users SET active=$2 WHERE id=$1`, [id, active]);
}

module.exports = {
  listWarehouses, addWarehouse, deleteWarehouse,
  listUsers, createUser, updateUser, setUserActive,
};
