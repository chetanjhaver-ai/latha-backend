const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }, // most managed Postgres (Render/Railway) needs this
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
