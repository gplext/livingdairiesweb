import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'livingdairies.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============= TYPES =============
export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  image_url: string;
  created_at: string;
}

export type OrderStatus = 'pending' | 'in_delivery' | 'completed' | 'cancelled';

export interface Order {
  id: number;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  product_id: number;
  quantity: number;
  total_price: number;
  status: OrderStatus;
  notes: string | null;
  customer_email: string | null;
  email_sent: number;
  created_at: string;
}

export interface OrderWithProduct extends Order {
  product_name: string;
  product_price: number;
}

export type AdminRole = 'super' | 'admin';

export interface Admin {
  id: number;
  username: string;
  password_hash: string;
  role: AdminRole;
  active: number;
  last_login: string | null;
}

export interface NotificationEmail {
  id: number;
  email: string;
  label: string | null;
  active: number;
  created_at: string;
}

// ============= SCHEMA =============
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    image_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_address TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    total_price REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'in_delivery', 'completed', 'cancelled')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    customer_email TEXT,
    email_sent INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
`);

// Notification recipients (managed in admin console)
db.exec(`
  CREATE TABLE IF NOT EXISTS notification_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    label TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ============= MIGRATIONS (safe to run repeatedly) =============
const orderCols = db.prepare(`PRAGMA table_info(orders)`).all() as { name: string }[];
if (!orderCols.some((c) => c.name === 'customer_email')) {
  db.exec(`ALTER TABLE orders ADD COLUMN customer_email TEXT`);
  console.log('✓ Migration: added orders.customer_email');
}
if (!orderCols.some((c) => c.name === 'email_sent')) {
  db.exec(`ALTER TABLE orders ADD COLUMN email_sent INTEGER NOT NULL DEFAULT 0`);
  console.log('✓ Migration: added orders.email_sent');
}

// Admin roles: role / active / last_login columns
const adminCols = db.prepare(`PRAGMA table_info(admins)`).all() as { name: string }[];
if (!adminCols.some((c) => c.name === 'role')) {
  db.exec(`ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'`);
  console.log('✓ Migration: added admins.role');
}
if (!adminCols.some((c) => c.name === 'active')) {
  db.exec(`ALTER TABLE admins ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
  console.log('✓ Migration: added admins.active');
}
if (!adminCols.some((c) => c.name === 'last_login')) {
  db.exec(`ALTER TABLE admins ADD COLUMN last_login TEXT`);
  console.log('✓ Migration: added admins.last_login');
}
// Ensure at least one super admin exists: promote the oldest active admin
const superCount = (db.prepare("SELECT COUNT(*) as c FROM admins WHERE role = 'super'").get() as { c: number }).c;
if (superCount === 0) {
  const first = db.prepare('SELECT id, username FROM admins ORDER BY id ASC LIMIT 1').get() as { id: number; username: string } | undefined;
  if (first) {
    db.prepare("UPDATE admins SET role = 'super', active = 1 WHERE id = ?").run(first.id);
    console.log(`✓ Migration: "${first.username}" promoted to super admin`);
  }
}

// Allow 'cancelled' status (requires table rebuild — SQLite can't alter CHECK constraints)
const ordersSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get() as { sql: string }).sql;
if (!ordersSql.includes("'cancelled'")) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE orders_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        customer_address TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        total_price REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'in_delivery', 'completed', 'cancelled')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        customer_email TEXT,
        email_sent INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      INSERT INTO orders_new (id, customer_name, customer_phone, customer_address, product_id, quantity,
        total_price, status, notes, created_at, customer_email, email_sent)
      SELECT id, customer_name, customer_phone, customer_address, product_id, quantity,
        total_price, status, notes, created_at, customer_email, email_sent FROM orders;
      DROP TABLE orders;
      ALTER TABLE orders_new RENAME TO orders;
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    `);
  })();
  db.pragma('foreign_keys = ON');
  console.log("✓ Migration: orders table now supports 'cancelled' status");
}

// ============= SEED =============
const productCount = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;
if (productCount === 0) {
  db.prepare(`
    INSERT INTO products (name, description, price, image_url) VALUES (?, ?, ?, ?)
  `).run(
    'Fresh Farm Milk',
    'Pure cow milk, hand-collected at dawn from our family farms in Punjab. No preservatives, no powders, no shortcuts. Delivered same-day, chilled and ready to enjoy.',
    245,
    'img/Order/Pour_from_MilkPacking.png'
  );
  console.log('✓ Seeded default product');
}

const adminCount = (db.prepare('SELECT COUNT(*) as c FROM admins').get() as { c: number }).c;
if (adminCount === 0) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'dairies123';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO admins (username, password_hash, role) VALUES (?, ?, 'super')").run(username, hash);
  console.log(`✓ Seeded super admin "${username}" (CHANGE PASSWORD IN PRODUCTION!)`);
}

// Safety net: if no super admin exists (e.g. DB created before roles existed),
// promote the oldest active admin. Runs after seeding so fresh DBs are covered too.
const superCheck = (db.prepare("SELECT COUNT(*) as c FROM admins WHERE role = 'super'").get() as { c: number }).c;
if (superCheck === 0) {
  const oldest = db.prepare('SELECT id, username FROM admins ORDER BY id ASC LIMIT 1').get() as { id: number; username: string } | undefined;
  if (oldest) {
    db.prepare("UPDATE admins SET role = 'super', active = 1 WHERE id = ?").run(oldest.id);
    console.log(`✓ Migration: "${oldest.username}" promoted to super admin`);
  }
}

// ============= QUERIES =============
export const queries = {
  // Products
  getAllProducts: () => db.prepare('SELECT * FROM products ORDER BY id ASC').all() as Product[],
  getProduct: (id: number) => db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined,
  addProduct: (name: string, description: string, price: number, image_url: string) =>
    db.prepare('INSERT INTO products (name, description, price, image_url) VALUES (?, ?, ?, ?)').run(name, description, price, image_url),
  deleteProduct: (id: number) =>
    db.prepare('DELETE FROM products WHERE id = ?').run(id),

  // Orders
  createOrder: (
    customer_name: string,
    customer_phone: string,
    customer_address: string,
    product_id: number,
    quantity: number,
    total_price: number,
    notes: string | null,
    customer_email: string | null = null
  ) =>
    db.prepare(`
      INSERT INTO orders (customer_name, customer_phone, customer_address, product_id, quantity, total_price, notes, customer_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(customer_name, customer_phone, customer_address, product_id, quantity, total_price, notes, customer_email),

  markOrderEmailSent: (id: number) =>
    db.prepare('UPDATE orders SET email_sent = 1 WHERE id = ?').run(id),

  getActiveOrders: () =>
    db.prepare(`
      SELECT o.*, p.name AS product_name, p.price AS product_price
      FROM orders o JOIN products p ON o.product_id = p.id
      WHERE o.status IN ('pending', 'in_delivery')
      ORDER BY o.created_at DESC
    `).all() as OrderWithProduct[],

  getCompletedOrders: () =>
    db.prepare(`
      SELECT o.*, p.name AS product_name, p.price AS product_price
      FROM orders o JOIN products p ON o.product_id = p.id
      WHERE o.status IN ('completed', 'cancelled')
      ORDER BY o.created_at DESC
      LIMIT 200
    `).all() as OrderWithProduct[],

  updateOrderStatus: (id: number, status: OrderStatus) =>
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id),

  // Dashboard stats
  getDashboardStats: () => {
    const total = (db.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number }).c;
    const pending = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get() as { c: number }).c;
    const inDelivery = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'in_delivery'").get() as { c: number }).c;
    const completed = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'completed'").get() as { c: number }).c;
    const revenueRow = db.prepare("SELECT COALESCE(SUM(total_price), 0) as r FROM orders WHERE status = 'completed'").get() as { r: number };
    return { total, pending, inDelivery, completed, revenue: revenueRow.r };
  },

  getOrdersByMonth: () =>
    db.prepare(`
      SELECT
        strftime('%Y-%m', created_at) AS month,
        COUNT(*) AS count,
        COALESCE(SUM(total_price), 0) AS revenue
      FROM orders
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `).all() as { month: string; count: number; revenue: number }[],

  // Admin
  getAdminByUsername: (username: string) =>
    db.prepare('SELECT * FROM admins WHERE username = ?').get(username) as Admin | undefined,
  getAdminById: (id: number) =>
    db.prepare('SELECT * FROM admins WHERE id = ?').get(id) as Admin | undefined,
  getAllAdmins: () =>
    db.prepare('SELECT id, username, role, active, last_login FROM admins ORDER BY id ASC').all() as Omit<Admin, 'password_hash'>[],
  addAdmin: (username: string, password_hash: string, role: AdminRole) =>
    db.prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)').run(username, password_hash, role),
  updateAdminPassword: (id: number, password_hash: string) =>
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(password_hash, id),
  toggleAdminActive: (id: number) =>
    db.prepare('UPDATE admins SET active = 1 - active WHERE id = ?').run(id),
  deleteAdmin: (id: number) =>
    db.prepare('DELETE FROM admins WHERE id = ?').run(id),
  recordAdminLogin: (id: number) =>
    db.prepare("UPDATE admins SET last_login = datetime('now') WHERE id = ?").run(id),
  countActiveSupers: () =>
    (db.prepare("SELECT COUNT(*) as c FROM admins WHERE role = 'super' AND active = 1").get() as { c: number }).c,

  // Notification recipients
  getAllNotificationEmails: () =>
    db.prepare('SELECT * FROM notification_emails ORDER BY created_at ASC').all() as NotificationEmail[],
  getActiveNotificationEmails: () =>
    db.prepare('SELECT * FROM notification_emails WHERE active = 1 ORDER BY created_at ASC').all() as NotificationEmail[],
  addNotificationEmail: (email: string, label: string | null) =>
    db.prepare('INSERT INTO notification_emails (email, label) VALUES (?, ?)').run(email, label),
  deleteNotificationEmail: (id: number) =>
    db.prepare('DELETE FROM notification_emails WHERE id = ?').run(id),
  toggleNotificationEmail: (id: number) =>
    db.prepare('UPDATE notification_emails SET active = 1 - active WHERE id = ?').run(id),

  // Settings (key/value, used for SMTP config)
  getSetting: (key: string) =>
    (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value,
  setSetting: (key: string, value: string) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value),
  deleteSetting: (key: string) =>
    db.prepare('DELETE FROM settings WHERE key = ?').run(key),
};
// migrations for customer_email and email_sent run at startup (see above)
