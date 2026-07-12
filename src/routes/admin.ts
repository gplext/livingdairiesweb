import { Router } from 'express';
import bcrypt from 'bcrypt';
import { queries, OrderStatus } from '../db';
import { requireAdmin, requireSuperAdmin } from '../middleware/auth';
import { getSmtpConfig, sendTestEmail } from '../mailer';

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

  if (!admin.active) {
    req.session.flash = { type: 'error', message: 'This account has been disabled' };
    return res.redirect('/admin/login');
  }

  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  req.session.adminRole = admin.role;
  queries.recordAdminLogin(admin.id);
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

  if (isNaN(id) || !['pending', 'in_delivery', 'completed', 'cancelled'].includes(status)) {
    req.session.flash = { type: 'error', message: 'Invalid request' };
    return res.redirect('/admin/orders');
  }

  queries.updateOrderStatus(id, status);
  const label = status === 'in_delivery' ? 'In Delivery' : status[0].toUpperCase() + status.slice(1);
  req.session.flash = { type: 'success', message: `Order #${id} → ${label}` };
  res.redirect('/admin/orders');
});

// ============= ADMIN USERS (super admin only) =============
router.get('/users', requireSuperAdmin, (req, res) => {
  const admins = queries.getAllAdmins();
  const flash = req.session.flash;
  delete req.session.flash;
  res.render('admin/users', {
    page: 'users',
    username: req.session.adminUsername,
    currentId: req.session.adminId,
    admins,
    flash,
  });
});

router.post('/users/add', requireSuperAdmin, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'super' ? 'super' : 'admin';

  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    req.session.flash = { type: 'error', message: 'Username must be 3–30 characters (letters, numbers, _ . -)' };
    return res.redirect('/admin/users');
  }
  if (password.length < 8) {
    req.session.flash = { type: 'error', message: 'Password must be at least 8 characters' };
    return res.redirect('/admin/users');
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    queries.addAdmin(username, hash, role);
    req.session.flash = { type: 'success', message: `Admin "${username}" created — share the credentials with them` };
  } catch {
    req.session.flash = { type: 'error', message: 'That username is already taken' };
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/password', requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const password = String(req.body.password || '');
  if (isNaN(id) || !queries.getAdminById(id)) {
    req.session.flash = { type: 'error', message: 'Admin not found' };
    return res.redirect('/admin/users');
  }
  if (password.length < 8) {
    req.session.flash = { type: 'error', message: 'Password must be at least 8 characters' };
    return res.redirect('/admin/users');
  }
  queries.updateAdminPassword(id, await bcrypt.hash(password, 10));
  req.session.flash = { type: 'success', message: 'Password updated' };
  res.redirect('/admin/users');
});

router.post('/users/:id/toggle', requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const target = isNaN(id) ? undefined : queries.getAdminById(id);
  if (!target) {
    req.session.flash = { type: 'error', message: 'Admin not found' };
    return res.redirect('/admin/users');
  }
  if (target.id === req.session.adminId) {
    req.session.flash = { type: 'error', message: 'You cannot disable your own account' };
    return res.redirect('/admin/users');
  }
  if (target.role === 'super' && target.active && queries.countActiveSupers() <= 1) {
    req.session.flash = { type: 'error', message: 'Cannot disable the last super admin' };
    return res.redirect('/admin/users');
  }
  queries.toggleAdminActive(id);
  req.session.flash = { type: 'success', message: `"${target.username}" ${target.active ? 'disabled' : 'enabled'}` };
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const target = isNaN(id) ? undefined : queries.getAdminById(id);
  if (!target) {
    req.session.flash = { type: 'error', message: 'Admin not found' };
    return res.redirect('/admin/users');
  }
  if (target.id === req.session.adminId) {
    req.session.flash = { type: 'error', message: 'You cannot delete your own account' };
    return res.redirect('/admin/users');
  }
  if (target.role === 'super' && target.active && queries.countActiveSupers() <= 1) {
    req.session.flash = { type: 'error', message: 'Cannot delete the last super admin' };
    return res.redirect('/admin/users');
  }
  queries.deleteAdmin(id);
  req.session.flash = { type: 'success', message: `Admin "${target.username}" deleted` };
  res.redirect('/admin/users');
});

// Change own password (any admin)
router.post('/password', requireAdmin, async (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const me = queries.getAdminById(req.session.adminId!);
  if (!me || !(await bcrypt.compare(current, me.password_hash))) {
    req.session.flash = { type: 'error', message: 'Current password is incorrect' };
    return res.redirect('/admin');
  }
  if (next.length < 8) {
    req.session.flash = { type: 'error', message: 'New password must be at least 8 characters' };
    return res.redirect('/admin');
  }
  queries.updateAdminPassword(me.id, await bcrypt.hash(next, 10));
  req.session.flash = { type: 'success', message: 'Your password has been changed' };
  res.redirect('/admin');
});

// ============= NOTIFICATIONS (recipient list + SMTP settings) =============
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/notifications', requireAdmin, (req, res) => {
  const recipients = queries.getAllNotificationEmails();
  const smtp = getSmtpConfig();
  const flash = req.session.flash;
  delete req.session.flash;
  res.render('admin/notifications', {
    page: 'notifications',
    username: req.session.adminUsername,
    recipients,
    smtp: { ...smtp, pass: smtp.pass ? '********' : '' }, // never expose the password
    fallbackEmail: process.env.ADMIN_EMAIL || null,
    flash,
  });
});

router.post('/notifications/emails/add', requireAdmin, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const label = String(req.body.label || '').trim() || null;

  if (!EMAIL_RE.test(email)) {
    req.session.flash = { type: 'error', message: 'Invalid email address' };
    return res.redirect('/admin/notifications');
  }
  try {
    queries.addNotificationEmail(email, label);
    req.session.flash = { type: 'success', message: `${email} will now receive order alerts` };
  } catch {
    req.session.flash = { type: 'error', message: 'That email is already on the list' };
  }
  res.redirect('/admin/notifications');
});

router.post('/notifications/emails/:id/delete', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (!isNaN(id)) {
    queries.deleteNotificationEmail(id);
    req.session.flash = { type: 'success', message: 'Recipient removed' };
  }
  res.redirect('/admin/notifications');
});

router.post('/notifications/emails/:id/toggle', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (!isNaN(id)) {
    queries.toggleNotificationEmail(id);
    req.session.flash = { type: 'success', message: 'Recipient updated' };
  }
  res.redirect('/admin/notifications');
});

router.post('/notifications/smtp', requireAdmin, (req, res) => {
  const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, mail_from } = req.body;

  const port = parseInt(smtp_port);
  if (smtp_port && (isNaN(port) || port < 1 || port > 65535)) {
    req.session.flash = { type: 'error', message: 'Invalid SMTP port' };
    return res.redirect('/admin/notifications');
  }

  queries.setSetting('smtp_host', String(smtp_host || '').trim());
  queries.setSetting('smtp_port', String(port || 587));
  queries.setSetting('smtp_secure', smtp_secure === 'on' ? 'true' : 'false');
  queries.setSetting('smtp_user', String(smtp_user || '').trim());
  queries.setSetting('mail_from', String(mail_from || '').trim());
  // Only overwrite the password if a new one was typed (field left blank = keep existing)
  if (smtp_pass && String(smtp_pass).trim() && String(smtp_pass).trim() !== '********') {
    queries.setSetting('smtp_pass', String(smtp_pass).trim());
  }

  req.session.flash = { type: 'success', message: 'SMTP settings saved — send a test email to verify' };
  res.redirect('/admin/notifications');
});

router.post('/notifications/test', requireAdmin, async (req, res) => {
  try {
    const recipients = await sendTestEmail();
    req.session.flash = { type: 'success', message: `Test email sent to: ${recipients.join(', ')}` };
  } catch (err) {
    req.session.flash = { type: 'error', message: `Test failed: ${(err as Error).message}` };
  }
  res.redirect('/admin/notifications');
});

export default router;
