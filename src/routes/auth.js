const express = require('express');
const { login, logout } = require('../services/authService');
const { requireAuth } = require('../middleware/auth');

function authRoutes(db) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const result = await login(db, username, password);
    if (result.error) return res.status(401).json(result);
    // Besides returning the bearer token (used by the app's data calls,
    // exactly as before), also set it as an HttpOnly cookie — that cookie
    // is what unlocks the served app code at /crm/app. One session, two
    // carriers. Max-Age matches the session's 24h validity.
    res.setHeader('Set-Cookie',
      `crmsession=${encodeURIComponent(result.token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400`);
    res.json(result);
  });

  router.post('/logout', async (req, res) => {
    const header = req.headers.authorization || '';
    let token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      const m = String(req.headers.cookie || '').match(/(?:^|;\s*)crmsession=([^;]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }
    await logout(db, token);
    res.setHeader('Set-Cookie', 'crmsession=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
    res.json({ ok: true });
  });

  // Lets the frontend confirm a saved token is still valid on page load,
  // without needing to know anything about it beyond "yes/no and who am I".
  router.get('/me', requireAuth(db), (req, res) => {
    res.json({ ok: true, user: req.user });
  });

  return router;
}

module.exports = authRoutes;
