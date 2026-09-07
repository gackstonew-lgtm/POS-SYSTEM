const { getSupabaseClient, jsonResponse } = require('./db');
const { verifyTokenFromHeader } = require('./auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { success: true });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Invalid request method.' });
  }

  const user = verifyTokenFromHeader(event.headers);
  if (!user) {
    return jsonResponse(401, { success: false, message: 'Unauthorized session.' });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(422, { success: false, message: 'Invalid JSON checkout payload.' });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const paymentMethod = String(payload.payment_method || '').toLowerCase().trim();
  const discountInput = Math.max(0, Number(payload.discount || 0));

  if (!['cash', 'card', 'mpesa'].includes(paymentMethod)) {
    return jsonResponse(422, { success: false, message: 'Choose Cash, Card, or M-PESA payment.' });
  }

  if (items.length === 0) {
    return jsonResponse(422, { success: false, message: 'The cart is empty.' });
  }

  if (paymentMethod === 'mpesa' && !String(payload.mpesa_phone || '').trim()) {
    return jsonResponse(422, { success: false, message: 'Mpesa phone number is required.' });
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const randNum = Math.floor(100 + Math.random() * 900);
  const saleReference = `KE-${dateStr}-${timeStr}-${randNum}`;

  const client = getSupabaseClient();

  try {
    let subtotal = 0.0;
    const cleanItems = [];

    for (const item of items) {
      const productId = Number(item.product_id || 0);
      const quantity = Number(item.quantity || 1);

      if (productId <= 0 || quantity <= 0) {
        throw new Error('One or more cart items are invalid.');
      }

      const { data: products, error: productError } = await client
        .from('products')
        .select('id, name, selling_price, stock_quantity')
        .eq('id', productId)
        .is('deleted_at', null)
        .eq('is_active', true)
        .limit(1);

      if (productError) {
        throw new Error(productError.message);
      }

      const product = products && products.length > 0 ? products[0] : null;

      if (!product) {
        throw new Error('A selected product no longer exists.');
      }

      if (Number(product.stock_quantity) < quantity) {
        throw new Error(`${product.name} does not have enough stock.`);
      }

      const price = Number(product.selling_price);
      const lineTotal = Number((price * quantity).toFixed(2));
      subtotal = Number((subtotal + lineTotal).toFixed(2));

      cleanItems.push({
        product_id: Number(product.id),
        name: String(product.name),
        price,
        quantity,
        line_total: lineTotal,
        new_stock: Number((Number(product.stock_quantity) - quantity).toFixed(4))
      });
    }

    const discount = Number(Math.min(discountInput, subtotal).toFixed(2));
    const tax = 0.0;
    const total = Number(((subtotal - discount) + tax).toFixed(2));
    const paymentStatus = (paymentMethod === 'mpesa') ? 'pending' : 'paid';
    const customerName = String(payload.customer_name || 'Walk-in customer').trim() || 'Walk-in customer';

    const { data: sale, error: saleError } = await client
      .from('sales')
      .insert({
        reference: saleReference,
        customer_name: customerName,
        subtotal,
        discount,
        tax,
        total,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        cashier_id: user.id || null
      })
      .select()
      .single();

    if (saleError) {
      throw new Error(saleError.message);
    }

    const saleId = sale.id;

    const saleItems = cleanItems.map((line) => ({
      sale_id: saleId,
      product_id: line.product_id,
      quantity: line.quantity,
      unit_price: line.price,
      line_total: line.line_total
    }));

    const { error: itemsError } = await client
      .from('sale_items')
      .insert(saleItems);

    if (itemsError) {
      throw new Error(itemsError.message);
    }

    if (paymentMethod !== 'mpesa') {
      for (const line of cleanItems) {
        const { error: stockError } = await client
          .from('products')
          .update({ stock_quantity: line.new_stock })
          .eq('id', line.product_id);

        if (stockError) {
          throw new Error(stockError.message);
        }
      }
    }

    return jsonResponse(200, {
      success: true,
      message: paymentMethod === 'mpesa'
        ? 'Pending M-PESA sale created. Send STK Push to complete payment.'
        : `${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)} sale completed successfully.`,
      sale_id: saleId,
      sale_reference: saleReference,
      payment_status: paymentStatus,
      totals: {
        subtotal,
        discount,
        tax,
        total
      },
      items: cleanItems
    });
  } catch (error) {
    return jsonResponse(422, { success: false, message: error.message || 'Checkout failed.' });
  }
};
