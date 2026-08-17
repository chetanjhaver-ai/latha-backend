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
// GodownBook is served BY this server now (moved off Netlify): '/' is a
// small public login shell; '/app' is the full application, handed out only
// to browsers holding a valid session cookie.
app.get('/', gbookRouter.loginPage);
app.get('/app', gbookRouter.appPage);

// Basic housekeeping: clear out expired sessions periodically.
setInterval(() => { cleanupExpiredSessions(db).catch(() => {}); }, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
