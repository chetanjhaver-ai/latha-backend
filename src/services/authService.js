const { verifyPassword } = require('../crypto');

const SESSION_HOURS = 24;
const RATE_LIMIT_WINDOW_MIN = 15;
const RATE_LIMIT_MAX_FAILURES = 5;

async function checkRateLimit(db, username) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS failures FROM login_attempts
     WHERE username = $1 AND succeeded = false
       AND attempted_at > now() - interval '${RATE_LIMIT_WINDOW_MIN} minutes'`,
    [username]
  );
  return rows[0].failures < RATE_LIMIT_MAX_FAILURES;
}

async function recordAttempt(db, username, succeeded) {
  await db.query(`INSERT INTO login_attempts (username, succeeded) VALUES ($1, $2)`, [username, succeeded]);
}

async function login(db, username, password) {
  const u = (username || '').toLowerCase().trim();
  if (!u || !password) return { error: 'Please enter username and password.' };

  const allowed = await checkRateLimit(db, u);
  if (!allowed) {
    return { error: `Too many failed attempts. Please wait ${RATE_LIMIT_WINDOW_MIN} minutes and try again.` };
  }

  const { rows } = await db.query(
    `SELECT id, username, password_hash, password_salt, name, email, role, active, warehouse
     FROM users WHERE username = $1`,
    [u]
  );
  const user = rows[0];

  const valid = user && user.active && verifyPassword(password, user.password_hash, user.password_salt);
  await recordAttempt(db, u, !!valid);

  if (!valid) return { error: 'Invalid username or password.' };

  const { rows: sessRows } = await db.query(
    `INSERT INTO sessions (user_id, expires_at)
     VALUES ($1, now() + interval '${SESSION_HOURS} hours')
     RETURNING token`,
    [user.id]
  );

  return {
    ok: true,
    token: sessRows[0].token,
    role: user.role,
    name: user.name,
    email: user.email,
    warehouse: user.warehouse,
  };
}

async function requireSession(db, token) {
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT s.token, s.expires_at, u.id AS user_id, u.username, u.role, u.name, u.email, u.active, u.warehouse
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token]
  );
  const row = rows[0];
  if (!row || !row.active) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
    return null;
  }
  return { userId: row.user_id, username: row.username, role: row.role, name: row.name, email: row.email, warehouse: row.warehouse };
}

async function logout(db, token) {
  if (token) await db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

async function cleanupExpiredSessions(db) {
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
}

module.exports = { login, requireSession, logout, cleanupExpiredSessions };
