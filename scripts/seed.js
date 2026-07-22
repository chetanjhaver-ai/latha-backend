// One-time (or re-run anytime) script to create/update the starting accounts.
// Edit the plaintext passwords below to whatever you want them to actually be
// — only the resulting HASH gets stored in the database, never the plaintext.
require('dotenv').config();
const { Pool } = require('pg');
const { hashPassword } = require('../src/crypto');

const SEED_USERS = [
  { username: 'admin',  password: 'admin123',  name: 'Admin',        email: 'chetan.jhaver@gmail.com', role: 'admin' },
  { username: 'godown', password: 'godown123', name: 'Godown Staff', email: 'godown@store.com',         role: 'user'  },
];

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  for (const u of SEED_USERS) {
    const { hash, salt } = hashPassword(u.password);
    await pool.query(
      `INSERT INTO users (username, password_hash, password_salt, name, email, role)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             password_salt = EXCLUDED.password_salt,
             name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role`,
      [u.username, hash, salt, u.name, u.email, u.role]
    );
    console.log('Seeded user:', u.username);
  }
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
