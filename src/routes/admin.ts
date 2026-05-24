import { Router } from 'express';
import bcrypt from 'bcrypt';
import { queries, OrderStatus } from '../db';
import { requireAdmin } from '../middleware/auth';

const router = Router();

// ============= LOGIN / LOGOUT =============
router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  const flash = req.session.flash;
  delete req.session.flash;
  res.render('admin/login', { flash });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    req.session.flash = { type: 'error', message: 'Username and password required' };
    return res.redirect('/admin/login');
  }

  const admin = queries.getAdminByUsername(String(username).trim());
  if (!admin) {
    req.session.flash = { type: 'error', message: 'Invalid credentials' };
    return res.redirect('/admin/login');
  }

  const valid = await bcrypt.compare(String(password), admin.password_hash);
  if (!valid) {
    req.session.flash = { type: 'error', message: 'Invalid credentials' };
    return res.redirect('/admin/login');
  }

  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ============= DASHBOARD =============
router.get('/', requireAdmin, (req, res) => {
  const stats = queries.getDashboardStats();
  const byMonth = queries.getOrdersByMonth().reverse(); // chronological for chart
  const flash = req.session.flash;
  delete req.session.flash;

  res.render('admin/dashboard', {
    page: 'dashboard',
    username: req.session.adminUsername,
    stats,
    byMonth,
    flash,
  });
});

// ============= PRODUCTS =============
router.get('/products', requireAdmin, (req, res) => {
  const products = queries.getAllProducts();
  const flash = req.session.flash;
  delete req.session.flash;
  res.render('admin/products', {
    page: 'products',
    username: req.session.adminUsername,
    products,
    flash,
  });
});

router.post('/products/add', requireAdmin, (req, res) => {
  const { name, description, price, image_url } = req.body;

  if (!name || !description || !price || !image_url) {
    req.session.flash = { type: 'error', message: 'All fields required' };
    return res.redirect('/admin/products');
  }

  const priceNum = parseFloat(price);
  if (isNaN(priceNum) || priceNum <= 0) {
    req.session.flash = { type: 'error', message: 'Invalid price' };
    return res.redirect('/admin/products');
  }

  queries.addProduct(
    String(name).trim(),
    String(description).trim(),
    priceNum,
    String(image_url).trim()
  );
  req.session.flash = { type: 'success', message: `Product "${name}" added` };
  res.redirect('/admin/products');
});

router.post('/products/:id/delete', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    req.session.flash = { type: 'error', message: 'Invalid product id' };
    return res.redirect('/admin/products');
  }
  try {
    queries.deleteProduct(id);
    req.session.flash = { type: 'success', message: 'Product deleted' };
  } catch {
    req.session.flash = { type: 'error', message: 'Cannot delete — product has orders' };
  }
  res.redirect('/admin/products');
});

// ============= ORDERS =============
router.get('/orders', requireAdmin, (req, res) => {
  const orders = queries.getActiveOrders();
  const flash = req.session.flash;
  delete req.session.flash;
  res.render('admin/orders', {
    page: 'orders',
    username: req.session.adminUsername,
    orders,
    flash,
  });
});

router.get('/orders/completed', requireAdmin, (req, res) => {
  const orders = queries.getCompletedOrders();
  const flash = req.session.flash;
  delete req.session.flash;
  res.render('admin/orders-completed', {
    page: 'completed',
    username: req.session.adminUsername,
    orders,
    flash,
  });
});

router.post('/orders/:id/status', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const status = req.body.status as OrderStatus;

  if (isNaN(id) || !['pending', 'in_delivery', 'completed'].includes(status)) {
    req.session.flash = { type: 'error', message: 'Invalid request' };
    return res.redirect('/admin/orders');
  }

  queries.updateOrderStatus(id, status);
  const label = status === 'in_delivery' ? 'In Delivery' : status[0].toUpperCase() + status.slice(1);
  req.session.flash = { type: 'success', message: `Order #${id} → ${label}` };
  res.redirect('/admin/orders');
});

export default router;
