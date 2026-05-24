import { Router } from 'express';
import { queries } from '../db';

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
    const { name, phone, address, productId, quantity, notes } = req.body;

    // Validation
    if (!name || !phone || !address || !productId || !quantity) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
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
      notes ? String(notes).trim() : null
    );

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

export default router;
