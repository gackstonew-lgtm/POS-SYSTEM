const assert = require('assert');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { handler: reportsHandler } = require('../lib/reports');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const adminToken = jwt.sign({ id: 1, role: 'super_admin', email: 'admin@karing.com' }, JWT_SECRET);
const cashierToken = jwt.sign({ id: 2, role: 'cashier', email: 'cashier@karing.com' }, JWT_SECRET);

async function runAllTests() {
  console.log('====================================================');
  console.log('STARTING COMPREHENSIVE REPORTS & ANALYTICS TEST SUITE');
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

  // 1. Permissions & Access Control
  await it('1. Rejects unauthenticated request (403)', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
    assert.strictEqual(res.statusCode, 403);
  });

  await it('2. Rejects cashier role (restricted to Admins) (403)', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${cashierToken}` }, queryStringParameters: {} });
    assert.strictEqual(res.statusCode, 403);
  });

  // 2. Date Validations & Calendar Safety
  await it('3. Rejects invalid calendar date (2026-09-31) (400)', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-08-01', to: '2026-09-31' } });
    assert.strictEqual(res.statusCode, 400);
  });

  await it('4. Rejects non-leap February 29 (2026-02-29) (400)', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-02-01', to: '2026-02-29' } });
    assert.strictEqual(res.statusCode, 400);
  });

  await it('5. Accepts leap year February 29 (2024-02-29) (200)', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2024-02-01', to: '2024-02-29' } });
    assert.strictEqual(res.statusCode, 200);
  });

  await it('6. Accepts 30-day month boundary (2026-09-30) (200)', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-09-01', to: '2026-09-30' } });
    assert.strictEqual(res.statusCode, 200);
  });

  await it('7. Accepts 31-day month boundary (2026-08-31) (200)', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-08-01', to: '2026-08-31' } });
    assert.strictEqual(res.statusCode, 200);
  });

  await it('8. Rejects inverted date range (from > to) (400)', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-09-07', to: '2026-08-31' } });
    assert.strictEqual(res.statusCode, 400);
  });

  // 3. Same-Day & Multi-Day Reports
  await it('9. Supports same-day report (from == to)', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-09-07', to: '2026-09-07' } });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.soldProducts));
  });

  await it('10. Supports multi-day date range spanning months', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-08-15', to: '2026-09-07' } });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.soldProducts.length > 0);
  });

  // 4. Successful Products Field Verification
  await it('11. Sold product records contain all required fields (Product, Qty, Amount, Payment, Date, Time)', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-08-01', to: '2026-09-07' } });
    const body = JSON.parse(res.body);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(body.soldProducts.length > 0, 'Expected at least one sold product');
    const sample = body.soldProducts[0];
    assert.ok(typeof sample.product_name === 'string' && sample.product_name.length > 0, 'Missing product_name');
    assert.ok(typeof sample.quantity === 'number' && sample.quantity > 0, 'Invalid quantity');
    assert.ok(typeof sample.amount === 'number', 'Invalid amount');
    assert.ok(['Cash', 'Card', 'M-PESA'].includes(sample.payment_type), 'Invalid payment_type');
    assert.ok(/^\d{2}\/\d{2}\/\d{4}$/.test(sample.date), 'Date must be DD/MM/YYYY');
    assert.ok(/^\d{2}:\d{2}$/.test(sample.time), 'Time must be HH:MM');
  });

  // 5. Fractional Quantity Preservation in Reports
  await it('12. Preserves fractional quantities (e.g. 1.25, 2.25) without truncation in soldProducts', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-08-01', to: '2026-09-07' } });
    const body = JSON.parse(res.body);
    const fractionalItems = body.soldProducts.filter(p => !Number.isInteger(p.quantity));
    assert.ok(fractionalItems.length > 0, 'Expected fractional sold items to be present');
    assert.ok(fractionalItems.some(p => p.quantity === 1.25 || p.quantity === 0.25), 'Fractional quantities must match exact decimal value');
  });

  // 6. Cashier Filtering
  await it('13. Filters successfully by specific cashier and All Cashiers', async () => {
    const resAll = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-08-01', to: '2026-09-07', cashier_id: '0' } });
    const bodyAll = JSON.parse(resAll.body);
    const resCashier1 = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-08-01', to: '2026-09-07', cashier_id: '1' } });
    const bodyCashier1 = JSON.parse(resCashier1.body);
    assert.ok(bodyAll.soldProducts.length >= bodyCashier1.soldProducts.length);
  });

  // 7. Only Successful Sales Included
  await it('14. Excludes pending and failed sales from soldProducts', async () => {
    const res = await reportsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { from: '2026-08-01', to: '2026-09-07' } });
    const body = JSON.parse(res.body);
    assert.ok(body.soldProducts.every(p => p.amount > 0));
  });

  console.log('====================================================');
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('====================================================');
  if (failed > 0) process.exit(1);
}

runAllTests();
