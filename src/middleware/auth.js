const { requireSession } = require('../services/authService');

// Reads the token from the Authorization header ("Bearer <token>") and
// attaches req.user if valid. Sends 401 with a message the frontend can
// detect and use to force a re-login if not.
function requireAuth(db) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = await requireSession(db, token);
    if (!user) return res.status(401).json({ error: 'session expired — please log in again' });
    req.user = user;
    next();
  };
}

// Use after requireAuth for routes only an admin may call.
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

module.exports = { requireAuth, requireAdmin };
