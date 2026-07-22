const express = require('express');
const { login, logout } = require('../services/authService');
const { requireAuth } = require('../middleware/auth');

function authRoutes(db) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const result = await login(db, username, password);
    if (result.error) return res.status(401).json(result);
    res.json(result);
  });

  router.post('/logout', async (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    await logout(db, token);
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
