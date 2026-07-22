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

// Basic housekeeping: clear out expired sessions periodically.
setInterval(() => { cleanupExpiredSessions(db).catch(() => {}); }, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
