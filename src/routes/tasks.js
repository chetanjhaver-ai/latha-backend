const express = require('express');
const { requireAuth } = require('../middleware/auth');
const tm = require('../services/taskService');

function taskRoutes(db) {
  const router = express.Router();
  const auth = requireAuth(db);

  router.get('/all', auth, async (req, res) => {
    try { res.json(await tm.readAll(db)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/employees', auth, async (req, res) => {
    try { res.json({ ok: true, id: await tm.addEmployee(db, req.body) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/employees/:id', auth, async (req, res) => {
    try { await tm.updateEmployeeField(db, req.params.id, req.body.field, req.body.value); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/employees/:id', auth, async (req, res) => {
    try { await tm.deleteEmployee(db, req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/tasks', auth, async (req, res) => {
    try { res.json({ ok: true, id: await tm.createTask(db, req.body) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/tasks/:id', auth, async (req, res) => {
    try { await tm.updateTask(db, req.params.id, req.body); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/tasks/:id/done', auth, async (req, res) => {
    try { await tm.markDone(db, req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/tasks/:id', auth, async (req, res) => {
    try { await tm.deleteTask(db, req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/updates', auth, async (req, res) => {
    try { res.json({ ok: true, id: await tm.addUpdate(db, req.body) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

module.exports = taskRoutes;
