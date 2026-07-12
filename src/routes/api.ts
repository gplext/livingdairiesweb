import { Router } from 'express';
import { queries } from '../db';
import { isMailEnabled, sendOrderNotification, sendCustomerConfirmation, sendContactMessage, OrderEmailData } from '../mailer';

const router = Router();

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
router.post('/orders', (req, res) => {
  try {
    const { name, phone, address, productId, quantity, notes, email } = req.body;

    // Validation
    if (!name || !phone || !address || !productId || !quantity) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    // Optional email — validate only if provided
    const customerEmail = email && String(email).trim() ? String(email).trim() : null;
    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
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
    const result = queries.createOrder(
      String(name).trim(),
      String(phone).trim(),
      String(address).trim(),
      product.id,
      qty,
      total,
      notes ? String(notes).trim() : null,
      customerEmail
    );

    // Fire-and-forget email notifications: the customer gets their response
    // immediately; email failures are logged and never block the order.
    const orderId = Number(result.lastInsertRowid);
    if (isMailEnabled()) {
      const emailData: OrderEmailData = {
        orderId,
        customerName: String(name).trim(),
        customerPhone: String(phone).trim(),
        customerAddress: String(address).trim(),
        customerEmail,
        productName: product.name,
        quantity: qty,
        totalPrice: total,
        notes: notes ? String(notes).trim() : null,
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
router.post('/contact', (req, res) => {
  try {
    const { name, phone, email, subject, message } = req.body;
    if (!name || !message) {
      return res.status(400).json({ ok: false, error: 'Name and message are required' });
    }
    const msg = {
      name: String(name).trim().slice(0, 200),
      phone: phone ? String(phone).trim().slice(0, 50) : null,
      email: email ? String(email).trim().slice(0, 200) : null,
      subject: subject ? String(subject).trim().slice(0, 200) : null,
      message: String(message).trim().slice(0, 5000),
    };
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
