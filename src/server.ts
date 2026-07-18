import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';
import Database from 'better-sqlite3';

// SQLite-backed session store: sessions survive restarts/redeploys (stored in data/)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SqliteStore = require('better-sqlite3-session-store')(session);
const sessionDb = new Database(path.join(__dirname, '..', 'data', 'sessions.db'));

import apiRoutes from './routes/api';
import adminRoutes from './routes/admin';

// initialize db (runs schema + seed)
import './db';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// ============= MIDDLEWARE =============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new SqliteStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 }, // purge expired sessions every 15 min
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      httpOnly: true,
    },
  })
);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// ============= ROUTES =============
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

// Static (public website + admin assets) — comes after routes
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============= 404 =============
app.use((_req, res) => {
  res.status(404).send('Not found');
});

// Graceful shutdown: close DB connections cleanly so redeploys/restarts
// can never interrupt SQLite mid-write.
import { db as mainDb } from './db';
function shutdown(signal: string) {
  console.log(`${signal} received — closing database connections…`);
  try { mainDb.close(); } catch { /* already closed */ }
  try { sessionDb.close(); } catch { /* already closed */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen(PORT, () => {
  console.log('');
  console.log('Living Dairies');
  console.log('---------------------------------------');
  console.log(`  Public:  http://localhost:${PORT}`);
  console.log(`  Admin:   http://localhost:${PORT}/admin`);
  console.log('---------------------------------------');
  console.log('');
});
