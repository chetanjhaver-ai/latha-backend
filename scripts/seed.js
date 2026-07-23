// One-time (or re-run anytime) script to create/update the starting accounts.
// Edit the plaintext passwords below to whatever you want them to actually be
// — only the resulting HASH gets stored in the database, never the plaintext.
require('dotenv').config();
const { Pool } = require('pg');
const { hashPassword } = require('../src/crypto');

const SEED_USERS = [
  { username: 'admin',   password: 'admin123',   name: 'Admin',          email: 'chetan.jhaver@gmail.com', role: 'admin', warehouse: null },
  { username: 'godown1', password: 'godown1123', name: 'Godown 1 Staff', email: 'godown1@store.com',        role: 'user',  warehouse: 'Godown 1' },
  { username: 'godown2', password: 'godown2123', name: 'Godown 2 Staff', email: 'godown2@store.com',        role: 'user',  warehouse: 'Godown 2' },
  { username: 'godown3', password: 'godown3123', name: 'Godown 3 Staff', email: 'godown3@store.com',        role: 'user',  warehouse: 'Godown 3' },
];

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  for (const u of SEED_USERS) {
    const { hash, salt } = hashPassword(u.password);
    await pool.query(
      `INSERT INTO users (username, password_hash, password_salt, name, email, role, warehouse)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             password_salt = EXCLUDED.password_salt,
             name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role, warehouse = EXCLUDED.warehouse`,
      [u.username, hash, salt, u.name, u.email, u.role, u.warehouse]
    );
    console.log('Seeded user:', u.username, u.warehouse ? `(${u.warehouse})` : '(admin — all warehouses)');
  }
  // The old single-warehouse 'godown' account is superseded by godown1/2/3.
  await pool.query(`DELETE FROM users WHERE username = 'godown'`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
