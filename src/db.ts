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

export type OrderStatus = 'pending' | 'in_delivery' | 'completed';

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
  created_at: string;
}

export interface OrderWithProduct extends Order {
  product_name: string;
  product_price: number;
}

export interface Admin {
  id: number;
  username: string;
  password_hash: string;
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
      CHECK(status IN ('pending', 'in_delivery', 'completed')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`✓ Seeded admin user "${username}" (CHANGE PASSWORD IN PRODUCTION!)`);
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
    notes: string | null
  ) =>
    db.prepare(`
      INSERT INTO orders (customer_name, customer_phone, customer_address, product_id, quantity, total_price, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(customer_name, customer_phone, customer_address, product_id, quantity, total_price, notes),

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
      WHERE o.status = 'completed'
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
};
