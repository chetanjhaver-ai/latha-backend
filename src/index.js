require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const authRoutes = require('./routes/auth');
const { cleanupExpiredSessions } = require('./services/authService');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes(db));
app.use('/api/godown', require('./routes/godown')(db));
app.use('/api/tasks', require('./routes/tasks')(db));
app.use('/api/admin', require('./routes/admin')(db));
app.use('/api/complaints', require('./routes/complaints')(db));
// GodownBook (new version, replaces the old wms/godown module for daily use).
// Its tables are all prefixed gdb_ — fully separate from the old gb_* tables
// (kept as frozen archive) and from the complaints app. Creates its own
// tables on first boot; no migration run needed.
const gbookRouter = require('./routes/godownbook')(db);
app.use('/api/gbook', gbookRouter);
// Both frontends are served BY this server now (moved off Netlify), each
// behind its own login wall. Which app answers '/' depends on which NAME
// was used to reach the server: crm.lechennai.in gets ComplaintBook,
// everything else (godown.lechennai.in / onrender.com) gets GodownBook.
// Path-based routes (/crm, /crm/app) work on every hostname too, so the
// CRM can be tested before its domain is repointed.
const crm = require('./routes/crmpages')(db);
app.get('/', (req, res) => {
  if (String(req.hostname || '').startsWith('crm.')) return crm.loginPage(req, res);
  return gbookRouter.loginPage(req, res);
});
app.get('/app', gbookRouter.appPage);
app.get('/crm', crm.loginPage);
app.get('/crm/app', crm.appPage);

// Basic housekeeping: clear out expired sessions periodically.
setInterval(() => { cleanupExpiredSessions(db).catch(() => {}); }, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
