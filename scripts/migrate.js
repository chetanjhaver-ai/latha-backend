require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  // Postgres' gen_random_uuid() needs this extension enabled once per database.
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    console.log('Applying', file, '...');
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await pool.query(sql);
  }
  console.log('All migrations applied.');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
