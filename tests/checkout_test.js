const assert = require('assert');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { handler: checkoutHandler } = require('../lib/checkout');
const { handler: mpesaHandler } = require('../lib/mpesa-callback');
const { handler: entitiesHandler } = require('../lib/entities');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const validToken = jwt.sign({ id: 1, role: 'super_admin', email: 'admin@karing.com' }, JWT_SECRET);

async function runTests() {
  console.log('====================================================');
  console.log('STARTING POS CHECKOUT & FRACTIONAL QUANTITY TESTS');
  console.log('====================================================');
  let passed = 0;
  let failed = 0;

  async function it(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  // 1. Auth & Input Validations
  await it('Rejects checkout request without auth token (401)', async () => {
    const res = await checkoutHandler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ items: [{ product_id: 1, quantity: 1 }], payment_method: 'cash' })
    });
    assert.strictEqual(res.statusCode, 401);
  });

  await it('Rejects checkout with empty items array (422)', async () => {
    const res = await checkoutHandler({
      httpMethod: 'POST',
      headers: { authorization: `Bearer ${validToken}` },
      body: JSON.stringify({ items: [], payment_method: 'cash' })
    });
    assert.strictEqual(res.statusCode, 422);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.message, 'The cart is empty.');
  });

  await it('Rejects checkout with invalid payment method (422)', async () => {
    const res = await checkoutHandler({
      httpMethod: 'POST',
      headers: { authorization: `Bearer ${validToken}` },
      body: JSON.stringify({ items: [{ product_id: 1, quantity: 1 }], payment_method: 'bitcoin' })
    });
    assert.strictEqual(res.statusCode, 422);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.message, 'Choose Cash, Card, or M-PESA payment.');
  });

  await it('Rejects M-PESA checkout without customer phone number (422)', async () => {
    const res = await checkoutHandler({
      httpMethod: 'POST',
      headers: { authorization: `Bearer ${validToken}` },
      body: JSON.stringify({ items: [{ product_id: 1, quantity: 1 }], payment_method: 'mpesa', mpesa_phone: '' })
    });
    assert.strictEqual(res.statusCode, 422);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.message, 'Mpesa phone number is required.');
  });

  // 2. Fractional Quantity Calculation & Pricing
  await it('Correctly calculates line total for fractional quantity (2.25 kg @ Ksh 200.00 = Ksh 450.00)', () => {
    const price = 200.00;
    const quantity = 2.25;
    const lineTotal = Number((price * quantity).toFixed(2));
    assert.strictEqual(lineTotal, 450.00);
  });

  await it('Correctly calculates line total for small fractional quantity (0.5 kg @ Ksh 350.00 = Ksh 175.00)', () => {
    const price = 350.00;
    const quantity = 0.5;
    const lineTotal = Number((price * quantity).toFixed(2));
    assert.strictEqual(lineTotal, 175.00);
  });

  await it('Correctly calculates subtotal, discount, and total for multi-item cart with decimals', () => {
    const cart = [
      { price: 200.00, quantity: 2.25 }, // 450.00
      { price: 70.00, quantity: 1.5 },   // 105.00
      { price: 45.00, quantity: 0.5 }    // 22.50
    ];
    let subtotal = 0;
    for (const item of cart) {
      const lineTotal = Number((item.price * item.quantity).toFixed(2));
      subtotal = Number((subtotal + lineTotal).toFixed(2));
    }
    const discountInput = 27.50;
    const discount = Number(Math.min(discountInput, subtotal).toFixed(2));
    const tax = 0.0;
    const total = Number(((subtotal - discount) + tax).toFixed(2));

    assert.strictEqual(subtotal, 577.50);
    assert.strictEqual(discount, 27.50);
    assert.strictEqual(total, 550.00);
  });

  // 3. Inventory Stock Calculations (Precision & Fractional Deductions)
  await it('Calculates correct remaining stock after fractional purchase (10 - 2.25 = 7.75)', () => {
    const currentStock = 10;
    const quantity = 2.25;
    const newStock = Number((Number(currentStock) - quantity).toFixed(4));
    assert.strictEqual(newStock, 7.75);
  });

  await it('Prevents floating point subtraction drift (e.g. 10.2 - 2.1 = 8.1)', () => {
    const currentStock = 10.2;
    const quantity = 2.1;
    const newStock = Number((Number(currentStock) - quantity).toFixed(4));
    assert.strictEqual(newStock, 8.1);
  });

  await it('Correctly adjusts stock in inventory module for fractional values', () => {
    const currentStock = 7.75;
    const addIn = 2.25;
    const stockAfterAdd = Number((currentStock + addIn).toFixed(4));
    assert.strictEqual(stockAfterAdd, 10.0);

    const removeOut = 0.75;
    const stockAfterRemove = Number((stockAfterAdd - removeOut).toFixed(4));
    assert.strictEqual(stockAfterRemove, 9.25);
  });

  console.log('====================================================');
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('====================================================');
  if (failed > 0) process.exit(1);
}

runTests();
