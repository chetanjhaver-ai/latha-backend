const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const admin = require('../services/adminService');

function adminRoutes(db) {
  const router = express.Router();
  const auth = requireAuth(db);

  // ---- Warehouses ----
  router.get('/warehouses', auth, requireAdmin, async (req, res) => {
    try { res.json(await admin.listWarehouses(db)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.post('/warehouses', auth, requireAdmin, async (req, res) => {
    try { res.json({ ok: true, warehouse: await admin.addWarehouse(db, req.body.name) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.delete('/warehouses/:id', auth, requireAdmin, async (req, res) => {
    try { await admin.deleteWarehouse(db, req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ---- Users ----
  router.get('/users', auth, requireAdmin, async (req, res) => {
    try { res.json(await admin.listUsers(db)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.post('/users', auth, requireAdmin, async (req, res) => {
    try { res.json({ ok: true, id: await admin.createUser(db, req.body) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.put('/users/:id', auth, requireAdmin, async (req, res) => {
    try { await admin.updateUser(db, req.params.id, req.body); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.put('/users/:id/active', auth, requireAdmin, async (req, res) => {
    try { await admin.setUserActive(db, req.params.id, !!req.body.active); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  return router;
}

module.exports = adminRoutes;
