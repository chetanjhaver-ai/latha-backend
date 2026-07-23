const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const gb = require('../services/godownService');

// Determines which warehouse a request should be scoped to.
// - Non-admin users are ALWAYS forced to their own warehouse — whatever the
//   client sends in query/body is ignored. This is the actual security
//   boundary between godown1/godown2/godown3.
// - Admin can pass ?warehouse=... (reads) or body.warehouse (writes) to
//   target a specific godown. Omitted on a read = "all warehouses".
function resolveReadWarehouse(req) {
  if (req.user.role !== 'admin') return req.user.warehouse;
  return req.query.warehouse || null;
}
function resolveWriteWarehouse(req) {
  if (req.user.role !== 'admin') return req.user.warehouse;
  return req.body.warehouse || null;
}

function godownRoutes(db) {
  const router = express.Router();
  const auth = requireAuth(db);

  router.get('/all', auth, async (req, res) => {
    try { res.json(await gb.readAll(db, resolveReadWarehouse(req))); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Items — admin only
  router.post('/items', auth, requireAdmin, async (req, res) => {
    try {
      const warehouse = resolveWriteWarehouse(req);
      if (!warehouse) return res.status(400).json({ error: 'Select a specific godown before adding an item.' });
      res.json({ ok: true, id: await gb.addItem(db, { ...req.body, warehouse }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/items/bulk', auth, requireAdmin, async (req, res) => {
    try {
      const warehouse = resolveWriteWarehouse(req);
      if (!warehouse) return res.status(400).json({ error: 'Select a specific godown before importing items.' });
      await gb.addItemsBulk(db, req.body.items || [], warehouse);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/items/:id', auth, requireAdmin, async (req, res) => {
    try { await gb.editItem(db, req.params.id, req.body); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Bills (the IN/OUT transaction ledger)
  router.post('/bills', auth, async (req, res) => {
    try {
      const warehouse = resolveWriteWarehouse(req);
      if (!warehouse) return res.status(400).json({ error: 'Select a specific godown before creating a bill.' });
      res.json({ ok: true, billGroup: await gb.createBill(db, req.user, { ...req.body, warehouse }) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.put('/bills/:billGroup', auth, async (req, res) => {
    try { await gb.editBill(db, req.user, req.params.billGroup, req.body); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.delete('/bills/:billGroup', auth, async (req, res) => {
    try { await gb.deleteBill(db, req.user, req.params.billGroup); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Bills Received / Pending / Dispatched
  router.post('/received-bills', auth, async (req, res) => {
    try {
      const warehouse = resolveWriteWarehouse(req);
      if (!warehouse) return res.status(400).json({ error: 'Select a specific godown before adding received bills.' });
      res.json({ ok: true, ids: await gb.addReceivedBills(db, req.body.bills || [], warehouse) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/received-bills/:id/dispatch', auth, async (req, res) => {
    try { await gb.markBillDispatched(db, req.params.id, req.body.outwardBillGroup); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/received-bills/:id', auth, async (req, res) => {
    try { await gb.deleteReceivedBill(db, req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Customers
  router.post('/customers', auth, requireAdmin, async (req, res) => {
    try {
      const warehouse = resolveWriteWarehouse(req);
      if (!warehouse) return res.status(400).json({ error: 'Select a specific godown before adding a customer.' });
      res.json({ ok: true, id: await gb.addCustomer(db, { ...req.body, warehouse }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.post('/customers/bulk', auth, requireAdmin, async (req, res) => {
    try {
      const warehouse = resolveWriteWarehouse(req);
      if (!warehouse) return res.status(400).json({ error: 'Select a specific godown before importing customers.' });
      await gb.addCustomersBulk(db, req.body.customers || [], warehouse);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/customers/:id', auth, requireAdmin, async (req, res) => {
    try { await gb.editCustomer(db, req.params.id, req.body); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/customers/:id', auth, requireAdmin, async (req, res) => {
    try { await gb.deleteCustomer(db, req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

module.exports = godownRoutes;
