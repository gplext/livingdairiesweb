import { Router } from 'express';
import { queries } from '../db';
import { isMailEnabled, sendOrderNotification, sendCustomerConfirmation, sendContactMessage, OrderEmailData } from '../mailer';
import { issueFormToken, checkForm, rateLimit, text, oneLine, hasLink, isPakistaniPhone } from '../antispam';

const router = Router();

// Spam limits: form submissions allowed per IP address per hour
const HOUR = 60 * 60 * 1000;
const orderLimit = rateLimit(15, HOUR);
const contactLimit = rateLimit(5, HOUR);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/form-token - the order and contact pages fetch this when they load.
// Form submissions without a valid token are refused (see src/antispam.ts).
router.get('/form-token', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, token: issueFormToken() });
});

// GET /api/products - list all products
router.get('/products', (_req, res) => {
  try {
    const products = queries.getAllProducts();
    res.json({ ok: true, products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to fetch products' });
  }
});

// POST /api/orders - place an order
router.post('/orders', orderLimit, (req, res) => {
  try {
    const blocked = checkForm(req.body);
    if (blocked) {
      console.warn(`[antispam] order blocked (${blocked.code}) from ${req.ip}`);
      return res.status(400).json({ ok: false, ...blocked });
    }

    const { productId, quantity } = req.body;
    const name = oneLine(req.body.name);
    const phone = oneLine(req.body.phone);
    const address = text(req.body.address);
    const notes = oneLine(req.body.notes) || null;

    // Validation
    if (!name || !phone || !address || !productId || !quantity) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    if (name.length < 2 || name.length > 80 || hasLink(name)) {
      return res.status(400).json({ ok: false, error: 'Please enter your full name' });
    }
    if (!isPakistaniPhone(phone)) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid Pakistani phone number, e.g. 0300 1234567' });
    }
    // A deliverable address has several parts ("House 12, Street 4, Gulberg").
    // The order bots send one random word, e.g. "Umcfyykun".
    const addressParts = address.split(/[\s,،]+/).filter(Boolean);
    if (address.length < 8 || address.length > 300 || addressParts.length < 2) {
      return res.status(400).json({ ok: false, error: 'Please enter your complete delivery address (house, street and area)' });
    }
    if (notes && notes.length > 300) {
      return res.status(400).json({ ok: false, error: 'Delivery notes are too long (300 characters maximum)' });
    }
    // A Google Maps pin for the address is fine; any other link is not.
    if (hasLink(address, true) || (notes && hasLink(notes, true))) {
      return res.status(400).json({ ok: false, error: 'Website links are not allowed. Please type your address instead' });
    }

    // Optional email — validate only if provided
    const customerEmail = text(req.body.email) || null;
    if (customerEmail && !EMAIL_RE.test(customerEmail)) {
      return res.status(400).json({ ok: false, error: 'Invalid email address' });
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 1 || qty > 100) {
      return res.status(400).json({ ok: false, error: 'Quantity must be between 1 and 100' });
    }

    const product = queries.getProduct(parseInt(productId));
    if (!product) {
      return res.status(400).json({ ok: false, error: 'Product not found' });
    }

    const total = product.price * qty;
    const result = queries.createOrder(name, phone, address, product.id, qty, total, notes, customerEmail);

    // Fire-and-forget email notifications: the customer gets their response
    // immediately; email failures are logged and never block the order.
    const orderId = Number(result.lastInsertRowid);
    if (isMailEnabled()) {
      const emailData: OrderEmailData = {
        orderId,
        customerName: name,
        customerPhone: phone,
        customerAddress: address,
        customerEmail,
        productName: product.name,
        quantity: qty,
        totalPrice: total,
        notes,
      };
      sendOrderNotification(emailData)
        .then(() => {
          queries.markOrderEmailSent(orderId);
          console.log(`[mailer] admin notified for order #${orderId}`);
        })
        .catch((err) => console.error(`[mailer] admin notification FAILED for order #${orderId}:`, err.message));
      sendCustomerConfirmation(emailData)
        .catch((err) => console.error(`[mailer] customer confirmation failed for order #${orderId}:`, err.message));
    } else {
      console.warn('[mailer] SMTP not configured — no order notification sent. Set SMTP_HOST and ADMIN_EMAIL in .env');
    }

    res.json({
      ok: true,
      orderId: result.lastInsertRowid,
      total,
      message: 'Order placed successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to place order' });
  }
});

// POST /api/contact - forward contact-form messages to the notification email list
router.post('/contact', contactLimit, (req, res) => {
  try {
    const blocked = checkForm(req.body);
    if (blocked) {
      console.warn(`[antispam] contact message blocked (${blocked.code}) from ${req.ip}`);
      return res.status(400).json({ ok: false, ...blocked });
    }

    const msg = {
      name: oneLine(req.body.name).slice(0, 200),
      phone: oneLine(req.body.phone).slice(0, 50) || null,
      email: oneLine(req.body.email).slice(0, 200) || null,
      subject: oneLine(req.body.subject).slice(0, 200) || null,
      message: text(req.body.message).slice(0, 5000),
    };
    if (!msg.name || !msg.message) {
      return res.status(400).json({ ok: false, error: 'Name and message are required' });
    }
    if (msg.email && !EMAIL_RE.test(msg.email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email address' });
    }
    if ([msg.name, msg.phone, msg.subject, msg.message].some((field) => field && hasLink(field))) {
      return res.status(400).json({ ok: false, error: 'Website links are not allowed. Please remove them from your message and try again' });
    }
    if (isMailEnabled()) {
      sendContactMessage(msg)
        .then(() => console.log(`[mailer] contact message from "${msg.name}" forwarded`))
        .catch((err) => console.error('[mailer] contact message FAILED:', err.message));
    } else {
      console.warn('[mailer] SMTP not configured — contact message not emailed');
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to send message' });
  }
});

export default router;
// order notifications: see src/mailer.ts
