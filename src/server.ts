import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';

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

app.listen(PORT, () => {
  console.log('');
  console.log('Living Dairies');
  console.log('---------------------------------------');
  console.log(`  Public:  http://localhost:${PORT}`);
  console.log(`  Admin:   http://localhost:${PORT}/admin`);
  console.log('---------------------------------------');
  console.log('');
});
