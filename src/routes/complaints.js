const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const svc = require('../services/complaintService');

function complaintRoutes(db) {
  const router = express.Router();
  const auth = requireAuth(db);

  router.get('/all', auth, async (req, res) => {
    try { res.json(await svc.readAll(db)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Any logged-in user (admin or Call Attender) can log a new complaint.
  router.post('/', auth, async (req, res) => {
    try { res.json({ ok: true, id: await svc.addComplaint(db, req.user, req.body) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.put('/:ticketNo/status', auth, async (req, res) => {
    try { await svc.updateStatus(db, req.params.ticketNo, req.body.status); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.put('/:ticketNo/assign', auth, async (req, res) => {
    try { res.json({ ok: true, status: await svc.updateAssignment(db, req.params.ticketNo, req.body.technician) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Technicians — any logged-in user can add (matches the original UI,
  // which showed this tab to both Admin and Call Attender roles).
  router.post('/technicians', auth, async (req, res) => {
    try { await svc.addTechnician(db, req.body); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Items — admin only (matches the original UI, which hid this tab from
  // the Call Attender role).
  router.post('/items', auth, requireAdmin, async (req, res) => {
    try { await svc.addItem(db, req.body); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  return router;
}

module.exports = complaintRoutes;
